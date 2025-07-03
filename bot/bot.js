require('dotenv').config();
const { Telegraf } = require('telegraf');
const axios = require('axios');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;
const API_URL = process.env.API_URL || 'http://localhost:3000/appointments';
const DEBUG_MODE = process.env.DEBUG_MODE === 'true'; // New environment variable

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
    const possibleIntervals = [1, 1.25, 1.5, 1.75, 2]; // Valid steps
    return possibleIntervals[Math.floor(Math.random() * possibleIntervals.length)];
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
        
        const newMessageText = `🚦 *Available Appointments:*\n\n${await fetchAppointments()}\n\n_Last updated: ${currentTime}_\n_Next update: ${nextUpdateTime}_`;

        if (DEBUG_MODE) {
            // Debug mode: Always send new message
            const sentMessage = await bot.telegram.sendMessage(
                TELEGRAM_CHANNEL_ID,
                newMessageText,
                { parse_mode: "Markdown" }
            );

            // Store new message details
            lastMessageId = sentMessage.message_id;
            lastMessageText = newMessageText;

            console.log("📢 [DEBUG MODE] Sent new message.");
        } else {
            // Production mode: Only update if content has changed
            if (newMessageText !== lastMessageText) {
                // Delete previous message if it exists
                if (lastMessageId) {
                    try {
                        await bot.telegram.deleteMessage(TELEGRAM_CHANNEL_ID, lastMessageId);
                        console.log("🗑️ Deleted previous message.");
                    } catch (deleteError) {
                        console.log("⚠️ Could not delete previous message (might be too old):", deleteError.message);
                    }
                }

                // Send new message
                const sentMessage = await bot.telegram.sendMessage(
                    TELEGRAM_CHANNEL_ID,
                    newMessageText,
                    { parse_mode: "Markdown" }
                );

                // Store new message details
                lastMessageId = sentMessage.message_id;
                lastMessageText = newMessageText;

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

    // Schedule the next update in 3 to 21 minutes (random step of 3 minutes)
    const nextUpdate = getRandomUpdateInterval();
    console.log(`🔄 Next update in ${nextUpdate} minutes`);
    setTimeout(updateMessage, nextUpdate * 60 * 1000);
}

// Start the routine
console.log(`🚀 Bot started in ${DEBUG_MODE ? 'DEBUG' : 'PRODUCTION'} mode`);
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
