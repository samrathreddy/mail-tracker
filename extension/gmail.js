// Gmail content script — auto-injects tracking pixel on Send
// Strategy: Only inject pixels when Send button is clicked

(function () {
  const LOG = '[MailTracker]';
  let serverUrl = '';
  let dashboardPassword = '';
  let trackingEnabled = true;

  // Add CSS for read indicators
  const style = document.createElement('style');
  style.textContent = `
    .mail-tracker-status {
      display: inline-block;
      margin-left: 4px;
      font-size: 11px;
      font-weight: bold;
      cursor: help;
      opacity: 0.8;
      transition: opacity 0.2s;
    }
    .mail-tracker-status:hover {
      opacity: 1;
    }
  `;
  document.head.appendChild(style);

  // Cache for tracking data to avoid excessive API calls
  let trackingDataCache = null;
  let lastCacheUpdate = 0;
  const CACHE_DURATION = 5000; // 5 second cache
  let currentView = '';

  // Get tracking data with caching
  async function getTrackingData() {
    const now = Date.now();
    
    console.log(LOG, 'getTrackingData called - cache age:', now - lastCacheUpdate, 'ms');
    
    // Return cached data if still valid
    if (trackingDataCache && (now - lastCacheUpdate) < CACHE_DURATION) {
      console.log(LOG, 'Using cached data, no API call');
      return trackingDataCache;
    }
    
    console.log(LOG, 'Cache expired or empty, making API call...');
    
    try {
      const headers = {};
      if (dashboardPassword) {
        headers['Authorization'] = 'Basic ' + btoa(':' + dashboardPassword);
      }
      
      console.log(LOG, 'Making /list API call');
      const res = await fetch(`${serverUrl}/list`, { headers });
      if (res.ok) {
        trackingDataCache = await res.json();
        lastCacheUpdate = now;
        console.log(LOG, 'API call successful, cached', trackingDataCache.length, 'trackers');
        return trackingDataCache;
      } else {
        console.warn(LOG, 'Failed to fetch tracking data:', res.status);
        return [];
      }
    } catch (e) {
      console.warn(LOG, 'Error fetching tracking data:', e);
      return [];
    }
  }

  // Load settings
  chrome.storage.sync.get(['serverUrl', 'autoTrack', 'dashboardPassword'], (result) => {
    serverUrl = result.serverUrl || '';
    dashboardPassword = result.dashboardPassword || '';
    trackingEnabled = result.autoTrack !== false;
    console.log(LOG, 'Loaded settings:', { serverUrl: serverUrl ? 'set' : 'empty', trackingEnabled });
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.serverUrl) serverUrl = changes.serverUrl.newValue || '';
    if (changes.dashboardPassword) dashboardPassword = changes.dashboardPassword.newValue || '';
    if (changes.autoTrack) trackingEnabled = changes.autoTrack.newValue !== false;
  });

  // Extract email addresses from a compose form
  function getRecipients(composeForm) {
    const recipients = new Set();

    // Method 1: span[email] inside recipient rows (most reliable in current Gmail)
    composeForm.querySelectorAll('span[email]').forEach(el => {
      const email = el.getAttribute('email');
      if (email && email.includes('@')) recipients.add(email.toLowerCase());
    });

    // Method 2: data-hovercard-id on recipient chips
    composeForm.querySelectorAll('[data-hovercard-id]').forEach(el => {
      const email = el.getAttribute('data-hovercard-id');
      if (email && email.includes('@')) recipients.add(email.toLowerCase());
    });

    // Method 3: [email] attribute
    composeForm.querySelectorAll('[email]').forEach(el => {
      const email = el.getAttribute('email');
      if (email && email.includes('@')) recipients.add(email.toLowerCase());
    });

    return Array.from(recipients);
  }

  // Extract email subject and body preview
  function getEmailContent(composeForm) {
    // Try multiple selectors for subject
    const subjectEl = composeForm.querySelector('input[name="subjectbox"]') ||
                     composeForm.querySelector('input[aria-label*="Subject"]') ||
                     composeForm.querySelector('input[placeholder*="Subject"]') ||
                     composeForm.querySelector('[data-tooltip*="Subject"] input');
    
    const subject = subjectEl?.value || '';
    
    // Try multiple selectors for body
    const bodyEl = composeForm.querySelector('[contenteditable="true"][aria-label*="Message"]') ||
                   composeForm.querySelector('[contenteditable="true"][role="textbox"]') ||
                   composeForm.querySelector('.Am.Al.editable') ||
                   composeForm.querySelector('[contenteditable="true"]');
    
    let bodyPreview = '';
    if (bodyEl) {
      const text = bodyEl.innerText || bodyEl.textContent || '';
      // Get first 2 lines, max 200 chars
      const lines = text.split('\n').filter(line => line.trim());
      bodyPreview = lines.slice(0, 2).join(' ').substring(0, 200);
    }
    
    console.log(LOG, 'Extracted content:', { subject, bodyPreview: bodyPreview.substring(0, 50) + '...' });
    return { subject: subject.trim(), bodyPreview: bodyPreview.trim() };
  }

  // Find compose form containing a body element
  function findComposeForm(bodyEl) {
    return bodyEl.closest('[role="dialog"]') || bodyEl.closest('.nH') || bodyEl.closest('form');
  }

  // Find all compose body elements
  function findComposeBodies() {
    return Array.from(document.querySelectorAll('div[contenteditable="true"]'))
      .filter(el => el.closest('[role="dialog"]') || el.closest('.nH'));
  }

  // Check which recipients don't have tracking pixels yet
  function getUntrackedRecipients(bodyEl, recipients) {
    const existing = Array.from(bodyEl.querySelectorAll('img[data-mail-tracker-to]'))
      .map(img => img.getAttribute('data-mail-tracker-to'));
    return recipients.filter(email => !existing.includes(email));
  }

  // Inject tracking pixel into a compose body for given recipients
  async function injectTracker(bodyEl, recipients) {
    if (!serverUrl || recipients.length === 0) return;

    const form = findComposeForm(bodyEl);
    const emailContent = getEmailContent(form);
    let injectedCount = 0;

    for (const recipient of recipients) {
      try {
        const headers = { 'Content-Type': 'application/json' };
        if (dashboardPassword) {
          headers['Authorization'] = 'Basic ' + btoa(':' + dashboardPassword);
        }
        
        const payload = {
          to: recipient,
          subject: emailContent.subject,
          bodyPreview: emailContent.bodyPreview,
          messageId: Date.now() + '-' + Math.random().toString(36).substr(2, 9) // Unique message ID
        };
        
        const res = await fetch(`${serverUrl}/new`, { 
          method: 'POST',
          headers,
          body: JSON.stringify(payload)
        });
        
        if (!res.ok) {
          console.warn(LOG, 'Failed to create tracker for', recipient, '- status:', res.status);
          continue;
        }
        const data = await res.json();

        const img = document.createElement('img');
        img.src = data.pixel;
        img.width = 1;
        img.height = 1;
        img.style.cssText = 'display:none!important;width:1px!important;height:1px!important;opacity:0!important;position:absolute!important;';
        img.setAttribute('data-mail-tracker', data.id);
        img.setAttribute('data-mail-tracker-to', recipient);
        img.setAttribute('data-message-id', payload.messageId);

        bodyEl.appendChild(img);
        injectedCount++;
        console.log(LOG, 'Injected tracker for', recipient, '- id:', data.id);
      } catch (e) {
        console.warn(LOG, 'Error creating tracker for', recipient, e.message);
      }
    }

    if (injectedCount > 0) {
      console.log(LOG, 'Injected', injectedCount, 'tracking pixels');
    }
  }

  // Extract unique identifiers from Gmail thread
  function getEmailIdentifiers(row) {
    // Try to get Gmail's thread ID or message ID
    const threadId = row.querySelector('[data-thread-id]')?.getAttribute('data-thread-id') ||
                    row.querySelector('[data-legacy-thread-id]')?.getAttribute('data-legacy-thread-id');
    
    // Get subject from the email row
    const subjectEl = row.querySelector('.bog span') || row.querySelector('.y6 span');
    const subject = subjectEl?.textContent?.trim() || '';
    
    // Get timestamp
    const timeEl = row.querySelector('[title*="2026"]') || row.querySelector('span[title]');
    const timestamp = timeEl?.getAttribute('title') || '';
    
    return { threadId, subject, timestamp };
  }

  // Find best matching tracker for an email
  function findMatchingTracker(trackers, email, identifiers) {
    // First try exact subject + recipient match
    let matches = trackers.filter(t => 
      t.recipient === email && 
      t.subject && 
      identifiers.subject.includes(t.subject)
    );
    
    if (matches.length === 1) return matches[0];
    
    // If multiple matches, try to find most recent
    if (matches.length > 1) {
      return matches.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
    }
    
    // Fallback to any tracker for this recipient (most recent)
    matches = trackers.filter(t => t.recipient === email);
    if (matches.length > 0) {
      return matches.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
    }
    
    return null;
  }
  function addReadIndicators(composeForm) {
    console.log(LOG, 'Adding read indicators...');
    
    // Find all recipient chips in the compose form
    const recipientChips = composeForm.querySelectorAll('span[email], [data-hovercard-id]');
    console.log(LOG, 'Found recipient chips:', recipientChips.length);
    
    recipientChips.forEach(async (chip) => {
      const email = chip.getAttribute('email') || chip.getAttribute('data-hovercard-id');
      if (!email || chip.querySelector('.mail-tracker-status')) return;
      
      console.log(LOG, 'Adding indicator for:', email);
      
      // Create status indicator
      const statusEl = document.createElement('span');
      statusEl.className = 'mail-tracker-status';
      statusEl.style.cssText = 'margin-left: 6px; font-size: 12px; color: #5f6368; cursor: help; font-weight: bold;';
      statusEl.textContent = '✓'; // Single tick for sent
      statusEl.title = 'Sent but not opened yet';
      
      // Insert after the chip
      chip.parentNode.insertBefore(statusEl, chip.nextSibling);
      console.log(LOG, 'Indicator added for:', email);
      
      // Update status with cached data
      const trackers = await getTrackingData();
      const tracker = trackers.find(t => t.recipient === email);
      
      if (tracker && tracker.opens > 0) {
        statusEl.textContent = '✓✓'; // Double tick for read
        statusEl.style.color = '#1a73e8'; // Blue for read
        
        const lastOpen = tracker.lastOpen ? new Date(tracker.lastOpen).toLocaleString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
          month: 'short',
          day: 'numeric'
        }) : 'never';
        
        statusEl.title = `Opened ${tracker.opens} time${tracker.opens > 1 ? 's' : ''}\nLast opened: ${lastOpen}`;
      }
    });
  }

  // Process a compose window — inject pixels for untracked recipients
  async function processCompose(bodyEl) {
    const form = findComposeForm(bodyEl);
    if (!form) {
      console.log(LOG, 'Could not find compose form for body element');
      return;
    }

    const recipients = getRecipients(form);
    if (recipients.length === 0) return;

    const untracked = getUntrackedRecipients(bodyEl, recipients);
    if (untracked.length === 0) return;

    console.log(LOG, 'Found untracked recipients:', untracked);
    await injectTracker(bodyEl, untracked);
    
    // Add read indicators after injecting trackers with longer delay
    console.log(LOG, 'Scheduling read indicators...');
    setTimeout(() => {
      console.log(LOG, 'Adding read indicators now...');
      addReadIndicators(form);
    }, 3000);
  }

  // Watch for Send button clicks and keyboard shortcut — inject right before send
  function setupSendInterception() {
    // Keyboard shortcut: Ctrl+Enter or Cmd+Enter
    document.addEventListener('keydown', (e) => {
      if (!trackingEnabled || !serverUrl) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        console.log(LOG, 'Send shortcut detected');
        findComposeBodies().forEach(body => processCompose(body));
      }
    }, true);

    // Click on any Send button — use mousedown to fire before Gmail's click handler
    document.addEventListener('mousedown', (e) => {
      if (!trackingEnabled || !serverUrl) return;

      const target = e.target.closest(
        'div[role="button"][aria-label*="Send"], ' +
        'div[role="button"][data-tooltip*="Send"], ' +
        'div[role="button"][aria-label*="send"], ' +
        'div[role="button"][data-tooltip*="send"], ' +
        'div.T-I.J-J5-Ji[data-tooltip*="Send"], ' +
        'div.T-I.J-J5-Ji[data-tooltip*="send"]'
      );

      if (target) {
        console.log(LOG, 'Send button mousedown detected');
        findComposeBodies().forEach(body => processCompose(body));
      }
    }, true);
  }

  // Periodically update read indicators for open compose windows
  function startStatusUpdater() {
    // No periodic updates - only fetch on view changes
  }

  // Add read indicators to sent emails in inbox view
  async function addInboxReadIndicators() {
    if (!serverUrl || !dashboardPassword) return;
    
    console.log(LOG, 'addInboxReadIndicators called');
    
    // First, remove all existing indicators to prevent duplicates
    document.querySelectorAll('.mail-tracker-status').forEach(el => el.remove());
    console.log(LOG, 'Cleared existing indicators');
    
    // Fetch tracking data ONCE before processing emails
    const trackers = await getTrackingData();
    console.log(LOG, 'Got', trackers.length, 'trackers for processing');
    
    // Find sent email rows (emails with "To: " prefix)
    const sentRows = document.querySelectorAll('tr[role="row"]');
    console.log(LOG, 'Found', sentRows.length, 'email rows');
    
    sentRows.forEach((row, index) => {
      const toField = row.querySelector('.yW');
      if (!toField || !toField.textContent.startsWith('To: ')) return;
      
      const emailSpan = toField.querySelector('span[email]');
      if (!emailSpan) return; // Remove the duplicate check since we cleared all indicators above
      
      const email = emailSpan.getAttribute('email');
      console.log(LOG, 'Processing row', index, 'for email:', email);
      
      // Get email identifiers for better matching
      const identifiers = getEmailIdentifiers(row);
      console.log(LOG, 'Email identifiers:', identifiers);
      
      // Find the best matching tracker for this specific email
      const tracker = findMatchingTracker(trackers, email, identifiers);
      
      // Only add indicator if email was tracked
      if (!tracker) {
        console.log(LOG, 'Email', email, 'not tracked, skipping');
        return;
      }
      
      console.log(LOG, 'Found tracked email to:', email);
      
      // Create status indicator
      const statusEl = document.createElement('span');
      statusEl.className = 'mail-tracker-status';
      statusEl.style.cssText = 'margin-left: 6px; font-size: 11px; color: #5f6368; cursor: help; font-weight: bold;';
      
      if (tracker.opens > 0) {
        statusEl.textContent = '✓✓'; // Double tick for read
        statusEl.style.color = '#1a73e8'; // Blue for read
        
        const lastOpen = tracker.lastOpen ? new Date(tracker.lastOpen).toLocaleString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
          month: 'short',
          day: 'numeric'
        }) : 'never';
        
        statusEl.title = `Opened ${tracker.opens} time${tracker.opens > 1 ? 's' : ''}\nLast opened: ${lastOpen}`;
      } else {
        statusEl.textContent = '✓'; // Single tick for sent
        statusEl.title = 'Sent but not opened yet';
      }
      
      // Insert after email span
      emailSpan.parentNode.insertBefore(statusEl, emailSpan.nextSibling);
      console.log(LOG, 'Added indicator for tracked email:', email);
    });
  }

  // Initialize tracking
  if (window.location.hostname === 'mail.google.com') {
    console.log(LOG, 'Initializing...');
    setupSendInterception();
    
    // Detect view changes and fetch data only when needed
    let lastUrl = location.href;
    
    function handleViewChange() {
      const newView = location.hash;
      console.log(LOG, 'URL changed to:', newView);
      
      // Only process if we're actually changing to sent folder view
      if (newView !== currentView && newView === '#sent') {
        currentView = newView;
        console.log(LOG, 'Entered sent folder, loading indicators');
        // Clear cache on view change to force fresh data
        trackingDataCache = null;
        setTimeout(() => addInboxReadIndicators(), 1000);
      } else if (newView !== currentView) {
        currentView = newView;
        console.log(LOG, 'Changed to:', currentView, '- not sent folder, skipping');
      }
    }
    
    // Initial load - only if already in sent
    if (location.hash === '#sent') {
      handleViewChange();
    }
    
    // Watch for URL changes with polling instead of MutationObserver
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        handleViewChange();
      }
    }, 1000);
  }

})();
