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

-   ✅ Dockerized for easy deployment.

-   ✅ Backend is private and only accessible inside Docker.

# 📽 Demo Video {#demo-video .unnumbered}

::: center
[![image](https://via.placeholder.com/800x450?text=Demo+Video){width="80%"}](https://your-video-link-here)
:::

# 🚀 Installation & Usage {#installation-usage .unnumbered}

## 1️⃣ Clone the Repository {#clone-the-repository .unnumbered}

    git clone https://github.com/yourusername/telegram-appointment-bot.git
    cd telegram-appointment-bot

## 2️⃣ Configure `.env` Files {#configure-.env-files .unnumbered}

Create `.env` files inside both **backend** and **bot** directories.

### Backend (`/backend/.env`) {#backend-backend.env .unnumbered}

    PORT=3000
    EXAM_TYPE=G
    LAST_NAME=YourLastName
    LICENSE_NUMBER=123456

### Bot (`/bot/.env`) {#bot-bot.env .unnumbered}

    TELEGRAM_BOT_TOKEN=your_bot_token
    TELEGRAM_CHANNEL_ID=your_channel_id
    API_URL=http://backend:3000/appointments  # Use service name inside Docker

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
