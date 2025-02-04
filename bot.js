// bot.js

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { fetchAppointments, formatAppointments, sendLongMessage } = require('./appointments');

// Telegram bot setup
let bot;
if (process.env.NODE_ENV !== 'test') {
  bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
}

// Send formatted appointments to the channel
function sendAppointmentsToChannel(appointments, channelId) {
  if (appointments.length > 0) {
    const formattedAppointments = formatAppointments(appointments);
    sendLongMessage(channelId, formattedAppointments, bot);
  } else {
    bot.sendMessage(channelId, 'No appointments available within the next 2 weeks.');
  }
}

// Telegram bot command for manual request (optional)
if (process.env.NODE_ENV !== 'test') {
  bot.onText(/\/request/, async (msg) => {
    const chatId = msg.chat.id;
    // Call the function to get appointments for all locations
    const appointments = await fetchAppointmentsForAllLocations();
    sendAppointmentsToChannel(appointments, chatId);  // Send to the user
  });
}

module.exports = { bot, sendAppointmentsToChannel };