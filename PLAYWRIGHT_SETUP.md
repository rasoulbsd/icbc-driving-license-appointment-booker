# Playwright Setup for WSL

## Missing System Dependencies Error

If you see this error:
```
error while loading shared libraries: libnspr4.so: cannot open shared object file: No such file or directory
```

You need to install Playwright's system dependencies.

## Solution

Run these commands **in your WSL terminal** (not PowerShell):

```bash
cd backend

# Install Playwright system dependencies for Chromium
npx playwright install-deps chromium
```

This will install all required system libraries (libnspr4, libnss3, etc.) that Chromium needs to run.

## Alternative: Manual Installation

If the above doesn't work, you can manually install the dependencies on Ubuntu/Debian:

```bash
sudo apt-get update
sudo apt-get install -y \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libcairo2
```

## After Installing Dependencies

1. Make sure Chromium is installed:
   ```bash
   npx playwright install chromium
   ```

2. Test the script:
   ```bash
   npm run test:playwright
   ```

## Note

- Run these commands in **WSL**, not PowerShell
- The `install-deps` command is the easiest way to install all dependencies
- If you're using a different Linux distribution, check Playwright's documentation for your specific distro

