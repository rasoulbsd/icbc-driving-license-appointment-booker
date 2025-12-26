// server.js

require('dotenv').config({ path: '../.env' });
const express = require('express');
const { fetchAppointments, filterAppointmentsWithinPeriod, formatAppointments, login } = require('./appointments');
const { searchAppointmentsByLocation } = require('./appointments-playwright');
const { getBearerTokenWithPlaywright } = require('./get-bearer-token-playwright');
const locations = require('./locations');
const allLocations = require('./all-locations.json');

const app = express();
const PORT = process.env.PORT || 3000;

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

// Middleware to parse JSON
app.use(express.json());

// Helper function to delay execution (for rate limiting)
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper function to handle appointment fetching (used by both GET and POST)
async function handleFetchAppointments(req, res, locationId = null, useAllLocations = false) {
  try {
    // Accept bearer token, personal info, and debug mode from query parameter or request body
    const bearerToken = req.query.bearerToken || req.body?.bearerToken || null;
    const debugMode = req.query.debugMode === 'true' || req.body?.debugMode === true || req.body?.debugMode === 'true';
    const customPersonalInfo = req.body?.examType || req.body?.lastName || req.body?.licenseNumber ? {
      examType: req.body.examType || req.query.examType,
      lastName: req.body.lastName || req.query.lastName,
      licenseNumber: req.body.licenseNumber || req.query.licenseNumber
    } : null;
    
    if (locationId) {
      // Fetch for specific location
      const result = await fetchAppointments(locationId, 10, true, bearerToken, customPersonalInfo);
      
      // Check for errors first
      if (result.error) {
        const statusCode = result.error.status || 500;
        return res.status(statusCode).json({
          error: 'Error fetching appointments',
          message: result.error.message,
          status: statusCode,
          statusText: result.error.statusText,
          locationId: result.error.locationId,
          data: result.error.data
        });
      }
      
      const appointments = result.appointments || [];
      if (appointments.length === 0) {
        // If no appointments returned (e.g., 404 error), return appropriate message
        const timePeriod = getTimePeriodText(APPOINTMENT_SEARCH_DAYS);
        return res.json({ message: `No appointments available for location ${locationId}${debugMode ? '' : ` within the next ${timePeriod}`}.` });
      }
      
      const filteredAppointments = filterAppointmentsWithinPeriod(appointments, debugMode);
      if (filteredAppointments.length > 0) {
        const formattedAppointments = formatAppointments(filteredAppointments);
        res.json({ appointments: formattedAppointments });
      } else {
        const timePeriod = getTimePeriodText(APPOINTMENT_SEARCH_DAYS);
        res.json({ message: `No appointments available${debugMode ? '' : ` within the next ${timePeriod}`}.` });
      }
    } else {
      // Fetch for all locations (configured or all)
      const locationList = useAllLocations ? allLocations : locations;
      
      // Only login if no custom bearer token is provided
      // If bearer token is provided, skip login entirely (no Playwright)
      if (!bearerToken) {
        try {
          await login();
          await delay(1000);
        } catch (loginError) {
          console.log(`Warning: Login failed before fetching appointments: ${loginError.message}`);
        }
      } else {
        console.log('Using custom bearer token from request, skipping login (no Playwright)');
      }
      
      let allAppointments = [];
      let errors = [];
      let notFoundLocations = []; // Track 404s separately
      const locationIds = Object.keys(locationList);
      for (const locationId of locationIds) {
        const result = await fetchAppointments(locationId, 10, true, bearerToken, customPersonalInfo);
        
        // Collect errors but continue with other locations
        if (result.error) {
          if (result.error.is404) {
            // 404s are not critical errors, but we should still report them
            notFoundLocations.push({
              locationId: result.error.locationId,
              message: result.error.message
            });
          } else {
            errors.push(result.error);
          }
        } else if (result.appointments && result.appointments.length > 0) {
          allAppointments = allAppointments.concat(result.appointments);
        }
        await delay(500);
      }
      
      const filteredAppointments = filterAppointmentsWithinPeriod(allAppointments, debugMode);
      
      // If we have critical errors (non-404) and no appointments, return the errors
      if (errors.length > 0 && filteredAppointments.length === 0) {
        // If all locations failed with the same error (e.g., all 403), return that error
        const firstError = errors[0];
        const allSameError = errors.every(e => e.status === firstError.status);
        
        if (allSameError && errors.length === locationIds.length) {
          // All locations failed with the same error
          const statusCode = firstError.status || 500;
          return res.status(statusCode).json({
            error: 'Error fetching appointments',
            message: firstError.message || `All locations returned ${firstError.status}`,
            status: statusCode,
            statusText: firstError.statusText,
            errors: errors,
            locationsChecked: locationIds.length,
            notFoundLocations: notFoundLocations,
            data: firstError.data
          });
        } else {
          // Mixed results - some errors, but also return any appointments found
          // Include errors in response
          const response = {
            message: `Some locations returned errors. Found ${filteredAppointments.length} appointment(s) from ${allAppointments.length} successful location(s).`,
            errors: errors,
            notFoundLocations: notFoundLocations,
            locationsChecked: locationIds.length,
            successfulLocations: locationIds.length - errors.length - notFoundLocations.length
          };
          
          if (filteredAppointments.length > 0) {
            const formattedAppointments = formatAppointments(filteredAppointments);
            response.appointments = formattedAppointments;
          } else {
            const timePeriod = getTimePeriodText(APPOINTMENT_SEARCH_DAYS);
            response.message = `No appointments available${debugMode ? '' : ` within the next ${timePeriod}`}. Some locations returned errors.`;
          }
          
          return res.json(response);
        }
      }
      
      // If we have no appointments, include information about what was checked
      if (filteredAppointments.length === 0) {
        const timePeriod = getTimePeriodText(APPOINTMENT_SEARCH_DAYS);
        const response = {
          message: `No appointments available${debugMode ? '' : ` within the next ${timePeriod}`}.`,
          locationsChecked: locationIds.length
        };
        
        // Include 404 information if any locations returned 404
        if (notFoundLocations.length > 0) {
          response.notFoundLocations = notFoundLocations;
          response.message += ` ${notFoundLocations.length} location(s) returned 404 (may not exist or have no appointments).`;
        }
        
        // Include errors if any
        if (errors.length > 0) {
          response.errors = errors;
        }
        
        return res.json(response);
      }
      
      // We have appointments, return them
      const formattedAppointments = formatAppointments(filteredAppointments);
      const response = { appointments: formattedAppointments };
      
      // Still include 404 info if any
      if (notFoundLocations.length > 0) {
        response.notFoundLocations = notFoundLocations;
      }
      
      res.json(response);
    }
  } catch (error) {
    const statusCode = error.response?.status || error.status || 500;
    res.status(statusCode).json({ 
      error: 'Error fetching appointments',
      message: error.message,
      status: statusCode,
      statusText: error.response?.statusText || error.statusText,
      data: error.response?.data || error.data,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      details: {
        response: error.response ? {
          status: error.response.status,
          statusText: error.response.statusText,
          headers: error.response.headers,
          data: error.response.data
        } : undefined,
        request: error.config ? {
          url: error.config.url,
          method: error.config.method,
          headers: error.config.headers
        } : undefined
      }
    });
  }
}

