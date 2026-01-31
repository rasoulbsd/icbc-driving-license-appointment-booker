// appointments-playwright.js - Playwright-based implementation for ICBC appointment booking

require('dotenv').config({ path: '../.env' });
const { chromium } = require('playwright');
const fs = require('fs-extra');

const locations = require('./locations');
const allLocations = require('./all-locations.json');

// Configurable appointment search period (in days)
const APPOINTMENT_SEARCH_DAYS = parseInt(process.env.APPOINTMENT_SEARCH_DAYS) || 60;

// Playwright configuration
const HEADLESS = process.env.PLAYWRIGHT_HEADLESS === 'true'; // Default to GUI (false), set to 'true' for headless
const BROWSER_TIMEOUT = 60000; // 60 seconds
const NAVIGATION_TIMEOUT = 30000; // 30 seconds

// Logging function
function logMessage(message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
  fs.appendFileSync('app.log', `[${timestamp}] ${message}\n`);
}

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

// Helper function to delay execution
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Initialize browser instance (singleton pattern)
let browserInstance = null;
let contextInstance = null;

async function getBrowser() {
  if (!browserInstance) {
    logMessage(`Launching Playwright browser (headless: ${HEADLESS})...`);
    // In Docker/Alpine, use system Chromium if available
    const executablePath = process.env.CHROMIUM_PATH || (process.platform === 'linux' && process.env.IN_DOCKER === 'true' ? '/usr/bin/chromium-browser' : undefined);
    
    browserInstance = await chromium.launch({
      executablePath: executablePath,
      headless: HEADLESS,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process'
      ]
    });
    
    contextInstance = await browserInstance.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    });
    
    logMessage('Browser launched successfully');
  }
  return { browser: browserInstance, context: contextInstance };
}

async function closeBrowser() {
  stopKeepAlive();
  isLoggedIn = false;
  if (sessionPage && !sessionPage.isClosed()) {
    await sessionPage.close();
    sessionPage = null;
  }
  if (contextInstance) {
    await contextInstance.close();
    contextInstance = null;
  }
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
    logMessage('Browser closed');
  }
}

