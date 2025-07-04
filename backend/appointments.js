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

// Login and get a new bearer token
async function login() {
  try {
    // Make the login request with Authorization header

    const response = await axios.put(LOGIN_API_URL, {
    //   username: process.env.ICBC_USERNAME,
      keyword: process.env.ICBC_KEYWORD,
      drvrLastName: process.env.LAST_NAME,
      licenceNumber: process.env.LICENSE_NUMBER,
    }, {
      headers: { 
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
        // 'Authorization': `Bearer ${process.env.BEARER_TOKEN}` // Assuming BEARER_TOKEN is provided in the environment variables
      },
    });
    
    // Extract the token from the response and save it
    const token = response.headers.authorization.split(' ')[1];
    await saveToken(token);
    logMessage('Successfully logged in and updated bearer token.');
    return token;
  } catch (error) {
    logMessage(`Login failed: ${error.message}`);
    throw error;
  }
}

// Get a valid bearer token
async function getBearerToken() {
  let token = await loadToken();
  if (!token) {
    token = await login();
  }
  return token;
}

// Function to get today's date in YYYY-MM-DD format
function getToday() {
  const today = new Date();
  return today.toISOString().split('T')[0];
}

// Function to fetch appointments
async function fetchAppointments(locationId, limit = 10) {
  const today = getToday();
  let token = await getBearerToken();

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
        Authorization: `Bearer ${token}`,
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
      const location = locations[appt.posId] || 'Unknown Location';
      return {
        location: location,
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
  login,
  getBearerToken
};
