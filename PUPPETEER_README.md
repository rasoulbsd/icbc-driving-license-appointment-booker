# ICBC Appointment Booker - Playwright Version

This branch implements ICBC appointment booking using **Playwright** (browser automation) instead of direct API calls.

**Why Playwright?** Playwright is faster to install, more modern, and has better features than Puppeteer. It's also actively maintained and supports multiple browsers.

## 🚀 Setup

### 1. Install Dependencies

```bash
cd backend
npm install
```

This will install Playwright and all required dependencies.

**Note:** On first install, Playwright will download browser binaries. This is faster than Puppeteer's Chromium download.

### 2. Configure Environment

Update your `.env` file with:

```env
# Playwright Configuration
PLAYWRIGHT_HEADLESS=false  # Set to 'false' for GUI debugging, 'true' for headless

# ICBC Credentials (same as before)
LAST_NAME=YourLastName
LICENSE_NUMBER=YourLicenseNumber
ICBC_KEYWORD=YourKeyword
```

### 3. Test the Implementation

First, explore the ICBC website to understand the flow:

```bash
npm run test:playwright
```

This will:
- Launch a browser (headless or with GUI based on `PLAYWRIGHT_HEADLESS`)
- Navigate to https://account.icbc.com/
- Take screenshots for debugging
- Save page HTML for inspection
- Look for sign-in and appointment booking elements

## 🔍 Current Status

### ✅ Implemented
- Browser automation setup with Playwright
- Login flow (basic structure)
- Navigation helpers
- Screenshot and debugging tools
- Test script to explore ICBC website

### 🚧 TODO (Needs Implementation)
1. **Complete Login Flow**
   - Identify exact sign-in button/link selectors
   - Fill in credentials correctly
   - Handle login success/failure

2. **Navigate to Appointment Booking**
   - Find the driver licensing section
   - Navigate to appointment booking page
   - Identify the correct URL/route

3. **Select Location and Exam Type**
   - Find location selector dropdown/buttons
   - Select exam type (from `EXAM_TYPE` env var)
   - Handle location selection

4. **Extract Appointments**
   - Identify appointment list/table structure
   - Parse available dates and times
   - Extract appointment data in correct format

5. **Handle Multiple Locations**
   - Loop through all locations (from `all-locations.json`)
   - Aggregate results
   - Format for API response

## 🧪 Testing

### Debug Mode (with GUI)
Set `PLAYWRIGHT_HEADLESS=false` in `.env` to see the browser in action. This helps with:
- Finding correct selectors
- Understanding page flow
- Debugging navigation issues

### Headless Mode (production)
Set `PLAYWRIGHT_HEADLESS=true` or omit the variable for headless operation.

## 📝 Notes

- The test script saves screenshots and HTML files in the `backend/` directory
- Check `icbc-homepage.png`, `icbc-driver-licensing.png`, etc. to see what the browser sees
- The `icbc-homepage.html` file can be opened in a browser to inspect the page structure

## 🔄 Next Steps

1. Run `npm run test:puppeteer` with `PUPPETEER_HEADLESS=false`
2. Manually inspect the ICBC website flow:
   - How do you sign in?
   - Where is the appointment booking section?
   - How do you select a location?
   - How are appointments displayed?
3. Update `appointments-playwright.js` with the correct selectors and flow
4. Test the complete flow
5. Integrate with the existing server endpoints

## 🐛 Troubleshooting

### Missing System Libraries (WSL/Linux)
If you see `libnspr4.so: cannot open shared object file`:
```bash
# In WSL terminal (not PowerShell):
npx playwright install-deps chromium
```

### Other Issues
- **Browser doesn't launch**: Make sure Playwright is installed (`npm install`). If browsers aren't installed, run `npx playwright install chromium`
- **Can't find elements**: Use `PLAYWRIGHT_HEADLESS=false` to see what the browser sees
- **Navigation timeouts**: Increase `NAVIGATION_TIMEOUT` in `appointments-playwright.js`
- **Screenshots not saving**: Check file permissions in the `backend/` directory
- **Installation slow**: Playwright is faster than Puppeteer, but first install downloads browser binaries. Subsequent installs are much faster.

See `PLAYWRIGHT_SETUP.md` for detailed setup instructions.

