require('dotenv').config({ path: '../.env' });
const { Telegraf } = require('telegraf');
const axios = require('axios');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;
const TELEGRAM_CHANNEL_ID_ALL = process.env.TELEGRAM_CHANNEL_ID_ALL;
// Enable/disable ALL locations search (default: true if TELEGRAM_CHANNEL_ID_ALL is set)
const ENABLE_ALL_LOCATIONS_SEARCH = process.env.ENABLE_ALL_LOCATIONS_SEARCH !== 'false' && !!TELEGRAM_CHANNEL_ID_ALL;
const LOCATION_SEARCH = process.env.LOCATION_SEARCH || 'north vancouver';
const USE_PLAYWRIGHT_API = process.env.USE_PLAYWRIGHT_API === 'true'; // Use new Playwright API
const DEBUG_MODE = process.env.DEBUG_MODE === 'true'; // New environment variable

// Determine if we're in dev or prod mode
// Defaults to prod if not specified
const BOT_MODE = (process.env.BOT_MODE || 'prod').toLowerCase();
const isDevMode = BOT_MODE === 'dev' || BOT_MODE === 'development';

// Detect if running in Docker or locally
// In Docker: use service name (e.g., "backend")
// Locally: use localhost
const isDocker = process.env.DOCKER_ENV === 'true' || process.env.IN_DOCKER === 'true' || 
                 (process.env.API_URL && process.env.API_URL.includes('backend:'));

// Determine API URLs based on mode (dev/prod) and environment (Docker/local)
// Priority: 1. DEV_API_URL/PROD_API_URL (mode-specific), 2. API_URL (legacy), 3. Auto-detect
let API_URL, API_URL_ALL, API_URL_SEARCH;

if (isDevMode) {
    // Development mode - use DEV_API_URL if set, otherwise fall back to auto-detect
    if (process.env.DEV_API_URL) {
        API_URL = process.env.DEV_API_URL;
        API_URL_ALL = process.env.DEV_API_URL_ALL || API_URL.replace('/appointments', '/appointments-all');
        API_URL_SEARCH = process.env.DEV_API_URL_SEARCH || API_URL.replace('/appointments', '/appointments/search');
    } else {
        // Auto-detect for dev mode
        const BACKEND_HOST = process.env.DEV_BACKEND_HOST || process.env.BACKEND_HOST || (isDocker ? 'backend' : 'localhost');
        const BACKEND_PORT = process.env.DEV_BACKEND_PORT || process.env.BACKEND_PORT || process.env.PORT || '3000';
        API_URL = `http://${BACKEND_HOST}:${BACKEND_PORT}/appointments`;
        API_URL_ALL = `http://${BACKEND_HOST}:${BACKEND_PORT}/appointments-all`;
        API_URL_SEARCH = `http://${BACKEND_HOST}:${BACKEND_PORT}/appointments/search`;
    }
} else {
    // Prod mode - use PROD_API_URL if set, otherwise fall back to auto-detect
    if (process.env.PROD_API_URL) {
        API_URL = process.env.PROD_API_URL;
        API_URL_ALL = process.env.PROD_API_URL_ALL || API_URL.replace('/appointments', '/appointments-all');
        API_URL_SEARCH = process.env.PROD_API_URL_SEARCH || API_URL.replace('/appointments', '/appointments/search');
    } else {
        // Auto-detect for prod mode
        const BACKEND_HOST = process.env.PROD_BACKEND_HOST || process.env.BACKEND_HOST || (isDocker ? 'backend' : 'localhost');
        const BACKEND_PORT = process.env.PROD_BACKEND_PORT || process.env.BACKEND_PORT || process.env.PORT || '3000';
        API_URL = `http://${BACKEND_HOST}:${BACKEND_PORT}/appointments`;
        API_URL_ALL = `http://${BACKEND_HOST}:${BACKEND_PORT}/appointments-all`;
        API_URL_SEARCH = `http://${BACKEND_HOST}:${BACKEND_PORT}/appointments/search`;
    }
}

