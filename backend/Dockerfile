# Use official Node.js LTS image
FROM node:18-alpine

# Install system dependencies required for Playwright
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    && rm -rf /var/cache/apk/*

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Install Playwright browsers (chromium only for smaller image size)
RUN npx playwright install chromium || true
RUN npx playwright install-deps chromium || true

# Set environment variable to use system Chromium in Docker (Alpine path)
ENV CHROMIUM_PATH=/usr/bin/chromium-browser
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=0

# Copy the rest of the backend files
COPY . .

# Expose backend port (not public because of Docker networking)
EXPOSE 3000

# Start the server
CMD ["node", "server.js"]