// Route to log in to ICBC (validates credentials / session)
app.get('/login', async (req, res) => {
  try {
    const result = await login(); // Calls the login function from appointments.js
    res.json({ success: true, result });
  } catch (error) {
    const statusCode = error.response?.status || error.status || 500;
    res.status(statusCode).json({
      error: 'Login failed',
      message: error.message,
      status: statusCode,
      statusText: error.response?.statusText || error.statusText,
      data: error.response?.data || error.data,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      details: {
        response: error.response ? {
          status: error.response.status,
          statusText: error.response.statusText,
          headers: error.response.headers,
          data: error.response.data
        } : undefined,
        request: error.config ? {
          url: error.config.url,
          method: error.config.method,
          headers: error.config.headers
        } : undefined
      }
    });
  }
});

// Route to renew bearer token using Playwright (for when token expires or is invalid)
// Supports GET with query params or POST with body for credentials
// If bearerToken is provided, it will be used/validated instead of running Playwright
// Note: This endpoint can take 30-60 seconds if Playwright is used, so timeout is set to 5 minutes
app.get('/token/renew', async (req, res) => {
  // Set a longer timeout for this endpoint (5 minutes = 300000ms)
  req.setTimeout(300000);
  res.setTimeout(300000);
  
  try {
    // Check if bearer token is provided - if so, use it instead of running Playwright
    const providedToken = req.query.bearerToken || req.body?.bearerToken;
    
    if (providedToken) {
      console.log('✅ Bearer token provided in request. Using provided token (skipping Playwright)...');
      
      // Decode and validate the token structure (basic validation)
      const parts = providedToken.split('.');
      if (parts.length !== 3) {
        return res.status(400).json({
          success: false,
          error: 'Invalid bearer token format',
          message: 'Bearer token must be a valid JWT (should have 3 parts separated by dots)',
          timestamp: new Date().toISOString()
        });
      }
      
      // Try to decode the payload to get expiration info
      let decoded = null;
      try {
        const payload = Buffer.from(parts[1], 'base64').toString('utf8');
        decoded = JSON.parse(payload);
      } catch (e) {
        // Token might be valid but not decodable, that's okay
      }
      
      // Save the token to file
      const fs = require('fs');
      const path = require('path');
      const tokenFile = path.join(__dirname, 'bearer_token.json');
      const tokenData = {
        token: providedToken,
        timestamp: new Date().toISOString(),
        expires: decoded?.exp ? new Date(decoded.exp * 1000).toISOString() : null,
        source: 'provided_by_user'
      };
      fs.writeFileSync(tokenFile, JSON.stringify(tokenData, null, 2));
      console.log(`💾 Token saved to: ${tokenFile}`);
      
      return res.json({
        success: true,
        found: true,
        token: providedToken,
        location: 'provided_by_user',
        timestamp: tokenData.timestamp,
        expires: tokenData.expires,
        message: 'Bearer token accepted and saved successfully',
        decoded: decoded ? {
          exp: decoded.exp,
          iat: decoded.iat,
          sub: decoded.sub
        } : null
      });
    }
    
    // If no bearer token provided, proceed with Playwright login
    // Accept credentials from query parameters or request body
    const customCredentials = req.query.keyword || req.query.lastName || req.query.licenseNumber || req.query.bcidNumber || req.query.date ? {
      keyword: req.query.keyword,
      lastName: req.query.lastName,
      licenseNumber: req.query.licenseNumber || req.query.bcidNumber,
      bcidNumber: req.query.bcidNumber || req.query.licenseNumber,
      date: req.query.date
    } : null;
    
    // Accept headless option from query parameter (defaults to environment variable if not provided)
    const headless = req.query.headless !== undefined 
      ? req.query.headless === 'true' || req.query.headless === true 
      : null;
    
    console.log('🔄 No bearer token provided. Renewing bearer token via Playwright...');
    const tokenInfo = await getBearerTokenWithPlaywright(customCredentials, headless);
    
    if (tokenInfo && tokenInfo.found && tokenInfo.token) {
      res.json({
        success: true,
        found: true,
        token: tokenInfo.token,
        location: tokenInfo.location,
        timestamp: tokenInfo.timestamp,
        message: 'Bearer token renewed successfully'
      });
    } else {
      res.status(500).json({
        success: false,
        found: false,
        error: 'Token renewal failed',
        message: 'No bearer token found during login flow',
        timestamp: new Date().toISOString(),
        details: {
          reason: 'Token extraction failed during Playwright login flow',
          suggestion: 'Check if login credentials are correct and ICBC website is accessible'
        }
      });
    }
  } catch (error) {
    console.error('❌ Error renewing bearer token:', error.message);
    const statusCode = error.response?.status || error.status || 500;
    res.status(statusCode).json({
      success: false,
      error: 'Token renewal failed',
      message: error.message,
      status: statusCode,
      statusText: error.response?.statusText || error.statusText,
      data: error.response?.data || error.data,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      timestamp: new Date().toISOString(),
      details: {
        response: error.response ? {
          status: error.response.status,
          statusText: error.response.statusText,
          headers: error.response.headers,
          data: error.response.data
        } : undefined,
        request: error.config ? {
          url: error.config.url,
          method: error.config.method,
          headers: error.config.headers
        } : undefined
      }
    });
  }
});

