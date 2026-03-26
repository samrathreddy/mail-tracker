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

    const recipients = getRecipients(form);
    if (recipients.length === 0) return;

    const untracked = getUntrackedRecipients(bodyEl, recipients);
    if (untracked.length === 0) return;

    console.log(LOG, 'Found untracked recipients:', untracked);
    await injectTracker(bodyEl, untracked);

    // Create sequence if one was selected
    const seqBtn = form.querySelector('[data-sequence-selector] button');
    if (seqBtn) {
      const templateId = seqBtn.getAttribute('data-selected-template');
      const oneoffSteps = seqBtn.getAttribute('data-oneoff-steps');
      if (templateId || oneoffSteps) {
        const { subject, bodyPreview } = getEmailContent(form);
        const allRecipients = getRecipients(form);
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
                  variables: { subject: subject, originalBody: bodyPreview },
                  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                });
              }
              await fetch(serverUrl + '/sequences', {
                method: 'POST',
                headers: headers,
                body: seqBody,
              });
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

          const recipients = getRecipients(form);
          const untracked = getUntrackedRecipients(body, recipients);
          
          if (untracked.length > 0) {
            console.log(LOG, 'Injecting pixels for untracked recipients:', untracked);
            await processCompose(body);
            // Wait a bit for pixels to be added to DOM
            await new Promise(resolve => setTimeout(resolve, 500));
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
      btn.style.background = 'rgba(59,130,246,0.1)';
      svgEl.style.color = '#3b82f6';
    } else {
      btn.style.background = 'transparent';
      svgEl.style.color = '#5f6368';
    }
    btn.title = tooltipText;
  }

  function injectSequenceSelector(composeForm) {
    if (!composeForm || composeForm.querySelector('[data-sequence-selector]')) return;

    // Find the formatting toolbar row (contains Aa, attachment, emoji icons)
    const toolbar = composeForm.querySelector('tr.btC td.gU') ||
                    composeForm.querySelector('div[aria-label*="ormatting"]')?.parentElement ||
                    composeForm.querySelector('.bAK');

    // Fallback: find the Send button's parent row
    const sendButton = composeForm.querySelector('div[role="button"][aria-label*="Send"], div[role="button"][data-tooltip*="Send"]');
    if (!sendButton && !toolbar) return;

    const container = document.createElement('div');
    container.setAttribute('data-sequence-selector', 'true');
    container.style.cssText = 'display:inline-flex;align-items:center;position:relative;margin-left:4px;';

    const btn = document.createElement('button');
    btn.type = 'button';
    // Style to match Gmail's toolbar icons — transparent bg, subtle hover
    btn.style.cssText = 'background:transparent;border:none;border-radius:50%;width:28px;height:28px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;transition:background 0.15s;';
    btn.title = 'Select sequence';
    btn.setAttribute('data-selected-template', '');

    var svgNS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('fill', 'none');
    svg.style.color = '#94a3b8';

    // Three connected dots forming a vertical timeline
    var c1 = document.createElementNS(svgNS, 'circle');
    c1.setAttribute('cx', '8'); c1.setAttribute('cy', '3'); c1.setAttribute('r', '2');
    c1.setAttribute('fill', 'currentColor');
    var c2 = document.createElementNS(svgNS, 'circle');
    c2.setAttribute('cx', '8'); c2.setAttribute('cy', '8'); c2.setAttribute('r', '2');
    c2.setAttribute('fill', 'currentColor');
    var c3 = document.createElementNS(svgNS, 'circle');
    c3.setAttribute('cx', '8'); c3.setAttribute('cy', '13'); c3.setAttribute('r', '2');
    c3.setAttribute('fill', 'currentColor');
    var line1 = document.createElementNS(svgNS, 'line');
    line1.setAttribute('x1', '8'); line1.setAttribute('y1', '5');
    line1.setAttribute('x2', '8'); line1.setAttribute('y2', '6');
    line1.setAttribute('stroke', 'currentColor'); line1.setAttribute('stroke-width', '1.5');
    var line2 = document.createElementNS(svgNS, 'line');
    line2.setAttribute('x1', '8'); line2.setAttribute('y1', '10');
    line2.setAttribute('x2', '8'); line2.setAttribute('y2', '11');
    line2.setAttribute('stroke', 'currentColor'); line2.setAttribute('stroke-width', '1.5');

    svg.appendChild(c1);
    svg.appendChild(line1);
    svg.appendChild(c2);
    svg.appendChild(line2);
    svg.appendChild(c3);
    btn.appendChild(svg);

    const dropdown = document.createElement('div');
    dropdown.style.cssText = 'display:none;position:absolute;bottom:100%;left:0;background:#27272a;border:1px solid #52525b;border-radius:10px;padding:6px 0;min-width:220px;z-index:9999;margin-bottom:4px;box-shadow:0 4px 16px rgba(0,0,0,0.4);';

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

      const noSeq = document.createElement('div');
      noSeq.style.cssText = 'padding:8px 14px;cursor:pointer;font-size:13px;color:#e4e4e7;';
      noSeq.textContent = 'No sequence';
      noSeq.addEventListener('click', function() {
        btn.setAttribute('data-selected-template', '');
        btn.setAttribute('data-oneoff-steps', '');
        setSequenceBtnState(btn, svg, false, 'Select sequence');
        dropdown.style.display = 'none';
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

    // Try to insert in the formatting toolbar row (away from Send button)
    if (toolbar) {
      toolbar.appendChild(container);
    } else if (sendButton) {
      // Fallback: insert after send button with a separator
      container.style.marginLeft = '12px';
      container.style.borderLeft = '1px solid #dadce0';
      container.style.paddingLeft = '12px';
      sendButton.parentElement.insertBefore(container, sendButton.nextSibling);
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

      // C3: Inject sequence selector into compose windows as they appear
      if (trackingEnabled) {
        const composeBodies = findComposeBodies();
        composeBodies.forEach(function(bodyEl) {
          const form = findComposeForm(bodyEl);
          if (form) injectSequenceSelector(form);
        });
      }
    }, 1000);
  }

})();
