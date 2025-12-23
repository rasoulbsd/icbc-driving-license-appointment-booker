// appointments.js

require('dotenv').config({ path: '../.env' });
const axios = require('axios');
const fs = require('fs-extra');

const locations = require('./locations');

// ICBC API details
const ICBC_API_URL = 'https://onlinebusiness.icbc.com/deas-api/v1/web/getAvailableAppointments';
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

// Login (ICBC currently does not return a bearer token header; this just validates credentials/session)
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
    // In case ICBC ever returns a token in the body in the future:
    return response.data || { status: response.status };
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

// Function to fetch appointments
async function fetchAppointments(locationId, limit = 10) {
  const today = getToday();

  try {
    logMessage(`Fetching appointments for location ${locationId}...`);
    const response = await axios.post(ICBC_API_URL, {
      aPosID: locationId,
      examDate: today,
      examType: process.env.EXAM_TYPE,
      ignoreReserveTime: false,
      lastName: process.env.LAST_NAME,
      licenseNumber: process.env.LICENSE_NUMBER,
      prfDaysOfWeek: '[0,1,2,3,4,5,6]',
      prfPartsOfDay: '[0,1]',
    }, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        ...(process.env.ICBC_COOKIES ? { Cookie: process.env.ICBC_COOKIES } : {})
      },
    });
    logMessage(`Successfully fetched appointments for location ${locationId}`);
    return response.data.slice(0, limit);
  } catch (error) {
    if (error.response?.status === 403) {
      logMessage('Bearer token expired. Logging in again...');
      token = await login();
      return fetchAppointments(locationId, limit); // Retry with new token
    } else {
      logMessage(`Error fetching appointments for location ${locationId}: ${error.response?.status || 'Unknown'} - ${error.message}`);
      fs.appendFileSync(
        'error.log',
        `${new Date().toISOString()} - Location ${locationId}: ${error.response?.status || 'Unknown'} - ${error.message}\n`
      );
      return null;
    }
  }
}

// Filter appointments within configured period
function filterAppointmentsWithinPeriod(appointments) {
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