// POST alternative for token renewal (easier to send credentials in body)
// If bearerToken is provided, it will be used/validated instead of running Playwright
// Note: This endpoint can take 30-120 seconds if Playwright is used, timeout is set to 5 minutes
app.post('/token/renew', async (req, res) => {
  // Set a longer timeout for this endpoint (5 minutes = 300000ms)
  req.setTimeout(300000);
  res.setTimeout(300000);
  
  try {
    // Check if bearer token is provided - if so, use it instead of running Playwright
    const providedToken = req.body?.bearerToken || req.query.bearerToken;
    
    if (providedToken) {
      console.log('✅ Bearer token provided in request. Using provided token (skipping Playwright)...');
      
      // Decode and validate the token structure (basic validation)
      const parts = providedToken.split('.');
      if (parts.length !== 3) {
        return res.status(400).json({
          success: false,
          error: 'Invalid bearer token format',
          message: 'Bearer token must be a valid JWT (should have 3 parts separated by dots)',
          timestamp: new Date().toISOString()
        });
      }
      
      // Try to decode the payload to get expiration info
      let decoded = null;
      try {
        const payload = Buffer.from(parts[1], 'base64').toString('utf8');
        decoded = JSON.parse(payload);
      } catch (e) {
        // Token might be valid but not decodable, that's okay
      }
      
      // Save the token to file
      const fs = require('fs');
      const path = require('path');
      const tokenFile = path.join(__dirname, 'bearer_token.json');
      const tokenData = {
        token: providedToken,
        timestamp: new Date().toISOString(),
        expires: decoded?.exp ? new Date(decoded.exp * 1000).toISOString() : null,
        source: 'provided_by_user'
      };
      fs.writeFileSync(tokenFile, JSON.stringify(tokenData, null, 2));
      console.log(`💾 Token saved to: ${tokenFile}`);
      
      return res.json({
        success: true,
        found: true,
        token: providedToken,
        location: 'provided_by_user',
        timestamp: tokenData.timestamp,
        expires: tokenData.expires,
        message: 'Bearer token accepted and saved successfully',
        decoded: decoded ? {
          exp: decoded.exp,
          iat: decoded.iat,
          sub: decoded.sub
        } : null
      });
    }
    
    // If no bearer token provided, proceed with Playwright login
    // Accept credentials from request body or query parameters
    const customCredentials = req.body?.keyword || req.body?.lastName || req.body?.licenseNumber || req.body?.bcidNumber || req.body?.date ? {
      keyword: req.body.keyword || req.query.keyword,
      lastName: req.body.lastName || req.query.lastName,
      licenseNumber: req.body.licenseNumber || req.body.bcidNumber || req.query.licenseNumber || req.query.bcidNumber,
      bcidNumber: req.body.bcidNumber || req.body.licenseNumber || req.query.bcidNumber || req.query.licenseNumber,
      date: req.body.date || req.query.date
    } : null;
    
    // Accept headless option from request body or query parameter (defaults to environment variable if not provided)
    const headless = req.body?.headless !== undefined 
      ? req.body.headless === true || req.body.headless === 'true'
      : req.query.headless !== undefined
        ? req.query.headless === 'true' || req.query.headless === true
        : null;
    
    console.log('🔄 No bearer token provided. Renewing bearer token via Playwright...');
    const tokenInfo = await getBearerTokenWithPlaywright(customCredentials, headless);
    
    if (tokenInfo && tokenInfo.found && tokenInfo.token) {
      res.json({
        success: true,
        found: true,
        token: tokenInfo.token,
        location: tokenInfo.location,
        timestamp: tokenInfo.timestamp,
        message: 'Bearer token renewed successfully'
      });
    } else {
      res.status(500).json({
        success: false,
        found: false,
        error: 'Token renewal failed',
        message: 'No bearer token found during login flow',
        timestamp: new Date().toISOString(),
        details: {
          reason: 'Token extraction failed during Playwright login flow',
          suggestion: 'Check if login credentials are correct and ICBC website is accessible'
        }
      });
    }
  } catch (error) {
    console.error('❌ Error renewing bearer token:', error.message);
    const statusCode = error.response?.status || error.status || 500;
    res.status(statusCode).json({
      success: false,
      error: 'Token renewal failed',
      message: error.message,
      status: statusCode,
      statusText: error.response?.statusText || error.statusText,
      data: error.response?.data || error.data,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      timestamp: new Date().toISOString(),
      details: {
        response: error.response ? {
          status: error.response.status,
          statusText: error.response.statusText,
          headers: error.response.headers,
          data: error.response.data
        } : undefined,
        request: error.config ? {
          url: error.config.url,
          method: error.config.method,
          headers: error.config.headers
        } : undefined
      }
    });
  }
});