// Login to ICBC account
async function login() {
  const { context } = await getBrowser();
  const page = await context.newPage();

  try {
    // Navigate directly to the booking system (webdeas-ui)
    logMessage('Navigating to ICBC booking system...');
    await page.goto('https://onlinebusiness.icbc.com/webdeas-ui/home', {
      waitUntil: 'domcontentloaded',
      timeout: NAVIGATION_TIMEOUT
    });

    // Wait for page to be interactive
    await page.waitForLoadState('load');
    await delay(3000); // Extra wait for any dynamic content

    // Click the Terms and Conditions checkbox
    logMessage('Looking for Terms and Conditions checkbox...');
    const checkbox = page.locator('input[type="checkbox"]').first();
    const checkboxCount = await checkbox.count();
    
    if (checkboxCount > 0) {
      const isChecked = await checkbox.isChecked();
      if (!isChecked) {
        logMessage('Clicking Terms and Conditions checkbox...');
        await checkbox.click();
        await delay(500);
      } else {
        logMessage('Terms and Conditions checkbox already checked');
      }
    } else {
      logMessage('⚠️  Could not find Terms and Conditions checkbox');
    }

    // Click the third "Sign in" button using XPath
    logMessage('Looking for sign-in button (third button)...');
    
    // Use the specific XPath for the third sign-in button
    const signInButtonXPath = '/html/body/div[2]/main/div[2]/div/div[1]/div[2]/div[4]/div/div[2]/div/div/div[1]/form/button';
    let signInButton = page.locator(`xpath=${signInButtonXPath}`);
    let buttonCount = await signInButton.count();
    
    if (buttonCount > 0) {
      const buttonText = await signInButton.textContent();
      logMessage(`Found sign-in button: "${buttonText?.trim()}"`);
      logMessage('Clicking sign-in button (third button)...');
      await signInButton.scrollIntoViewIfNeeded();
      await delay(500);
      await signInButton.click();
      
      // Wait for navigation or form to appear
      await page.waitForLoadState('load', { timeout: NAVIGATION_TIMEOUT });
      await delay(2000);
      
      logMessage(`After clicking sign-in, current URL: ${page.url()}`);
    } else {
      throw new Error('Could not find sign-in button at the specified XPath');
    }

    await delay(1000); // Wait for form to load

    // Click the "Select" button for "B.C. driver's licence or learner's licence" using exact XPath
    logMessage('Looking for "B.C. driver\'s licence" Select button...');
    await delay(2000); // Wait for the page to fully load
    
    // Use the exact XPath provided
    const selectButtonXPath = '/html/body/form/div[5]/div/div/div/div[2]/div/div[3]/div/div[3]/div[1]/div/span/div[3]/div/div[3]';
    const targetSelectButton = page.locator(`xpath=${selectButtonXPath}`);
    
    buttonCount = await targetSelectButton.count();
    logMessage(`Found ${buttonCount} Select button(s) using XPath`);
    
    if (buttonCount > 0) {
      logMessage('Clicking Select button...');
      
      // Make sure button is visible and enabled
      const isVisible = await targetSelectButton.isVisible();
      const isEnabled = await targetSelectButton.isEnabled();
      logMessage(`Button visible: ${isVisible}, enabled: ${isEnabled}`);
      
      // Scroll to button
      await targetSelectButton.scrollIntoViewIfNeeded();
      await delay(1000); // Wait longer after scroll
      
      // Try multiple click methods
      let clicked = false;
      
      // Method 1: Regular click
      try {
        await targetSelectButton.click({ timeout: 5000 });
        clicked = true;
        logMessage('Clicked using regular click');
      } catch (e) {
        logMessage(`Regular click failed: ${e.message}`);
      }
      
      // Method 2: Force click if regular didn't work
      if (!clicked) {
        try {
          await targetSelectButton.click({ force: true });
          clicked = true;
          logMessage('Clicked using force click');
        } catch (e) {
          logMessage(`Force click failed: ${e.message}`);
        }
      }
      
      // Method 3: JavaScript click
      if (!clicked) {
        try {
          await targetSelectButton.evaluate(btn => btn.click());
          clicked = true;
          logMessage('Clicked using JavaScript');
        } catch (e) {
          logMessage(`JavaScript click failed: ${e.message}`);
        }
      }
      
      if (!clicked) {
        logMessage('All click methods failed');
      }
      
      // Wait for form to appear and scroll to it
      logMessage('Waiting for form fields to appear...');
      await delay(3000); // Wait longer for form to appear
      
      // Scroll down a bit to make sure form is visible
      await page.evaluate(() => window.scrollBy(0, 300));
      await delay(500);
    } else {
      logMessage('⚠️  Could not find Select button for driver\'s licence');
    }

    // Take screenshot for debugging
    if (!HEADLESS) {
      await page.screenshot({ path: 'icbc-signin-form.png', fullPage: true });
      logMessage('Screenshot saved: icbc-signin-form.png');
    }

    // Fill in login credentials
    logMessage('Filling in login credentials...');
    
    // Parse the date: "14 March 2024" -> year: 2024, month: March (03), day: 14
    const dateValue = process.env.ICBC_DATE || '14 March 2024';
    const dateParts = dateValue.split(' ');
    const day = dateParts[0];
    const monthName = dateParts[1];
    const year = dateParts[2];
    const monthMap = {
      'january': '01', 'jan': '01',
      'february': '02', 'feb': '02',
      'march': '03', 'mar': '03',
      'april': '04', 'apr': '04',
      'may': '05',
      'june': '06', 'jun': '06',
      'july': '07', 'jul': '07',
      'august': '08', 'aug': '08',
      'september': '09', 'sep': '09',
      'october': '10', 'oct': '10',
      'november': '11', 'nov': '11',
      'december': '12', 'dec': '12'
    };
    const monthNum = monthMap[monthName.toLowerCase()] || '03';
    
    const licenseNumber = process.env.BCID_NUMBER || '111556588';
    const keyword = process.env.ICBC_KEYWORD || '2336lili';
    
    // Use exact XPath for first input field (license/BCID number)
    const firstInputXPath = '/html/body/form/div[5]/div/div/div/div[2]/div/div[3]/div/div[3]/div[4]/div[3]/div/div/div[2]/div[2]/div[1]/input';
    const firstInput = page.locator(`xpath=${firstInputXPath}`);
    
    if (await firstInput.count() > 0) {
      logMessage('Found first input field using XPath');
      await firstInput.scrollIntoViewIfNeeded();
      await delay(200);
      await firstInput.fill(licenseNumber);
      logMessage(`Filled license number: ${licenseNumber}`);
    } else {
      logMessage('⚠️  First input field not found using XPath, trying fallback...');
      // Fallback: try to find by attributes
      const fallbackInput = page.locator('input[name*="license"], input[name*="licence"], input[name*="bcid"], input[name*="number"]').first();
      if (await fallbackInput.count() > 0) {
        await fallbackInput.scrollIntoViewIfNeeded();
        await delay(200);
        await fallbackInput.fill(licenseNumber);
        logMessage(`Filled license number (fallback): ${licenseNumber}`);
      }
    }
    
    // Fill date fields using exact XPaths
    // Note: The order in the form is Year (div[1]), Month (div[2]), Day (div[3])
    
    // Year input (div[1])
    const yearInputXPath = '/html/body/form/div[5]/div/div/div/div[2]/div/div[3]/div/div[3]/div[4]/div[3]/div/div/div[4]/div[2]/div[1]/div[1]/div[1]/input';
    const yearInput = page.locator(`xpath=${yearInputXPath}`);
    if (await yearInput.count() > 0) {
      await yearInput.scrollIntoViewIfNeeded();
      await delay(200);
      await yearInput.fill(year);
      logMessage(`Filled year: ${year}`);
    } else {
      logMessage('⚠️  Year input not found using XPath');
    }
    
    // Month select (div[2])
    const monthSelectXPath = '/html/body/form/div[5]/div/div/div/div[2]/div/div[3]/div/div[3]/div[4]/div[3]/div/div/div[4]/div[2]/div[1]/div[1]/div[2]/select';
    const monthSelect = page.locator(`xpath=${monthSelectXPath}`);
    if (await monthSelect.count() > 0) {
      await monthSelect.scrollIntoViewIfNeeded();
      await delay(300);
      
      // Wait for select to be ready
      await monthSelect.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
      
      // Get month abbreviation (e.g., "March" -> "MAR")
      const monthAbbr = monthName.substring(0, 3).toUpperCase();
      
      logMessage(`Attempting to select month: ${monthName} (${monthAbbr}, value: ${monthNum})`);
      
      // First, get all options to see what's available
      const options = await monthSelect.locator('option').all();
      logMessage(`Found ${options.length} month options`);
      
      // Log all options for debugging
      for (let i = 0; i < options.length; i++) {
        const optionText = await options[i].textContent();
        const optionValue = await options[i].getAttribute('value');
        const isSelected = await options[i].evaluate(el => el.selected);
        logMessage(`  Option ${i}: text="${optionText?.trim()}", value="${optionValue}", selected=${isSelected}`);
      }
      
      // Find the matching option by text (abbreviation like MAR, JAN, etc.)
      let targetIndex = -1;
      let targetValue = null;
      let targetOption = null;
      
      for (let i = 0; i < options.length; i++) {
        const optionText = await options[i].textContent();
        const optionValue = await options[i].getAttribute('value');
        const trimmedText = optionText?.trim().toUpperCase();
        
        // Match by abbreviation (MAR, JAN, etc.) - this is what's in the select
        if (trimmedText === monthAbbr) {
          targetIndex = i;
          targetValue = optionValue;
          targetOption = options[i];
          logMessage(`Found matching option at index ${i}: "${optionText?.trim()}" (value: ${optionValue})`);
          break;
        }
      }
      
      // If not found by abbreviation, try other methods
      if (targetIndex < 0) {
        for (let i = 0; i < options.length; i++) {
          const optionText = await options[i].textContent();
          const optionValue = await options[i].getAttribute('value');
          const trimmedText = optionText?.trim().toUpperCase();
          
          if (trimmedText === monthName.toUpperCase() ||
              trimmedText.includes(monthName.toUpperCase()) ||
              trimmedText.includes(monthAbbr)) {
            targetIndex = i;
            targetValue = optionValue;
            targetOption = options[i];
            logMessage(`Found matching option at index ${i}: "${optionText?.trim()}" (value: ${optionValue})`);
            break;
          }
        }
      }
      
      let monthSelected = false;
      
      // Method 1: Use selectOption with the actual value from the option (PRIORITY METHOD)
      if (targetValue) {
        try {
          logMessage(`Selecting month by value: ${targetValue} (${monthAbbr})`);
          await monthSelect.selectOption({ value: targetValue });
          await delay(500); // Wait for onchange handler to fire
          
          // Verify selection
          const selectedValue = await monthSelect.inputValue();
          const selectedText = await monthSelect.locator('option:checked').textContent();
          
          if (selectedValue === targetValue || selectedText?.trim().toUpperCase() === monthAbbr) {
            logMessage(`Selected month by value: ${targetValue} (${monthAbbr})`);
            monthSelected = true;
          } else {
            logMessage(`⚠️  Value selection didn't verify: selectedValue=${selectedValue}, selectedText="${selectedText}"`);
          }
        } catch (e) {
          logMessage(`⚠️  SelectOption by value failed: ${e.message}`);
        }
      }
      
      // Method 2: Click select to open dropdown, then click the month option
      if (!monthSelected && targetOption) {
        try {
          logMessage(`Clicking select dropdown to open it...`);
          await monthSelect.click();
          await delay(500); // Wait for dropdown to open
          
          // Wait for the option to be visible/clickable
          await targetOption.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
          
          logMessage(`Clicking month option: ${monthAbbr} (index ${targetIndex}, value ${targetValue})...`);
          await targetOption.scrollIntoViewIfNeeded();
          await delay(200);
          await targetOption.click({ force: true });
          await delay(500); // Wait for selection to register and onchange to fire
          
          // Verify selection
          const selectedValue = await monthSelect.inputValue();
          const selectedText = await monthSelect.locator('option:checked').textContent();
          
          if (selectedValue === targetValue || selectedText?.trim().toUpperCase() === monthAbbr) {
            logMessage(`Selected month by clicking: value=${selectedValue}, text="${selectedText?.trim()}"`);
            monthSelected = true;
          } else {
            logMessage(`⚠️  Click didn't verify: selectedValue=${selectedValue}, selectedText="${selectedText}"`);
          }
        } catch (e) {
          logMessage(`⚠️  Click method failed: ${e.message}`);
        }
      }
      
      // Method 3: Use selectOption with index (fallback)
      if (!monthSelected && targetIndex >= 0) {
        try {
          await monthSelect.selectOption({ index: targetIndex });
          await delay(500);
          const selectedValue = await monthSelect.inputValue();
          const selectedText = await monthSelect.locator('option:checked').textContent();
          if (selectedValue === targetValue || selectedText?.trim().toUpperCase() === monthAbbr) {
            logMessage(`Selected month by selectOption index: ${targetIndex}`);
            monthSelected = true;
          }
        } catch (e) {
          logMessage(`⚠️  SelectOption by index failed: ${e.message}`);
        }
      }
      
      // Method 4: Use selectOption with label (abbreviation)
      if (!monthSelected) {
        try {
          await monthSelect.selectOption({ label: monthAbbr });
          await delay(500);
          const selectedText = await monthSelect.locator('option:checked').textContent();
          if (selectedText?.trim().toUpperCase() === monthAbbr) {
            logMessage(`Selected month by label: ${monthAbbr}`);
            monthSelected = true;
          }
        } catch (e) {
          logMessage(`⚠️  SelectOption by label failed: ${e.message}`);
        }
      }
      
      // Method 4: Use evaluate to directly set the selectedIndex and trigger events (fallback)
      if (!monthSelected && targetIndex >= 0) {
        try {
          const success = await monthSelect.evaluate((select, index, value) => {
            // Set the selected index
            select.selectedIndex = index;
            // Also set the value
            select.value = value;
            // Trigger multiple events to ensure the change is registered
            select.dispatchEvent(new Event('change', { bubbles: true }));
            select.dispatchEvent(new Event('input', { bubbles: true }));
            // Also try focus/blur to trigger validation
            select.focus();
            select.blur();
            return select.value === value || select.selectedIndex === index;
          }, targetIndex, monthNum);
          
          await delay(300);
          
          // Verify selection
          const selectedValue = await monthSelect.inputValue();
          const selectedIndex = await monthSelect.evaluate(el => el.selectedIndex);
          const selectedText = await monthSelect.locator('option:checked').textContent();
          
          if (selectedValue === monthNum || selectedIndex === targetIndex || selectedText?.trim().toUpperCase().includes(monthAbbr)) {
            logMessage(`Selected month by direct index/value assignment: index=${targetIndex}, value=${monthNum}`);
            monthSelected = true;
          } else {
            logMessage(`⚠️  Direct assignment didn't verify: selectedValue=${selectedValue}, selectedIndex=${selectedIndex}, selectedText="${selectedText}"`);
          }
        } catch (e) {
          logMessage(`⚠️  Direct index/value assignment failed: ${e.message}`);
        }
      }
      
      // Method 5: Try by label/text matching
      if (!monthSelected) {
        try {
          // Try full name
          await monthSelect.selectOption({ label: monthName });
          await delay(200);
          const selectedText = await monthSelect.locator('option:checked').textContent();
          if (selectedText?.trim().toLowerCase().includes(monthName.toLowerCase())) {
            logMessage(`Selected month by label (full): ${monthName}`);
            monthSelected = true;
          } else {
            // Try abbreviation
            await monthSelect.selectOption({ label: monthAbbr });
            await delay(200);
            const selectedText2 = await monthSelect.locator('option:checked').textContent();
            if (selectedText2?.trim().toUpperCase().includes(monthAbbr)) {
              logMessage(`Selected month by label (abbr): ${monthAbbr}`);
              monthSelected = true;
            }
          }
        } catch (e) {
          logMessage(`⚠️  SelectOption by label failed: ${e.message}`);
        }
      }
      
      if (!monthSelected) {
        logMessage('⚠️  Could not select month using any method');
        logMessage(`   Looking for: ${monthName} (${monthAbbr}, value: ${monthNum})`);
        logMessage(`   Target index was: ${targetIndex}`);
      }
    } else {
      logMessage('⚠️  Month select not found using XPath');
    }
    
    // Day input (div[3])
    const dayInputXPath = '/html/body/form/div[5]/div/div/div/div[2]/div/div[3]/div/div[3]/div[4]/div[3]/div/div/div[4]/div[2]/div[1]/div[1]/div[3]/input';
    const dayInput = page.locator(`xpath=${dayInputXPath}`);
    if (await dayInput.count() > 0) {
      await dayInput.scrollIntoViewIfNeeded();
      await delay(200);
      await dayInput.fill(day);
      logMessage(`Filled day: ${day}`);
    } else {
      logMessage('⚠️  Day input not found using XPath');
    }
    
    await delay(1000);
    
    // Click the Next button using exact XPath
    logMessage('Looking for Next button...');
    const nextButtonXPath = '/html/body/form/div[5]/div/div/div/div[2]/div/div[3]/div/div[5]/input';
    const nextButton = page.locator(`xpath=${nextButtonXPath}`);
    const nextCount = await nextButton.count();
    
    if (nextCount > 0) {
      logMessage('Found Next button');
      await nextButton.scrollIntoViewIfNeeded();
      await delay(500);
      logMessage('Clicking Next button...');
      await nextButton.click();
      
      // Wait for next page/form to appear
      await delay(3000);
      await page.waitForLoadState('load', { timeout: NAVIGATION_TIMEOUT });
      logMessage(`After clicking Next, current URL: ${page.url()}`);
      
      // Click the second button after Next (optional — step may have been removed)
      logMessage('Looking for second button...');
      const secondButtonXPath = '/html/body/form/div[5]/div/div/div/div[2]/div/div[3]/div/div[3]/div[2]/div/span/div[3]/div/div[3]';
      const secondButton = page.locator(`xpath=${secondButtonXPath}`);
      const secondButtonCount = await secondButton.count();
      if (secondButtonCount > 0) {
        logMessage('Found second button');
        await secondButton.scrollIntoViewIfNeeded();
        await delay(500);
        logMessage('Clicking second button...');
        await secondButton.click();
        await delay(3000);
        await page.waitForLoadState('load', { timeout: NAVIGATION_TIMEOUT });
        logMessage(`After clicking second button, current URL: ${page.url()}`);
      } else {
        logMessage('Second button not found (step may have been removed), proceeding to keyword...');
      }

      // Fill keyword field — find by input[maxlength="22"] (ICBC keyword field)
      logMessage('Looking for keyword input field (input[maxlength="22"])...');
      let keywordInput = page.locator('input[maxlength="22"]').first();
      let keywordCount = await keywordInput.count();
      if (keywordCount === 0) {
        const keywordInputXPath = '/html/body/form/div[5]/div/div/div/div[2]/div/div[3]/div/div[3]/div[5]/div[3]/div/div/div[2]/div[2]/div/input';
        keywordInput = page.locator(`xpath=${keywordInputXPath}`);
        keywordCount = await keywordInput.count();
        if (keywordCount > 0) logMessage('Found keyword input via XPath fallback');
      } else {
        logMessage('Found keyword input via input[maxlength="22"]');
      }

      if (keywordCount > 0) {
          logMessage('Found keyword input field');
          await keywordInput.scrollIntoViewIfNeeded();
          await delay(500);
          
          // Get field attributes for debugging
          const fieldType = await keywordInput.getAttribute('type');
          const fieldName = await keywordInput.getAttribute('name');
          const fieldId = await keywordInput.getAttribute('id');
          logMessage(`Keyword field - type: ${fieldType}, name: ${fieldName}, id: ${fieldId}`);
          
          // Click to focus the field first
          logMessage('Clicking keyword field to focus...');
          await keywordInput.click();
          await delay(500);
          
          // Clear any existing value
          logMessage('Clearing keyword field...');
          await keywordInput.clear();
          await delay(500);
          
          // Verify field is empty
          const emptyValue = await keywordInput.inputValue().catch(() => '');
          logMessage(`Keyword field value after clear: "${emptyValue}"`);
          
          // Type the keyword to trigger input events
          logMessage(`Typing keyword: ${keyword} (character by character)...`);
          await keywordInput.type(keyword, { delay: 100 });
          await delay(1000);
          
          // Verify the keyword was actually entered
          const enteredValue = await keywordInput.inputValue().catch(() => '');
          logMessage(`Keyword field value after typing: "${enteredValue}"`);
          
          if (enteredValue !== keyword) {
            logMessage(`⚠️  WARNING: Keyword mismatch! Expected: "${keyword}", Got: "${enteredValue}"`);
            logMessage('Attempting to fill again...');
            await keywordInput.clear();
            await delay(500);
            await keywordInput.fill(keyword);
            await delay(1000);
            const retryValue = await keywordInput.inputValue().catch(() => '');
            logMessage(`Keyword field value after retry: "${retryValue}"`);
          }
          
          // Trigger additional events to ensure form recognizes the input
          logMessage('Triggering blur event to validate field...');
          await keywordInput.evaluate(el => {
            el.blur();
            el.dispatchEvent(new Event('blur', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('input', { bubbles: true }));
          });
          await delay(1000);
          
          // Take screenshot for debugging
          if (!HEADLESS) {
            await page.screenshot({ path: 'icbc-keyword-filled.png', fullPage: true });
            logMessage('📸 Screenshot saved: icbc-keyword-filled.png');
          }
          
          logMessage(`✅ Keyword filled: ${keyword}`);
          logMessage('⏳ Waiting 1 second before submit...');
          await delay(1000);
        } else {
          logMessage('⚠️  Keyword input field not found (input[maxlength="22"] and XPath)');
          // Fallback: try to find by attributes
          const inputs = await page.locator('input').all();
          for (let i = 0; i < inputs.length; i++) {
            const type = await inputs[i].getAttribute('type');
            const name = await inputs[i].getAttribute('name');
            const id = await inputs[i].getAttribute('id');
            const placeholder = await inputs[i].getAttribute('placeholder');
            
            // Check if this input already has a value (skip if already filled)
            const currentValue = await inputs[i].inputValue().catch(() => '');
            if (currentValue === licenseNumber || currentValue === day || currentValue === year) {
              continue; // Skip, already filled
            }
            
            // Fill keyword
            if (name?.toLowerCase().includes('keyword') || name?.toLowerCase().includes('password') ||
                id?.toLowerCase().includes('keyword') || id?.toLowerCase().includes('password') ||
                placeholder?.toLowerCase().includes('keyword') || placeholder?.toLowerCase().includes('password') ||
                type === 'password') {
              logMessage(`Found keyword field (fallback) - type: ${type}, name: ${name}, id: ${id}`);
              await inputs[i].scrollIntoViewIfNeeded();
              await delay(500);
              
              // Click to focus the field first
              logMessage('Clicking keyword field to focus (fallback)...');
              await inputs[i].click();
              await delay(500);
              
              // Clear any existing value
              logMessage('Clearing keyword field (fallback)...');
              await inputs[i].clear();
              await delay(500);
              
              // Type the keyword to trigger input events
              logMessage(`Typing keyword (fallback): ${keyword} (character by character)...`);
              await inputs[i].type(keyword, { delay: 100 });
              await delay(1000);
              
              // Verify the keyword was actually entered
              const enteredValue = await inputs[i].inputValue().catch(() => '');
              logMessage(`Keyword field value after typing (fallback): "${enteredValue}"`);
              
              if (enteredValue !== keyword) {
                logMessage(`⚠️  WARNING: Keyword mismatch! Expected: "${keyword}", Got: "${enteredValue}"`);
              }
              
              // Trigger additional events
              await inputs[i].evaluate(el => {
                el.blur();
                el.dispatchEvent(new Event('blur', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                el.dispatchEvent(new Event('input', { bubbles: true }));
              });
              await delay(1000);
              
              // Take screenshot for debugging
              if (!HEADLESS) {
                await page.screenshot({ path: 'icbc-keyword-filled-fallback.png', fullPage: true });
                logMessage('📸 Screenshot saved: icbc-keyword-filled-fallback.png');
              }
              
          logMessage(`✅ Keyword filled (fallback): ${keyword}`);
          logMessage('⏳ Waiting 1 second before submit...');
          await delay(1000);
              break; // Found and filled, no need to continue
            }
          }
        }
        
        // Click the submit button
        logMessage('Looking for submit button...');
        const submitButtonXPath = '/html/body/form/div[5]/div/div/div/div[2]/div/div[3]/div/div[4]/input[2]';
        const submitButton = page.locator(`xpath=${submitButtonXPath}`);
        const submitCount = await submitButton.count();
        
        if (submitCount > 0) {
          logMessage('Found submit button');
          await submitButton.scrollIntoViewIfNeeded();
          logMessage('⏳ Waiting 1 more second before clicking submit...');
          await delay(1000);
          logMessage('Clicking submit button...');
          await submitButton.click();
          
          // Wait for navigation to next page
          await delay(3000);
          await page.waitForLoadState('load', { timeout: NAVIGATION_TIMEOUT });
          logMessage(`After clicking submit, current URL: ${page.url()}`);
          
          // Wait for the location input to appear (it's in a mat-dialog-container)
          logMessage('Looking for location input field...');
          const locationInputXPath = '/html/body/div[2]/div/div/mat-dialog-container/app-search-modal/div/div/form/div[1]/mat-tab-group/div/mat-tab-body[1]/div/div/mat-form-field/div/div[1]/div[3]/input';
          
          // Wait for the dialog to appear
          await delay(2000);
          await page.waitForSelector(`xpath=${locationInputXPath}`, { timeout: 10000 }).catch(() => {
            logMessage('⚠️  Location input not found immediately, waiting longer...');
          });
          
          const locationInput = page.locator(`xpath=${locationInputXPath}`);
          const locationCount = await locationInput.count();
          
          if (locationCount > 0) {
            logMessage('Found location input field');
            await locationInput.scrollIntoViewIfNeeded();
            await delay(500);
            await locationInput.click(); // Click to focus
            await delay(200);
            
            // Type the location to trigger autocomplete dropdown
            await locationInput.type('north vancouver', { delay: 100 });
            logMessage('Typed location: north vancouver');
            
            // Wait for the dropdown options to appear
            logMessage('⏳ Waiting for location dropdown options to appear...');
            await delay(2000);
            
            // Try multiple ways to find and click the option
            let optionSelected = false;
            
            // Method 1: Find by mat-option-text containing "North Vancouver, BC"
            try {
              const option = page.locator('span.mat-option-text:has-text("North Vancouver, BC")').first();
              const optionCount = await option.count();
              if (optionCount > 0) {
                logMessage('Found location option: North Vancouver, BC');
                await option.scrollIntoViewIfNeeded();
                await delay(300);
                await option.click();
                logMessage('Selected location option');
                optionSelected = true;
              }
            } catch (e) {
              logMessage(`⚠️  Method 1 failed: ${e.message}`);
            }
            
            // Method 2: Find by mat-option containing the text
            if (!optionSelected) {
              try {
                const option = page.locator('mat-option:has-text("North Vancouver, BC")').first();
                const optionCount = await option.count();
                if (optionCount > 0) {
                  logMessage('Found location option (method 2): North Vancouver, BC');
                  await option.scrollIntoViewIfNeeded();
                  await delay(300);
                  await option.click();
                  logMessage('Selected location option');
                  optionSelected = true;
                }
              } catch (e) {
                logMessage(`⚠️  Method 2 failed: ${e.message}`);
              }
            }
            
            // Method 3: Find all mat-option elements and click the one with matching text
            if (!optionSelected) {
              try {
                const options = await page.locator('mat-option').all();
                logMessage(`Found ${options.length} location options`);
                for (const opt of options) {
                  const optionText = await opt.textContent();
                  if (optionText && optionText.includes('North Vancouver, BC')) {
                    logMessage(`Found matching option: "${optionText.trim()}"`);
                    await opt.scrollIntoViewIfNeeded();
                    await delay(300);
                    await opt.click();
                    logMessage('Selected location option');
                    optionSelected = true;
                    break;
                  }
                }
              } catch (e) {
                logMessage(`⚠️  Method 3 failed: ${e.message}`);
              }
            }
            
            // Method 4: Find by span with class mat-option-text
            if (!optionSelected) {
              try {
                const spans = await page.locator('span.mat-option-text').all();
                logMessage(`Found ${spans.length} option text spans`);
                for (const span of spans) {
                  const spanText = await span.textContent();
                  if (spanText && spanText.trim().includes('North Vancouver, BC')) {
                    logMessage(`Found matching span: "${spanText.trim()}"`);
                    await span.scrollIntoViewIfNeeded();
                    await delay(300);
                    await span.click();
                    logMessage('Selected location option');
                    optionSelected = true;
                    break;
                  }
                }
              } catch (e) {
                logMessage(`⚠️  Method 4 failed: ${e.message}`);
              }
            }
            
            if (!optionSelected) {
              logMessage('⚠️  Could not select location option');
            }
            
            // Click the search button
            logMessage('Clicking search button...');
            const searchButtonXPath = '/html/body/div[2]/div/div/mat-dialog-container/app-search-modal/div/div/form/div[2]/button';
            const searchButton = page.locator(`xpath=${searchButtonXPath}`);
            const searchButtonCount = await searchButton.count();
            
            if (searchButtonCount > 0) {
              logMessage('Found search button');
              await searchButton.scrollIntoViewIfNeeded();
              await delay(500);
              await searchButton.click();
              logMessage('Clicked search button');
              
              // Wait for results to appear
              await delay(2000);
              
              // Click the location result
              logMessage('Clicking location result...');
              const locationResultXPath = '/html/body/div[2]/div/div/mat-dialog-container/app-search-modal/div[2]/div/div[2]/div[2]';
              const locationResult = page.locator(`xpath=${locationResultXPath}`);
              const locationResultCount = await locationResult.count();
              
              if (locationResultCount > 0) {
                logMessage('Found location result');
                await locationResult.scrollIntoViewIfNeeded();
                await delay(500);
                await locationResult.click();
                logMessage('Clicked location result');
                
                // Wait for appointment dialog to appear
                await delay(3000);
                
                // Extract appointments from the dialog
                logMessage('Extracting appointments...');
                const appointments = [];
                
                // Get all date titles and time slots
                const allDateTitles = await page.locator('div.date-title').all();
                const allTimeSlots = await page.locator('mat-button-toggle span.mat-button-toggle-label-content').all();
                
                logMessage(`Found ${allDateTitles.length} date sections and ${allTimeSlots.length} time slots`);
                
                // Extract dates and their positions
                const datesWithPositions = [];
                for (const dateTitle of allDateTitles) {
                  const dateText = await dateTitle.textContent();
                  const date = dateText?.trim() || '';
                  const position = await dateTitle.evaluate(el => el.getBoundingClientRect().top);
                  datesWithPositions.push({ date, position, element: dateTitle });
                  logMessage(`  Date: ${date} (position: ${position})`);
                }
                
                // Extract times and their positions, then match with nearest date
                for (const timeSlot of allTimeSlots) {
                  const timeText = await timeSlot.textContent();
                  const time = timeText?.trim() || '';
                  
                  if (time) {
                    const timePosition = await timeSlot.evaluate(el => el.getBoundingClientRect().top);
                    
                    // Find the nearest date that comes before this time slot
                    let nearestDate = '';
                    let minDistance = Infinity;
                    
                    for (const dateInfo of datesWithPositions) {
                      if (dateInfo.position <= timePosition) {
                        const distance = timePosition - dateInfo.position;
                        if (distance < minDistance) {
                          minDistance = distance;
                          nearestDate = dateInfo.date;
                        }
                      }
                    }
                    
                    appointments.push({
                      date: nearestDate || 'Unknown',
                      time: time,
                      location: 'North Vancouver driver licensing'
                    });
                    logMessage(`    Time: ${time} (matched with: ${nearestDate || 'Unknown'})`);
                  }
                }
                
                logMessage(`Extracted ${appointments.length} appointments`);
                
                // Check if login was successful
                const currentUrl = page.url();
                logMessage(`After login, current URL: ${currentUrl}`);

                if (currentUrl.includes('error') || currentUrl.includes('login')) {
                  throw new Error('Login may have failed - still on login page');
                }

                logMessage('Login successful');
                return { success: true, url: currentUrl, appointments: appointments };
              } else {
                logMessage('⚠️  Location result not found using XPath');
              }
            } else {
              logMessage('⚠️  Search button not found using XPath');
            }
          } else {
            logMessage('⚠️  Location input field not found using XPath');
          }
        } else {
          logMessage('⚠️  Could not find submit button');
        }
    } else {
      logMessage('⚠️  Could not find Next button');
    }

    // Check if login was successful
    const currentUrl = page.url();
    logMessage(`After login, current URL: ${currentUrl}`);

    if (currentUrl.includes('error') || currentUrl.includes('login')) {
      throw new Error('Login may have failed - still on login page');
    }

    logMessage('Login successful');
    return { success: true, url: currentUrl, appointments: [] };

  } catch (error) {
    logMessage(`Login error: ${error.message}`);
    
    // Take error screenshot
    if (!HEADLESS) {
      await page.screenshot({ path: 'icbc-login-error.png', fullPage: true });
    }
    
    throw error;
  } finally {
    await page.close();
  }
}

// Navigate to appointment booking page
async function navigateToAppointments() {
  const { context } = await getBrowser();
  const page = await context.newPage();

  try {
    // Navigate to the road test booking page
    logMessage('Navigating to ICBC road test booking page...');
    await page.goto('https://www.icbc.com/driver-licensing/visit-dl-office/Book-a-road-test', { 
      waitUntil: 'domcontentloaded', 
      timeout: NAVIGATION_TIMEOUT 
    });
    
    // Wait for page to be interactive
    await page.waitForLoadState('load');
    await delay(3000); // Extra wait for any dynamic content

    // Find and click the button that goes to webdeas-ui/home
    logMessage('Looking for booking button (webdeas-ui/home)...');
    
    // First, find ALL links and check their text and hrefs
    const allLinksData = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('a[href]'));
      return anchors.map(a => ({
        text: a.textContent.trim(),
        href: a.href,
        visible: a.offsetParent !== null
      })).filter(link => link.visible);
    });
    
    logMessage(`Found ${allLinksData.length} visible links on page`);
    
    // Find the link with correct text AND correct href
    let targetLink = null;
    for (const linkData of allLinksData) {
      if (linkData.text.includes('Book or update your road test online')) {
        logMessage(`Found link with matching text: "${linkData.text}" -> ${linkData.href}`);
        
        // Verify it goes to webdeas-ui
        if (linkData.href.includes('webdeas-ui') || linkData.href.includes('onlinebusiness.icbc.com')) {
          targetLink = linkData;
          logMessage(`✅ Found correct booking button: "${linkData.text}" -> ${linkData.href}`);
          break;
        } else {
          logMessage(`⚠️  Link has correct text but wrong href: ${linkData.href}`);
        }
      }
    }
    
    // If not found, try to find by href only
    if (!targetLink) {
      logMessage('Trying to find by href only...');
      for (const linkData of allLinksData) {
        if (linkData.href.includes('webdeas-ui') || linkData.href.includes('onlinebusiness.icbc.com')) {
          targetLink = linkData;
          logMessage(`✅ Found booking button by href: "${linkData.text}" -> ${linkData.href}`);
          break;
        }
      }
    }
    
    if (targetLink) {
      // Use Playwright locator with href
      const escapedHref = targetLink.href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      let bookingLink = page.locator(`a[href="${escapedHref}"]`).first();
      
      // If that doesn't work, try with href contains
      if (await bookingLink.count() === 0) {
        bookingLink = page.locator('a[href*="webdeas-ui"]').first();
      }
      
      // Scroll to the button to make sure it's visible
      logMessage('Scrolling to booking button...');
      await bookingLink.scrollIntoViewIfNeeded();
      await delay(1000); // Wait for scroll animation
      
      // Click the button
      logMessage(`Clicking booking button (href: ${targetLink.href})...`);
      await bookingLink.click();
      await page.waitForLoadState('load', { timeout: NAVIGATION_TIMEOUT });
      await delay(3000);
      logMessage(`Navigated to booking system: ${page.url()}`);
    } else {
      // Fallback: try direct navigation
      logMessage('Booking button not found, navigating directly to webdeas-ui/home...');
      await page.goto('https://onlinebusiness.icbc.com/webdeas-ui/home', { 
        waitUntil: 'domcontentloaded', 
        timeout: NAVIGATION_TIMEOUT 
      });
      await page.waitForLoadState('load');
      await delay(3000);
      logMessage(`Navigated directly to: ${page.url()}`);
    }

    return page;
  } catch (error) {
    logMessage(`Error navigating to appointments: ${error.message}`);
    await page.close();
    throw error;
  }
}

