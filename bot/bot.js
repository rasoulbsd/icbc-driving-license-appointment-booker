require('dotenv').config();
const { Telegraf } = require('telegraf');
const axios = require('axios');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;
const API_URL = process.env.API_URL || 'http://localhost:3000/appointments';

const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

let lastMessageId = null; // Store the last message ID to delete
let lastMessageText = ""; // Store last sent text to prevent unnecessary updates

// Fetch appointments using Axios
async function fetchAppointments() {
    try {
        const { data } = await axios.get(API_URL);

        if (!data.appointments || data.appointments.length === 0) {
            return "No appointments available within the next 2 months.";
        }

        console.log(data.appointments)
        return data.appointments
        .map(app => `📍 *${app.location.name}*\n _${app.location.postalCode}_\n📅 ${app.date} - ${app.dayOfWeek} - ${app.startTime}`)
        .join("\n\n");
    } catch (error) {
        console.error("❌ Error fetching appointments:", error.message);
        return "⚠️ Error fetching appointment data.";
    }
}

// Generate a random interval (3 to 21 minutes, in steps of 3)
function getRandomUpdateInterval() {
    const possibleIntervals = [1.5, 2, 3]; // Valid steps
    return possibleIntervals[Math.floor(Math.random() * possibleIntervals.length)];
}

// Send a new message and delete the previous one if the content has changed
async function updateMessage() {
    try {
        const currentTime = new Date().toLocaleString('en-US', {
            timeZone: 'America/New_York',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
        
        const newMessageText = `🚦 *Available Appointments:*\n\n${await fetchAppointments()}\n\n_Last updated: ${currentTime}_`;

        // Always send a new message
        const sentMessage = await bot.telegram.sendMessage(
            TELEGRAM_CHANNEL_ID,
            newMessageText,
            { parse_mode: "Markdown" }
        );

        // Store new message details
        lastMessageId = sentMessage.message_id;
        lastMessageText = newMessageText;

        console.log("📢 Sent new message.");
    } catch (error) {
        console.error("❌ Error updating message:", error.message);
        
        // Send error message when there's an error
        try {
            const errorMessage = `⚠️ *Error occurred while fetching appointments*\n\n_Error: ${error.message}_\n\n_Time: ${new Date().toLocaleString('en-US', {
                timeZone: 'America/New_York',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
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

    // Schedule the next update in 3 to 21 minutes (random step of 3 minutes)
    const nextUpdate = getRandomUpdateInterval();
    console.log(`🔄 Next update in ${nextUpdate} minutes`);
    setTimeout(updateMessage, nextUpdate * 60 * 1000);
}

// Start the routine
updateMessage();

// Graceful shutdown
process.on('SIGINT', () => {
    console.log("⚠️ Bot stopped.");
    process.exit();
});
process.on('SIGTERM', () => {
    console.log("⚠️ Bot stopped.");
    process.exit();
});