// Route to get all location details (including ID)
app.get('/locations', (req, res) => {  
    // Convert locations object into an array of objects with id and name
    const locationDetails = Object.keys(locations).map(id => ({
      id: id,
      name: locations[id]
    }));
  
    res.json({ locations: locationDetails });
});

// Route to fetch appointments for a specific location (supports GET with query param or POST with body)
app.get('/appointments/:locationId', async (req, res) => {
  await handleFetchAppointments(req, res, req.params.locationId);
});

// POST alternative for fetching appointments for a specific location (easier to send bearer token in body)
app.post('/appointments/:locationId', async (req, res) => {
  await handleFetchAppointments(req, res, req.params.locationId);
});

// Route to fetch appointments for configured locations (original set) - supports GET with query param or POST with body
app.get('/appointments', async (req, res) => {
  await handleFetchAppointments(req, res);
});

// POST alternative for fetching appointments (easier to send bearer token in body)
app.post('/appointments', async (req, res) => {
  await handleFetchAppointments(req, res);
});

// Route to fetch appointments for ALL locations in all-locations.json (ignores configured subset) - supports GET with query param or POST with body
app.get('/appointments-all', async (req, res) => {
  await handleFetchAppointments(req, res, null, true);
});

// POST alternative for fetching all appointments (easier to send bearer token in body)
app.post('/appointments-all', async (req, res) => {
  await handleFetchAppointments(req, res, null, true);
});