// Legacy support: If API_URL is explicitly set (not mode-specific), use it
// This allows backward compatibility
if (process.env.API_URL && !process.env.DEV_API_URL && !process.env.PROD_API_URL) {
    API_URL = process.env.API_URL;
    API_URL_ALL = process.env.API_URL_ALL || API_URL.replace('/appointments', '/appointments-all');
    API_URL_SEARCH = process.env.API_URL_SEARCH || API_URL.replace('/appointments', '/appointments/search');
}

// Configurable update intervals (in minutes)
const UPDATE_INTERVALS = process.env.UPDATE_INTERVALS ? 
  process.env.UPDATE_INTERVALS.split(',').map(x => parseFloat(x.trim())) : 
  [1, 1.25, 1.5, 1.75, 2]; // Default intervals

// Configurable appointment search period (in days)
const APPOINTMENT_SEARCH_DAYS = parseInt(process.env.APPOINTMENT_SEARCH_DAYS) || 60; // Default 60 days

// Print resolved config (mask secrets) so .env can be verified
function printConfig() {
  console.log('\n📋 Bot config (from .env / environment):');
  console.log('   BOT_MODE:', BOT_MODE);
  console.log('   isDevMode:', isDevMode);
  console.log('   isDocker:', isDocker, '(DOCKER_ENV=%s, IN_DOCKER=%s)', process.env.DOCKER_ENV || '', process.env.IN_DOCKER || '');
  console.log('   API_URL:', API_URL);
  console.log('   API_URL_ALL:', API_URL_ALL);
  console.log('   API_URL_SEARCH:', API_URL_SEARCH);
  console.log('   TELEGRAM_BOT_TOKEN:', TELEGRAM_BOT_TOKEN ? '(set)' : '(not set)');
  console.log('   TELEGRAM_CHANNEL_ID:', TELEGRAM_CHANNEL_ID || '(not set)');
  console.log('   TELEGRAM_CHANNEL_ID_ALL:', TELEGRAM_CHANNEL_ID_ALL || '(not set)');
  console.log('   LOCATION_SEARCH:', LOCATION_SEARCH);
  console.log('   ENABLE_ALL_LOCATIONS_SEARCH:', ENABLE_ALL_LOCATIONS_SEARCH);
  console.log('   USE_PLAYWRIGHT_API:', USE_PLAYWRIGHT_API);
  console.log('   DEBUG_MODE:', DEBUG_MODE);
  console.log('   UPDATE_INTERVALS:', UPDATE_INTERVALS.join(', '));
  console.log('   APPOINTMENT_SEARCH_DAYS:', APPOINTMENT_SEARCH_DAYS);
  if (process.env.API_URL) console.log('   (raw) process.env.API_URL:', process.env.API_URL);
  if (process.env.PROD_API_URL) console.log('   (raw) process.env.PROD_API_URL:', process.env.PROD_API_URL);
  if (process.env.DEV_API_URL) console.log('   (raw) process.env.DEV_API_URL:', process.env.DEV_API_URL);
  console.log('');
}
printConfig();

const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

let lastMessageId = null; // Store the last message ID to delete
let lastAppointmentContent = ""; // Store last appointment content to prevent unnecessary updates

// Helper function to get human-readable time period
function getTimePeriodText(days) {
  if (days === 1) return '1 day';
  if (days < 7) return `${days} days`;
  if (days === 7) return '1 week';
  if (days < 30) return `${Math.floor(days / 7)} weeks`;
  if (days === 30) return '1 month';
  if (days < 365) return `${Math.floor(days / 30)} months`;
  return `${Math.floor(days / 365)} years`;
}

