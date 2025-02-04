// bot.js

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { fetchAppointments, filterAppointmentsWithin2Weeks, formatAppointments, sendLongMessage } = require('./appointments');

// Telegram bot setup
let bot;
if (process.env.NODE_ENV !== 'test') {
  bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
}

// Function to handle requests from Telegram Bot
if (process.env.NODE_ENV !== 'test') {
  bot.onText(/\/request (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const locationArg = match[1].trim();

    if (locationArg === 'all') {
      let allAppointments = [];
      const locationIds = Object.keys(process.env.LOCATIONS); // Assuming locations come from environment
      for (const locationId of locationIds) {
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
    } else if (process.env.LOCATIONS[locationArg]) {
      const appointments = await fetchAppointments(locationArg);
      const upcomingAppointments = filterAppointmentsWithin2Weeks(appointments);
      if (upcomingAppointments.length > 0) {
        const formattedAppointments = formatAppointments(upcomingAppointments);
        sendLongMessage(chatId, formattedAppointments, bot);
      } else {
        bot.sendMessage(chatId, 'No appointments available.');
      }
    } else {
      bot.sendMessage(chatId, 'Invalid location. Use a valid location ID or "all".');
    }
  });
}

module.exports = bot;