// Route to search appointments by location string (Playwright-based, maintains session)
app.post('/appointments/search', async (req, res) => {
  try {
    const { location } = req.body;
    
    if (!location || typeof location !== 'string') {
      return res.status(400).json({ 
        error: 'Invalid request', 
        message: 'Location string is required in request body: { "location": "north vancouver" }' 
      });
    }
    
    console.log(`Searching for appointments at: ${location}`);
    const result = await searchAppointmentsByLocation(location);
    
    if (result.success) {
      res.json({ 
        success: true,
        location: location,
        appointments: result.appointments,
        count: result.appointments.length
      });
    } else {
      res.status(500).json({ 
        error: 'Search failed', 
        message: 'Could not retrieve appointments',
        details: {
          reason: 'Playwright search returned no results or failed',
          suggestion: 'Check if the location string is correct and ICBC website is accessible'
        }
      });
    }
  } catch (error) {
    console.error(`Error searching appointments: ${error.message}`);
    const statusCode = error.response?.status || error.status || 500;
    res.status(statusCode).json({ 
      error: 'Error searching appointments',
      message: error.message,
      status: statusCode,
      statusText: error.response?.statusText || error.statusText,
      data: error.response?.data || error.data,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      details: {
        response: error.response ? {
          status: error.response.status,
          statusText: error.response.statusText,
          headers: error.response.headers,
          data: error.response.data
        } : undefined,
        request: error.config ? {
          url: error.config.url,
          method: error.config.method,
          headers: error.config.headers
        } : undefined
      }
    });
  }
});

// Express API endpoint to fetch arguments (like exam type, locations, etc.)
app.get('/api/arguments', (req, res) => {
  const args = {
    examType: process.env.EXAM_TYPE,
    lastName: process.env.LAST_NAME,
    licenseNumber: process.env.LICENSE_NUMBER,
    locations,
  };
  res.json(args);
});

// Start the server
let server;
if (process.env.NODE_ENV !== 'test') {
  server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });

  process.on('SIGINT', () => {
    server.close(() => {
      console.log('Server closed due to SIGINT');
      process.exit(0);
    });
  });
}

module.exports = app;
