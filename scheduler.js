// scheduler.js

require('dotenv').config();
const { fetchAppointments, filterAppointmentsWithin2Weeks } = require('./appointments');
const { sendAppointmentsToChannel } = require('./bot');
const fs = require('fs-extra');

// Location mapping (same as in your main code)
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

// Track the number of consecutive failed login attempts
let failedLoginAttempts = 0;

// Function to fetch appointments for all locations
async function fetchAppointmentsForAllLocations() {
  let allAppointments = [];
  for (const locationId of Object.keys(locations)) {
    try {
      const appointments = await fetchAppointments(locationId);
      if (appointments) {
        allAppointments = allAppointments.concat(appointments);
      }
    } catch (error) {
      console.log(`Error fetching appointments for location ${locationId}: ${error.message}`);
    }
  }

  // Filter and return appointments within the next 2 weeks
  const upcomingAppointments = filterAppointmentsWithin2Weeks(allAppointments);
  return upcomingAppointments;
}

// Function to handle login attempts (max 4 retries)
async function loginWithRetry() {
  if (failedLoginAttempts >= 4) {
    console.log('Max login attempts reached. Skipping login.');
    return null;
  }

  try {
    const token = await login(); // Assuming login() will perform login
    failedLoginAttempts = 0;  // Reset failed login count if successful
    return token;
  } catch (error) {
    failedLoginAttempts += 1;
    console.log(`Login attempt ${failedLoginAttempts} failed. Retrying...`);
    return null;
  }
}

// Function to schedule appointment checks with random intervals
function scheduleAppointmentChecks() {
  const channelId = process.env.TELEGRAM_CHANNEL_ID; // Channel to send appointments

  setInterval(async () => {
    const randomInterval = Math.floor(Math.random() * (45 - 10 + 1)) + 10; // Random between 10 and 45 min
    console.log(`Next check scheduled in ${randomInterval} minutes`);

    try {
      const appointments = await fetchAppointmentsForAllLocations();
      sendAppointmentsToChannel(appointments, channelId);
    } catch (error) {
      console.error('Error fetching appointments:', error.message);

      // If fetchAppointments fails, attempt login and retry the request
      await loginWithRetry();
      const appointments = await fetchAppointmentsForAllLocations();
      sendAppointmentsToChannel(appointments, channelId);
    }

  }, randomInterval * 60 * 1000);  // Convert minutes to milliseconds
}

module.exports = { scheduleAppointmentChecks };