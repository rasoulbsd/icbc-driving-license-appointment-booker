---
title: "**Telegram Bot & Private Backend for Appointment Monitoring**"
---

# [⚠ Disclaimer]{style="color: red"} {#disclaimer .unnumbered}

This project is created **for educational purposes only**. **Commercial
use is strictly prohibited** and may be **illegal** depending on your
jurisdiction. The author is **not responsible** for any misuse of this
software.

# 📌 Features {#features .unnumbered}

-   ✅ Telegram bot updates a message in a channel periodically.

-   ✅ Backend fetches appointment data securely.

-   ✅ Bot deletes old messages and sends new updates only when needed.

-   ✅ Dual-mode operation: Debug mode (always send new messages) and Production mode (update only when changes detected).

-   ✅ Dockerized for easy deployment.

-   ✅ Backend is private and only accessible inside Docker.

-   ✅ Single `.env` file for all configuration.

# 📽 Demo Video {#demo-video .unnumbered}

::: center
[![image](https://via.placeholder.com/800x450?text=Demo+Video){width="80%"}](https://your-video-link-here)
:::

# 🚀 Installation & Usage {#installation-usage .unnumbered}

## 1️⃣ Clone the Repository {#clone-the-repository .unnumbered}

    git clone https://github.com/yourusername/telegram-appointment-bot.git
    cd telegram-appointment-bot

## 2️⃣ Configure `.env` File {#configure-.env-file .unnumbered}

Create a single `.env` file in the project root directory. You can copy `env.example` to `.env` and modify the values.

### Root `.env` File {#root-env-file .unnumbered}

    # Backend Configuration
    PORT=3000
    EXAM_TYPE=G
    LAST_NAME=YourLastName
    LICENSE_NUMBER=123456
    APPOINTMENT_SEARCH_DAYS=60

    # Bot Configuration
    TELEGRAM_BOT_TOKEN=your_bot_token
    TELEGRAM_CHANNEL_ID=your_channel_id
    API_URL=http://backend:3000/appointments  # Use service name inside Docker
    DEBUG_MODE=false  # Set to 'true' for debug mode, 'false' for production mode
    UPDATE_INTERVALS=1,1.25,1.5,1.75,2  # Update intervals in minutes (comma-separated)

## 3️⃣ Build & Run Using Docker {#build-run-using-docker .unnumbered}

    docker-compose up -d --build

**Note:** The bot will **start fetching and updating appointments**, and
the backend will run **privately inside Docker**.

# 📜 API Endpoints (Backend) {#api-endpoints-backend .unnumbered}

::: center
   **Method**  **Endpoint**                  **Description**
  ------------ ----------------------------- --------------------------------------------
      GET      `/appointments`               Fetch all available appointments
      GET      `/appointments/:locationId`   Fetch appointments for a specific location
      GET      `/locations`                  Get available locations
:::

# 🤖 Bot Operation Modes {#bot-operation-modes .unnumbered}

## Debug Mode (`DEBUG_MODE=true`) {#debug-mode .unnumbered}

-   Always sends new messages every update cycle
-   Useful for testing and development
-   Shows all update activity in the channel
-   May generate more notifications

## Production Mode (`DEBUG_MODE=false`) {#production-mode .unnumbered}

-   Only updates messages when appointment data changes
-   Deletes previous message before sending new one
-   Reduces unnecessary notifications
-   Ideal for production use

# ⚙️ Configuration Options {#configuration-options .unnumbered}

## Update Intervals (`UPDATE_INTERVALS`) {#update-intervals .unnumbered}

-   Comma-separated list of update intervals in minutes
-   Bot randomly selects from these intervals for each update
-   Example: `1,1.25,1.5,1.75,2` (1 to 2 minutes)
-   Default: `1,1.25,1.5,1.75,2`

## Appointment Search Period (`APPOINTMENT_SEARCH_DAYS`) {#appointment-search-period .unnumbered}

-   Number of days to search for available appointments
-   Used in both backend and bot
-   Affects the "No appointments available within the next X" message
-   Default: `60` (2 months)
-   Examples: `30` (1 month), `90` (3 months), `14` (2 weeks)

## Port Configuration (`PORT`) {#port-configuration .unnumbered}

-   Backend server port (default: `3000`)
-   Docker Compose automatically maps this port to the host
-   Format: `127.0.0.1:${PORT}:3000`
-   Backend is only accessible from localhost for security

# 🛠 Development {#development .unnumbered}

## Backend {#backend .unnumbered}

    cd backend
    npm install
    npm run dev

## Bot {#bot .unnumbered}

    cd bot
    npm install
    npm run dev

# 📜 Stopping & Removing the Containers {#stopping-removing-the-containers .unnumbered}

    docker-compose down

# ⚠ Legal Disclaimer {#legal-disclaimer .unnumbered}

This project is **strictly for educational purposes**.\
Using this bot for **commercial purposes** is **illegal** and may
**violate terms of service**.\
The author **assumes no responsibility** for any misuse of this
software.

# 📜 License {#license .unnumbered}

This project is **open-source** but **not for commercial use**.

# 🤝 Contributing {#contributing .unnumbered}

Pull requests are welcome! Feel free to **fork this repo** and suggest
improvements. 🚀
