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
  // Patterns for BCC logging addresses that should NOT get trackers/sequences
  var BCC_LOGGING_PATTERNS = [
    /@bcc\..*\.hubspot\.com$/i,    // HubSpot BCC logging
    /@.*\.salesforce\.com$/i,       // Salesforce BCC logging
    /@bcc\..*\.hubspotfree\.com$/i, // HubSpot free BCC
  ];

  function isBccLoggingAddress(email) {
    return BCC_LOGGING_PATTERNS.some(function(p) { return p.test(email); });
  }

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

    // Filter out BCC logging addresses — they get tracked separately via getBccLoggingAddresses()
    return Array.from(recipients).filter(function(email) { return !isBccLoggingAddress(email); });
  }

  // Extract BCC logging addresses (e.g., HubSpot) to include on follow-ups for CRM logging
  function getBccLoggingAddresses(composeForm) {
    var allEmails = new Set();
    composeForm.querySelectorAll('span[email], [data-hovercard-id], [email]').forEach(function(el) {
      var email = el.getAttribute('email') || el.getAttribute('data-hovercard-id');
      if (email && email.includes('@')) allEmails.add(email.toLowerCase());
    });
    return Array.from(allEmails).filter(isBccLoggingAddress);
  }

  function authHeadersJson() {
    var headers = { 'Content-Type': 'application/json' };
    if (dashboardPassword) headers['Authorization'] = 'Basic ' + btoa(':' + dashboardPassword);
    return headers;
  }

  function showToast(message) {
    var el = document.createElement('div');
    el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:100000;background:#1f2937;color:#fff;padding:12px 18px;border-radius:10px;font-size:13px;font-family:Roboto,Google Sans,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,0.35);max-width:90vw;';
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(function() { el.remove(); }, 4200);
  }

  function getComposeParticipants(composeForm) {
    var out = { to: [], cc: [], bcc: [] };
    composeForm.querySelectorAll('tr, [role="listitem"]').forEach(function(row) {
      var labelText = '';
      var lx = row.querySelector('.aXa, .aYk');
      if (lx) labelText = (lx.textContent || '').trim();
      if (!labelText && row.getAttribute('aria-label')) labelText = row.getAttribute('aria-label') || '';
      var lt = labelText.trim().toLowerCase();
      var emails = [];
      row.querySelectorAll('span[email]').forEach(function(el) {
        var e = el.getAttribute('email');
        if (e && e.indexOf('@') !== -1) emails.push(e.toLowerCase());
      });
      if (emails.length === 0) return;
      if (lt.indexOf('to') === 0 || lt === 'to') out.to = emails;
      else if (lt.indexOf('cc') === 0) out.cc = emails;
      else if (lt.indexOf('bcc') === 0) out.bcc = emails;
    });
    if (out.to.length === 0) out.to = getRecipients(composeForm);
    return out;
  }

  function getComposeBodyHtml(composeForm) {
    var bodyEl = composeForm.querySelector('[contenteditable="true"][aria-label*="Message"]') ||
      composeForm.querySelector('[contenteditable="true"][role="textbox"]') ||
      composeForm.querySelector('[contenteditable="true"]');
    return bodyEl ? bodyEl.innerHTML : '';
  }

  function getComposeSubjectLine(composeForm) {
    var subjectEl = composeForm.querySelector('input[name="subjectbox"]') ||
      composeForm.querySelector('input[aria-label*="Subject"]');
    return subjectEl ? String(subjectEl.value || '').trim() : '';
  }

  function computeNextBusinessSendAt(optimalHour, recipientTz) {
    var tz = recipientTz || 'America/New_York';
    // Clamp optimal hour to 8am-6pm business window
    var clampedHour = optimalHour;
    if (clampedHour < 8 || clampedHour >= 18) clampedHour = 9;
    var now = Date.now();
    for (var t = now + 60000; t < now + 21 * 86400000; t += 60000) {
      var d = new Date(t);
      var wd = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(d);
      if (wd === 'Sat' || wd === 'Sun') continue;
      var parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(d);
      var hp = parts.find(function(p) { return p.type === 'hour'; });
      var mp = parts.find(function(p) { return p.type === 'minute'; });
      var h = hp ? parseInt(hp.value, 10) : 0;
      var m = mp ? parseInt(mp.value, 10) : 0;
      if (h === clampedHour && m === 0) return d.toISOString();
    }
    return new Date(now + 3600000).toISOString();
  }

  function formatScheduleLabel(iso, recipientTz) {
    var tz = recipientTz || 'America/New_York';
    var d = new Date(iso);
    return d.toLocaleString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  }

  function discardComposeWindow(composeForm) {
    var discard = composeForm.querySelector('[aria-label*="Discard"]') ||
      composeForm.querySelector('[data-tooltip*="Discard"]');
    if (discard) discard.click();
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

        // Try to inject into the actual email content area, not just the compose div
        const contentArea = bodyEl.querySelector('[contenteditable="true"]') || 
                           bodyEl.querySelector('.Am.Al.editable') ||
                           bodyEl;
        
        contentArea.appendChild(img);
        injectedCount++;
        console.log(LOG, 'Injected tracker into content area for', recipient, '- id:', data.id);
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
  function _addReadIndicators(composeForm) {
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

    // Per-compose tracking override: skip pixel injection but still allow sequences
    var trackingDisabledForCompose = form.hasAttribute('data-tracking-disabled');

    const recipients = getRecipients(form);
    if (recipients.length === 0) return;

    if (!trackingDisabledForCompose) {
      const untracked = getUntrackedRecipients(bodyEl, recipients);
      if (untracked.length === 0) {
        // All tracked, fall through to sequence logic
      } else {
        console.log(LOG, 'Found untracked recipients:', untracked);
        await injectTracker(bodyEl, untracked);
      }
    } else {
      console.log(LOG, 'Tracking disabled for this compose, skipping pixel injection');
    }

    // Create sequence if one was selected (but NOT if a scheduled send is pending)
    // Search within form first, then the whole compose dialog (button may be in toolbar)
    const seqBtn = form.querySelector('[data-sequence-selector] button') ||
                   (form.closest('[role="dialog"]') || document).querySelector('[data-sequence-selector] button');
    if (seqBtn) {
      const templateId = seqBtn.getAttribute('data-selected-template');
      const oneoffSteps = seqBtn.getAttribute('data-oneoff-steps');
      var isScheduled = seqBtn.getAttribute('data-scheduled-at');
      if (!isScheduled && (templateId || oneoffSteps)) {
        const { subject, bodyPreview } = getEmailContent(form);
        const allRecipients = getRecipients(form);
        const bccAddresses = getBccLoggingAddresses(form);
        for (const recipient of allRecipients) {
          const img = bodyEl.querySelector('img[data-mail-tracker-to="' + recipient + '"]');
          const trackerId = img ? new URL(img.src).pathname.split('/t/')[1] : null;
          const messageIdAttr = img ? img.getAttribute('data-message-id') : null;
          if (trackerId) {
            try {
              const headers = { 'Content-Type': 'application/json' };
              if (dashboardPassword) {
                headers['Authorization'] = 'Basic ' + btoa(':' + dashboardPassword);
              }
              var seqBody;
              if (templateId) {
                seqBody = JSON.stringify({
                  templateId: templateId,
                  trackerId: trackerId,
                  recipient: recipient,
                  originalMessageId: messageIdAttr || null,
                  threadId: null,
                  hubspotBcc: bccAddresses.length > 0 ? bccAddresses[0] : null,
                  variables: { subject: subject, originalBody: bodyPreview },
                  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                });
              } else {
                seqBody = JSON.stringify({
                  steps: JSON.parse(oneoffSteps),
                  trackerId: trackerId,
                  recipient: recipient,
                  originalMessageId: messageIdAttr || null,
                  threadId: null,
                  hubspotBcc: bccAddresses.length > 0 ? bccAddresses[0] : null,
                  variables: { subject: subject, originalBody: bodyPreview },
                  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                });
              }
              var seqRes = await fetch(serverUrl + '/sequences', {
                method: 'POST',
                headers: headers,
                body: seqBody,
              });
              if (!seqRes.ok) {
                var errText = await seqRes.text().catch(function() { return 'unknown error'; });
                console.error(LOG, 'Sequence creation failed:', seqRes.status, errText);
              } else {
                console.log(LOG, 'Sequence created for', recipient);
              }
            } catch (e) {
              console.error(LOG, 'Failed to create sequence', e);
            }
          }
        }
      }
    }
  }

  // Watch for Send button clicks — block send, inject pixels, then allow send
  let isSending = false; // Flag to prevent infinite loop

  function authHeadersBasicOnly() {
    var h = {};
    if (dashboardPassword) h['Authorization'] = 'Basic ' + btoa(':' + dashboardPassword);
    return h;
  }

  async function handleScheduledSend(bodyEl, form, seqBtn) {
    var scheduledAt = seqBtn.getAttribute('data-scheduled-at');
    if (!scheduledAt || !serverUrl) return false;
    var p = getComposeParticipants(form);
    var to = p.to.join(', ') || (getRecipients(form)[0] || '');
    var cc = p.cc.join(', ');
    var bccList = p.bcc.slice();
    getBccLoggingAddresses(form).forEach(function(b) {
      if (bccList.indexOf(b) === -1) bccList.push(b);
    });
    var bcc = bccList.join(', ');
    var subject = getComposeSubjectLine(form);
    var bodyHtml = getComposeBodyHtml(form);
    var img = bodyEl.querySelector('img[data-mail-tracker]');
    var trackerId = img ? new URL(img.src).pathname.split('/t/')[1] : null;
    var recipientTz = seqBtn.getAttribute('data-recipient-timezone') || '';
    var tzSource = seqBtn.getAttribute('data-timezone-source') || '';
    var payload = {
      to: to,
      cc: cc,
      bcc: bcc,
      subject: subject,
      body: bodyHtml,
      scheduledAt: scheduledAt,
      recipientTimezone: recipientTz || null,
      timezoneSource: tzSource || null,
      trackerId: trackerId,
      sequenceId: null,
      threadId: null,
      inReplyTo: null,
    };
    try {
      var res = await fetch(serverUrl + '/scheduled', { method: 'POST', headers: authHeadersJson(), body: JSON.stringify(payload) });
      if (!res.ok) {
        showToast('Schedule failed (' + res.status + ')');
        return true;
      }
    } catch (_err) {
      showToast('Schedule failed');
      return true;
    }
    seqBtn.removeAttribute('data-scheduled-at');
    seqBtn.removeAttribute('data-recipient-timezone');
    seqBtn.removeAttribute('data-timezone-source');
    discardComposeWindow(form);
    showToast('Scheduled for ' + formatScheduleLabel(scheduledAt, recipientTz || (Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York')));
    return true;
  }

  function setupSendInterception() {
    document.addEventListener('click', async (e) => {
      if (!trackingEnabled || !serverUrl) return;
      if (isSending) return; // Skip if already sending

      const target = e.target.closest(
        'div[role="button"][aria-label*="Send"], ' +
        'div[role="button"][data-tooltip*="Send"]'
      );

      if (target) {
        console.log(LOG, 'Send button clicked - checking for untracked recipients');
        
        // Prevent the send
        e.stopPropagation();
        e.preventDefault();
        
        // Set flag to prevent re-interception
        isSending = true;
        
        // Process all compose windows
        const bodies = findComposeBodies();
        for (const body of bodies) {
          const form = findComposeForm(body);
          if (!form) continue;

          // Skip pixel injection if tracking disabled for this compose
          if (form.hasAttribute('data-tracking-disabled')) {
            console.log(LOG, 'Tracking disabled for this compose, skipping pixel injection');
            continue;
          }

          const recipients = getRecipients(form);
          const untracked = getUntrackedRecipients(body, recipients);

          if (untracked.length > 0) {
            console.log(LOG, 'Injecting pixels for untracked recipients:', untracked);
            await processCompose(body);
            // Wait a bit for pixels to be added to DOM
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }

        var activeDialog = target.closest('[role="dialog"]');
        if (activeDialog) {
          var activeBody = activeDialog.querySelector('div[contenteditable="true"]');
          if (activeBody) {
            var activeForm = findComposeForm(activeBody);
            var seqBtn = activeForm.querySelector('[data-sequence-selector] button') ||
              activeDialog.querySelector('[data-sequence-selector] button');
            if (seqBtn && seqBtn.getAttribute('data-scheduled-at')) {
              await processCompose(activeBody);
              await new Promise(function(r) { setTimeout(r, 400); });
              var didSchedule = await handleScheduledSend(activeBody, activeForm, seqBtn);
              if (didSchedule) {
                setTimeout(function() { isSending = false; }, 200);
                return;
              }
            }
          }
        }
        
        console.log(LOG, 'All pixels injected, sending email now');
        
        // Now trigger the actual send
        setTimeout(() => {
          target.click();
          // Reset flag after send
          setTimeout(() => { isSending = false; }, 1000);
        }, 100);
      }
    }, true); // Use capture phase to intercept before Gmail
  }

  // Periodically update read indicators for open compose windows
  function _startStatusUpdater() {
    // No periodic updates - only fetch on view changes
  }

  // Add read indicators to sent emails in inbox view
  async function addInboxReadIndicators() {
    if (!serverUrl || !dashboardPassword) return;

    console.log(LOG, 'addInboxReadIndicators called');

    // Fetch tracking data ONCE before processing emails
    const trackers = await getTrackingData();
    console.log(LOG, 'Got', trackers.length, 'trackers for processing');

    // Find sent email rows (emails with "To: " prefix)
    const sentRows = document.querySelectorAll('tr[role="row"]');
    console.log(LOG, 'Found', sentRows.length, 'email rows');

    sentRows.forEach((row, _index) => {
      const toField = row.querySelector('.yW');
      if (!toField || !toField.textContent.startsWith('To: ')) return;

      const emailSpan = toField.querySelector('span[email]');
      if (!emailSpan) return;

      const email = emailSpan.getAttribute('email');

      // Get email identifiers for better matching
      const identifiers = getEmailIdentifiers(row);

      // Find the best matching tracker for this specific email
      const tracker = findMatchingTracker(trackers, email, identifiers);

      // Only add indicator if email was tracked
      if (!tracker) return;

      // Check if this row already has an indicator
      const existingStatus = row.querySelector('.mail-tracker-status');
      if (existingStatus) {
        // Compare opens count to see if we need to update
        var currentOpens = parseInt(existingStatus.getAttribute('data-tracker-opens') || '0', 10);
        if (currentOpens === tracker.opens) return; // No change, skip

        // Update existing indicator in-place
        existingStatus.setAttribute('data-tracker-opens', String(tracker.opens));
        if (tracker.opens > 0) {
          existingStatus.textContent = '\u2713\u2713';
          existingStatus.style.color = '#1a73e8';
          var lastOpen = tracker.lastOpen ? new Date(tracker.lastOpen).toLocaleString('en-US', {
            hour: 'numeric', minute: '2-digit', hour12: true, month: 'short', day: 'numeric'
          }) : 'never';
          existingStatus.title = 'Opened ' + tracker.opens + ' time' + (tracker.opens > 1 ? 's' : '') + '\nLast opened: ' + lastOpen;
        } else {
          existingStatus.textContent = '\u2713';
          existingStatus.style.color = '#5f6368';
          existingStatus.title = 'Sent but not opened yet';
        }
        console.log(LOG, 'Updated indicator for:', email);
        return;
      }

      console.log(LOG, 'Found tracked email to:', email);

      // Create status indicator
      const statusEl = document.createElement('span');
      statusEl.className = 'mail-tracker-status';
      statusEl.style.cssText = 'margin-left: 6px; font-size: 11px; color: #5f6368; cursor: help; font-weight: bold;';
      statusEl.setAttribute('data-tracker-opens', String(tracker.opens));

      if (tracker.opens > 0) {
        statusEl.textContent = '\u2713\u2713'; // Double tick for read
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
        statusEl.textContent = '\u2713'; // Single tick for sent
        statusEl.title = 'Sent but not opened yet';
      }

      // Insert after email span
      emailSpan.parentNode.insertBefore(statusEl, emailSpan.nextSibling);

      var intelBtn = document.createElement('button');
      intelBtn.type = 'button';
      intelBtn.setAttribute('data-thread-intel', tracker.id);
      intelBtn.setAttribute('aria-label', 'Thread intelligence');
      intelBtn.textContent = '\u2139';
      intelBtn.style.cssText = 'display:inline-block;margin-left:4px;width:16px;height:16px;padding:0;border:none;background:transparent;color:#2563eb;cursor:pointer;font-size:12px;line-height:16px;vertical-align:middle;';
      intelBtn.title = 'Thread intelligence';
      intelBtn.addEventListener('click', function(ev) {
        ev.stopPropagation();
        ev.preventDefault();
        fetchRecipientInfoExt(email).then(function(ri) {
          showThreadIntelCard(tracker, ri, intelBtn);
        });
      });
      statusEl.parentNode.insertBefore(intelBtn, statusEl.nextSibling);

      console.log(LOG, 'Added indicator for tracked email:', email);
    });
  }

  var lastThreadIntelRun = 0;

  async function injectThreadIntelligence() {
    var now = Date.now();
    if (now - lastThreadIntelRun < 5000) return;
    lastThreadIntelRun = now;
    if (!serverUrl || !dashboardPassword) return;
    // Only run in sent folder or when viewing a thread
    if (!location.hash.startsWith('#sent') && !document.querySelector('div[role="list"]')) return;
    var trackers = await getTrackingData();
    document.querySelectorAll('div[role="listitem"] span[email]').forEach(function(span) {
      var email = span.getAttribute('email');
      if (!email) return;
      var host = span.closest('div[role="listitem"]');
      if (!host || host.querySelector('[data-thread-intel]')) return;
      var matches = trackers.filter(function(t) { return t.recipient === email; });
      matches.sort(function(a, b) { return new Date(b.createdAt || 0) - new Date(a.createdAt || 0); });
      var tracker = matches[0] || null;
      if (!tracker) return;
      var intelBtn = document.createElement('button');
      intelBtn.type = 'button';
      intelBtn.setAttribute('data-thread-intel', tracker.id);
      intelBtn.setAttribute('aria-label', 'Thread intelligence');
      intelBtn.textContent = '\u2139';
      intelBtn.style.cssText = 'display:inline-block;margin-left:4px;width:16px;height:16px;padding:0;border:none;background:transparent;color:#2563eb;cursor:pointer;font-size:11px;line-height:16px;vertical-align:middle;';
      intelBtn.title = 'Thread intelligence';
      intelBtn.addEventListener('click', function(ev) {
        ev.stopPropagation();
        ev.preventDefault();
        fetchRecipientInfoExt(email).then(function(ri) {
          showThreadIntelCard(tracker, ri, intelBtn);
        });
      });
      span.parentNode.insertBefore(intelBtn, span.nextSibling);
    });
  }

  // Global flag for dropdown close listener (H9: prevent listener leak)
  let globalDropdownListenerAdded = false;

  // Sequence selector functions
  async function getTemplates() {
    if (!serverUrl) return [];
    try {
      const headers = {};
      if (dashboardPassword) {
        headers['Authorization'] = 'Basic ' + btoa(':' + dashboardPassword);
      }
      const res = await fetch(serverUrl + '/templates', { headers });
      if (!res.ok) return [];
      return await res.json();
    } catch { return []; }
  }

  function setSequenceBtnState(btn, svgEl, selected, tooltipText) {
    if (selected) {
      btn.style.background = 'rgba(59,130,246,0.12)';
      btn.style.borderRadius = '50%';
      svgEl.setAttribute('stroke', '#2563eb');
    } else {
      btn.style.background = 'transparent';
      svgEl.setAttribute('stroke', '#3b82f6');
    }
    btn.title = tooltipText;
  }

  // Spam checker word lists
  // Red: clearly spammy phrases — multi-word triggers that scream spam
  var SPAM_RED = [
    'buy now', 'act now', 'act fast', 'limited time offer', 'click here',
    'no obligation', 'risk-free', 'congratulations', 'you have been selected',
    'earn money', 'make money', 'earn cash', 'fast cash', 'double your',
    'lowest price', 'order now', 'subscribe now', 'no cost', 'no catch',
    '100% free', '100% guaranteed', 'money-back guarantee', 'free money',
    'get rich', 'work from home', 'be your own boss', 'financial freedom',
    'once in a lifetime', 'this isn\'t spam', 'not junk', 'as seen on',
    'multi-level marketing', 'no credit check', 'no hidden fees',
    'while supplies last', 'don\'t delete', 'apply now!', 'call now!',
    'miracle', 'secret formula', 'lose weight fast', 'anti-aging',
    'online casino', 'free chips', 'jackpot', 'lottery',
  ];
  // Orange: aggressive sales tactics — phrases that push too hard
  var SPAM_ORANGE = [
    'exclusive deal', 'special offer', 'limited time', 'act immediately',
    'don\'t miss', 'expires today', 'final call', 'hurry',
    'take action now', 'instant access', 'sign up free',
    'free trial', 'free consultation', 'free gift', 'free preview',
    'guaranteed results', 'incredible deal', 'unbelievable',
    'pure profit', 'potential earnings', 'increase sales',
    'no strings attached', 'cancel at any time',
  ];
  // Yellow: soft triggers — common words that are fine alone but worth noting
  // These are individual words that Salesforge-style checkers flag lightly
  var SPAM_YELLOW = [
    'free', 'guarantee', 'urgent', 'winner', 'bonus', 'discount',
    'profit', 'cash', 'earn', 'income', 'affordable', 'bargain',
    'giveaway', 'prize', 'instant', 'amazing', 'incredible',
    'millions', 'save', 'get', 'now', 'all',
  ];

  function findSpamWords(text, wordList) {
    var found = [];
    for (var i = 0; i < wordList.length; i++) {
      var word = wordList[i];
      var escaped = word.replace(/[.*+?^\\|(){}[\]]/g, function(c) { return '\\' + c; });
      var regex = new RegExp('\\b' + escaped + '\\b', 'gi');
      if (regex.test(text)) {
        found.push(word);
      }
    }
    return found;
  }

  function analyzeComposeSpam(composeForm) {
    var subjectEl = composeForm.querySelector('input[name="subjectbox"]') ||
      composeForm.querySelector('input[aria-label*="Subject"]');
    var subject = subjectEl ? subjectEl.value : '';

    var bodyEl = composeForm.querySelector('[contenteditable="true"][aria-label*="Message"]') ||
      composeForm.querySelector('[contenteditable="true"][role="textbox"]') ||
      composeForm.querySelector('[contenteditable="true"]');
    var bodyHtml = bodyEl ? bodyEl.innerHTML : '';

    // Strip Gmail signature from analysis (content after -- delimiter or inside .gmail_signature)
    var cleanHtml = bodyHtml
      .replace(/<div[^>]*class="[^"]*gmail_signature[^"]*"[^>]*>[\s\S]*$/i, '')  // Gmail signature div
      .replace(/(<br\s*\/?>|\s)*--\s*(<br\s*\/?>)[\s\S]*$/i, '');                 // -- delimiter and everything after

    var text = cleanHtml.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    var fullText = (subject + ' ' + text).toLowerCase();

    var plainText = fullText.replace(/\{\{([^}]*)\}\}/g, function(m, inner) {
      return inner.indexOf('|') !== -1 ? inner.split('|')[0] : inner;
    });
    var wordCount = plainText.split(/\s+/).filter(Boolean).length;

    var spintaxMatches = fullText.match(/\{\{[^}]+\}\}/g) || [];
    var spintaxPercent = wordCount > 0 ? Math.round((spintaxMatches.length / wordCount) * 100) : 0;

    var redFound = findSpamWords(fullText, SPAM_RED);
    var orangeFound = findSpamWords(fullText, SPAM_ORANGE);
    var yellowFound = findSpamWords(fullText, SPAM_YELLOW);

    // Count links/images only in the email body (excluding signature)
    var linkCount = (cleanHtml.match(/<a\b/gi) || []).length;
    var urlsInText = text.match(/https?:\/\/\S+/gi) || [];
    linkCount += urlsInText.length;
    var imageCount = (cleanHtml.match(/<img\b/gi) || []).length;
    var emojiCount;
    try {
      var emojiMatches = text.match(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu);
      emojiCount = emojiMatches ? emojiMatches.length : 0;
    } catch(_e) { emojiCount = 0; }

    var score = 0;
    score += redFound.length * 10;
    score += orangeFound.length * 5;
    score += yellowFound.length * 2;
    // Links: first link is free, 2nd adds 5, 3+ adds 10 each
    if (linkCount >= 3) score += 10 + (linkCount - 2) * 10;
    else if (linkCount === 2) score += 5;
    score += Math.max(0, imageCount * 10);
    score += Math.max(0, (emojiCount - 1) * 5);
    if (wordCount < 15 || wordCount > 150) score += 10;
    else if (wordCount < 25 || wordCount > 100) score += 5;
    if (spintaxPercent < 5 && wordCount > 10) score += 10;
    score = Math.min(100, score);

    return {
      score: score,
      red: redFound,
      orange: orangeFound,
      yellow: yellowFound,
      spintaxPercent: spintaxPercent,
      linkCount: linkCount,
      imageCount: imageCount,
      emojiCount: emojiCount,
      wordCount: wordCount
    };
  }

  function spamScoreColor(score) {
    if (score < 30) return '#22c55e';
    if (score <= 60) return '#eab308';
    return '#ef4444';
  }

  function spamSeverityColor(level) {
    if (level === 'green') return '#22c55e';
    if (level === 'yellow') return '#eab308';
    return '#ef4444';
  }

  function buildSpamPanel(composeForm) {
    var data = analyzeComposeSpam(composeForm);
    var panel = document.createElement('div');
    panel.className = 'gmail-spam-panel';
    panel.style.cssText = 'position:fixed;z-index:10000;width:280px;background:#ffffff;border:1px solid #dadce0;border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,0.15);padding:16px;font-family:Google Sans,Roboto,sans-serif;';

    // Close button
    var closeBtn = document.createElement('div');
    closeBtn.style.cssText = 'position:absolute;top:8px;right:10px;cursor:pointer;width:20px;height:20px;display:flex;align-items:center;justify-content:center;border-radius:50%;color:#6b7280;font-size:16px;line-height:1;';
    closeBtn.textContent = '\u00d7';
    closeBtn.addEventListener('mouseenter', function() { closeBtn.style.background = '#f3f4f6'; });
    closeBtn.addEventListener('mouseleave', function() { closeBtn.style.background = 'none'; });
    closeBtn.addEventListener('click', function() { panel.remove(); });
    panel.appendChild(closeBtn);

    // Title
    var title = document.createElement('div');
    title.style.cssText = 'font-size:13px;font-weight:600;color:#1f2937;margin-bottom:12px;';
    title.textContent = 'Spam Analysis';
    panel.appendChild(title);

    // Score ring
    var ringWrap = document.createElement('div');
    ringWrap.style.cssText = 'display:flex;align-items:center;gap:12px;margin-bottom:14px;';
    var ringSize = 64;
    var radius = 26;
    var circumference = 2 * Math.PI * radius;
    var dashLen = (data.score / 100) * circumference;
    var ringColor = spamScoreColor(data.score);

    var svgNS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width', String(ringSize));
    svg.setAttribute('height', String(ringSize));
    svg.setAttribute('viewBox', '0 0 ' + ringSize + ' ' + ringSize);

    var bgCircle = document.createElementNS(svgNS, 'circle');
    bgCircle.setAttribute('cx', String(ringSize / 2));
    bgCircle.setAttribute('cy', String(ringSize / 2));
    bgCircle.setAttribute('r', String(radius));
    bgCircle.setAttribute('fill', 'none');
    bgCircle.setAttribute('stroke', '#e5e7eb');
    bgCircle.setAttribute('stroke-width', '4');
    svg.appendChild(bgCircle);

    var fgCircle = document.createElementNS(svgNS, 'circle');
    fgCircle.setAttribute('cx', String(ringSize / 2));
    fgCircle.setAttribute('cy', String(ringSize / 2));
    fgCircle.setAttribute('r', String(radius));
    fgCircle.setAttribute('fill', 'none');
    fgCircle.setAttribute('stroke', ringColor);
    fgCircle.setAttribute('stroke-width', '4');
    fgCircle.setAttribute('stroke-dasharray', dashLen + ' ' + (circumference - dashLen));
    fgCircle.setAttribute('stroke-dashoffset', String(circumference * 0.25));
    fgCircle.setAttribute('stroke-linecap', 'round');
    svg.appendChild(fgCircle);

    var scoreText = document.createElementNS(svgNS, 'text');
    scoreText.setAttribute('x', String(ringSize / 2));
    scoreText.setAttribute('y', String(ringSize / 2 + 1));
    scoreText.setAttribute('text-anchor', 'middle');
    scoreText.setAttribute('dominant-baseline', 'middle');
    scoreText.setAttribute('fill', ringColor);
    scoreText.setAttribute('font-size', '15');
    scoreText.setAttribute('font-weight', '700');
    scoreText.setAttribute('font-family', 'inherit');
    scoreText.textContent = data.score + '%';
    svg.appendChild(scoreText);

    ringWrap.appendChild(svg);

    var ringLabel = document.createElement('div');
    ringLabel.style.cssText = 'font-size:12px;color:#6b7280;';
    ringLabel.textContent = data.score < 30 ? 'Low spam risk' : data.score <= 60 ? 'Moderate spam risk' : 'High spam risk';
    ringWrap.appendChild(ringLabel);
    panel.appendChild(ringWrap);

    // Metric row helper
    function addMetric(label, value, barPercent, severity, inverted) {
      var row = document.createElement('div');
      row.style.cssText = 'margin-bottom:10px;';
      var header = document.createElement('div');
      header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;';
      var lbl = document.createElement('span');
      lbl.style.cssText = 'font-size:11px;color:#6b7280;';
      lbl.textContent = label;
      header.appendChild(lbl);
      var val = document.createElement('span');
      val.style.cssText = 'font-size:11px;font-weight:600;color:' + spamSeverityColor(severity) + ';';
      val.textContent = String(value);
      header.appendChild(val);
      row.appendChild(header);

      var bar = document.createElement('div');
      bar.style.cssText = 'height:4px;border-radius:2px;background:linear-gradient(90deg,#22c55e 0%,#22c55e 33%,#eab308 33%,#eab308 66%,#ef4444 66%,#ef4444 100%);position:relative;';
      if (inverted) {
        bar.style.background = 'linear-gradient(90deg, #ef4444 0%, #ef4444 33%, #eab308 33%, #eab308 66%, #22c55e 66%, #22c55e 100%)';
      }
      var marker = document.createElement('div');
      marker.style.cssText = 'position:absolute;top:-2px;width:8px;height:8px;border-radius:50%;background:#1f2937;border:1.5px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.2);transform:translateX(-50%);left:' + Math.min(100, Math.max(0, barPercent)) + '%;';
      bar.appendChild(marker);
      row.appendChild(bar);
      return row;
    }

    // Spam Words
    var totalSpamWords = data.red.length + data.orange.length + data.yellow.length;
    var spamWordSeverity = data.red.length > 0 ? 'red' : data.orange.length > 0 ? 'yellow' : 'green';
    var spamBarPct = Math.min(100, totalSpamWords * 10);
    var spamMetric = addMetric('Spam Words', totalSpamWords, spamBarPct, spamWordSeverity);

    if (totalSpamWords > 0) {
      var tags = document.createElement('div');
      tags.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;';
      function addTags(words, bgColor) {
        for (var i = 0; i < words.length; i++) {
          var tag = document.createElement('span');
          tag.style.cssText = 'font-size:10px;padding:1px 6px;border-radius:8px;color:#fff;background:' + bgColor + ';';
          tag.textContent = words[i];
          tags.appendChild(tag);
        }
      }
      addTags(data.red, '#ef4444');
      addTags(data.orange, '#f97316');
      addTags(data.yellow, '#eab308');
      spamMetric.appendChild(tags);
    }
    panel.appendChild(spamMetric);

    // Spintax & Variables (inverted bar: higher is better)
    var spintaxSeverity = data.spintaxPercent >= 10 ? 'green' : data.spintaxPercent >= 5 ? 'yellow' : 'red';
    var spintaxBarPct = Math.min(100, data.spintaxPercent * 2.5);
    panel.appendChild(addMetric('Spintax & Variables', data.spintaxPercent + '%', spintaxBarPct, spintaxSeverity, true));

    // Links
    var linkSeverity = data.linkCount === 0 ? 'green' : data.linkCount <= 2 ? 'yellow' : 'red';
    panel.appendChild(addMetric('Links', data.linkCount, Math.min(100, data.linkCount * 25), linkSeverity));

    // Images
    var imgSeverity = data.imageCount === 0 ? 'green' : data.imageCount === 1 ? 'yellow' : 'red';
    panel.appendChild(addMetric('Images', data.imageCount, Math.min(100, data.imageCount * 35), imgSeverity));

    // Emojis
    var emojiSeverity = data.emojiCount <= 1 ? 'green' : data.emojiCount <= 3 ? 'yellow' : 'red';
    panel.appendChild(addMetric('Emojis', data.emojiCount, Math.min(100, data.emojiCount * 15), emojiSeverity));

    // Word Count (custom bar: red-yellow-green-yellow-red)
    var wcSeverity = (data.wordCount >= 25 && data.wordCount <= 100) ? 'green'
      : ((data.wordCount >= 15 && data.wordCount < 25) || (data.wordCount > 100 && data.wordCount <= 150)) ? 'yellow' : 'red';
    var wcBarPct = Math.min(100, (data.wordCount / 150) * 100);
    var wcMetric = addMetric('Word Count', '~' + data.wordCount, wcBarPct, wcSeverity);
    var wcBar = wcMetric.querySelector('div[style*="border-radius:2px"]');
    if (wcBar) {
      wcBar.style.background = 'linear-gradient(90deg, #ef4444 0%, #eab308 10%, #eab308 17%, #22c55e 17%, #22c55e 67%, #eab308 67%, #eab308 80%, #ef4444 80%, #ef4444 100%)';
    }
    panel.appendChild(wcMetric);

    // Recommendations
    var recs = [];
    if (data.red.length > 0) recs.push('Remove high-severity spam trigger words.');
    if (data.linkCount > 0) recs.push('Avoid hyperlinks \u2014 use plain text URLs instead.');
    if (data.imageCount > 0) recs.push('Minimize images to improve deliverability.');
    if (data.spintaxPercent < 5) recs.push('Add more spintax or variables for personalization.');
    if (data.wordCount < 25) recs.push('Email body is very short \u2014 add more context.');
    if (data.wordCount > 100) recs.push('Consider shortening your email for better engagement.');
    if (data.emojiCount > 3) recs.push('Reduce emoji usage to avoid spam filters.');

    if (recs.length > 0) {
      var recBox = document.createElement('div');
      recBox.style.cssText = 'margin-top:10px;padding:8px 10px;background:#fef9c3;border:1px solid #fde68a;border-radius:8px;font-size:10px;color:#92400e;line-height:1.4;';
      recBox.textContent = recs.join(' ');
      panel.appendChild(recBox);
    }

    return panel;
  }

  function toggleSpamPanel(composeForm, anchorEl) {
    var existing = document.querySelector('.gmail-spam-panel');
    if (existing) {
      existing.remove();
      return;
    }

    var panel = buildSpamPanel(composeForm);

    // Position above the anchor button, flip left if near right edge
    var rect = anchorEl.getBoundingClientRect();
    var panelWidth = 280;
    var leftPos = rect.left;
    if (leftPos + panelWidth > window.innerWidth - 16) {
      leftPos = Math.max(8, rect.right - panelWidth);
    }
    panel.style.left = Math.max(8, leftPos) + 'px';
    panel.style.bottom = (window.innerHeight - rect.top + 8) + 'px';

    document.body.appendChild(panel);

    // Close on outside click (one-time listener)
    function closeOnOutside(e) {
      if (!panel.contains(e.target) && !anchorEl.contains(e.target)) {
        panel.remove();
        document.removeEventListener('click', closeOnOutside, true);
      }
    }
    setTimeout(function() {
      document.addEventListener('click', closeOnOutside, true);
    }, 0);
  }

  async function fetchTrackerJson(trackerId) {
    if (!serverUrl) return null;
    try {
      var headers = {};
      if (dashboardPassword) headers['Authorization'] = 'Basic ' + btoa(':' + dashboardPassword);
      var res = await fetch(serverUrl + '/s/' + encodeURIComponent(trackerId) + '?format=json', { headers: headers });
      if (!res.ok) return null;
      return await res.json();
    } catch (_e) {
      return null;
    }
  }

  async function fetchRecipientInfoExt(email) {
    if (!serverUrl || !email) return null;
    try {
      var headers = {};
      if (dashboardPassword) headers['Authorization'] = 'Basic ' + btoa(':' + dashboardPassword);
      var defTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
      var url = serverUrl + '/recipient/info?email=' + encodeURIComponent(email) + '&defaultTimezone=' + encodeURIComponent(defTz);
      var res = await fetch(url, { headers: headers });
      if (!res.ok) return null;
      return await res.json();
    } catch (_e) {
      return null;
    }
  }

  function hourHistogram(events, recipientTz) {
    var tz = recipientTz || 'America/New_York';
    var counts = new Array(24).fill(0);
    if (!events) return counts;
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      if (!ev.time) continue;
      var d = new Date(ev.time);
      var parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', hour12: false }).formatToParts(d);
      var hp = parts.find(function(p) { return p.type === 'hour'; });
      var h = hp ? parseInt(hp.value, 10) : 0;
      if (h >= 0 && h <= 23) counts[h]++;
    }
    return counts;
  }

  function relativeTime(iso) {
    if (!iso) return '';
    var diff = Date.now() - new Date(iso).getTime();
    var mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    var days = Math.floor(hrs / 24);
    return days + 'd ago';
  }

  function expandThreadIntelCard(panel, trackerId, trackerSummary, recipientInfo, seqData) {
    var anchor = panel._anchorEl;
    panel.style.width = '400px';
    while (panel.firstChild) panel.removeChild(panel.firstChild);
    panel._anchorEl = anchor;

    var title = document.createElement('div');
    title.style.cssText = 'font-size:14px;font-weight:600;color:#111827;margin-bottom:10px;';
    title.textContent = 'Thread intelligence';
    panel.appendChild(title);

    if (seqData && seqData.steps) {
      var seqTitle = document.createElement('div');
      seqTitle.style.cssText = 'font-weight:600;margin-bottom:6px;font-size:12px;';
      seqTitle.textContent = 'Sequence progress';
      panel.appendChild(seqTitle);
      var dots = document.createElement('div');
      dots.style.cssText = 'display:flex;gap:4px;margin-bottom:10px;flex-wrap:wrap;';
      for (var s = 0; s < seqData.steps.length; s++) {
        var st = seqData.steps[s];
        var dot = document.createElement('span');
        dot.style.cssText = 'width:10px;height:10px;border-radius:50%;background:' + (st.status === 'sent' ? '#22c55e' : st.status === 'pending' ? '#eab308' : '#9ca3af') + ';';
        dot.title = 'Step ' + (s + 1) + ': ' + (st.status || '');
        dots.appendChild(dot);
      }
      panel.appendChild(dots);
    }

    var scroll = document.createElement('div');
    scroll.style.cssText = 'max-height:320px;overflow:auto;font-size:12px;color:#374151;';
    panel.appendChild(scroll);

    fetchTrackerJson(trackerId).then(function(full) {
      while (scroll.firstChild) scroll.removeChild(scroll.firstChild);
      if (!full || !full.events || full.events.length === 0) {
        var empty = document.createElement('div');
        empty.textContent = 'No open events yet.';
        scroll.appendChild(empty);
        return;
      }
      var tz = recipientInfo && recipientInfo.timezone ? recipientInfo.timezone : 'America/New_York';
      var hist = hourHistogram(full.events, tz);
      var maxBar = Math.max.apply(null, hist);
      if (maxBar === 0) maxBar = 1;

      var histTitle = document.createElement('div');
      histTitle.style.cssText = 'font-weight:600;margin-bottom:6px;';
      histTitle.textContent = 'Opens by hour';
      scroll.appendChild(histTitle);

      var rowWrap = document.createElement('div');
      for (var h = 0; h < 24; h++) {
        var row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:2px;';
        var lab = document.createElement('span');
        lab.style.cssText = 'width:28px;color:#6b7280;';
        lab.textContent = String(h);
        var barBg = document.createElement('div');
        barBg.style.cssText = 'flex:1;height:8px;background:#e5e7eb;border-radius:4px;overflow:hidden;';
        var barW = document.createElement('div');
        barW.style.cssText = 'height:100%;width:' + (maxBar ? (hist[h] / maxBar) * 100 : 0) + '%;background:#2563eb;';
        barBg.appendChild(barW);
        var cnt = document.createElement('span');
        cnt.style.cssText = 'width:20px;text-align:right;color:#6b7280;';
        cnt.textContent = String(hist[h]);
        row.appendChild(lab);
        row.appendChild(barBg);
        row.appendChild(cnt);
        rowWrap.appendChild(row);
      }
      scroll.appendChild(rowWrap);

      var tlTitle = document.createElement('div');
      tlTitle.style.cssText = 'font-weight:600;margin:12px 0 6px;';
      tlTitle.textContent = 'Timeline';
      scroll.appendChild(tlTitle);

      for (var i = full.events.length - 1; i >= 0; i--) {
        var ev = full.events[i];
        var line = document.createElement('div');
        line.style.cssText = 'border-bottom:1px solid #e5e7eb;padding:6px 0;';
        var t = ev.time ? new Date(ev.time).toLocaleString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' }) : '';
        var loc = [ev.city, ev.region, ev.country].filter(Boolean).join(', ');
        var dev = [ev.browser, ev.os, ev.device].filter(Boolean).join(' on ');
        line.textContent = t + (loc ? ' · ' + loc : '') + (dev ? ' · ' + dev : '') + (ev.isp ? ' · ' + ev.isp : '');
        scroll.appendChild(line);
      }
    });

    var foot = document.createElement('div');
    foot.style.cssText = 'margin-top:10px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;';
    var dash = document.createElement('a');
    dash.href = serverUrl + '/s/' + encodeURIComponent(trackerId);
    dash.target = '_blank';
    dash.rel = 'noopener';
    dash.style.cssText = 'color:#2563eb;font-size:12px;';
    dash.textContent = 'Open in dashboard';
    foot.appendChild(dash);
    var collapse = document.createElement('button');
    collapse.type = 'button';
    collapse.style.cssText = 'background:none;border:none;color:#2563eb;cursor:pointer;font-size:12px;';
    collapse.textContent = 'Collapse';
    collapse.addEventListener('click', function() {
      showThreadIntelCard(trackerSummary, recipientInfo, anchor);
    });
    foot.appendChild(collapse);
    panel.appendChild(foot);
  }

  function findSequenceForTracker(trackerId, callback) {
    if (!serverUrl) {
      callback(null);
      return;
    }
    var headers = {};
    if (dashboardPassword) headers['Authorization'] = 'Basic ' + btoa(':' + dashboardPassword);
    fetch(serverUrl + '/sequences', { headers: headers })
      .then(function(r) { return r.json(); })
      .then(function(seqs) {
        for (var i = 0; i < seqs.length; i++) {
          if (seqs[i].trackerId === trackerId) {
            callback(seqs[i]);
            return;
          }
        }
        callback(null);
      })
      .catch(function() { callback(null); });
  }

  function showThreadIntelCard(trackerSummary, recipientInfo, anchorEl) {
    var existing = document.querySelector('.mail-tracker-thread-intel-panel');
    if (existing) existing.remove();

    var panel = document.createElement('div');
    panel.className = 'mail-tracker-thread-intel-panel';
    panel._anchorEl = anchorEl;
    panel.style.cssText = 'position:fixed;z-index:100001;width:300px;background:#ffffff;border:1px solid #dadce0;border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,0.15);padding:14px;font-family:Google Sans,Roboto,sans-serif;';

    var big = document.createElement('div');
    big.style.cssText = 'font-size:28px;font-weight:700;color:#111827;';
    big.textContent = String(trackerSummary.opens || 0);
    panel.appendChild(big);

    var sub = document.createElement('div');
    sub.style.cssText = 'font-size:12px;color:#6b7280;margin-bottom:8px;';
    var last = trackerSummary.lastOpen;
    var loc = recipientInfo ? [recipientInfo.city, recipientInfo.state, recipientInfo.country].filter(Boolean).join(', ') : '';
    sub.textContent = 'Opens · Last: ' + (last ? relativeTime(last) : 'never') + (loc ? ' · ' + loc : '');
    panel.appendChild(sub);

    var devLine = document.createElement('div');
    devLine.style.cssText = 'font-size:12px;color:#374151;margin-bottom:8px;';
    devLine.textContent = 'Device: …';
    panel.appendChild(devLine);

    fetchTrackerJson(trackerSummary.id).then(function(full) {
      if (full && full.events && full.events.length) {
        var ev = full.events[full.events.length - 1];
        devLine.textContent = 'Device: ' + [ev.browser, ev.os, ev.device].filter(Boolean).join(' on ');
      }
    });

    var seqBadge = document.createElement('div');
    seqBadge.style.cssText = 'font-size:11px;display:inline-block;padding:2px 8px;border-radius:999px;background:#e0e7ff;color:#3730a3;margin-bottom:8px;';
    seqBadge.textContent = 'Checking sequence…';
    panel.appendChild(seqBadge);

    findSequenceForTracker(trackerSummary.id, function(found) {
      if (!found) {
        seqBadge.textContent = 'No sequence';
        seqBadge.style.background = '#f3f4f6';
        seqBadge.style.color = '#4b5563';
        return;
      }
      seqBadge.textContent = (found.status || 'active') + ' · step ' + (found.currentStep + 1) + '/' + (found.steps ? found.steps.length : '?');
    });

    if (recipientInfo && (recipientInfo.firstName || recipientInfo.lastName)) {
      var nameEl = document.createElement('div');
      nameEl.style.cssText = 'font-size:12px;color:#6b7280;margin-bottom:4px;';
      nameEl.textContent = [recipientInfo.firstName, recipientInfo.lastName].filter(Boolean).join(' ');
      panel.appendChild(nameEl);
    }

    var rec = document.createElement('div');
    rec.style.cssText = 'font-size:12px;color:#374151;margin-bottom:8px;';
    rec.textContent = recipientInfo ? [recipientInfo.company, recipientInfo.jobTitle].filter(Boolean).join(' \u00b7 ') : 'Loading recipient\u2026';
    panel.appendChild(rec);

    fetchRecipientInfoExt(trackerSummary.recipient).then(function(ri) {
      if (ri) {
        rec.textContent = [ri.company, ri.jobTitle].filter(Boolean).join(' \u00b7 ') || '\u2014';
        // Update name if not already shown
        if ((ri.firstName || ri.lastName) && !panel.querySelector('[data-recipient-name]')) {
          var nameEl2 = document.createElement('div');
          nameEl2.setAttribute('data-recipient-name', 'true');
          nameEl2.style.cssText = 'font-size:12px;color:#6b7280;margin-bottom:4px;';
          nameEl2.textContent = [ri.firstName, ri.lastName].filter(Boolean).join(' ');
          rec.parentNode.insertBefore(nameEl2, rec);
        }
      }
    });

    var expand = document.createElement('button');
    expand.type = 'button';
    expand.style.cssText = 'background:#2563eb;color:#fff;border:none;border-radius:8px;padding:6px 10px;font-size:12px;cursor:pointer;margin-right:8px;';
    expand.textContent = 'View full details';
    expand.addEventListener('click', function(e) {
      e.stopPropagation();
      fetchRecipientInfoExt(trackerSummary.recipient).then(function(ri) {
        findSequenceForTracker(trackerSummary.id, function(sq) {
          expandThreadIntelCard(panel, trackerSummary.id, trackerSummary, ri || recipientInfo, sq);
        });
      });
    });
    panel.appendChild(expand);

    var dashOpen = document.createElement('a');
    dashOpen.href = serverUrl + '/s/' + encodeURIComponent(trackerSummary.id);
    dashOpen.target = '_blank';
    dashOpen.rel = 'noopener';
    dashOpen.style.cssText = 'display:block;margin-top:6px;font-size:12px;color:#2563eb;';
    dashOpen.textContent = 'Open in dashboard';
    panel.appendChild(dashOpen);

    var close = document.createElement('button');
    close.type = 'button';
    close.style.cssText = 'position:absolute;top:8px;right:10px;background:none;border:none;color:#6b7280;font-size:16px;cursor:pointer;';
    close.textContent = '\u00d7';
    close.addEventListener('click', function() { panel.remove(); });
    panel.appendChild(close);

    var rect = anchorEl.getBoundingClientRect();
    var intelWidth = 320;
    var intelLeft = rect.left;
    if (intelLeft + intelWidth > window.innerWidth - 16) {
      intelLeft = Math.max(8, rect.right - intelWidth);
    }
    panel.style.left = Math.max(8, intelLeft) + 'px';
    panel.style.top = Math.min(window.innerHeight - 280, Math.max(8, rect.bottom + 8)) + 'px';

    document.body.appendChild(panel);

    var closeOutside = function(e) {
      if (!panel.contains(e.target) && !anchorEl.contains(e.target)) {
        panel.remove();
        document.removeEventListener('click', closeOutside, true);
      }
    };
    setTimeout(function() { document.addEventListener('click', closeOutside, true); }, 0);
  }

  // --- Compose Status Bar ---
  function createComposeStatusBar(composeForm) {
    var bar = document.createElement('div');
    bar.setAttribute('data-compose-status-bar', 'true');
    bar.style.cssText = 'background:#f8f9fa;border-top:1px solid #e2e5e9;border-bottom:1px solid #e2e5e9;padding:4px 12px;display:flex;align-items:center;justify-content:space-between;font-size:12px;font-family:Google Sans,Roboto,sans-serif;';

    // Left side: tracking toggle
    var leftSide = document.createElement('div');
    leftSide.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:pointer;';
    leftSide.setAttribute('data-status-tracking', 'true');

    var trackDot = document.createElement('span');
    trackDot.setAttribute('data-track-dot', 'true');
    trackDot.style.cssText = 'width:6px;height:6px;border-radius:50%;flex-shrink:0;';

    var trackLabel = document.createElement('span');
    trackLabel.setAttribute('data-track-label', 'true');
    trackLabel.style.cssText = 'color:#374151;user-select:none;';

    // Toggle switch
    var toggleTrack = document.createElement('div');
    toggleTrack.setAttribute('data-track-toggle', 'true');
    toggleTrack.style.cssText = 'width:28px;height:16px;border-radius:8px;position:relative;cursor:pointer;transition:background 0.2s;flex-shrink:0;';

    var toggleThumb = document.createElement('div');
    toggleThumb.style.cssText = 'width:12px;height:12px;border-radius:50%;background:#fff;position:absolute;top:2px;transition:left 0.2s;box-shadow:0 1px 2px rgba(0,0,0,0.2);';
    toggleTrack.appendChild(toggleThumb);

    function applyTrackingVisuals(isOn) {
      if (isOn) {
        trackDot.style.background = '#22c55e';
        trackLabel.textContent = 'Tracking';
        toggleTrack.style.background = '#22c55e';
        toggleThumb.style.left = '14px';
      } else {
        trackDot.style.background = '#9ca3af';
        trackLabel.textContent = 'Tracking off';
        toggleTrack.style.background = '#d1d5db';
        toggleThumb.style.left = '2px';
      }
    }

    // Determine initial state: per-compose override or global
    var isTrackingOn = !composeForm.hasAttribute('data-tracking-disabled') && trackingEnabled;
    applyTrackingVisuals(isTrackingOn);

    function handleToggle(ev) {
      ev.stopPropagation();
      var currentlyOn = !composeForm.hasAttribute('data-tracking-disabled') && trackingEnabled;
      if (currentlyOn) {
        // Turn off for THIS compose
        composeForm.setAttribute('data-tracking-disabled', 'true');
        applyTrackingVisuals(false);
      } else {
        // Turn on: remove per-compose override, ensure global is on
        composeForm.removeAttribute('data-tracking-disabled');
        trackingEnabled = true;
        chrome.storage.sync.set({ autoTrack: true });
        applyTrackingVisuals(true);
      }
    }

    leftSide.addEventListener('click', handleToggle);
    leftSide.appendChild(trackDot);
    leftSide.appendChild(trackLabel);
    leftSide.appendChild(toggleTrack);

    // Right side: sequence status
    var rightSide = document.createElement('div');
    rightSide.style.cssText = 'display:flex;align-items:center;gap:6px;';
    rightSide.setAttribute('data-status-sequence', 'true');

    var seqDot = document.createElement('span');
    seqDot.setAttribute('data-seq-dot', 'true');
    seqDot.style.cssText = 'width:6px;height:6px;border-radius:50%;background:#9ca3af;flex-shrink:0;';

    var seqLabel = document.createElement('span');
    seqLabel.setAttribute('data-seq-label', 'true');
    seqLabel.style.cssText = 'color:#6b7280;user-select:none;';
    seqLabel.textContent = 'No sequence';

    var seqClear = document.createElement('span');
    seqClear.setAttribute('data-seq-clear', 'true');
    seqClear.style.cssText = 'color:#9ca3af;cursor:pointer;font-size:14px;line-height:1;display:none;padding:0 2px;';
    seqClear.textContent = '\u00d7';
    seqClear.addEventListener('mouseenter', function() { seqClear.style.color = '#ef4444'; });
    seqClear.addEventListener('mouseleave', function() { seqClear.style.color = '#9ca3af'; });

    rightSide.appendChild(seqDot);
    rightSide.appendChild(seqLabel);
    rightSide.appendChild(seqClear);

    bar.appendChild(leftSide);
    bar.appendChild(rightSide);

    // Store refs for easy updates
    bar._applyTrackingVisuals = applyTrackingVisuals;

    return bar;
  }

  function updateComposeStatusBar(composeForm) {
    var bar = composeForm.querySelector('[data-compose-status-bar]');
    if (!bar) return;

    // Update tracking visuals
    var isTrackingOn = !composeForm.hasAttribute('data-tracking-disabled') && trackingEnabled;
    if (bar._applyTrackingVisuals) bar._applyTrackingVisuals(isTrackingOn);

    // Find the sequence button
    var seqBtn = composeForm.querySelector('[data-sequence-selector] button') ||
      (composeForm.closest('[role="dialog"]') || composeForm).querySelector('[data-sequence-selector] button');

    var seqDot = bar.querySelector('[data-seq-dot]');
    var seqLabel = bar.querySelector('[data-seq-label]');
    var seqClear = bar.querySelector('[data-seq-clear]');
    if (!seqDot || !seqLabel || !seqClear) return;

    var templateId = seqBtn ? seqBtn.getAttribute('data-selected-template') : '';
    var oneoffSteps = seqBtn ? seqBtn.getAttribute('data-oneoff-steps') : '';
    var scheduledAt = seqBtn ? seqBtn.getAttribute('data-scheduled-at') : '';

    // Remove old clear handler and set new one
    var newClear = seqClear.cloneNode(true);
    newClear.addEventListener('mouseenter', function() { newClear.style.color = '#ef4444'; });
    newClear.addEventListener('mouseleave', function() { newClear.style.color = '#9ca3af'; });
    seqClear.parentNode.replaceChild(newClear, seqClear);
    seqClear = newClear;

    if (scheduledAt) {
      // Show scheduled send info
      seqDot.style.background = '#3b82f6';
      var schedTz = seqBtn.getAttribute('data-scheduled-tz') || seqBtn.getAttribute('data-recipient-timezone') || Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
      seqLabel.textContent = formatScheduleLabel(scheduledAt, schedTz);
      seqLabel.style.color = '#3b82f6';
      seqLabel.style.fontWeight = '500';
      seqClear.style.display = 'inline';
      seqClear.addEventListener('click', function(ev) {
        ev.stopPropagation();
        if (seqBtn) {
          seqBtn.removeAttribute('data-scheduled-at');
          seqBtn.removeAttribute('data-recipient-timezone');
          seqBtn.removeAttribute('data-timezone-source');
          seqBtn.removeAttribute('data-scheduled-tz');
          var svg = seqBtn.querySelector('svg');
          var hasSeq = seqBtn.getAttribute('data-selected-template') || seqBtn.getAttribute('data-oneoff-steps');
          setSequenceBtnState(seqBtn, svg, !!hasSeq, hasSeq ? seqBtn.title : 'Select sequence');
        }
        updateComposeStatusBar(composeForm);
      });
    } else if (templateId) {
      seqDot.style.background = '#3b82f6';
      seqLabel.textContent = seqBtn.title || 'Template selected';
      seqLabel.style.color = '#3b82f6';
      seqLabel.style.fontWeight = '500';
      seqClear.style.display = 'inline';
      seqClear.addEventListener('click', function(ev) {
        ev.stopPropagation();
        if (seqBtn) {
          seqBtn.setAttribute('data-selected-template', '');
          seqBtn.setAttribute('data-oneoff-steps', '');
          var svg = seqBtn.querySelector('svg');
          setSequenceBtnState(seqBtn, svg, false, 'Select sequence');
        }
        updateComposeStatusBar(composeForm);
      });
    } else if (oneoffSteps) {
      var steps = [];
      try { steps = JSON.parse(oneoffSteps); } catch (_e) { /* ignore */ }
      var stepCount = steps.length;
      var totalDays = 0;
      for (var i = 0; i < steps.length; i++) totalDays += (steps[i].delayDays || 0);
      seqDot.style.background = '#3b82f6';
      seqLabel.textContent = 'One-off (' + stepCount + ' step' + (stepCount > 1 ? 's' : '') + ', ' + totalDays + 'd)';
      seqLabel.style.color = '#3b82f6';
      seqLabel.style.fontWeight = '500';
      seqClear.style.display = 'inline';
      seqClear.addEventListener('click', function(ev) {
        ev.stopPropagation();
        if (seqBtn) {
          seqBtn.setAttribute('data-selected-template', '');
          seqBtn.setAttribute('data-oneoff-steps', '');
          var svg = seqBtn.querySelector('svg');
          setSequenceBtnState(seqBtn, svg, false, 'Select sequence');
        }
        updateComposeStatusBar(composeForm);
      });
    } else {
      seqDot.style.background = '#9ca3af';
      seqLabel.textContent = 'No sequence';
      seqLabel.style.color = '#6b7280';
      seqLabel.style.fontWeight = 'normal';
      seqClear.style.display = 'none';
    }

    // Make sequence label clickable to open dropdown
    seqLabel.style.cursor = 'pointer';
    var newLabel = seqLabel.cloneNode(true);
    newLabel.style.cursor = 'pointer';
    newLabel.addEventListener('click', function(ev) {
      ev.stopPropagation();
      if (seqBtn) seqBtn.click();
    });
    seqLabel.parentNode.replaceChild(newLabel, seqLabel);
  }

  function injectSequenceSelector(composeForm) {
    if (!composeForm || composeForm.querySelector('[data-sequence-selector]')) return;

    const sendButton = composeForm.querySelector('div[role="button"][aria-label*="Send"], div[role="button"][data-tooltip*="Send"]');
    if (!sendButton) return;

    const container = document.createElement('div');
    container.setAttribute('data-sequence-selector', 'true');
    // Match Gmail's toolbar icon container (wG J-Z-I class pattern)
    container.style.cssText = 'display:inline-flex;align-items:center;position:relative;';

    const btn = document.createElement('div');
    // Match Gmail toolbar icon sizing and behavior
    btn.style.cssText = 'width:20px;height:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:5px;border-radius:50%;transition:background 0.15s;';
    btn.setAttribute('role', 'button');
    btn.setAttribute('tabindex', '1');
    btn.title = 'Select sequence';
    btn.setAttribute('data-selected-template', '');

    var svgNS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', '#3b82f6');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');

    // Paper airplane (send) icon
    var plane = document.createElementNS(svgNS, 'path');
    plane.setAttribute('d', 'M22 2L11 13');
    svg.appendChild(plane);
    var plane2 = document.createElementNS(svgNS, 'path');
    plane2.setAttribute('d', 'M22 2L15 22L11 13L2 9L22 2Z');
    svg.appendChild(plane2);

    // Small clock in bottom-right corner
    var clockCircle = document.createElementNS(svgNS, 'circle');
    clockCircle.setAttribute('cx', '19');
    clockCircle.setAttribute('cy', '19');
    clockCircle.setAttribute('r', '4.5');
    clockCircle.setAttribute('fill', 'white');
    clockCircle.setAttribute('stroke', '#3b82f6');
    clockCircle.setAttribute('stroke-width', '1.5');
    svg.appendChild(clockCircle);
    var clockHand1 = document.createElementNS(svgNS, 'line');
    clockHand1.setAttribute('x1', '19'); clockHand1.setAttribute('y1', '17');
    clockHand1.setAttribute('x2', '19'); clockHand1.setAttribute('y2', '19');
    clockHand1.setAttribute('stroke', '#3b82f6'); clockHand1.setAttribute('stroke-width', '1.5');
    svg.appendChild(clockHand1);
    var clockHand2 = document.createElementNS(svgNS, 'line');
    clockHand2.setAttribute('x1', '19'); clockHand2.setAttribute('y1', '19');
    clockHand2.setAttribute('x2', '20.5'); clockHand2.setAttribute('y2', '20');
    clockHand2.setAttribute('stroke', '#3b82f6'); clockHand2.setAttribute('stroke-width', '1.5');
    svg.appendChild(clockHand2);

    btn.appendChild(svg);

    const dropdown = document.createElement('div');
    dropdown.style.cssText = 'display:none;position:absolute;bottom:100%;right:0;background:#27272a;border:1px solid #52525b;border-radius:10px;padding:6px 0;min-width:220px;z-index:9999;margin-bottom:4px;box-shadow:0 4px 16px rgba(0,0,0,0.4);';

    btn.addEventListener('click', async function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (dropdown.style.display === 'block') {
        dropdown.style.display = 'none';
        return;
      }

      dropdown.textContent = '';
      const loadingDiv = document.createElement('div');
      loadingDiv.style.cssText = 'padding:8px 14px;color:#71717a;font-size:12px;';
      loadingDiv.textContent = 'Loading...';
      dropdown.appendChild(loadingDiv);
      dropdown.style.display = 'block';

      const templates = await getTemplates();
      dropdown.textContent = '';

      const schedHeader = document.createElement('div');
      schedHeader.style.cssText = 'padding:4px 14px;color:#71717a;font-size:11px;';
      schedHeader.textContent = 'SCHEDULE SEND';
      dropdown.appendChild(schedHeader);

      const optimizeRow = document.createElement('div');
      optimizeRow.style.cssText = 'padding:8px 14px;cursor:pointer;font-size:13px;color:#e4e4e7;display:flex;align-items:center;gap:6px;';
      const dotOpt = document.createElement('span');
      dotOpt.style.cssText = 'width:8px;height:8px;border-radius:50%;background:#9ca3af;flex-shrink:0;';
      optimizeRow.appendChild(dotOpt);
      const optLabel = document.createElement('span');
      optLabel.textContent = 'Optimize for recipient…';
      optimizeRow.appendChild(optLabel);
      optimizeRow.addEventListener('mouseenter', function() { optimizeRow.style.background = '#3f3f46'; });
      optimizeRow.addEventListener('mouseleave', function() { optimizeRow.style.background = 'none'; });
      dropdown.appendChild(optimizeRow);

      const pickRow = document.createElement('div');
      pickRow.style.cssText = 'padding:8px 14px;cursor:pointer;font-size:13px;color:#e4e4e7;';
      pickRow.textContent = 'Pick date & time';
      pickRow.addEventListener('mouseenter', function() { pickRow.style.background = '#3f3f46'; });
      pickRow.addEventListener('mouseleave', function() { pickRow.style.background = 'none'; });
      dropdown.appendChild(pickRow);

      const pickPanel = document.createElement('div');
      pickPanel.style.cssText = 'display:none;padding:8px 14px 10px;border-bottom:1px solid #3f3f46;';
      var pickLocal = document.createElement('input');
      pickLocal.type = 'datetime-local';
      pickLocal.style.cssText = 'width:100%;margin-bottom:8px;font-size:12px;padding:4px;border-radius:6px;border:1px solid #52525b;background:#18181b;color:#e4e4e7;';
      pickPanel.appendChild(pickLocal);
      var tzLab = document.createElement('label');
      tzLab.style.cssText = 'font-size:11px;color:#a1a1aa;display:block;margin-bottom:4px;';
      tzLab.textContent = 'Timezone';
      pickPanel.appendChild(tzLab);
      var tzSel = document.createElement('select');
      tzSel.style.cssText = 'width:100%;font-size:12px;padding:4px;border-radius:6px;margin-bottom:8px;background:#18181b;color:#e4e4e7;border:1px solid #52525b;';
      var zones = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Sao_Paulo', 'America/Mexico_City', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Africa/Johannesburg', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Shanghai', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney', 'Pacific/Auckland'];
      var userTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
      zones.forEach(function(z) {
        var o = document.createElement('option');
        o.value = z;
        o.textContent = z;
        if (z === userTz) o.selected = true;
        tzSel.appendChild(o);
      });
      if (zones.indexOf(userTz) === -1) {
        var o2 = document.createElement('option');
        o2.value = userTz;
        o2.textContent = userTz;
        o2.selected = true;
        tzSel.appendChild(o2);
      }
      pickPanel.appendChild(tzSel);
      var pickConfirm = document.createElement('button');
      pickConfirm.type = 'button';
      pickConfirm.textContent = 'Confirm schedule';
      pickConfirm.style.cssText = 'background:#3b82f6;color:#fff;border:none;border-radius:6px;padding:6px 10px;font-size:12px;cursor:pointer;width:100%;';
      pickConfirm.addEventListener('click', function(ev) {
        ev.stopPropagation();
        if (!pickLocal.value) {
          showToast('Pick a date and time');
          return;
        }
        // Parse the datetime-local value as components
        var parts = pickLocal.value.split('T');
        var dateParts = parts[0].split('-');
        var timeParts = parts[1].split(':');
        var year = parseInt(dateParts[0]);
        var month = parseInt(dateParts[1]) - 1;
        var day = parseInt(dateParts[2]);
        var hour = parseInt(timeParts[0]);
        var minute = parseInt(timeParts[1]) || 0;
        var selectedTz = tzSel.value;

        if (isNaN(year) || isNaN(month) || isNaN(day) || isNaN(hour)) {
          showToast('Invalid date/time');
          return;
        }

        // Create a date in the selected timezone by finding the UTC offset
        var formatter = new Intl.DateTimeFormat('en-US', {
          timeZone: selectedTz,
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', hour12: false
        });

        // Start with a rough UTC estimate
        var rough = new Date(Date.UTC(year, month, day, hour, minute));
        // Check what local time this produces in the target TZ
        var localParts = formatter.formatToParts(rough);
        var localHour = parseInt(localParts.find(function(p) { return p.type === 'hour'; }).value);
        var localMinute = parseInt(localParts.find(function(p) { return p.type === 'minute'; }).value);
        var localDay = parseInt(localParts.find(function(p) { return p.type === 'day'; }).value);

        // Compute the offset and adjust
        var hourDiff = localHour - hour;
        var minuteDiff = localMinute - minute;
        var dayDiff = localDay - day;
        var adjustMs = (hourDiff * 3600000) + (minuteDiff * 60000) + (dayDiff * 86400000);
        var corrected = new Date(rough.getTime() - adjustMs);

        btn.setAttribute('data-scheduled-at', corrected.toISOString());
        btn.setAttribute('data-scheduled-tz', selectedTz);
        btn.setAttribute('data-recipient-timezone', selectedTz);
        btn.setAttribute('data-timezone-source', 'manual');
        dropdown.style.display = 'none';
        showToast('Click Send to schedule for ' + formatScheduleLabel(corrected.toISOString(), selectedTz));
        updateComposeStatusBar(composeForm);
      });
      pickPanel.appendChild(pickConfirm);
      dropdown.appendChild(pickPanel);

      pickRow.addEventListener('click', function(ev) {
        ev.stopPropagation();
        pickPanel.style.display = pickPanel.style.display === 'none' ? 'block' : 'none';
      });

      var recs = getRecipients(composeForm);
      if (recs.length > 0 && serverUrl) {
        fetch(serverUrl + '/recipient/info?email=' + encodeURIComponent(recs[0]), { headers: authHeadersBasicOnly() })
          .then(function(r) { return r.ok ? r.json() : null; })
          .then(function(info) {
            if (!info) return;
            var tz = info.timezone || 'America/New_York';
            var hour = info.optimalSendTime && info.optimalSendTime.hour != null ? info.optimalSendTime.hour : 9;
            var iso = computeNextBusinessSendAt(hour, tz);
            var src = info.timezoneSource || 'default';
            if (src === 'hubspot') dotOpt.style.background = '#22c55e';
            else if (src === 'tld' || src === 'open_history') dotOpt.style.background = '#eab308';
            else dotOpt.style.background = '#9ca3af';
            optLabel.textContent = 'Optimize for recipient — ' + formatScheduleLabel(iso, tz);
            optimizeRow.setAttribute('data-sched-iso', iso);
            optimizeRow.setAttribute('data-sched-tz', tz);
            optimizeRow.setAttribute('data-sched-info', JSON.stringify(info));
          })
          .catch(function() {});
      }

      optimizeRow.addEventListener('click', function(ev) {
        ev.stopPropagation();
        var schedIso = optimizeRow.getAttribute('data-sched-iso');
        if (!schedIso) {
          showToast('Recipient timezone not loaded yet \u2014 try again');
          return;
        }
        var schedTz = optimizeRow.getAttribute('data-sched-tz') || '';
        var schedInfoStr = optimizeRow.getAttribute('data-sched-info');
        var schedInfo = schedInfoStr ? JSON.parse(schedInfoStr) : null;
        btn.setAttribute('data-scheduled-at', schedIso);
        btn.setAttribute('data-recipient-timezone', schedTz);
        btn.setAttribute('data-timezone-source', schedInfo && schedInfo.timezoneSource ? schedInfo.timezoneSource : '');
        dropdown.style.display = 'none';
        showToast('Click Send to schedule for ' + formatScheduleLabel(schedIso, schedTz));
        updateComposeStatusBar(composeForm);
      });

      const sendNowRow = document.createElement('div');
      sendNowRow.style.cssText = 'padding:8px 14px;cursor:pointer;font-size:13px;color:#e4e4e7;';
      sendNowRow.textContent = 'Send now';
      sendNowRow.addEventListener('mouseenter', function() { sendNowRow.style.background = '#3f3f46'; });
      sendNowRow.addEventListener('mouseleave', function() { sendNowRow.style.background = 'none'; });
      sendNowRow.addEventListener('click', function(ev) {
        ev.stopPropagation();
        btn.removeAttribute('data-scheduled-at');
        btn.removeAttribute('data-recipient-timezone');
        btn.removeAttribute('data-timezone-source');
        dropdown.style.display = 'none';
        updateComposeStatusBar(composeForm);
      });
      dropdown.appendChild(sendNowRow);

      const schedDivider = document.createElement('div');
      schedDivider.style.cssText = 'border-top:1px solid #3f3f46;margin:4px 0;';
      dropdown.appendChild(schedDivider);

      const noSeq = document.createElement('div');
      noSeq.style.cssText = 'padding:8px 14px;cursor:pointer;font-size:13px;color:#e4e4e7;';
      noSeq.textContent = 'No sequence';
      noSeq.addEventListener('click', function() {
        btn.setAttribute('data-selected-template', '');
        btn.setAttribute('data-oneoff-steps', '');
        btn.removeAttribute('data-scheduled-at');
        btn.removeAttribute('data-recipient-timezone');
        btn.removeAttribute('data-timezone-source');
        setSequenceBtnState(btn, svg, false, 'Select sequence');
        dropdown.style.display = 'none';
        updateComposeStatusBar(composeForm);
      });
      noSeq.addEventListener('mouseenter', function() { noSeq.style.background = '#3f3f46'; });
      noSeq.addEventListener('mouseleave', function() { noSeq.style.background = 'none'; });
      dropdown.appendChild(noSeq);

      if (templates.length > 0) {
        const divider = document.createElement('div');
        divider.style.cssText = 'border-top:1px solid #3f3f46;margin:4px 0;';
        dropdown.appendChild(divider);

        const sectionLabel = document.createElement('div');
        sectionLabel.style.cssText = 'padding:4px 14px;color:#71717a;font-size:11px;';
        sectionLabel.textContent = 'TEMPLATES';
        dropdown.appendChild(sectionLabel);

        templates.forEach(function(tmpl) {
          const item = document.createElement('div');
          item.style.cssText = 'padding:8px 14px;cursor:pointer;font-size:13px;color:#e4e4e7;';
          item.textContent = tmpl.name + ' (' + tmpl.steps.length + ' steps)';
          item.addEventListener('click', function() {
            btn.setAttribute('data-selected-template', tmpl.id);
            btn.setAttribute('data-oneoff-steps', '');
            setSequenceBtnState(btn, svg, true, tmpl.name);
            dropdown.style.display = 'none';
            updateComposeStatusBar(composeForm);
          });
          item.addEventListener('mouseenter', function() { item.style.background = '#3f3f46'; });
          item.addEventListener('mouseleave', function() { item.style.background = 'none'; });
          dropdown.appendChild(item);
        });
      }

      // One-off follow-up option
      const divider2 = document.createElement('div');
      divider2.style.cssText = 'border-top:1px solid #3f3f46;margin:4px 0;';
      dropdown.appendChild(divider2);

      const oneOff = document.createElement('div');
      oneOff.style.cssText = 'padding:8px 14px;cursor:pointer;font-size:13px;color:#a5b4fc;';
      oneOff.textContent = '+ One-off follow-up...';
      oneOff.addEventListener('mouseenter', function() { oneOff.style.background = '#3f3f46'; });
      oneOff.addEventListener('mouseleave', function() { oneOff.style.background = 'none'; });
      oneOff.addEventListener('click', function() {
        dropdown.style.display = 'none';
        showOneOffBuilder(container, btn, svg);
      });
      dropdown.appendChild(oneOff);
    });

    if (!globalDropdownListenerAdded) {
      document.addEventListener('click', function(e) {
        document.querySelectorAll('[data-sequence-selector]').forEach(function(sel) {
          if (!sel.contains(e.target)) {
            var dd = sel.querySelector('div[style*="position:absolute"]');
            if (dd) dd.style.display = 'none';
          }
        });
      });
      globalDropdownListenerAdded = true;
    }

    // Add hover effect matching Gmail toolbar style
    btn.addEventListener('mouseenter', function() {
      if (!btn.getAttribute('data-selected-template') && !btn.getAttribute('data-oneoff-steps')) {
        btn.style.background = 'rgba(0,0,0,0.06)';
      }
    });
    btn.addEventListener('mouseleave', function() {
      var hasSelection = btn.getAttribute('data-selected-template') || btn.getAttribute('data-oneoff-steps');
      if (!hasSelection) btn.style.background = 'transparent';
    });

    container.appendChild(btn);
    container.appendChild(dropdown);

    // Place in Gmail's compose toolbar (div.bAK) — the row with attach, link, emoji icons.
    // This is in a separate td from the Send button, so no overlap.
    const toolbarDiv = composeForm.querySelector('div.bAK');
    if (toolbarDiv) {
      toolbarDiv.appendChild(container);
    } else {
      // Fallback: find the toolbar td (td.a8X) or the td after Send's td
      const sendTd = sendButton.closest('td');
      const toolbarTd = composeForm.querySelector('td.a8X') ||
                        (sendTd ? sendTd.nextElementSibling?.nextElementSibling?.nextElementSibling : null);
      if (toolbarTd) {
        const innerDiv = toolbarTd.querySelector('div') || toolbarTd;
        innerDiv.appendChild(container);
      } else {
        // Last resort: after Send's parent td with separator
        container.style.marginLeft = '8px';
        container.style.borderLeft = '1px solid #dadce0';
        container.style.paddingLeft = '8px';
        if (sendTd && sendTd.parentElement) {
          sendTd.parentElement.appendChild(container);
        }
      }
    }

    // Inject Spam Check button next to the sequence selector
    var spamContainer = document.createElement('div');
    spamContainer.setAttribute('data-spam-checker', 'true');
    spamContainer.style.cssText = 'display:inline-flex;align-items:center;position:relative;';

    var spamBtn = document.createElement('div');
    spamBtn.style.cssText = 'width:20px;height:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:5px;border-radius:50%;transition:background 0.15s;';
    spamBtn.setAttribute('role', 'button');
    spamBtn.setAttribute('tabindex', '1');
    spamBtn.title = 'Check email for spam';

    // Shield icon SVG (blue)
    var spamSvgNS = 'http://www.w3.org/2000/svg';
    var spamSvg = document.createElementNS(spamSvgNS, 'svg');
    spamSvg.setAttribute('width', '18');
    spamSvg.setAttribute('height', '18');
    spamSvg.setAttribute('viewBox', '0 0 24 24');
    spamSvg.setAttribute('fill', 'none');
    spamSvg.setAttribute('stroke', '#3b82f6');
    spamSvg.setAttribute('stroke-width', '2');
    spamSvg.setAttribute('stroke-linecap', 'round');
    spamSvg.setAttribute('stroke-linejoin', 'round');

    var shieldPath = document.createElementNS(spamSvgNS, 'path');
    shieldPath.setAttribute('d', 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z');
    spamSvg.appendChild(shieldPath);

    // Checkmark inside the shield
    var checkPath = document.createElementNS(spamSvgNS, 'path');
    checkPath.setAttribute('d', 'M9 12l2 2 4-4');
    spamSvg.appendChild(checkPath);

    spamBtn.appendChild(spamSvg);

    spamBtn.addEventListener('mouseenter', function() { spamBtn.style.background = 'rgba(0,0,0,0.06)'; });
    spamBtn.addEventListener('mouseleave', function() { spamBtn.style.background = 'transparent'; });

    spamBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      toggleSpamPanel(composeForm, spamContainer);
    });

    spamContainer.appendChild(spamBtn);

    // Append to the same toolbar target as the sequence selector
    var spamTarget = container.parentElement;
    if (spamTarget) {
      spamTarget.appendChild(spamContainer);
    }

    // Inject compose status bar if not already present
    if (!composeForm.querySelector('[data-compose-status-bar]')) {
      var statusBar = createComposeStatusBar(composeForm);
      var composeBody = composeForm.querySelector('[contenteditable="true"][aria-label*="Message"]') ||
        composeForm.querySelector('[contenteditable="true"][role="textbox"]');
      var toolbarRowBtC = composeForm.querySelector('tr.btC');
      if (composeBody && toolbarRowBtC) {
        toolbarRowBtC.parentElement.insertBefore(statusBar, toolbarRowBtC);
      } else if (composeBody) {
        // Fallback: insert after compose body's parent
        var bodyParent = composeBody.closest('div[class]') || composeBody.parentElement;
        if (bodyParent && bodyParent.parentElement) {
          bodyParent.parentElement.insertBefore(statusBar, bodyParent.nextSibling);
        }
      }
      // Initial update
      updateComposeStatusBar(composeForm);
    }
  }

  function _insertTextAtCursor(textarea, text) {
    var start = textarea.selectionStart;
    var end = textarea.selectionEnd;
    var val = textarea.value;
    textarea.value = val.substring(0, start) + text + val.substring(end);
    textarea.selectionStart = textarea.selectionEnd = start + text.length;
    textarea.focus();
  }

  function _wrapSelectionWith(textarea, openTag, closeTag) {
    var start = textarea.selectionStart;
    var end = textarea.selectionEnd;
    var val = textarea.value;
    var selected = val.substring(start, end);
    var replacement = openTag + selected + closeTag;
    textarea.value = val.substring(0, start) + replacement + val.substring(end);
    textarea.selectionStart = start + openTag.length;
    textarea.selectionEnd = start + openTag.length + selected.length;
    textarea.focus();
  }

  function _getComposeData(container) {
    var form = container.closest('[role="dialog"]') || container.closest('.nH') || container.closest('form');
    var recipient = '';
    var subject = '';
    if (form) {
      var emailEl = form.querySelector('span[email]');
      if (emailEl) recipient = emailEl.getAttribute('email') || '';
      var subEl = form.querySelector('input[name="subjectbox"]') ||
                  form.querySelector('input[aria-label*="Subject"]');
      if (subEl) subject = subEl.value || '';
    }
    var firstName = recipient.split('@')[0] || '';
    firstName = firstName.charAt(0).toUpperCase() + firstName.slice(1);
    var domain = recipient.includes('@') ? recipient.split('@')[1] : '';
    var companyParts = domain.split('.');
    var company = companyParts.length > 1 ? companyParts.slice(0, -1).join(' ') : companyParts[0] || '';
    company = company.replace(/[-_]/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
    return { recipient: recipient, subject: subject, firstName: firstName, company: company };
  }

  function _substituteVariables(text, data) {
    return text
      .replace(/\{\{firstName\}\}/g, data.firstName)
      .replace(/\{\{company\}\}/g, data.company || '')
      .replace(/\{\{subject\}\}/g, data.subject)
      .replace(/\{\{daysSince\}\}/g, '0');
  }

  function _buildStepUI(stepIndex, stepsContainer, _allStepsData, _maxSteps) {
    var stepDiv = document.createElement('div');
    stepDiv.setAttribute('data-step-index', String(stepIndex));
    if (stepIndex > 0) {
      stepDiv.style.cssText = 'border-top:1px solid #e2e5e9;padding-top:10px;margin-top:10px;';
    }

    var stepHeader = document.createElement('div');
    stepHeader.style.cssText = 'font-weight:600;font-size:12px;color:#1f2937;margin-bottom:6px;';
    stepHeader.textContent = 'Step ' + (stepIndex + 1);
    stepDiv.appendChild(stepHeader);

    // Delay
    var delayLabel = document.createElement('label');
    delayLabel.style.cssText = 'color:#6b7280;font-size:11px;display:block;margin-bottom:2px;';
    delayLabel.textContent = 'Send after (days):';
    stepDiv.appendChild(delayLabel);
    var delayInput = document.createElement('input');
    delayInput.type = 'number';
    delayInput.min = '1';
    delayInput.max = '90';
    delayInput.value = stepIndex === 0 ? '2' : String((stepIndex + 1) * 2);
    delayInput.style.cssText = 'background:white;color:#1f2937;border:1px solid #d1d5db;border-radius:6px;padding:4px 8px;width:60px;margin-bottom:8px;display:block;font-size:12px;';
    stepDiv.appendChild(delayInput);

    // Subject
    var subLabel = document.createElement('label');
    subLabel.style.cssText = 'color:#6b7280;font-size:11px;display:block;margin-bottom:2px;';
    subLabel.textContent = 'Subject:';
    stepDiv.appendChild(subLabel);
    var subInput = document.createElement('input');
    subInput.type = 'text';
    subInput.placeholder = 'Re: {{subject}}';
    subInput.style.cssText = 'background:white;color:#1f2937;border:1px solid #d1d5db;border-radius:6px;padding:4px 8px;width:100%;margin-bottom:8px;display:block;box-sizing:border-box;font-size:12px;';
    stepDiv.appendChild(subInput);

    // Body label
    var bodyLabel = document.createElement('label');
    bodyLabel.style.cssText = 'color:#6b7280;font-size:11px;display:block;margin-bottom:2px;';
    bodyLabel.textContent = 'Body:';
    stepDiv.appendChild(bodyLabel);

    // Variable pills row
    var pillRow = document.createElement('div');
    pillRow.style.cssText = 'display:flex;gap:4px;margin-bottom:4px;flex-wrap:wrap;';
    var variables = ['{{firstName}}', '{{company}}', '{{subject}}', '{{daysSince}}'];
    var bodyTextarea = document.createElement('textarea');
    variables.forEach(function(v) {
      var pill = document.createElement('button');
      pill.type = 'button';
      pill.textContent = v;
      pill.style.cssText = 'background:#dbeafe;color:#3b82f6;border:none;border-radius:12px;padding:2px 8px;font-size:10px;cursor:pointer;font-family:inherit;';
      pill.addEventListener('click', function() {
        _insertTextAtCursor(bodyTextarea, v);
      });
      pillRow.appendChild(pill);
    });
    stepDiv.appendChild(pillRow);

    // Mini formatting toolbar
    var toolbarRow = document.createElement('div');
    toolbarRow.style.cssText = 'display:flex;gap:4px;margin-bottom:4px;';

    var boldBtn = document.createElement('button');
    boldBtn.type = 'button';
    boldBtn.textContent = 'B';
    boldBtn.style.cssText = 'background:white;color:#1f2937;border:1px solid #d1d5db;border-radius:4px;width:24px;height:24px;font-size:12px;font-weight:700;cursor:pointer;padding:0;line-height:24px;text-align:center;';
    boldBtn.addEventListener('click', function() {
      _wrapSelectionWith(bodyTextarea, '<b>', '</b>');
    });
    toolbarRow.appendChild(boldBtn);

    var italicBtn = document.createElement('button');
    italicBtn.type = 'button';
    italicBtn.textContent = 'I';
    italicBtn.style.cssText = 'background:white;color:#1f2937;border:1px solid #d1d5db;border-radius:4px;width:24px;height:24px;font-size:12px;font-style:italic;cursor:pointer;padding:0;line-height:24px;text-align:center;';
    italicBtn.addEventListener('click', function() {
      _wrapSelectionWith(bodyTextarea, '<i>', '</i>');
    });
    toolbarRow.appendChild(italicBtn);

    // Preview toggle button
    var previewToggle = document.createElement('button');
    previewToggle.type = 'button';
    previewToggle.textContent = 'Preview';
    previewToggle.style.cssText = 'background:none;color:#3b82f6;border:none;font-size:11px;cursor:pointer;margin-left:auto;padding:2px 4px;';
    toolbarRow.appendChild(previewToggle);

    stepDiv.appendChild(toolbarRow);

    // Body textarea
    bodyTextarea.placeholder = 'Hi {{firstName}}, just following up...';
    bodyTextarea.style.cssText = 'background:white;color:#1f2937;border:1px solid #d1d5db;border-radius:6px;padding:6px 8px;width:100%;height:60px;margin-bottom:8px;display:block;resize:vertical;box-sizing:border-box;font-size:12px;font-family:inherit;';
    stepDiv.appendChild(bodyTextarea);

    // Preview div (hidden initially)
    var previewDiv = document.createElement('div');
    previewDiv.style.cssText = 'background:white;border:1px solid #d1d5db;border-radius:6px;padding:6px 8px;width:100%;min-height:60px;margin-bottom:8px;display:none;box-sizing:border-box;font-size:12px;color:#1f2937;white-space:pre-wrap;word-break:break-word;';
    stepDiv.appendChild(previewDiv);

    var isPreviewMode = false;
    previewToggle.addEventListener('click', function() {
      if (!isPreviewMode) {
        // Switch to preview
        var data = _getComposeData(stepsContainer);
        var raw = _substituteVariables(bodyTextarea.value, data);
        // Render preview safely using DOM
        previewDiv.textContent = '';
        // Parse simple HTML tags for preview: split on <b>, </b>, <i>, </i>
        var tempDiv = document.createElement('div');
        // Safe: we build text nodes from substituted content
        // For preview, render the raw text (with tags visible) as text content
        tempDiv.textContent = raw;
        previewDiv.appendChild(tempDiv);
        bodyTextarea.style.display = 'none';
        previewDiv.style.display = 'block';
        previewToggle.textContent = 'Edit';
        isPreviewMode = true;
      } else {
        // Switch back to edit
        bodyTextarea.style.display = 'block';
        previewDiv.style.display = 'none';
        previewToggle.textContent = 'Preview';
        isPreviewMode = false;
      }
    });

    // Stop conditions
    var stopDiv = document.createElement('div');
    stopDiv.style.cssText = 'margin-bottom:8px;display:flex;gap:12px;flex-wrap:wrap;';

    var replyCheck = document.createElement('input');
    replyCheck.type = 'checkbox';
    replyCheck.checked = true;
    replyCheck.id = 'stop-reply-' + stepIndex + '-' + Date.now();
    var replyLbl = document.createElement('label');
    replyLbl.style.cssText = 'font-size:11px;color:#6b7280;display:flex;align-items:center;gap:3px;cursor:pointer;';
    replyLbl.appendChild(replyCheck);
    replyLbl.appendChild(document.createTextNode('Stop on reply'));
    stopDiv.appendChild(replyLbl);

    var openCheck = document.createElement('input');
    openCheck.type = 'checkbox';
    openCheck.checked = false;
    openCheck.id = 'stop-open-' + stepIndex + '-' + Date.now();
    var openLbl = document.createElement('label');
    openLbl.style.cssText = 'font-size:11px;color:#6b7280;display:flex;align-items:center;gap:3px;cursor:pointer;';
    openLbl.appendChild(openCheck);
    openLbl.appendChild(document.createTextNode('Stop on open'));
    stopDiv.appendChild(openLbl);

    stepDiv.appendChild(stopDiv);

    // Store references for data collection
    stepDiv._delayInput = delayInput;
    stepDiv._subInput = subInput;
    stepDiv._bodyTextarea = bodyTextarea;
    stepDiv._replyCheck = replyCheck;
    stepDiv._openCheck = openCheck;

    return stepDiv;
  }

  function showOneOffBuilder(container, btn, svgEl) {
    var existing = container.parentElement.querySelector('.oneoff-builder');
    if (existing) existing.remove();

    var maxSteps = 3;

    var builder = document.createElement('div');
    builder.className = 'oneoff-builder';
    builder.style.cssText = 'background:#f8f9fa;border:1px solid #e2e5e9;border-radius:10px;padding:14px;margin-top:8px;font-size:12px;color:#1f2937;';

    var title = document.createElement('div');
    title.style.cssText = 'font-weight:600;margin-bottom:10px;color:#1f2937;font-size:13px;';
    title.textContent = 'One-off Follow-up';
    builder.appendChild(title);

    var stepsContainer = document.createElement('div');
    builder.appendChild(stepsContainer);

    // Add first step
    var firstStep = _buildStepUI(0, stepsContainer, [], maxSteps);
    stepsContainer.appendChild(firstStep);

    // "Add another step" link container
    var addStepRow = document.createElement('div');
    addStepRow.style.cssText = 'margin-top:6px;margin-bottom:10px;';

    var addStepLink = document.createElement('a');
    addStepLink.href = '#';
    addStepLink.textContent = '+ Add another step';
    addStepLink.style.cssText = 'color:#3b82f6;font-size:11px;text-decoration:none;';
    addStepLink.addEventListener('click', function(e) {
      e.preventDefault();
      var currentCount = stepsContainer.querySelectorAll('[data-step-index]').length;
      if (currentCount >= maxSteps) return;
      var newStep = _buildStepUI(currentCount, stepsContainer, [], maxSteps);
      stepsContainer.appendChild(newStep);
      // Update add-step visibility
      if (currentCount + 1 >= maxSteps) {
        addStepLink.style.display = 'none';
        dashboardLink.style.display = 'inline';
      }
    });
    addStepRow.appendChild(addStepLink);

    var dashboardLink = document.createElement('a');
    dashboardLink.href = serverUrl + '/templates/new';
    dashboardLink.target = '_blank';
    dashboardLink.rel = 'noopener';
    dashboardLink.textContent = 'Create full template in dashboard \u2192';
    dashboardLink.style.cssText = 'color:#3b82f6;font-size:11px;text-decoration:none;display:none;margin-left:8px;';
    addStepRow.appendChild(dashboardLink);

    builder.appendChild(addStepRow);

    // Button row
    var btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:6px;';

    var saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.textContent = 'Set';
    saveBtn.style.cssText = 'background:#3b82f6;color:white;border:none;padding:5px 14px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:500;';
    saveBtn.addEventListener('click', function() {
      var stepEls = stepsContainer.querySelectorAll('[data-step-index]');
      var steps = [];
      stepEls.forEach(function(stepEl) {
        var stopOn = [];
        if (stepEl._replyCheck && stepEl._replyCheck.checked) stopOn.push('reply');
        if (stepEl._openCheck && stepEl._openCheck.checked) stopOn.push('open');
        steps.push({
          delayDays: parseInt(stepEl._delayInput.value) || 2,
          subject: stepEl._subInput.value || 'Re: {{subject}}',
          body: stepEl._bodyTextarea.value || '',
          stopOn: stopOn,
        });
      });
      btn.setAttribute('data-selected-template', '');
      btn.setAttribute('data-oneoff-steps', JSON.stringify(steps));
      setSequenceBtnState(btn, svgEl, true, 'One-off follow-up');
      builder.remove();
      var builderForm = container.closest('[role="dialog"]') || container.closest('.nH') || container.closest('form');
      if (builderForm) updateComposeStatusBar(builderForm);
    });
    btnRow.appendChild(saveBtn);

    var cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = 'background:white;color:#6b7280;border:1px solid #d1d5db;padding:5px 14px;border-radius:6px;cursor:pointer;font-size:11px;';
    cancelBtn.addEventListener('click', function() { builder.remove(); });
    btnRow.appendChild(cancelBtn);
    builder.appendChild(btnRow);

    container.parentElement.insertBefore(builder, container.nextSibling);
  }

  // Initialize tracking
  if (window.location.hostname === 'mail.google.com') {
    console.log(LOG, 'Initializing...');
    setupSendInterception();
    
    // Detect view changes and fetch data only when needed
    let lastUrl = location.href;
    
    function isSentView() {
      return location.hash.startsWith('#sent');
    }

    function handleViewChange() {
      const newView = location.hash;

      // Detect entering sent folder (match #sent, #sent/, #sent?compose=, etc.)
      if (newView !== currentView && isSentView()) {
        currentView = newView;
        console.log(LOG, 'Entered sent folder, loading indicators');
        trackingDataCache = null;
        setTimeout(() => addInboxReadIndicators(), 1000);
      } else if (newView !== currentView) {
        currentView = newView;
      }
    }

    // Initial load - if already in sent
    if (isSentView()) {
      setTimeout(() => addInboxReadIndicators(), 1500);
    }

    // Refresh indicators periodically while in sent view
    setInterval(() => {
      if (isSentView()) {
        addInboxReadIndicators();
      }
    }, 30000); // Every 30 seconds
    
    // Watch for URL changes with polling instead of MutationObserver
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        handleViewChange();
      }

      // C3: Inject sequence selector into compose windows as they appear
      if (trackingEnabled) {
        const composeBodies = findComposeBodies();
        composeBodies.forEach(function(bodyEl) {
          const form = findComposeForm(bodyEl);
          if (form) injectSequenceSelector(form);
        });
      }

      injectThreadIntelligence();
    }, 1000);
  }

})();
