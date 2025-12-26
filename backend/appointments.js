// appointments.js

require('dotenv').config({ path: '../.env' });
const axios = require('axios');
const fs = require('fs-extra');

const locations = require('./locations');

// ICBC API details
const ICBC_API_URL = 'https://onlinebusiness.icbc.com/deas-api/v1/webd/getAvailableAppointments';
const LOGIN_API_URL = 'https://onlinebusiness.icbc.com/deas-api/v1/webLogin/webLogin';
const TOKEN_FILE = './bearer_token.json';

// Configurable appointment search period (in days)
const APPOINTMENT_SEARCH_DAYS = parseInt(process.env.APPOINTMENT_SEARCH_DAYS) || 60; // Default 60 days

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

// Helper function to decode JWT (just for verification, not validation)
function decodeJWT(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    
    // Decode the payload (second part)
    const payload = Buffer.from(parts[1], 'base64').toString('utf8');
    return JSON.parse(payload);
  } catch (e) {
    return null;
  }
}

// Logging function
function logMessage(message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
  fs.appendFileSync('app.log', `[${timestamp}] ${message}\n`);
}

// Save bearer token locally
async function saveToken(token) {
  await fs.writeJson(TOKEN_FILE, { token });
}

// Load bearer token from local storage
async function loadToken() {
  try {
    const data = await fs.readJson(TOKEN_FILE);
    return data.token;
  } catch (error) {
    logMessage('Bearer token not found. Logging in...');
    return null;
  }
}

// Login and extract bearer token
async function login() {
  try {
    // Make the login request with cookies (same as your working curl)
    const response = await axios.put(
      LOGIN_API_URL,
      {
        keyword: process.env.ICBC_KEYWORD,
        drvrLastName: process.env.LAST_NAME,
        licenceNumber: process.env.LICENSE_NUMBER,
      },
      {
        headers: { 
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          ...(process.env.ICBC_COOKIES ? { Cookie: process.env.ICBC_COOKIES } : {})
        },
      },
    );

    logMessage(`Successfully logged in to ICBC. Status: ${response.status}`);
    
    // Try to extract bearer token from response headers
    let bearerToken = null;
    
    // Check response headers (case-insensitive)
    const headers = response.headers;
    const headerKeys = Object.keys(headers).map(k => k.toLowerCase());
    
    if (headerKeys.includes('authorization')) {
      const authHeader = Object.keys(headers).find(k => k.toLowerCase() === 'authorization');
      const authValue = headers[authHeader];
      if (authValue) {
        const match = authValue.match(/Bearer\s+(.+)/i);
        if (match) {
          bearerToken = match[1];
          logMessage(`Found bearer token in response header: Authorization`);
        }
      }
    }
    
    // Also check raw response object (axios might not expose all headers due to CORS)
    if (!bearerToken && response.request?.res?.headers) {
      const rawHeaders = response.request.res.headers;
      const rawHeaderKeys = Object.keys(rawHeaders).map(k => k.toLowerCase());
      if (rawHeaderKeys.includes('authorization')) {
        const authHeader = Object.keys(rawHeaders).find(k => k.toLowerCase() === 'authorization');
        const authValue = rawHeaders[authHeader];
        if (authValue) {
          const match = authValue.match(/Bearer\s+(.+)/i);
          if (match) {
            bearerToken = match[1];
            logMessage(`Found bearer token in raw response header: Authorization`);
          }
        }
      }
    }
    
    // Check response body for token
    if (!bearerToken && response.data) {
      const body = response.data;
      if (typeof body === 'object' && body !== null) {
        // Check common token fields
        const tokenFields = ['token', 'accessToken', 'access_token', 'bearerToken', 'bearer_token', 'jwt', 'jwtToken'];
        for (const field of tokenFields) {
          if (body[field] && typeof body[field] === 'string') {
            // Check if it's a JWT (3 parts separated by dots)
            if (body[field].split('.').length === 3) {
              bearerToken = body[field];
              logMessage(`Found bearer token in response body: ${field}`);
              break;
            }
          }
        }
      }
    }
    
    // Save token if found
    if (bearerToken) {
      await saveToken(bearerToken);
      logMessage(`Bearer token saved successfully`);
    } else {
      logMessage(`No bearer token found in login response (ICBC may use cookies/session instead)`);
    }
    
    return {
      status: response.status,
      data: response.data,
      token: bearerToken
    };
  } catch (error) {
    const status = error.response?.status;
    const data = error.response?.data;
    const errMsg = `Login failed: ${error.message}${status ? ` (status ${status})` : ''}${data ? ` | response: ${JSON.stringify(data)}` : ''}`;
    logMessage(errMsg);
    throw error;
  }
}

