// Install required packages
// npm install axios dotenv express node-telegram-bot-api

require('dotenv').config();
const axios = require('axios');
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const PORT = process.env.PORT || 3000;

// Telegram bot setup
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

// ICBC appointment API details
const ICBC_API_URL = 'https://onlinebusiness.icbc.com/deas-api/v1/web/getAvailableAppointments';

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

// Function to fetch appointments
async function fetchAppointments(locationId) {
  try {
    const response = await axios.post(ICBC_API_URL, {
      aPosID: locationId,
      examDate: process.env.EXAM_DATE,
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
        Authorization: `Bearer ${process.env.AUTH_TOKEN}`,
      },
    });
    return response.data.slice(0, limit);
  } catch (error) {
    console.error(error);
    return null;
  }
}

// Function to format appointment data
function formatAppointments(appointments) {
  return appointments
    .sort((a, b) => new Date(a.appointmentDt.date) - new Date(b.appointmentDt.date))
    .map(appt => {
      const locationName = locations[appt.posId] || 'Unknown Location';
      return `\u{1F4CD} *${locationName}*
  \u{1F4C5} Date: ${appt.appointmentDt.date} (${appt.appointmentDt.dayOfWeek})
  \u{1F550} Time: ${appt.startTm} - ${appt.endTm}`;
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
  

// Telegram bot command
bot.onText(/\/appointments/, async (msg) => {
    const chatId = msg.chat.id;
    const locationIds = Object.keys(locations);
  
    bot.sendMessage(chatId, 'Fetching appointments, please wait...');
  
    let allAppointments = [];
  
    for (const locationId of locationIds) {
      const appointments = await fetchAppointments(locationId);
      if (appointments) {
        allAppointments = allAppointments.concat(appointments);
      }
    }
  
    if (allAppointments.length > 0) {
      const formattedAppointments = formatAppointments(allAppointments);
      sendLongMessage(chatId, formattedAppointments, bot);
    } else {
      bot.sendMessage(chatId, 'No appointments available.');
    }
});

// Express API endpoint
app.get('/appointments', async (req, res) => {
  const locationIds = Object.keys(locations);
  let allAppointments = [];

  for (const locationId of locationIds) {
    const appointments = await fetchAppointments(locationId);
    if (appointments) {
      allAppointments = allAppointments.concat(appointments);
    }
  }

  if (allAppointments.length > 0) {
    res.json(allAppointments);
  } else {
    res.status(404).json({ message: 'No appointments available.' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
