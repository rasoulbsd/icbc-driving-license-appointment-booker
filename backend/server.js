// server.js

require('dotenv').config();
const express = require('express');
const { fetchAppointments, filterAppointmentsWithin2Weeks, formatAppointments, login, getBearerToken } = require('./appointments');
const locations = require('./locations');

const app = express();
const PORT = process.env.PORT || 3000;


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
    const upcomingAppointments = filterAppointmentsWithin2Weeks(appointments);
    if (upcomingAppointments.length > 0) {
      const formattedAppointments = formatAppointments(upcomingAppointments);
      res.json({ appointments: formattedAppointments });
    } else {
      res.json({ message: 'No appointments available within the next 2 months.' });
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
      const upcomingAppointments = filterAppointmentsWithin2Weeks(allAppointments);
      if (upcomingAppointments.length > 0) {
        const formattedAppointments = formatAppointments(upcomingAppointments); // Format the appointments as a list
        res.json({ appointments: formattedAppointments });
      } else {
        res.json({ message: 'No appointments available within the next 2 months.' });
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