// Helper function to trigger token renewal
async function renewToken() {
    try {
        const tokenRenewalUrl = `${API_URL.replace('/appointments', '/token/renew')}`;
        console.log(`🔄 Attempting to renew bearer token...`);
        const response = await axios.get(tokenRenewalUrl, {
            timeout: 180000 // 3 minutes timeout for Playwright
        });
        
        if (response.data && response.data.success) {
            console.log(`✅ Bearer token renewed successfully`);
            return true;
        } else {
            console.log(`⚠️ Token renewal returned: ${JSON.stringify(response.data)}`);
            return false;
        }
    } catch (error) {
        console.error(`❌ Token renewal failed: ${error.message}`);
        return false;
    }
}

// Fetch appointments using Axios (for selected locations)
async function fetchAppointments(retryOnAuthError = true) {
    try {
        // Use POST to send bearer token and personal info in body (more reliable than query params)
        const requestBody = {
            debugMode: DEBUG_MODE ? true : undefined
        };
        
        // Add bearer token if available from env (optional - backend will use saved token if not provided)
        if (process.env.BEARER_TOKEN) {
            requestBody.bearerToken = process.env.BEARER_TOKEN;
        }
        
        // Add personal info if available from env (optional - backend will use env vars if not provided)
        if (process.env.EXAM_TYPE) {
            requestBody.examType = process.env.EXAM_TYPE;
        }
        if (process.env.LAST_NAME) {
            requestBody.lastName = process.env.LAST_NAME;
        }
        if (process.env.LICENSE_NUMBER || process.env.BCID_NUMBER) {
            requestBody.licenseNumber = process.env.LICENSE_NUMBER || process.env.BCID_NUMBER;
        }
        
        // Remove undefined values
        Object.keys(requestBody).forEach(key => requestBody[key] === undefined && delete requestBody[key]);
        
        // Log what we're sending (without sensitive data)
        console.log(`📤 Sending request to ${API_URL}`);
        console.log(`   Parameters: ${Object.keys(requestBody).filter(k => k !== 'bearerToken').join(', ')}${requestBody.bearerToken ? ' (with bearerToken)' : ''}`);
        
        const { data } = await axios.post(API_URL, requestBody, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        // Handle error responses
        if (data.error) {
            // Check if it's an authentication/token error (401, 403, or 400 with token-related message)
            const isTokenError = data.status === 401 || 
                                 data.status === 403 || 
                                 (data.status === 400 && (
                                     (data.message && (
                                         data.message.toLowerCase().includes('token') ||
                                         data.message.toLowerCase().includes('unauthorized') ||
                                         data.message.toLowerCase().includes('payload does not match')
                                     )) ||
                                     (data.data && typeof data.data === 'string' && data.data.toLowerCase().includes('token'))
                                 ));
            
            // If token error and we haven't retried, try renewing token
            if (retryOnAuthError && isTokenError) {
                console.log(`⚠️ Got ${data.status} error (likely token issue). Attempting to renew token...`);
                const renewed = await renewToken();
                if (renewed) {
                    // Wait a bit for token to be saved
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    // Retry once after token renewal
                    return await fetchAppointments(false);
                }
            }
            
            console.error("❌ API Error:", data.message || data.error);
            return `⚠️ *Error:* ${data.message || data.error}\n_Status: ${data.status || 'Unknown'}_`;
        }

        // Handle message responses (no appointments)
        if (data.message && !data.appointments) {
            return data.message;
        }

        // Handle appointments
        if (!data.appointments || data.appointments.length === 0) {
            const timePeriod = getTimePeriodText(APPOINTMENT_SEARCH_DAYS);
            let message = `No appointments available within the next ${timePeriod}.`;
            
            // Include additional info if available
            if (data.notFoundLocations && data.notFoundLocations.length > 0) {
                message += `\n\n_${data.notFoundLocations.length} location(s) returned 404._`;
            }
            if (data.errors && data.errors.length > 0) {
                message += `\n\n_${data.errors.length} location(s) had errors._`;
            }
            
            return message;
        }

        return data.appointments
            .map(app => `📍 *${app.location.name}*\n _${app.location.postalCode}_\n📅 ${app.date} - ${app.dayOfWeek} - ${app.startTime}`)
            .join("\n\n");
    } catch (error) {
        // Handle authentication/token errors by attempting token renewal
        const status = error.response?.status;
        const errorData = error.response?.data;
        const errorMessage = errorData?.message || errorData?.data || error.message;
        
        // Check if it's a token-related error
        const isTokenError = status === 401 || 
                            status === 403 || 
                            (status === 400 && errorMessage && (
                                errorMessage.toLowerCase().includes('token') ||
                                errorMessage.toLowerCase().includes('unauthorized') ||
                                errorMessage.toLowerCase().includes('payload does not match')
                            ));
        
        if (retryOnAuthError && isTokenError) {
            console.log(`⚠️ Got ${status} error (likely token issue). Attempting to renew token...`);
            const renewed = await renewToken();
            if (renewed) {
                // Wait a bit for token to be saved
                await new Promise(resolve => setTimeout(resolve, 2000));
                // Retry once after token renewal
                return await fetchAppointments(false);
            }
        }
        
        console.error("❌ Error fetching appointments:", error.message);
        const errorMsg = errorData?.message || errorData?.data || error.message;
        return `⚠️ Error fetching appointment data: ${errorMsg}`;
    }
}

// Fetch appointments for ALL locations
async function fetchAppointmentsAll(retryOnAuthError = true) {
    try {
        // Use POST to send bearer token and personal info in body (more reliable than query params)
        const requestBody = {
            debugMode: DEBUG_MODE ? true : undefined
        };
        
        // Add bearer token if available from env (optional - backend will use saved token if not provided)
        if (process.env.BEARER_TOKEN) {
            requestBody.bearerToken = process.env.BEARER_TOKEN;
        }
        
        // Add personal info if available from env (optional - backend will use env vars if not provided)
        if (process.env.EXAM_TYPE) {
            requestBody.examType = process.env.EXAM_TYPE;
        }
        if (process.env.LAST_NAME) {
            requestBody.lastName = process.env.LAST_NAME;
        }
        if (process.env.LICENSE_NUMBER || process.env.BCID_NUMBER) {
            requestBody.licenseNumber = process.env.LICENSE_NUMBER || process.env.BCID_NUMBER;
        }
        
        // Remove undefined values
        Object.keys(requestBody).forEach(key => requestBody[key] === undefined && delete requestBody[key]);
        
        // Log what we're sending (without sensitive data) for debugging
        const logBody = { ...requestBody };
        if (logBody.bearerToken) logBody.bearerToken = '***';
        if (logBody.licenseNumber) logBody.licenseNumber = logBody.licenseNumber.substring(0, 2) + '***';
        if (logBody.lastName) logBody.lastName = logBody.lastName.substring(0, 2) + '***';
        console.log(`📤 Request to ${API_URL_ALL}:`, JSON.stringify(logBody, null, 2));
        
        const { data } = await axios.post(API_URL_ALL, requestBody, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        // Handle error responses
        if (data.error) {
            // Check if it's an authentication/token error (401, 403, 400, or 500 with token-related message)
            const errorMsgStr = (data.message || data.data || '').toString().toLowerCase();
            const isTokenError = data.status === 401 || 
                                 data.status === 403 || 
                                 (data.status === 400 && (
                                     errorMsgStr.includes('token') ||
                                     errorMsgStr.includes('unauthorized') ||
                                     errorMsgStr.includes('payload does not match')
                                 )) ||
                                 (data.status === 500 && (
                                     errorMsgStr.includes('token') ||
                                     errorMsgStr.includes('unauthorized') ||
                                     errorMsgStr.includes('authentication') ||
                                     errorMsgStr.includes('session') ||
                                     true // Try token renewal for all 500 errors as a safety measure
                                 ));
            
            // If token error and we haven't retried, try renewing token
            if (retryOnAuthError && isTokenError) {
                console.log(`⚠️ Got ${data.status} error (likely token issue). Attempting to renew token...`);
                const renewed = await renewToken();
                if (renewed) {
                    // Wait a bit for token to be saved
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    // Retry once after token renewal
                    return await fetchAppointmentsAll(false);
                }
            }
            
            console.error("❌ API Error:", data.message || data.error);
            return `⚠️ *Error:* ${data.message || data.error}\n_Status: ${data.status || 'Unknown'}_`;
        }

        // Handle message responses (no appointments)
        if (data.message && !data.appointments) {
            return data.message;
        }

        if (!data.appointments || data.appointments.length === 0) {
            const timePeriod = getTimePeriodText(APPOINTMENT_SEARCH_DAYS);
            let message = `No appointments available within the next ${timePeriod}.`;
            
            // Include additional info if available
            if (data.notFoundLocations && data.notFoundLocations.length > 0) {
                message += `\n\n_${data.notFoundLocations.length} location(s) returned 404._`;
            }
            if (data.errors && data.errors.length > 0) {
                message += `\n\n_${data.errors.length} location(s) had errors._`;
            }
            
            return message;
        }

        return data.appointments
            .map(app => `📍 *${app.location.name}* (ID: ${app.location.id})\n _${app.location.postalCode}_\n📅 ${app.date} - ${app.dayOfWeek} - ${app.startTime}`)
            .join("\n\n");
    } catch (error) {
        // Handle authentication/token errors by attempting token renewal
        const status = error.response?.status;
        const errorData = error.response?.data;
        const errorMessage = errorData?.message || errorData?.data || error.message;
        const errorMessageStr = typeof errorMessage === 'string' ? errorMessage : JSON.stringify(errorMessage || {});
        
        // Check if it's a token-related error (including 500 errors that might be auth-related)
        // For 500 errors, we'll try token renewal as a safety measure since they might indicate auth issues
        const isTokenError = status === 401 || 
                            status === 403 || 
                            (status === 400 && errorMessage && (
                                errorMessage.toLowerCase().includes('token') ||
                                errorMessage.toLowerCase().includes('unauthorized') ||
                                errorMessage.toLowerCase().includes('payload does not match')
                            )) ||
                            (status === 500 && (
                                errorMessageStr.toLowerCase().includes('token') ||
                                errorMessageStr.toLowerCase().includes('unauthorized') ||
                                errorMessageStr.toLowerCase().includes('authentication') ||
                                errorMessageStr.toLowerCase().includes('session') ||
                                true // Try token renewal for all 500 errors as a safety measure
                            ));
        
        if (retryOnAuthError && isTokenError) {
            console.log(`⚠️ Got ${status} error (likely token issue). Attempting to renew token...`);
            const renewed = await renewToken();
            if (renewed) {
                // Wait a bit for token to be saved
                await new Promise(resolve => setTimeout(resolve, 2000));
                // Retry once after token renewal
                return await fetchAppointmentsAll(false);
            }
        }
        
        console.error("❌ Error fetching ALL-location appointments:", error.message);
        const errorMsg = errorData?.message || errorData?.data || error.message;
        return `⚠️ Error fetching ALL-location appointment data: ${errorMsg}`;
    }
}

// Fetch appointments using Playwright API (new method)
async function fetchAppointmentsPlaywright() {
    try {
        const { data } = await axios.post(API_URL_SEARCH, {
            location: LOCATION_SEARCH
        });

        if (!data.success || !data.appointments || data.appointments.length === 0) {
            const timePeriod = getTimePeriodText(APPOINTMENT_SEARCH_DAYS);
            return `No appointments available for "${LOCATION_SEARCH}" within the next ${timePeriod}.`;
        }

        // Format appointments from Playwright API response
        // Format: { date: "Tuesday, February 3rd, 2026", time: "8:45 AM", location: "..." }
        return data.appointments
            .map(app => {
                const locationName = app.location || LOCATION_SEARCH;
                return `📍 *${locationName}*\n📅 ${app.date}\n🕐 ${app.time}`;
            })
            .join("\n\n");
    } catch (error) {
        console.error("❌ Error fetching Playwright appointments:", error.message);
        return `⚠️ Error fetching appointment data for "${LOCATION_SEARCH}": ${error.message}`;
    }
}

// Generate a random interval from configured intervals
function getRandomUpdateInterval() {
    return UPDATE_INTERVALS[Math.floor(Math.random() * UPDATE_INTERVALS.length)];
}

// Send a new message and delete the previous one if the content has changed
async function updateMessage() {
    try {
        const currentTime = new Date().toLocaleString('en-US', {
            timeZone: 'America/Vancouver',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
        });
        
        // Calculate next update time
        const nextUpdate = getRandomUpdateInterval();
        const nextUpdateTime = new Date(Date.now() + nextUpdate * 60 * 1000).toLocaleString('en-US', {
            timeZone: 'America/Vancouver',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
        });
        
        // Get appointment content (without timestamps)
        const appointmentContent = USE_PLAYWRIGHT_API 
            ? await fetchAppointmentsPlaywright() 
            : await fetchAppointments();
        const allLocationsContent = ENABLE_ALL_LOCATIONS_SEARCH ? await fetchAppointmentsAll() : null;
        
        // Create full message with timestamps
        const newMessageText = `🚦 *Available Appointments (Selected Locations):*\n\n${appointmentContent}\n\n_Last updated: ${currentTime}_\n_Next update: ${nextUpdateTime}_`;

        if (DEBUG_MODE) {
            // Debug mode: Always send new message
            const sentMessage = await bot.telegram.sendMessage(
                TELEGRAM_CHANNEL_ID,
                newMessageText,
                { parse_mode: "Markdown" }
            );

            // Store new message details
            lastMessageId = sentMessage.message_id;
            lastAppointmentContent = appointmentContent;

            // Also send ALL-locations message to secondary channel in debug mode (if configured)
            if (ENABLE_ALL_LOCATIONS_SEARCH && allLocationsContent) {
                const allText = `🌐 *Available Appointments (ALL Locations):*\n\n${allLocationsContent}\n\n_Last updated: ${currentTime}_\n_Next update: ${nextUpdateTime}_`;
                await bot.telegram.sendMessage(
                    TELEGRAM_CHANNEL_ID_ALL,
                    allText,
                    { parse_mode: "Markdown" }
                );
            }

            console.log("📢 [DEBUG MODE] Sent new message.");
        } else {
            // Production mode: Only update if appointment content has changed
            if (appointmentContent !== lastAppointmentContent) {
                // Delete previous message if it exists
                if (lastMessageId) {
                    try {
                        await bot.telegram.deleteMessage(TELEGRAM_CHANNEL_ID, lastMessageId);
                        console.log("🗑️ Deleted previous message.");
                    } catch (deleteError) {
                        console.log("⚠️ Could not delete previous message (might be too old):", deleteError.message);
                    }
                }

                // Send new message (production mode: no timestamps)
                const productionMessageText = `🚦 *Available Appointments (Selected Locations):*\n\n${appointmentContent}`;
                const sentMessage = await bot.telegram.sendMessage(
                    TELEGRAM_CHANNEL_ID,
                    productionMessageText,
                    { parse_mode: "Markdown" }
                );

                // Store new message details
                lastMessageId = sentMessage.message_id;
                lastAppointmentContent = appointmentContent;

                // Also send ALL-locations message to secondary channel (if configured)
                if (ENABLE_ALL_LOCATIONS_SEARCH && allLocationsContent) {
                    const allText = `🌐 *Available Appointments (ALL Locations):*\n\n${allLocationsContent}`;
                    await bot.telegram.sendMessage(
                        TELEGRAM_CHANNEL_ID_ALL,
                        allText,
                        { parse_mode: "Markdown" }
                    );
                }

                console.log("📢 [PRODUCTION MODE] Updated message with new content.");
            } else {
                console.log("📢 [PRODUCTION MODE] No changes detected, keeping existing message.");
            }
        }
    } catch (error) {
        console.error("❌ Error updating message:", error.message);
        
        // Send error message when there's an error
        try {
            const errorMessage = `⚠️ *Error occurred while fetching appointments*\n\n_Error: ${error.message}_\n\n_Time: ${new Date().toLocaleString('en-US', {
                timeZone: 'America/Vancouver',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: true
            })}_`;
            
            await bot.telegram.sendMessage(
                TELEGRAM_CHANNEL_ID,
                errorMessage,
                { parse_mode: "Markdown" }
            );
            console.log("📢 Sent error message.");
        } catch (errorSendError) {
            console.error("❌ Error sending error message:", errorSendError.message);
        }
    }

    // Schedule the next update
    const nextUpdate = getRandomUpdateInterval();
    console.log(`🔄 Next update in ${nextUpdate} minutes`);
    setTimeout(updateMessage, nextUpdate * 60 * 1000);
}

// Wait for backend to be ready before starting
async function waitForBackend(maxRetries = 30, retryDelay = 2000) {
    const backendHost = isDocker ? 'backend' : 'localhost';
    const backendPort = process.env.BACKEND_PORT || process.env.PORT || '3000';
    const healthUrl = `http://${backendHost}:${backendPort}/health`;
    
    console.log(`⏳ Waiting for backend to be ready at ${healthUrl}...`);
    
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await axios.get(healthUrl, {
                timeout: 3000,
                validateStatus: (status) => status === 200
            });
            
            if (response.status === 200 && response.data?.status === 'ok') {
                console.log(`✅ Backend is ready!`);
                return true;
            }
        } catch (error) {
            // Backend not ready yet, continue waiting
            if (i < maxRetries - 1) {
                console.log(`⏳ Backend not ready yet (attempt ${i + 1}/${maxRetries}), retrying in ${retryDelay / 1000}s...`);
                await new Promise(resolve => setTimeout(resolve, retryDelay));
            } else {
                console.error(`❌ Backend did not become ready after ${maxRetries} attempts`);
                console.error(`   Last error: ${error.message}`);
                return false;
            }
        }
    }
    
    return false;
}