// Fetch appointments for a specific location
async function fetchAppointments(locationId, limit = 10) {
  // This will be implemented once we understand the appointment booking flow
  // For now, return empty array
  logMessage(`Fetching appointments for location ${locationId} (Playwright - to be implemented)...`);
  
  // TODO: Implement actual appointment fetching using Playwright
  // This will require:
  // 1. Navigating to appointment booking page
  // 2. Selecting location
  // 3. Selecting exam type
  // 4. Extracting available appointments
  
  return [];
}

// Filter appointments within configured period
function filterAppointmentsWithinPeriod(appointments) {
  const today = new Date();
  const futureDate = new Date();
  futureDate.setDate(today.getDate() + APPOINTMENT_SEARCH_DAYS);

  return appointments.filter(appt => {
    const apptDate = new Date(appt.appointmentDt?.date || appt.date);
    return apptDate >= today && apptDate <= futureDate;
  });
}

// Function to format appointment data
function formatAppointments(appointments) {
  return appointments
    .sort((a, b) => new Date(a.appointmentDt?.date || a.date) - new Date(b.appointmentDt?.date || b.date))
    .map(appt => {
      const loc = locations[appt.posId] || allLocations[appt.posId];
      return {
        location: {
          id: appt.posId,
          name: loc?.name || loc || 'Unknown Location',
          postalCode: loc?.postalCode || '',
        },
        date: appt.appointmentDt?.date || appt.date,
        dayOfWeek: appt.appointmentDt?.dayOfWeek || appt.dayOfWeek,
        startTime: appt.startTm || appt.startTime,
        endTime: appt.endTm || appt.endTime,
      };
    });
}

