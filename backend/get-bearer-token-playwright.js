// get-bearer-token-playwright.js - Extract bearer token using Playwright (can access all headers)

require('dotenv').config({ path: '../.env' });
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const LOGIN_API_URL = 'https://onlinebusiness.icbc.com/deas-api/v1/webLogin/webLogin';
const TOKEN_OUTPUT_FILE = path.join(__dirname, 'bearer_token.json');
const HEADLESS = process.env.PLAYWRIGHT_HEADLESS !== 'true'; // Default to showing browser

// Helper function to decode JWT (just for verification, not validation)
function decodeJWT(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    
    // Decode the payload (second part)
    const payload = Buffer.from(parts[1], 'base64').toString('utf8');
    return JSON.parse(payload);
  } catch (e) {
    return null;
  }
}

async function getBearerTokenWithPlaywright(customCredentials = null, headlessOption = null) {
  // Use custom credentials if provided, otherwise use environment variables
  const keyword = customCredentials?.keyword || process.env.ICBC_KEYWORD || '2336lili';
  const lastName = customCredentials?.lastName || process.env.LAST_NAME || '';
  const licenseNumber = customCredentials?.licenseNumber || customCredentials?.bcidNumber || process.env.BCID_NUMBER || process.env.LICENSE_NUMBER || '111556588';
  const dateValue = customCredentials?.date || process.env.ICBC_DATE || '14 March 2024';
  
  // Determine headless mode: use provided option, otherwise fall back to environment variable
  // headlessOption: true = headless (browser hidden), false = show browser
  // If not provided, use the same logic as HEADLESS constant (inverted)
  const isHeadless = headlessOption !== null ? headlessOption : !HEADLESS;
  
  console.log('🔐 Using Playwright to capture bearer token from ICBC login...\n');
  console.log('📋 Strategy:');
  console.log('   1. Go through full ICBC login flow (checkbox, sign in, fill forms, submit)');
  console.log('   2. Intercept OAuth2 token endpoint response to capture access_token from response body');
  console.log('   3. Intercept API request headers to capture Bearer token (browser includes it automatically)');
  console.log('   4. Token will be in Authorization header of requests after OAuth2 completes\n');
  console.log(`📺 Headless mode: ${isHeadless} (browser ${isHeadless ? 'hidden' : 'visible'})\n`);
  
  if (customCredentials) {
    console.log('📝 Using custom credentials from request:');
    console.log('   Keyword:', keyword ? '***' : '(not provided)');
    console.log('   Last Name:', lastName || '(not provided)');
    console.log('   License/BCID Number:', licenseNumber ? '***' : '(not provided)');
    console.log('   Date:', dateValue);
  } else {
    console.log('📝 Using credentials from environment variables:');
    console.log('   Keyword:', process.env.ICBC_KEYWORD ? '***' : '(not set)');
    console.log('   Last Name:', process.env.LAST_NAME || '(not set)');
    console.log('   BCID Number:', process.env.BCID_NUMBER ? '***' : '(not set)');
    console.log('   Date:', process.env.ICBC_DATE || '14 March 2024');
  }

  const browser = await chromium.launch({
    headless: isHeadless,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();

  const tokenInfo = {
    found: false,
    token: null,
    location: null,
    timestamp: new Date().toISOString()
  };

  let oauth2Params = {
    code: null,
    code_verifier: null,
    client_id: null,
    client_secret: null,
    redirect_uri: null
  };

  // Intercept all network requests to capture Bearer token from request headers
  // After OAuth2, the browser automatically includes Bearer token in API request headers
  page.on('request', async (request) => {
    const url = request.url();
    const method = request.method();
    
    // Check for Authorization header in ALL API requests (especially after OAuth2)
    // The bearer token will be in request headers, not response headers
    if (url.includes('/deas-api/') || url.includes('onlinebusiness.icbc.com') || url.includes('auth.icbc.com')) {
      const headers = request.headers();
      const authHeader = headers['authorization'] || headers['Authorization'];
      
      if (authHeader && !tokenInfo.found) {
        const match = authHeader.match(/Bearer\s+(.+)/i);
        if (match && match[1]) {
          tokenInfo.found = true;
          tokenInfo.token = match[1];
          tokenInfo.location = `Request header: Authorization (${method} ${url})`;
          console.log(`\n✅ Found Bearer token in request header!`);
          console.log(`   Request: ${method} ${url}`);
          console.log(`   Token: ${match[1].substring(0, 50)}...`);
        }
      }
    }
    
    // Also capture OAuth2 token endpoint request parameters (for manual exchange if needed)
    if (url.includes('/f5-oauth2/v1/token') || url.includes('auth.icbc.com')) {
      console.log(`\n📤 Captured OAuth2 token endpoint request: ${method} ${url}`);
      
      const postData = request.postData();
      if (postData) {
        const params = new URLSearchParams(postData);
        oauth2Params.code = params.get('code') || oauth2Params.code;
        oauth2Params.code_verifier = params.get('code_verifier') || oauth2Params.code_verifier;
        oauth2Params.client_id = params.get('client_id') || oauth2Params.client_id;
        oauth2Params.client_secret = params.get('client_secret') || oauth2Params.client_secret;
        oauth2Params.redirect_uri = params.get('redirect_uri') || oauth2Params.redirect_uri;
      }
    }
  });

  // Intercept OAuth2 token endpoint response to capture access_token from response body
  // This is where the token is initially generated, then browser uses it in subsequent request headers
  page.on('response', async (response) => {
    const url = response.url();
    
    // Check OAuth2 token endpoint response body (primary source of token)
    if ((url.includes('/f5-oauth2/v1/token') || url.includes('auth.icbc.com')) && !tokenInfo.found) {
      console.log(`\n📥 Captured OAuth2 token endpoint response: ${response.status()} ${url}`);
      
      try {
        const body = await response.json();
        console.log('   OAuth2 token response body keys:', Object.keys(body).join(', '));
        
        // OAuth2 token endpoint returns: access_token, token_type, expires_in, etc.
        if (body.access_token) {
          tokenInfo.found = true;
          tokenInfo.token = body.access_token;
          tokenInfo.location = 'OAuth2 token endpoint response body: access_token';
          console.log(`\n✅ Found access_token in OAuth2 token response body!`);
          console.log(`   Token type: ${body.token_type || 'Bearer'}`);
          if (body.expires_in) {
            console.log(`   Expires in: ${body.expires_in} seconds`);
          }
        } else if (body.token) {
          tokenInfo.found = true;
          tokenInfo.token = body.token;
          tokenInfo.location = 'OAuth2 token endpoint response body: token';
          console.log(`\n✅ Found token in OAuth2 token response body!`);
        }
      } catch (e) {
        // Response might not be JSON
      }
    }
  });

  // Helper function to delay execution
  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  try {
    console.log('🌐 Starting full ICBC login flow via Playwright...\n');
    console.log('   Keyword:', process.env.ICBC_KEYWORD);
    console.log('   Last Name:', process.env.LAST_NAME);
    console.log('   BCID Number:', process.env.BCID_NUMBER);
    console.log('   Date:', process.env.ICBC_DATE || '14 March 2024');
    
    // Step 1: Navigate to ICBC booking system
    console.log('\n📋 Step 1: Navigating to ICBC booking system...');
    await page.goto('https://onlinebusiness.icbc.com/webdeas-ui/home', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    await page.waitForLoadState('load');
    await delay(1000); // Reduced from 3000ms
    console.log(`   Current URL: ${page.url()}`);

    // Step 2: Click Terms and Conditions checkbox
    console.log('\n📋 Step 2: Clicking Terms and Conditions checkbox...');
    const checkbox = page.locator('input[type="checkbox"]').first();
    const checkboxCount = await checkbox.count();
    if (checkboxCount > 0) {
      const isChecked = await checkbox.isChecked();
      if (!isChecked) {
        await checkbox.click();
        await delay(200); // Reduced from 500ms
        console.log('   ✅ Checkbox clicked');
      } else {
        console.log('   ✅ Checkbox already checked');
      }
    } else {
      console.log('   ⚠️  Checkbox not found');
    }

    // Step 3: Click "Sign in" button
    console.log('\n📋 Step 3: Clicking "Sign in" button...');
    let signInButton = page.locator('button:has-text("Sign in")').first();
    let buttonCount = await signInButton.count();
    if (buttonCount === 0) {
      const icbcSignInSection = page.locator('text="Sign in with your ICBC information"').locator('..').locator('..');
      signInButton = icbcSignInSection.locator('button:has-text("Sign in")').first();
      buttonCount = await signInButton.count();
    }
    if (buttonCount > 0) {
      await signInButton.scrollIntoViewIfNeeded();
      await delay(200); // Reduced from 500ms
      await signInButton.click();
      await page.waitForLoadState('load', { timeout: 30000 });
      await delay(1000); // Reduced from 2000ms
      console.log(`   ✅ Sign in clicked. Current URL: ${page.url()}`);
    } else {
      throw new Error('Could not find sign-in button');
    }

    // Step 4: Click "Select" button for B.C. driver's licence
    console.log('\n📋 Step 4: Clicking "B.C. driver\'s licence" Select button...');
    await delay(1000); // Reduced from 2000ms
    const selectButtonXPath = '/html/body/form/div[5]/div/div/div/div[2]/div/div[3]/div/div[3]/div[1]/div/span/div[3]/div/div[3]';
    const targetSelectButton = page.locator(`xpath=${selectButtonXPath}`);
    const selectButtonCount = await targetSelectButton.count();
    if (selectButtonCount > 0) {
      await targetSelectButton.scrollIntoViewIfNeeded();
      await delay(500); // Reduced from 1000ms
      await targetSelectButton.click({ force: true });
      await delay(1500); // Reduced from 3000ms
      console.log('   ✅ Select button clicked');
    } else {
      throw new Error('Could not find Select button');
    }

    // Step 5: Fill in login credentials
    console.log('\n📋 Step 5: Filling in login credentials...');
    
    // dateValue, keyword, licenseNumber, and lastName are already set at the top of the function
    const dateParts = dateValue.split(' ');
    const day = dateParts[0];
    const monthName = dateParts[1];
    const year = dateParts[2];
    const monthMap = {
      'january': '01', 'jan': '01', 'february': '02', 'feb': '02',
      'march': '03', 'mar': '03', 'april': '04', 'apr': '04',
      'may': '05', 'june': '06', 'jun': '06', 'july': '07', 'jul': '07',
      'august': '08', 'aug': '08', 'september': '09', 'sep': '09',
      'october': '10', 'oct': '10', 'november': '11', 'nov': '11',
      'december': '12', 'dec': '12'
    };
    const monthNum = monthMap[monthName.toLowerCase()] || '03';
    const monthAbbr = monthName.substring(0, 3).toUpperCase();
    
    // Fill BCID number
    const firstInputXPath = '/html/body/form/div[5]/div/div/div/div[2]/div/div[3]/div/div[3]/div[4]/div[3]/div/div/div[2]/div[2]/div[1]/input';
    const firstInput = page.locator(`xpath=${firstInputXPath}`);
    if (await firstInput.count() > 0) {
      await firstInput.scrollIntoViewIfNeeded();
      await delay(100); // Reduced from 200ms
      await firstInput.fill(licenseNumber);
      console.log(`   ✅ Filled BCID: ${licenseNumber}`);
    }
    
    // Fill year
    const yearInputXPath = '/html/body/form/div[5]/div/div/div/div[2]/div/div[3]/div/div[3]/div[4]/div[3]/div/div/div[4]/div[2]/div[1]/div[1]/div[1]/input';
    const yearInput = page.locator(`xpath=${yearInputXPath}`);
    if (await yearInput.count() > 0) {
      await yearInput.scrollIntoViewIfNeeded();
      await delay(100); // Reduced from 200ms
      await yearInput.fill(year);
      console.log(`   ✅ Filled year: ${year}`);
    }
    
    // Fill month
    const monthSelectXPath = '/html/body/form/div[5]/div/div/div/div[2]/div/div[3]/div/div[3]/div[4]/div[3]/div/div/div[4]/div[2]/div[1]/div[1]/div[2]/select';
    const monthSelect = page.locator(`xpath=${monthSelectXPath}`);
    if (await monthSelect.count() > 0) {
      await monthSelect.scrollIntoViewIfNeeded();
      await delay(150); // Reduced from 300ms
      const options = await monthSelect.locator('option').all();
      for (const opt of options) {
        const optText = await opt.textContent();
        if (optText?.trim().toUpperCase() === monthAbbr) {
          const optValue = await opt.getAttribute('value');
          await monthSelect.selectOption({ value: optValue });
          await delay(200); // Reduced from 500ms
          console.log(`   ✅ Selected month: ${monthName} (${monthAbbr})`);
          break;
        }
      }
    }
    
    // Fill day
    const dayInputXPath = '/html/body/form/div[5]/div/div/div/div[2]/div/div[3]/div/div[3]/div[4]/div[3]/div/div/div[4]/div[2]/div[1]/div[1]/div[3]/input';
    const dayInput = page.locator(`xpath=${dayInputXPath}`);
    if (await dayInput.count() > 0) {
      await dayInput.scrollIntoViewIfNeeded();
      await delay(200); // Reduced from 200ms
      await dayInput.fill(day);
      console.log(`   ✅ Filled day: ${day}`);
    }
    
    await delay(500); // Reduced from 1000ms

    // Step 6: Click Next button
    console.log('\n📋 Step 6: Clicking Next button...');
    const nextButtonXPath = '/html/body/form/div[5]/div/div/div/div[2]/div/div[3]/div/div[5]/input';
    const nextButton = page.locator(`xpath=${nextButtonXPath}`);
    if (await nextButton.count() > 0) {
      await nextButton.scrollIntoViewIfNeeded();
      await delay(500); // Reduced from 500ms
      await nextButton.click();
      await delay(1500); // Reduced from 3000ms
      await page.waitForLoadState('load', { timeout: 30000 });
      console.log(`   ✅ Next clicked. Current URL: ${page.url()}`);
    }

    // Step 7: Click second button
    console.log('\n📋 Step 7: Clicking second button...');
    const secondButtonXPath = '/html/body/form/div[5]/div/div/div/div[2]/div/div[3]/div/div[3]/div[2]/div/span/div[3]/div/div[3]';
    const secondButton = page.locator(`xpath=${secondButtonXPath}`);
    if (await secondButton.count() > 0) {
      await secondButton.scrollIntoViewIfNeeded();
      await delay(200); // Reduced from 500ms
      await secondButton.click();
      await delay(1500); // Reduced from 3000ms
      await page.waitForLoadState('load', { timeout: 30000 });
      console.log(`   ✅ Second button clicked. Current URL: ${page.url()}`);
    }

    // Step 8: Fill keyword
    console.log('\n📋 Step 8: Filling keyword...');
    const keywordInputXPath = '/html/body/form/div[5]/div/div/div/div[2]/div/div[3]/div/div[3]/div[5]/div[3]/div/div/div[2]/div[2]/div/input';
    const keywordInput = page.locator(`xpath=${keywordInputXPath}`);
    if (await keywordInput.count() > 0) {
      console.log('   Found keyword input field');
      await keywordInput.scrollIntoViewIfNeeded();
      await delay(200); // Reduced from 500ms
      
      // Get field attributes for debugging
      const fieldType = await keywordInput.getAttribute('type');
      const fieldName = await keywordInput.getAttribute('name');
      const fieldId = await keywordInput.getAttribute('id');
      console.log(`   Keyword field - type: ${fieldType}, name: ${fieldName}, id: ${fieldId}`);
      
      // Click to focus the field first
      console.log('   Clicking keyword field to focus...');
      await keywordInput.click();
      await delay(200); // Reduced from 500ms
      
      // Clear any existing value
      console.log('   Clearing keyword field...');
      await keywordInput.clear();
      await delay(200); // Reduced from 500ms
      
      // Verify field is empty
      const emptyValue = await keywordInput.inputValue().catch(() => '');
      console.log(`   Keyword field value after clear: "${emptyValue}"`);
      
      // Type the keyword to trigger input events
      console.log(`   Typing keyword: ${keyword} (character by character)...`);
      await keywordInput.type(keyword, { delay: 50 }); // Reduced from 100ms
      await delay(500); // Reduced from 1000ms
      
      // Verify the keyword was actually entered
      const enteredValue = await keywordInput.inputValue().catch(() => '');
      console.log(`   Keyword field value after typing: "${enteredValue}"`);
      
      if (enteredValue !== keyword) {
        console.log(`   ⚠️  WARNING: Keyword mismatch! Expected: "${keyword}", Got: "${enteredValue}"`);
        console.log('   Attempting to fill again...');
        await keywordInput.clear();
        await delay(200); // Reduced from 500ms
        await keywordInput.fill(keyword);
        await delay(500); // Reduced from 1000ms
        const retryValue = await keywordInput.inputValue().catch(() => '');
        console.log(`   Keyword field value after retry: "${retryValue}"`);
      }
      
      // Trigger additional events to ensure form recognizes the input
      console.log('   Triggering blur event to validate field...');
      await keywordInput.evaluate(el => {
        el.blur();
        el.dispatchEvent(new Event('blur', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await delay(300); // Reduced from 1000ms
      
      // Take screenshot for debugging
      if (!isHeadless) {
        await page.screenshot({ path: 'icbc-keyword-filled-token-renewal.png', fullPage: true });
        console.log('   📸 Screenshot saved: icbc-keyword-filled-token-renewal.png');
      }
      
      console.log(`   ✅ Keyword filled: ${keyword}`);
      await delay(300); // Reduced from 1000ms
    } else {
      console.log('   ⚠️  Keyword input field not found using XPath');
    }

    // Step 9: Click Submit button
    console.log('\n📋 Step 9: Clicking Submit button...');
    const submitButtonXPath = '/html/body/form/div[5]/div/div/div/div[2]/div/div[3]/div/div[4]/input[2]';
    const submitButton = page.locator(`xpath=${submitButtonXPath}`);
    if (await submitButton.count() > 0) {
      await submitButton.scrollIntoViewIfNeeded();
      await delay(300); // Reduced from 1000ms
      console.log('   Clicking submit button...');
      await submitButton.click();
      await delay(2000); // Reduced from 3000ms
      await page.waitForLoadState('load', { timeout: 30000 });
      console.log(`   ✅ Submit clicked. Current URL: ${page.url()}`);
      console.log('   ⏳ Waiting for OAuth2 token to be captured...');
      await delay(3000); // Reduced from 5000ms - Wait for OAuth2 flow to complete
    }

    console.log(`\n✅ Login flow completed. Status: Success\n`);
    
    // Wait a bit more to ensure all network requests (including OAuth2) have completed
    console.log('⏳ Waiting for all network requests to complete...');
    await delay(2000); // Reduced from 5000ms
    
    // Check if we captured OAuth2 parameters and try to exchange if needed
    if (!tokenInfo.found && oauth2Params.code) {
      console.log('\n📋 Attempting to exchange captured OAuth2 authorization code for token...');
      try {
        const tokenResponse = await page.request.post(
          'https://auth.icbc.com/f5-oauth2/v1/token',
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
              'Accept': 'application/json, text/plain, */*',
              'Referer': 'https://onlinebusiness.icbc.com/',
              'sec-ch-ua': '"Brave";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
              'sec-ch-ua-mobile': '?0',
              'sec-ch-ua-platform': '"Windows"'
            },
            data: new URLSearchParams({
              grant_type: 'authorization_code',
              code: oauth2Params.code,
              redirect_uri: oauth2Params.redirect_uri || 'https://onlinebusiness.icbc.com/webdeas-ui/oauth2callback',
              client_id: oauth2Params.client_id || '2265c2068a378fe6c7a34406b8ab0094a138f5f87fe72769',
              client_secret: oauth2Params.client_secret || '66bed7ba061189e13e26be0ea62da35b3697f63cc54b0094a138f5f87fe72769',
              code_verifier: oauth2Params.code_verifier || ''
            }).toString()
          }
        );
        
        console.log(`   Token endpoint response status: ${tokenResponse.status()}`);
        
        try {
          const tokenBody = await tokenResponse.json();
          console.log('   Token response keys:', Object.keys(tokenBody).join(', '));
          
          if (tokenBody.access_token) {
            tokenInfo.found = true;
            tokenInfo.token = tokenBody.access_token;
            tokenInfo.location = 'OAuth2 token endpoint: access_token (exchanged)';
            console.log(`\n✅ Found access_token from OAuth2 token endpoint!`);
            console.log(`   Token type: ${tokenBody.token_type || 'Bearer'}`);
            if (tokenBody.expires_in) {
              console.log(`   Expires in: ${tokenBody.expires_in} seconds`);
            }
          }
        } catch (e) {
          console.log('   Could not parse token response:', e.message);
        }
      } catch (tokenError) {
        console.log('   Token exchange failed:', tokenError.message);
      }
    }
    
    // Try making a test API call to see if token appears in subsequent requests
    // The Bearer token might only appear when making actual API calls
    if (!tokenInfo.found) {
      console.log('\n📋 Making test API call to check for Bearer token...');
      console.log('   (The Bearer token might only be returned in subsequent API requests)');
      try {
        const testResponse = await page.request.post(
          'https://onlinebusiness.icbc.com/deas-api/v1/web/getAvailableAppointments',
          {
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
              ...(process.env.ICBC_COOKIES ? { 'Cookie': process.env.ICBC_COOKIES } : {})
            },
            data: {
              aPosID: 8, // Test with a location ID
              examDate: new Date().toISOString().split('T')[0],
              examType: process.env.EXAM_TYPE || '5-R-1',
              ignoreReserveTime: false,
              lastName: lastName,
              licenseNumber: licenseNumber,
              prfDaysOfWeek: '[0,1,2,3,4,5,6]',
              prfPartsOfDay: '[0,1]',
            }
          }
        );
        
        console.log(`   Test API call completed. Status: ${testResponse.status()}`);
        
        // Check test response headers for Authorization
        const testHeaders = testResponse.headers();
        const testHeaderKeys = Object.keys(testHeaders);
        console.log('   Test API response headers:', testHeaderKeys.join(', '));
        
        // Check for Authorization header
        let testAuthHeaderValue = null;
        for (const key of testHeaderKeys) {
          if (key.toLowerCase() === 'authorization') {
            testAuthHeaderValue = testHeaders[key];
            break;
          }
        }
        
        if (testAuthHeaderValue) {
          console.log(`\n✅ Found Authorization header in test API call!`);
          const match = testAuthHeaderValue.match(/Bearer\s+(.+)/i) || testAuthHeaderValue.match(/(.+)/);
          if (match) {
            tokenInfo.found = true;
            tokenInfo.token = match[1];
            tokenInfo.location = 'test API call response header: Authorization';
            console.log(`   ✅ Extracted token from test API call`);
          }
        } else {
          console.log('   ⚠️  No Authorization header in test API response');
        }
      } catch (testError) {
        console.log(`   Test API call failed (this is OK): ${testError.message}`);
        // Check error response headers too
        if (testError.response) {
          const errorHeaders = testError.response.headers();
          const errorHeaderKeys = Object.keys(errorHeaders);
          for (const key of errorHeaderKeys) {
            if (key.toLowerCase() === 'authorization') {
              const authValue = errorHeaders[key];
              const match = authValue.match(/Bearer\s+(.+)/i) || authValue.match(/(.+)/);
              if (match && !tokenInfo.found) {
                tokenInfo.found = true;
                tokenInfo.token = match[1];
                tokenInfo.location = 'test API error response header: Authorization';
                console.log(`✅ Found token in test API error response header`);
              }
            }
          }
        }
      }
    }

    if (tokenInfo.found) {
      console.log(`\n✅ Bearer token found!`);
      console.log(`   Location: ${tokenInfo.location}`);
      
      // Check if it's a JWT
      const isJWT = tokenInfo.token.split('.').length === 3;
      if (isJWT) {
        console.log(`   Type: JWT (JSON Web Token)`);
        const decoded = decodeJWT(tokenInfo.token);
        if (decoded) {
          console.log(`   JWT Payload:`, JSON.stringify(decoded, null, 2));
          if (decoded.exp) {
            const expDate = new Date(decoded.exp * 1000);
            const minutesUntilExpiry = Math.floor((decoded.exp * 1000 - Date.now()) / 1000 / 60);
            console.log(`   Expires: ${expDate.toISOString()} (${minutesUntilExpiry} minutes from now)`);
          }
        }
      }
      
      console.log(`   Token: ${tokenInfo.token.substring(0, 30)}...${tokenInfo.token.substring(tokenInfo.token.length - 30)}`);
      
      // Save token to file
      fs.writeFileSync(TOKEN_OUTPUT_FILE, JSON.stringify(tokenInfo, null, 2));
      console.log(`\n💾 Token saved to: ${TOKEN_OUTPUT_FILE}`);
    } else {
      console.log('\n⚠️  No bearer token found in login response.');
      console.log('\n📄 Response details:');
      console.log('Status:', response.status());
      console.log('Headers:', JSON.stringify(response.headers(), null, 2));
      try {
        const body = await response.json();
        console.log('Body:', JSON.stringify(body, null, 2));
      } catch (e) {
        console.log('Body: (not JSON or not accessible)');
      }
      console.log('\n💡 The token might be:');
      console.log('   1. In a cookie that needs to be decoded');
      console.log('   2. Generated client-side from the response data');
      console.log('   3. Only available after making a subsequent API call');
      console.log('   4. Try making a subsequent API call (like /getAvailableAppointments) to see if token appears');
    }

    // Keep browser open for a few seconds to review
    if (!HEADLESS) {
      console.log('\n⏳ Keeping browser open for 2 seconds to review...');
      await page.waitForTimeout(2000); // Reduced from 5000ms
    }

  } catch (error) {
    console.error('\n❌ Error getting bearer token:');
    console.error(`   Message: ${error.message}`);
    if (error.stack) {
      console.error(`   Stack: ${error.stack}`);
    }
  } finally {
    await browser.close();
    console.log('\n✅ Browser closed');
  }

  return tokenInfo;
}

// Run if called directly
if (require.main === module) {
  getBearerTokenWithPlaywright()
    .then(result => {
      if (result.found) {
        console.log('\n✅ Success! Bearer token extracted and saved.');
        process.exit(0);
      } else {
        console.log('\n⚠️  No bearer token found.');
        console.log('   Check the output above for details.');
        process.exit(0);
      }
    })
    .catch(error => {
      console.error('\n❌ Failed to get bearer token');
      process.exit(1);
    });
}

module.exports = { getBearerTokenWithPlaywright };