// Function to get today's date in YYYY-MM-DD format
function getToday() {
  const today = new Date();
  return today.toISOString().split('T')[0];
}

// Helper function to delay execution (for rate limiting)
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Function to fetch appointments
// Returns: { appointments: [], error: null } or { appointments: [], error: { status, message, locationId } }
async function fetchAppointments(locationId, limit = 10, retryOn403 = true, customBearerToken = null, customPersonalInfo = null) {
  const today = getToday();

  try {
    logMessage(`Fetching appointments for location ${locationId}...`);
    
    // Use custom bearer token if provided, otherwise try to load from file
    let bearerToken = customBearerToken;
    if (!bearerToken) {
      bearerToken = await loadToken();
    } else {
      logMessage(`Using custom bearer token provided in request`);
    }
    
    // Decode bearer token to extract user information
    // The API validates that lastName and licenseNumber match what's in the token
    let tokenUserInfo = null;
    if (bearerToken) {
      const decoded = decodeJWT(bearerToken);
      if (decoded) {
        tokenUserInfo = {
          clno: decoded.clno, // Client number / license number from token
          firstName: decoded.firstName,
          lastName: decoded.lastName || decoded.drvrLastName,
        };
        logMessage(`Decoded token info: clno=${tokenUserInfo.clno ? tokenUserInfo.clno.substring(0, 2) + '***' : 'null'}, lastName=${tokenUserInfo.lastName ? tokenUserInfo.lastName.substring(0, 2) + '***' : 'null'}`);
      }
    }
    
    // Use custom personal info if provided, otherwise try token info, then environment variables
    // IMPORTANT: When using a custom bearer token, lastName and licenseNumber MUST be provided
    // because the API validates them against the login session, not just the token
    const examType = customPersonalInfo?.examType || process.env.EXAM_TYPE;
    
    // For licenseNumber: If custom provided, use it. Otherwise try token clno, then env.
    // Note: Token clno may have leading zeros (e.g., "03648453"), but API accepts both formats
    let licenseNumber = customPersonalInfo?.licenseNumber;
    if (!licenseNumber) {
      if (tokenUserInfo?.clno) {
        // Use clno from token (may have leading zeros)
        licenseNumber = tokenUserInfo.clno;
      } else {
        licenseNumber = process.env.LICENSE_NUMBER;
      }
    }
    
    // For lastName: Token usually doesn't have it, so it MUST be provided or from env
    // The API validates this against what was used during login
    let lastName = customPersonalInfo?.lastName || process.env.LAST_NAME;
    
    // Validate required fields
    if (!lastName || !licenseNumber) {
      return {
        appointments: [],
        error: {
          status: 400,
          statusText: 'Bad Request',
          message: 'Missing required fields: lastName and licenseNumber must be provided (either in request, token, or environment variables)',
          locationId: locationId
        }
      };
    }
    
    if (customPersonalInfo) {
      logMessage(`Using custom personal info: examType=${examType}, lastName=${lastName ? lastName.substring(0, 2) + '***' : 'null'}, licenseNumber=${licenseNumber ? licenseNumber.substring(0, 2) + '***' : 'null'}`);
    } else if (tokenUserInfo) {
      logMessage(`Using info from token: lastName=${lastName ? lastName.substring(0, 2) + '***' : 'null'}, licenseNumber=${licenseNumber ? licenseNumber.substring(0, 2) + '***' : 'null'}`);
    }
    
    // Build headers to match the working browser request
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/plain, */*',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
      'Referer': 'https://onlinebusiness.icbc.com/webdeas-ui/booking',
      'sec-ch-ua': '"Brave";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      ...(process.env.ICBC_COOKIES ? { Cookie: process.env.ICBC_COOKIES } : {})
    };
    
    // Add bearer token if available
    if (bearerToken) {
      headers['Authorization'] = `Bearer ${bearerToken}`;
      logMessage(`Using bearer token for API request`);
    }
    
    // Request body format matching the working curl command EXACTLY
    // IMPORTANT: The values must match what's in the bearer token
    // From the working curl: licenseNumber is a string (can have leading zeros), lastName must match token
    const requestBody = {
      aPosID: parseInt(locationId), // Must be a number
      examType: examType, // Must match what's expected for this user
      examDate: today, // Format: YYYY-MM-DD
      prfDaysOfWeek: '[0,1,2,3,4,5,6]', // String, not array
      prfPartsOfDay: '[0,1]', // String, not array
      lastName: lastName, // Must match token or be provided explicitly
      licenseNumber: licenseNumber // Must match clno from token (can be with or without leading zeros)
    };
    
    // Log the request body for debugging (without sensitive data)
    logMessage(`Request body: aPosID=${requestBody.aPosID}, examType=${requestBody.examType}, examDate=${requestBody.examDate}, lastName=${lastName ? lastName.substring(0, 2) + '***' : 'null'}, licenseNumber=${licenseNumber ? licenseNumber.substring(0, 2) + '***' : 'null'}`);
    
    // If token has clno, try using it directly (it might have leading zeros)
    // But also try without leading zeros if the provided value doesn't match
    if (tokenUserInfo?.clno && !customPersonalInfo?.licenseNumber) {
      // Token has clno, use it - but API might accept with or without leading zeros
      // Try the exact value from token first
      const tokenClno = tokenUserInfo.clno;
      // If token has leading zeros but our value doesn't, try both formats
      if (tokenClno.startsWith('0') && !licenseNumber.startsWith('0')) {
        logMessage(`Token has clno with leading zero: ${tokenClno.substring(0, 2)}***, but using provided: ${licenseNumber.substring(0, 2)}***`);
        // Keep the provided value, but log the token value for reference
      } else {
        // Use token value if it matches or if no custom value provided
        requestBody.licenseNumber = tokenClno;
        logMessage(`Using licenseNumber from token: ${tokenClno.substring(0, 2)}***`);
      }
    }
    
    const response = await axios.post(ICBC_API_URL, requestBody, {
      headers: headers
    });
    logMessage(`Successfully fetched appointments for location ${locationId}`);
    
    // Check if response.data is an array
    if (!Array.isArray(response.data)) {
      logMessage(`⚠️ Response data is not an array for location ${locationId}: ${typeof response.data}`);
      if (response.data) {
        logMessage(`   Response data: ${JSON.stringify(response.data).substring(0, 200)}`);
      }
      return { appointments: [], error: null };
    }
    
    return { appointments: response.data.slice(0, limit), error: null };
  } catch (error) {
    const status = error.response?.status;
    const errorData = error.response?.data;
    
    // Log full error details for 500 errors to help debug
    if (status === 500) {
      logMessage(`⚠️ ICBC API returned 500 error for location ${locationId}`);
      logMessage(`   Error message: ${error.message}`);
      if (errorData) {
        logMessage(`   Error data: ${typeof errorData === 'string' ? errorData : JSON.stringify(errorData).substring(0, 500)}`);
      }
      logMessage(`   Request was: aPosID=${parseInt(locationId)}, examType=${examType}, examDate=${today}, lastName=${lastName ? lastName.substring(0, 2) + '***' : 'null'}, licenseNumber=${licenseNumber ? licenseNumber.substring(0, 2) + '***' : 'null'}`);
    }
    
    // Handle 404 errors gracefully (some locations may not exist or have no appointments)
    if (status === 404) {
      logMessage(`⚠️ Location ${locationId} returned 404 (location may not exist or have no appointments)`);
      return { 
        appointments: [], 
        error: {
          status: 404,
          statusText: error.response?.statusText || 'Not Found',
          message: `Location ${locationId} returned 404 (location may not exist or have no appointments)`,
          locationId: locationId,
          data: error.response?.data,
          is404: true // Flag to indicate this is a 404 (not a critical error)
        }
      };
    }
    
    // If 400 (with token error), 401, or 403 and we haven't retried yet, try renewing bearer token and retry once
    // BUT: Skip token renewal if a custom bearer token was provided (user wants to use their own token)
    // errorData is already declared above, reuse it
    const errorMessage = (typeof errorData === 'string' ? errorData : errorData?.message || error.message || '').toLowerCase();
    const isTokenError = status === 401 || 
                        status === 403 || 
                        (status === 400 && (
                            errorMessage.includes('token') ||
                            errorMessage.includes('payload does not match') ||
                            errorMessage.includes('unauthorized')
                        ));
    
    if (isTokenError && retryOn403 && !customBearerToken) {
      logMessage(`⚠️ Got ${status} for location ${locationId} (token error detected). Token may be invalid or expired. Attempting to renew bearer token...`);
      try {
        // Call the token renewal API endpoint
        const apiPort = process.env.PORT || 3000;
        const tokenRenewalUrl = `http://localhost:${apiPort}/token/renew`;
        
        logMessage(`Calling token renewal API: ${tokenRenewalUrl}`);
        const tokenResponse = await axios.get(tokenRenewalUrl, {
          timeout: 120000 // 2 minutes timeout (Playwright login can take time)
        });
        
        if (tokenResponse.data && tokenResponse.data.success && tokenResponse.data.found) {
          logMessage(`✅ Bearer token renewed successfully`);
          logMessage(`   Token location: ${tokenResponse.data.location}`);
          
          // Reload the token from file (it was saved by getBearerTokenWithPlaywright)
          const newToken = await loadToken();
          if (newToken) {
            logMessage(`✅ New bearer token loaded from file`);
          } else {
            logMessage(`⚠️  Warning: Token was renewed but could not be loaded from file`);
          }
        } else {
          logMessage(`⚠️  Token renewal API returned: ${JSON.stringify(tokenResponse.data)}`);
        }
        
        await delay(2000); // Wait 2 seconds after token renewal before retrying
        const retryResult = await fetchAppointments(locationId, limit, false, null, customPersonalInfo); // Retry once without further retries (no custom token)
        return retryResult;
      } catch (renewalError) {
        logMessage(`⚠️  Token renewal failed for location ${locationId}: ${renewalError.message}`);
        
        // Fallback: try the old login method if API call fails
        try {
          logMessage(`Attempting fallback login method...`);
          const loginResult = await login();
          if (loginResult.token) {
            logMessage(`Bearer token extracted via fallback login`);
          }
          await delay(1000);
          return fetchAppointments(locationId, limit, false, null, customPersonalInfo);
        } catch (loginError) {
          logMessage(`⚠️  Fallback login also failed for location ${locationId}. Skipping...`);
          fs.appendFileSync(
            'error.log',
            `${new Date().toISOString()} - Location ${locationId}: Token renewal and fallback login failed - ${renewalError.message}\n`
          );
          return { appointments: [], error: { status: 500, message: 'Token renewal and fallback login failed', locationId } };
        }
      }
    } else if ((status === 401 || status === 403) && customBearerToken) {
      logMessage(`⚠️ Got ${status} for location ${locationId} with custom bearer token. Token may be invalid or expired, but skipping renewal as custom token was provided.`);
      // Return error info so it can be reported to the user
      return { 
        appointments: [], 
        error: {
          status: status,
          statusText: error.response?.statusText || (status === 401 ? 'Unauthorized' : 'Forbidden'),
          message: `${status === 401 ? 'Unauthorized' : 'Access denied'} for location ${locationId}. Bearer token may be invalid or expired.`,
          locationId: locationId,
          data: error.response?.data
        }
      };
    }
    
    // Log error and return error info
    const errorMsg = `Error fetching appointments for location ${locationId}: ${status || 'Unknown'} - ${error.message}`;
    logMessage(errorMsg);
    
    if (status === 401 || status === 403) {
      logMessage(`⚠️ ${status === 401 ? 'Unauthorized' : 'Access denied'} for location ${locationId}. Token may be invalid or expired.`);
    } else if (status === 404) {
      logMessage(`⚠️ Location ${locationId} not found or has no appointments. Skipping...`);
    }
    
    fs.appendFileSync(
      'error.log',
      `${new Date().toISOString()} - Location ${locationId}: ${status || 'Unknown'} - ${error.message}\n`
    );
    // Return error info so it can be reported to the user
    return { 
      appointments: [], 
      error: {
        status: status || 500,
        statusText: error.response?.statusText || error.statusText || 'Unknown Error',
        message: error.message,
        locationId: locationId,
        data: error.response?.data
      }
    };
  }
}

// Filter appointments within configured period
function filterAppointmentsWithinPeriod(appointments, debugMode = false) {
  // If debug mode is enabled, return all appointments without time filtering
  if (debugMode) {
    return appointments;
  }
  
  const today = new Date();
  const futureDate = new Date();
  futureDate.setDate(today.getDate() + APPOINTMENT_SEARCH_DAYS);

  return appointments.filter(appt => {
    const apptDate = new Date(appt.appointmentDt.date);
    return apptDate >= today && apptDate <= futureDate;
  });
}

// Function to format appointment data
function formatAppointments(appointments) {
  return appointments
    .sort((a, b) => new Date(a.appointmentDt.date) - new Date(b.appointmentDt.date)) // Sort by appointment date
    .map(appt => {
      const loc = locations[appt.posId];
      return {
        location: {
          id: appt.posId,
          name: loc?.name || loc || 'Unknown Location',
          postalCode: loc?.postalCode || '',
        },
        date: appt.appointmentDt.date,
        dayOfWeek: appt.appointmentDt.dayOfWeek,
        startTime: appt.startTm,
        endTime: appt.endTm,
      };
    });
}

// Function to send long messages in chunks
function sendLongMessage(chatId, text, bot) {
  const chunkSize = 4000; // Max safe Telegram message size
  for (let i = 0; i < text.length; i += chunkSize) {
    const chunk = text.slice(i, i + chunkSize);
    bot.sendMessage(chatId, chunk, { parse_mode: 'Markdown' });
  }
}

module.exports = {
  fetchAppointments,
  filterAppointmentsWithinPeriod,
  formatAppointments,
  sendLongMessage,
  login
};