// Start the routine
async function startBot() {
    console.log(`🚀 Bot starting in ${isDevMode ? 'DEV' : 'PROD'} mode`);
    console.log(`🐛 Debug mode: ${DEBUG_MODE ? 'ON' : 'OFF'}`);
    console.log(`🐳 Environment: ${isDocker ? 'Docker' : 'Local'}`);
    console.log(`⏰ Update intervals: ${UPDATE_INTERVALS.join(', ')} minutes`);
    console.log(`📅 Searching appointments within ${getTimePeriodText(APPOINTMENT_SEARCH_DAYS)}`);
    if (USE_PLAYWRIGHT_API) {
        console.log(`🌐 Using Playwright API for location: "${LOCATION_SEARCH}"`);
        console.log(`🔗 API URL: ${API_URL_SEARCH}`);
    } else {
        console.log(`📡 Using traditional API endpoints`);
        console.log(`🔗 API URL: ${API_URL}`);
        if (ENABLE_ALL_LOCATIONS_SEARCH) {
            console.log(`🔗 API URL (All Locations): ${API_URL_ALL}`);
        }
    }
    
    // Wait for backend to be ready
    const backendReady = await waitForBackend();
    if (!backendReady) {
        console.error(`❌ Failed to connect to backend. Exiting...`);
        process.exit(1);
    }
    
    console.log(`🚀 Bot started successfully!`);
    updateMessage();
}

// Start the bot
startBot();

// Graceful shutdown
process.on('SIGINT', () => {
    console.log("⚠️ Bot stopped.");
    process.exit();
});
process.on('SIGTERM', () => {
    console.log("⚠️ Bot stopped.");
    process.exit();
});