// Session Manager - maintains persistent logged-in session
let sessionPage = null;
let isLoggedIn = false;
let loginInProgress = false;
let keepAliveInterval = null;

// Keep-alive function to prevent browser from timing out
function startKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
  }
  
  // Every 5 minutes, verify the page is still alive
  keepAliveInterval = setInterval(async () => {
    if (sessionPage && !sessionPage.isClosed() && isLoggedIn) {
      try {
        await sessionPage.evaluate(() => document.title);
        logMessage('Keep-alive: Session is still active');
      } catch (e) {
        logMessage('Keep-alive: Session page is invalid, will re-login on next request');
        isLoggedIn = false;
      }
    }
  }, 5 * 60 * 1000); // 5 minutes
  
  logMessage('Keep-alive mechanism started');
}

function stopKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
    logMessage('Keep-alive mechanism stopped');
  }
}

// Perform login on a specific page (for session management)
async function performLoginOnPage(page) {
  try {
    // Navigate directly to the booking system (webdeas-ui)
    logMessage('Navigating to ICBC booking system...');
    await page.goto('https://onlinebusiness.icbc.com/webdeas-ui/home', {
      waitUntil: 'domcontentloaded',
      timeout: NAVIGATION_TIMEOUT
    });

    // Wait for page to be interactive
    await page.waitForLoadState('load');
    await delay(3000);

    // Click the Terms and Conditions checkbox
    logMessage('Looking for Terms and Conditions checkbox...');
    const checkbox = page.locator('input[type="checkbox"]').first();
    const checkboxCount = await checkbox.count();
    
    if (checkboxCount > 0) {
      const isChecked = await checkbox.isChecked();
      if (!isChecked) {
        logMessage('Clicking Terms and Conditions checkbox...');
        await checkbox.click();
        await delay(500);
      }
    }

    // Click the third "Sign in" button using XPath
    logMessage('Looking for sign-in button (third button)...');
    // Use the specific XPath for the third sign-in button
    const signInButtonXPath = '/html/body/div[2]/main/div[2]/div/div[1]/div[2]/div[4]/div/div[2]/div/div/div[1]/form/button';
    let signInButton = page.locator(`xpath=${signInButtonXPath}`);
    let buttonCount = await signInButton.count();
    
    if (buttonCount > 0) {
      logMessage('Clicking sign-in button (third button)...');
      await signInButton.scrollIntoViewIfNeeded();
      await delay(500);
      await signInButton.click();
      
      await page.waitForLoadState('load', { timeout: NAVIGATION_TIMEOUT });
      await delay(2000);
      
      // Click the "Select" button for "B.C. driver's licence"
      logMessage('Looking for "B.C. driver\'s licence" Select button...');
      await delay(2000);
      
      const selectButtonXPath = '/html/body/form/div[5]/div/div/div/div[2]/div/div[3]/div/div[3]/div[1]/div/span/div[3]/div/div[3]';
      const targetSelectButton = page.locator(`xpath=${selectButtonXPath}`);
      const selectButtonCount = await targetSelectButton.count();
      
      if (selectButtonCount > 0) {
        await targetSelectButton.scrollIntoViewIfNeeded();
        await delay(1000);
        await targetSelectButton.click({ force: true });
        await delay(3000);
        
        // Fill in login credentials (simplified - using the existing logic from login function)
        // This is a simplified version - you may need to copy the full form filling logic
        logMessage('Filling in login credentials...');
        
        const dateValue = process.env.ICBC_DATE || '14 March 2024';
        const dateParts = dateValue.split(' ');
        const day = dateParts[0];
        const monthName = dateParts[1];
        const year = dateParts[2];
        const licenseNumber = process.env.BCID_NUMBER || '111556588';
        const keyword = process.env.ICBC_KEYWORD || '2336lili';
        
        // Fill BCID number
        const firstInputXPath = '/html/body/form/div[5]/div/div/div/div[2]/div/div[3]/div/div[3]/div[4]/div[3]/div/div/div[2]/div[2]/div[1]/input';
        const firstInput = page.locator(`xpath=${firstInputXPath}`);
        if (await firstInput.count() > 0) {
          await firstInput.fill(licenseNumber);
        }
        
        // Fill date fields (year, month, day) - simplified
        const yearInputXPath = '/html/body/form/div[5]/div/div/div/div[2]/div/div[3]/div/div[3]/div[4]/div[3]/div/div/div[4]/div[2]/div[1]/div[1]/div[1]/input';
        await page.locator(`xpath=${yearInputXPath}`).fill(year);
        
        const monthSelectXPath = '/html/body/form/div[5]/div/div/div/div[2]/div/div[3]/div/div[3]/div[4]/div[3]/div/div/div[4]/div[2]/div[1]/div[1]/div[2]/select';
        const monthSelect = page.locator(`xpath=${monthSelectXPath}`);
        const monthAbbr = monthName.substring(0, 3).toUpperCase();
        const options = await monthSelect.locator('option').all();
        for (const opt of options) {
          const optText = await opt.textContent();
          if (optText?.trim().toUpperCase() === monthAbbr) {
            const optValue = await opt.getAttribute('value');
            await monthSelect.selectOption({ value: optValue });
            break;
          }
        }
        
        const dayInputXPath = '/html/body/form/div[5]/div/div/div/div[2]/div/div[3]/div/div[3]/div[4]/div[3]/div/div/div[4]/div[2]/div[1]/div[1]/div[3]/input';
        await page.locator(`xpath=${dayInputXPath}`).fill(day);
        
        // Click Next
        const nextButtonXPath = '/html/body/form/div[5]/div/div/div/div[2]/div/div[3]/div/div[5]/input';
        await page.locator(`xpath=${nextButtonXPath}`).click();
        await delay(3000);
        
        // Click second button (optional — step may have been removed)
        const secondButtonXPath = '/html/body/form/div[5]/div/div/div/div[2]/div/div[3]/div/div[3]/div[2]/div/span/div[3]/div/div[3]';
        const secondButtonLoc = page.locator(`xpath=${secondButtonXPath}`);
        if (await secondButtonLoc.count() > 0) {
          await secondButtonLoc.click();
          await delay(3000);
        } else {
          logMessage('Second button not found (performLoginOnPage), proceeding to keyword...');
        }
        
        // Fill keyword — find by input[maxlength="22"] first
        let keywordInput = page.locator('input[maxlength="22"]').first();
        if (await keywordInput.count() === 0) {
          const keywordInputXPath = '/html/body/form/div[5]/div/div/div/div[2]/div/div[3]/div/div[3]/div[5]/div[3]/div/div/div[2]/div[2]/div/input';
          keywordInput = page.locator(`xpath=${keywordInputXPath}`);
        }
        if (await keywordInput.count() > 0) {
          logMessage('Found keyword input field (performLoginOnPage)');
          await keywordInput.scrollIntoViewIfNeeded();
          await delay(500);
          
          // Get field attributes for debugging
          const fieldType = await keywordInput.getAttribute('type');
          const fieldName = await keywordInput.getAttribute('name');
          const fieldId = await keywordInput.getAttribute('id');
          logMessage(`Keyword field - type: ${fieldType}, name: ${fieldName}, id: ${fieldId}`);
          
          // Click to focus the field first
          logMessage('Clicking keyword field to focus...');
          await keywordInput.click();
          await delay(500);
          
          // Clear any existing value
          logMessage('Clearing keyword field...');
          await keywordInput.clear();
          await delay(500);
          
          // Verify field is empty
          const emptyValue = await keywordInput.inputValue().catch(() => '');
          logMessage(`Keyword field value after clear: "${emptyValue}"`);
          
          // Type the keyword to trigger input events
          logMessage(`Typing keyword: ${keyword} (character by character)...`);
          await keywordInput.type(keyword, { delay: 100 });
          await delay(1000);
          
          // Verify the keyword was actually entered
          const enteredValue = await keywordInput.inputValue().catch(() => '');
          logMessage(`Keyword field value after typing: "${enteredValue}"`);
          
          if (enteredValue !== keyword) {
            logMessage(`⚠️  WARNING: Keyword mismatch! Expected: "${keyword}", Got: "${enteredValue}"`);
            logMessage('Attempting to fill again...');
            await keywordInput.clear();
            await delay(500);
            await keywordInput.fill(keyword);
            await delay(1000);
            const retryValue = await keywordInput.inputValue().catch(() => '');
            logMessage(`Keyword field value after retry: "${retryValue}"`);
          }
          
          // Trigger additional events to ensure form recognizes the input
          logMessage('Triggering blur event to validate field...');
          await keywordInput.evaluate(el => {
            el.blur();
            el.dispatchEvent(new Event('blur', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('input', { bubbles: true }));
          });
          await delay(1000);
          
          logMessage(`✅ Keyword filled: ${keyword}`);
          logMessage('⏳ Waiting 1 second before submit...');
          await delay(1000);
        }
        
        // Click submit
        logMessage('Looking for submit button (performLoginOnPage)...');
        const submitButtonXPath = '/html/body/form/div[5]/div/div/div/div[2]/div/div[3]/div/div[4]/input[2]';
        const submitButton = page.locator(`xpath=${submitButtonXPath}`);
        if (await submitButton.count() > 0) {
          logMessage('Found submit button');
          await submitButton.scrollIntoViewIfNeeded();
          logMessage('⏳ Waiting 1 more second before clicking submit...');
          await delay(1000);
          logMessage('Clicking submit button...');
          await submitButton.click();
          await delay(3000);
        } else {
          logMessage('⚠️  Submit button not found');
        }
        
        logMessage('Login flow completed');
        return { success: true, url: page.url() };
      }
    }
    
    return { success: false };
  } catch (error) {
    logMessage(`Login error on page: ${error.message}`);
    throw error;
  }
}

// Initialize and maintain login session
async function ensureLoggedIn() {
  // If already logged in, return the page
  if (isLoggedIn && sessionPage && !sessionPage.isClosed()) {
    try {
      // Verify page is still valid
      await sessionPage.evaluate(() => document.title);
      return sessionPage;
    } catch (e) {
      logMessage('Session page is invalid, re-logging in...');
      isLoggedIn = false;
      sessionPage = null;
    }
  }

  // Prevent multiple simultaneous login attempts
  if (loginInProgress) {
    logMessage('Login already in progress, waiting...');
    while (loginInProgress) {
      await delay(1000);
    }
    if (isLoggedIn && sessionPage) {
      return sessionPage;
    }
  }

  loginInProgress = true;
  
  try {
    logMessage('Starting login process...');
    const { context } = await getBrowser();
    
    // Close old page if exists
    if (sessionPage && !sessionPage.isClosed()) {
      await sessionPage.close();
    }
    
    sessionPage = await context.newPage();
    
    // Perform login on the session page
    const loginResult = await performLoginOnPage(sessionPage);
    
    if (loginResult.success) {
      isLoggedIn = true;
      logMessage('Login successful, session maintained');
      startKeepAlive(); // Start keep-alive mechanism
      return sessionPage;
    } else {
      throw new Error('Login failed');
    }
  } catch (error) {
    logMessage(`Login error: ${error.message}`);
    isLoggedIn = false;
    if (sessionPage && !sessionPage.isClosed()) {
      await sessionPage.close();
    }
    sessionPage = null;
    throw error;
  } finally {
    loginInProgress = false;
  }
}

// Search for appointments by location string
async function searchAppointmentsByLocation(locationString) {
  let retries = 3;
  
  while (retries > 0) {
    try {
      // Ensure we're logged in
      const page = await ensureLoggedIn();
      
      logMessage(`Searching for appointments at: ${locationString}`);
      
      // Navigate to search page if not already there
      const currentUrl = page.url();
      if (!currentUrl.includes('webdeas-ui') && !currentUrl.includes('search')) {
        logMessage('Navigating to search page...');
        await page.goto('https://onlinebusiness.icbc.com/webdeas-ui/home', {
          waitUntil: 'domcontentloaded',
          timeout: NAVIGATION_TIMEOUT
        });
        await page.waitForLoadState('load');
        await delay(2000);
      }
      
      // Wait for the location input to appear (it's in a mat-dialog-container)
      logMessage('Looking for location input field...');
      const locationInputXPath = '/html/body/div[2]/div/div/mat-dialog-container/app-search-modal/div/div/form/div[1]/mat-tab-group/div/mat-tab-body[1]/div/div/mat-form-field/div/div[1]/div[3]/input';
      
      // Wait a bit for page to settle
      await delay(2000);
      
      // Check if dialog is already open
      let locationInput = page.locator(`xpath=${locationInputXPath}`);
      let locationCount = await locationInput.count();
      
      // If dialog is not open, try to find and click a button to open it
      if (locationCount === 0) {
        logMessage('Dialog not open, looking for button to open search dialog...');
        // Try common selectors for search/booking buttons
        const searchButtonSelectors = [
          'button:has-text("Search")',
          'button:has-text("Book")',
          'button:has-text("Find")',
          'a:has-text("Book")',
          'a:has-text("Search")',
          '[aria-label*="search" i]',
          '[aria-label*="book" i]'
        ];
        
        let dialogOpened = false;
        for (const selector of searchButtonSelectors) {
          try {
            const button = page.locator(selector).first();
            const count = await button.count();
            if (count > 0) {
              logMessage(`Found button with selector: ${selector}`);
              await button.click();
              await delay(2000);
              locationInput = page.locator(`xpath=${locationInputXPath}`);
              locationCount = await locationInput.count();
              if (locationCount > 0) {
                dialogOpened = true;
                logMessage('Dialog opened successfully');
                break;
              }
            }
          } catch (e) {
            // Continue to next selector
          }
        }
        
        if (!dialogOpened) {
          logMessage('⚠️  Could not open search dialog, trying to proceed anyway...');
        }
      }
      
      if (locationCount > 0) {
        logMessage('Found location input field');
        await locationInput.scrollIntoViewIfNeeded();
        await delay(500);
        await locationInput.click();
        await delay(200);
        
        // Clear any existing text and type the location
        await locationInput.fill('');
        await delay(200);
        await locationInput.type(locationString, { delay: 100 });
        logMessage(`Typed location: ${locationString}`);
        
        // Wait for the dropdown options to appear
        logMessage('⏳ Waiting for location dropdown options to appear...');
        await delay(2000);
        
        // Find and click the location option
        let optionSelected = false;
        
        // Try to find option containing the location string
        const options = await page.locator('mat-option, span.mat-option-text').all();
        logMessage(`Found ${options.length} location options`);
        
        for (const option of options) {
          const optionText = await option.textContent();
          if (optionText && optionText.toLowerCase().includes(locationString.toLowerCase())) {
            logMessage(`Found matching option: "${optionText.trim()}"`);
            await option.scrollIntoViewIfNeeded();
            await delay(300);
            await option.click();
            logMessage('Selected location option');
            optionSelected = true;
            break;
          }
        }
        
        if (!optionSelected) {
          throw new Error(`Could not find location option for: ${locationString}`);
        }
        
        // Click the search button
        logMessage('Clicking search button...');
        const searchButtonXPath = '/html/body/div[2]/div/div/mat-dialog-container/app-search-modal/div/div/form/div[2]/button';
        const searchButton = page.locator(`xpath=${searchButtonXPath}`);
        const searchButtonCount = await searchButton.count();
        
        if (searchButtonCount > 0) {
          await searchButton.scrollIntoViewIfNeeded();
          await delay(500);
          await searchButton.click();
          logMessage('Clicked search button');
          
          // Wait for results to appear
          await delay(2000);
          
          // Click the location result
          logMessage('Clicking location result...');
          const locationResultXPath = '/html/body/div[2]/div/div/mat-dialog-container/app-search-modal/div[2]/div/div[2]/div[2]';
          const locationResult = page.locator(`xpath=${locationResultXPath}`);
          const locationResultCount = await locationResult.count();
          
          if (locationResultCount > 0) {
            await locationResult.scrollIntoViewIfNeeded();
            await delay(500);
            await locationResult.click();
            logMessage('Clicked location result');
            
            // Wait for appointment dialog to appear
            await delay(3000);
            
            // Extract appointments from the dialog
            logMessage('Extracting appointments...');
            const appointments = [];
            
            // Get all date titles and time slots
            const allDateTitles = await page.locator('div.date-title').all();
            const allTimeSlots = await page.locator('mat-button-toggle span.mat-button-toggle-label-content').all();
            
            logMessage(`Found ${allDateTitles.length} date sections and ${allTimeSlots.length} time slots`);
            
            // Extract dates and their positions
            const datesWithPositions = [];
            for (const dateTitle of allDateTitles) {
              const dateText = await dateTitle.textContent();
              const date = dateText?.trim() || '';
              const position = await dateTitle.evaluate(el => el.getBoundingClientRect().top);
              datesWithPositions.push({ date, position, element: dateTitle });
              logMessage(`  Date: ${date} (position: ${position})`);
            }
            
            // Extract times and their positions, then match with nearest date
            for (const timeSlot of allTimeSlots) {
              const timeText = await timeSlot.textContent();
              const time = timeText?.trim() || '';
              
              if (time) {
                const timePosition = await timeSlot.evaluate(el => el.getBoundingClientRect().top);
                
                // Find the nearest date that comes before this time slot
                let nearestDate = '';
                let minDistance = Infinity;
                
                for (const dateInfo of datesWithPositions) {
                  if (dateInfo.position <= timePosition) {
                    const distance = timePosition - dateInfo.position;
                    if (distance < minDistance) {
                      minDistance = distance;
                      nearestDate = dateInfo.date;
                    }
                  }
                }
                
                appointments.push({
                  date: nearestDate || 'Unknown',
                  time: time,
                  location: locationString
                });
                logMessage(`    Time: ${time} (matched with: ${nearestDate || 'Unknown'})`);
              }
            }
            
            logMessage(`Extracted ${appointments.length} appointments`);
            
            // Close the appointment dialog to be ready for next search (but keep page open)
            try {
              const cancelButton = page.locator('button:has-text("Cancel")').first();
              const cancelCount = await cancelButton.count();
              if (cancelCount > 0) {
                await cancelButton.click();
                await delay(1000);
                logMessage('Closed appointment dialog');
              }
            } catch (e) {
              logMessage('Could not close dialog, continuing...');
            }
            
            return { success: true, appointments: appointments };
          } else {
            throw new Error('Location result not found');
          }
        } else {
          throw new Error('Search button not found');
        }
      } else {
        throw new Error('Location input field not found');
      }
    } catch (error) {
      logMessage(`Error searching appointments: ${error.message}`);
      retries--;
      
      if (retries > 0) {
        logMessage(`Retrying... (${retries} attempts remaining)`);
        // Reset login state to force re-login
        isLoggedIn = false;
        if (sessionPage && !sessionPage.isClosed()) {
          await sessionPage.close();
        }
        sessionPage = null;
        await delay(2000);
      } else {
        throw error;
      }
    }
  }
  
  throw new Error('Failed to search appointments after retries');
}

// Graceful shutdown
process.on('SIGINT', async () => {
  stopKeepAlive();
  if (sessionPage && !sessionPage.isClosed()) {
    await sessionPage.close();
  }
  await closeBrowser();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  stopKeepAlive();
  if (sessionPage && !sessionPage.isClosed()) {
    await sessionPage.close();
  }
  await closeBrowser();
  process.exit(0);
});

module.exports = {
  fetchAppointments,
  filterAppointmentsWithinPeriod,
  formatAppointments,
  login,
  navigateToAppointments,
  closeBrowser,
  getBrowser,
  searchAppointmentsByLocation,
  ensureLoggedIn
};

