// server.js

require('dotenv').config({ path: '../.env' });
const express = require('express');
const { fetchAppointments, filterAppointmentsWithinPeriod, formatAppointments, login, getBearerToken } = require('./appointments');
const locations = require('./locations');

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

// Route to log in and fetch bearer token
app.get('/login', async (req, res) => {
  try {
    const token = await login(); // Calls the login function from appointments.js
    res.json({ token });
  } catch (error) {
    res.status(500).json({ error: 'Login failed', message: error.message });
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

// Route to fetch appointments for a specific location
app.get('/appointments/:locationId', async (req, res) => {
  const { locationId } = req.params;
  try {
    const appointments = await fetchAppointments(locationId); // Fetch appointments for the specific location
    const upcomingAppointments = filterAppointmentsWithinPeriod(appointments);
    if (upcomingAppointments.length > 0) {
      const formattedAppointments = formatAppointments(upcomingAppointments);
      res.json({ appointments: formattedAppointments });
    } else {
      const timePeriod = getTimePeriodText(APPOINTMENT_SEARCH_DAYS);
      res.json({ message: `No appointments available within the next ${timePeriod}.` });
    }
  } catch (error) {
    res.status(500).json({ error: 'Error fetching appointments', message: error.message });
  }
});

// Route to fetch appointments for all locations
app.get('/appointments', async (req, res) => {
    try {
      let allAppointments = [];
      const locationIds = Object.keys(locations); // Assuming locations are provided via environment variables
      for (const locationId of locationIds) {
        const appointments = await fetchAppointments(locationId);
        if (appointments) {
          allAppointments = allAppointments.concat(appointments);
        }
      }
      const upcomingAppointments = filterAppointmentsWithinPeriod(allAppointments);
      if (upcomingAppointments.length > 0) {
        const formattedAppointments = formatAppointments(upcomingAppointments); // Format the appointments as a list
        res.json({ appointments: formattedAppointments });
      } else {
        const timePeriod = getTimePeriodText(APPOINTMENT_SEARCH_DAYS);
        res.json({ message: `No appointments available within the next ${timePeriod}.` });
      }
    } catch (error) {
      res.status(500).json({ error: 'Error fetching appointments', message: error.message });
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
