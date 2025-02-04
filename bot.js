// Install required packages
// npm install axios dotenv express node-telegram-bot-api fs-extra

require('dotenv').config();
const axios = require('axios');
const express = require('express');
const fs = require('fs-extra');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const PORT = process.env.PORT || 3000;

// Telegram bot setup
let bot;
if (process.env.NODE_ENV !== 'test') {
  bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
}

// ICBC API details
const ICBC_API_URL = 'https://onlinebusiness.icbc.com/deas-api/v1/web/getAvailableAppointments';
const LOGIN_API_URL = 'https://onlinebusiness.icbc.com/deas-api/v1/web/login';
const TOKEN_FILE = './bearer_token.json';

// Location mapping
const locations = {
  153: "Langley driver licensing (Willowbrook Center)",
  73: "Port Coquitlam driver licensing",
  281: "Guildford Boardwalk road test centre (Boardwalk mall)",
  11: "Surrey driver licensing",
  1: "Abbotsford driver licensing (Clearbrook Plaza)",
  2: "Burnaby driver licensing",
  8: "North Vancouver driver licensing",
  93: "Richmond driver licensing (Lansdowne Centre mall)",
  9: "Vancouver driver licensing (Point Grey)",
  3: "Chilliwack driver licensing",
};

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
    const response = await axios.post(LOGIN_API_URL, {
      username: process.env.ICBC_USERNAME,
      password: process.env.ICBC_PASSWORD,
    }, {
      headers: { 'Content-Type': 'application/json' },
    });
    const token = response.data.token;
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

// Filter appointments within 2 weeks
function filterAppointmentsWithin2Weeks(appointments) {
  const today = new Date();
  const twoWeeksFromNow = new Date();
  twoWeeksFromNow.setDate(today.getDate() + 14);

  return appointments.filter(appt => {
    const apptDate = new Date(appt.appointmentDt.date);
    return apptDate >= today && apptDate <= twoWeeksFromNow;
  });
}

// Function to format appointment data
function formatAppointments(appointments) {
  return appointments
    .sort((a, b) => new Date(a.appointmentDt.date) - new Date(b.appointmentDt.date))
    .map(appt => {
      const locationName = locations[appt.posId] || 'Unknown Location';
      return `📍 *${locationName}*\n📅 Date: ${appt.appointmentDt.date} (${appt.appointmentDt.dayOfWeek})\n🕒 Time: ${appt.startTm} - ${appt.endTm}`;
    })
    .join('\n\n');
}

// Function to send long messages in chunks
function sendLongMessage(chatId, text, bot) {
  const chunkSize = 4000; // Max safe Telegram message size
  for (let i = 0; i < text.length; i += chunkSize) {
    const chunk = text.slice(i, i + chunkSize);
    bot.sendMessage(chatId, chunk, { parse_mode: 'Markdown' });
  }
}

// Function to fetch and send results to a channel
async function fetchAndSendAppointments() {
  const channelId = process.env.TELEGRAM_CHANNEL_ID; // Use channel ID or username
  const locationIds = Object.keys(locations);

  let allAppointments = [];

  logMessage('Starting scheduled crawling...');

  for (const locationId of locationIds) {
    const appointments = await fetchAppointments(locationId);
    if (appointments) {
      allAppointments = allAppointments.concat(appointments);
    }
  }

  // Filter appointments within 2 weeks
  const upcomingAppointments = filterAppointmentsWithin2Weeks(allAppointments);

  if (upcomingAppointments.length > 0) {
    const formattedAppointments = formatAppointments(upcomingAppointments);
    sendLongMessage(channelId, formattedAppointments, bot); // Send to channel
  } else {
    bot.sendMessage(channelId, 'No appointments available within the next 2 weeks.');
  }

  logMessage('Completed scheduled crawling. Next crawl in 1 hour.');
}

// Schedule the task to run every hour
const CRAWL_INTERVAL = process.env.CRAWL_INTERVAL || 60 * 60 * 1000;
if (process.env.NODE_ENV !== 'test') {
  setInterval(fetchAndSendAppointments, CRAWL_INTERVAL);
}

// Express API endpoint to fetch arguments
app.get('/api/arguments', (req, res) => {
  const args = {
    examType: process.env.EXAM_TYPE,
    lastName: process.env.LAST_NAME,
    licenseNumber: process.env.LICENSE_NUMBER,
    locations,
  };
  res.json(args);
});

// Telegram bot command for manual request
if (process.env.NODE_ENV !== 'test') {
  bot.onText(/\/request (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const locationArg = match[1].trim();

    if (locationArg === 'all') {
      let allAppointments = [];
      for (const locationId of Object.keys(locations)) {
        const appointments = await fetchAppointments(locationId);
        if (appointments) {
          allAppointments = allAppointments.concat(appointments);
        }
      }
      const upcomingAppointments = filterAppointmentsWithin2Weeks(allAppointments).slice(0, 10);
      if (upcomingAppointments.length > 0) {
        const formattedAppointments = formatAppointments(upcomingAppointments);
        sendLongMessage(chatId, formattedAppointments, bot);
      } else {
        bot.sendMessage(chatId, 'No appointments available.');
      }
    } else if (locations[locationArg]) {
      const appointments = await fetchAppointments(locationArg);
      const upcomingAppointments = filterAppointmentsWithin2Weeks(appointments);
      if (upcomingAppointments.length > 0) {
        const formattedAppointments = formatAppointments(upcomingAppointments);
        sendLongMessage(chatId, formattedAppointments, bot);
      } else {
        bot.sendMessage(chatId, 'No appointments available.');
      }
    } else {
      bot.sendMessage(chatId, 'Invalid location. Use a valid location ID or \"all\".');
    }
  });
}

// Start the server
let server;
if (process.env.NODE_ENV !== 'test') {
  server = app.listen(PORT, () => {
    logMessage(`Server running on port ${PORT}`);
  });

  process.on('SIGINT', () => {
    server.close(() => {
      logMessage('Server closed due to SIGINT');
      process.exit(0);
    });
  });
}

module.exports = {
  login,
  getBearerToken,
  fetchAppointments,
  saveToken,
  loadToken,
  logMessage,
};