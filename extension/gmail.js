// Gmail content script — auto-injects tracking pixel on Send
// Strategy: Instead of intercepting the Send button (fragile, conflicts with other extensions),
// we inject the pixel as soon as the compose window has recipients + body content,
// and keep it updated. When Gmail sends, the pixel is already in the email.

(function () {
  const LOG = '[MailTracker]';
  let serverUrl = '';
  let trackingEnabled = true;

  // Load settings
  chrome.storage.sync.get(['serverUrl', 'autoTrack'], (result) => {
    serverUrl = result.serverUrl || '';
    trackingEnabled = result.autoTrack !== false;
    console.log(LOG, 'Loaded settings:', { serverUrl: serverUrl ? 'set' : 'empty', trackingEnabled });
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.serverUrl) serverUrl = changes.serverUrl.newValue || '';
    if (changes.autoTrack) trackingEnabled = changes.autoTrack.newValue !== false;
  });

  // Track which compose windows we've already processed
  const processedComposes = new WeakSet();

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

    // Method 4: Parse input values as fallback
    if (recipients.size === 0) {
      composeForm.querySelectorAll('input[name="to"], input[name="cc"], input[name="bcc"], input[aria-label="To"], input[aria-label="Cc"], input[aria-label="Bcc"]').forEach(input => {
        const val = input.value.trim();
        if (val) {
          val.split(/[,;]/).forEach(part => {
            const match = part.match(/[\w.+-]+@[\w.-]+\.\w+/);
            if (match) recipients.add(match[0].toLowerCase());
          });
        }
      });
    }

    return [...recipients];
  }

  // Find all compose body elements (contenteditable divs where you type the email)
  function findComposeBodies() {
    return document.querySelectorAll(
      'div[aria-label="Message Body"][contenteditable="true"], ' +
      'div[g_editable="true"][contenteditable="true"], ' +
      'div[contenteditable="true"][role="textbox"][aria-label="Message Body"]'
    );
  }

  // Find the compose form/container that wraps a compose body
  function findComposeForm(bodyEl) {
    let node = bodyEl;
    while (node) {
      // Gmail compose form element
      if (node.tagName === 'FORM') return node;
      // Dialog-based compose
      if (node.matches && node.matches('div[role="dialog"]')) return node;
      // Inline reply compose
      if (node.matches && node.matches('div.M9, div.AD, div.nH.Hd, table.IZ')) return node;
      // Generic: look for the element that contains both recipients and body
      if (node.querySelector && node.querySelector('span[email], [data-hovercard-id]')) {
        return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  // Find the recipient chip element in the compose form for a given email
  function findRecipientChip(form, email) {
    const selectors = [
      `span[email="${email}" i]`,
      `[data-hovercard-id="${email}" i]`,
      `[email="${email}" i]`
    ];
    for (const sel of selectors) {
      try {
        const el = form.querySelector(sel);
        if (el) return el;
      } catch (_) { /* skip invalid selectors */ }
    }
    return null;
  }

  // Create an SVG checkmark icon using DOM APIs (no innerHTML)
  function createCheckSvg() {
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 12 12');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', 'M2.5 6.5l2.5 2.5 5-5');
    svg.appendChild(path);
    return svg;
  }

  // Add a small tracking badge next to a recipient chip
  function addRecipientBadge(chip) {
    if (!chip || chip.querySelector('.mt-badge')) return;
    // Also check sibling
    if (chip.nextElementSibling && chip.nextElementSibling.classList.contains('mt-badge')) return;

    const badge = document.createElement('span');
    badge.className = 'mt-badge';
    badge.title = 'Tracking pixel attached';
    badge.appendChild(createCheckSvg());
    const label = document.createElement('span');
    label.textContent = 'Tracked';
    badge.appendChild(label);

    const parent = chip.parentElement;
    if (parent) {
      if (chip.nextSibling) {
        parent.insertBefore(badge, chip.nextSibling);
      } else {
        parent.appendChild(badge);
      }
    }
  }

  // Find the compose window's top-level container (the floating dialog box)
  function findComposeWindow(bodyEl) {
    let node = bodyEl;
    while (node) {
      // Gmail compose dialog: div[role="dialog"] or the outer .nH.Hd container
      if (node.matches && node.matches('div[role="dialog"]')) return node;
      // Compose popout window container
      if (node.classList && node.classList.contains('nH') && node.classList.contains('Hd')) return node;
      // The outermost compose table wrapper
      if (node.tagName === 'TABLE' && node.classList && node.classList.contains('IZ')) return node;
      node = node.parentElement;
    }
    return null;
  }

  // Add or update the compose banner showing tracking status
  function updateComposeBanner(bodyEl, trackedCount) {
    const composeWin = findComposeWindow(bodyEl) || findComposeForm(bodyEl);
    if (!composeWin) return;

    let banner = composeWin.querySelector('.mt-compose-banner');
    // Also check parent in case banner was placed above the window
    if (!banner && composeWin.parentElement) {
      banner = composeWin.parentElement.querySelector('.mt-compose-banner');
    }

    if (trackedCount === 0) {
      if (banner) banner.remove();
      return;
    }

    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'mt-compose-banner';
      // Insert directly above the compose window (above the title bar)
      const parent = composeWin.parentElement;
      if (parent) {
        parent.insertBefore(banner, composeWin);
      } else {
        composeWin.prepend(banner);
      }
    }

    // Clear and rebuild using DOM APIs
    while (banner.firstChild) banner.removeChild(banner.firstChild);

    const dot = document.createElement('span');
    dot.className = 'mt-dot';
    const text = document.createElement('span');
    text.textContent = 'Mail Tracker active \u2014 tracking ';
    const count = document.createElement('span');
    count.className = 'mt-count';
    count.textContent = trackedCount + ' recipient' + (trackedCount > 1 ? 's' : '');

    banner.appendChild(dot);
    banner.appendChild(text);
    banner.appendChild(count);
  }

  // Inject tracking pixel into a compose body for given recipients
  async function injectTracker(bodyEl, recipients) {
    if (!serverUrl || recipients.length === 0) return;

    const form = findComposeForm(bodyEl);
    let injectedCount = 0;

    for (const recipient of recipients) {
      try {
        const encoded = encodeURIComponent(recipient);
        const res = await fetch(`${serverUrl}/new?to=${encoded}`);
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

        bodyEl.appendChild(img);
        injectedCount++;
        console.log(LOG, 'Injected tracker for', recipient, '- id:', data.id);

        // Add badge next to recipient chip
        if (form) {
          const chip = findRecipientChip(form, recipient);
          addRecipientBadge(chip);
        }
      } catch (e) {
        console.warn(LOG, 'Error creating tracker for', recipient, e.message);
      }
    }

    // Update the compose banner with total tracked count
    if (injectedCount > 0) {
      const totalTracked = bodyEl.querySelectorAll('[data-mail-tracker]').length;
      updateComposeBanner(bodyEl, totalTracked);
    }
  }

  // Remove any previously injected trackers (in case recipients changed)
  function removeExistingTrackers(bodyEl) {
    bodyEl.querySelectorAll('[data-mail-tracker]').forEach(el => el.remove());
  }

  // Get recipients that don't already have a tracker
  function getUntrackedRecipients(bodyEl, recipients) {
    const tracked = new Set();
    bodyEl.querySelectorAll('[data-mail-tracker-to]').forEach(el => {
      tracked.add(el.getAttribute('data-mail-tracker-to'));
    });
    return recipients.filter(r => !tracked.has(r));
  }

  // Process a compose body: find recipients, inject pixel if needed
  async function processCompose(bodyEl) {
    if (!trackingEnabled || !serverUrl) return;

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

  // Periodically check compose windows for new recipients
  // This catches cases where recipients are added after compose opens
  function startComposeWatcher() {
    setInterval(() => {
      if (!trackingEnabled || !serverUrl) return;

      findComposeBodies().forEach(bodyEl => {
        if (processedComposes.has(bodyEl)) return;

        const form = findComposeForm(bodyEl);
        if (!form) return;

        const recipients = getRecipients(form);
        if (recipients.length > 0) {
          const untracked = getUntrackedRecipients(bodyEl, recipients);
          if (untracked.length > 0) {
            console.log(LOG, 'Compose watcher found new recipients:', untracked);
            injectTracker(bodyEl, untracked);
          }
        }
      });
    }, 3000); // check every 3 seconds
  }

  // Also inject when compose window first appears via MutationObserver
  function setupComposeObserver() {
    const observer = new MutationObserver((mutations) => {
      if (!trackingEnabled || !serverUrl) return;

      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue;

          // Check if this is or contains a compose body
          const bodies = node.matches && node.matches('div[contenteditable="true"]')
            ? [node]
            : (node.querySelectorAll ? [...node.querySelectorAll('div[aria-label="Message Body"][contenteditable="true"], div[g_editable="true"]')] : []);

          if (bodies.length > 0) {
            console.log(LOG, 'New compose window detected');
            // Delay to let Gmail populate recipients
            setTimeout(() => {
              bodies.forEach(body => processCompose(body));
            }, 1500);
          }
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Init
  console.log(LOG, 'Content script loaded on Gmail');

  // Wait for Gmail to fully load
  setTimeout(() => {
    console.log(LOG, 'Initializing...');
    setupSendInterception();
    setupComposeObserver();
    startComposeWatcher();

    // Process any already-open compose windows
    const existingBodies = findComposeBodies();
    if (existingBodies.length > 0) {
      console.log(LOG, 'Found', existingBodies.length, 'existing compose windows');
      existingBodies.forEach(body => processCompose(body));
    }
  }, 3000);
})();
