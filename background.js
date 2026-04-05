/**
 * Currenzy — background service worker
 *
 * Responsibilities:
 *  1. Fetch and cache daily exchange rates (free, no-key API).
 *  2. Respond to content-script requests for rates.
 *  3. Register the right-click context menu for manual conversions.
 */

const RATES_URL  = 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json';
const FALLBACK   = 'https://latest.currency-api.pages.dev/v1/currencies/usd.json';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// ── Rate fetching ──────────────────────────────────────────────────────────
async function fetchRates() {
  let data = null;
  for (const url of [RATES_URL, FALLBACK]) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      data = await res.json();
      break;
    } catch (e) {
      console.warn('[Currenzy] Fetch failed for', url, e.message);
    }
  }
  if (!data?.usd) { console.error('[Currenzy] Could not fetch rates.'); return; }
  await chrome.storage.local.set({
    rates:          data.usd,
    ratesDate:      data.date,
    ratesTimestamp: Date.now(),
  });
  console.log('[Currenzy] Rates updated —', data.date);
}

async function ensureFreshRates() {
  const { ratesTimestamp } = await chrome.storage.local.get('ratesTimestamp');
  if (!ratesTimestamp || Date.now() - ratesTimestamp > ONE_DAY_MS) await fetchRates();
}

// ── Lifecycle ──────────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  ensureFreshRates();
  registerContextMenu();
});
chrome.runtime.onStartup.addListener(ensureFreshRates);

// Refresh daily via alarm
chrome.alarms.create('refreshRates', { periodInMinutes: 24 * 60 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'refreshRates') fetchRates();
});

// ── Message handler ────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'getRates') {
    ensureFreshRates().then(() => {
      chrome.storage.local
        .get(['rates', 'ratesDate', 'ratesTimestamp'])
        .then(sendResponse);
    });
    return true; // keep channel open for async response
  }
  if (msg.type === 'reloadTab' && msg.tabId) {
    chrome.tabs.reload(msg.tabId);
  }
});

// ── Context menu ───────────────────────────────────────────────────────────
function registerContextMenu() {
  // Remove any existing menu items first to avoid duplicates on reload
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id:       'currenzy-convert',
      title:    '💱 Convert with Currenzy',
      contexts: ['selection'],
    });
  });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'currenzy-convert') return;
  if (!tab?.id) return;

  // Send the selected text to the content script for parsing and display.
  // The content script holds the full regex + rates and will render the modal.
  chrome.tabs.sendMessage(tab.id, {
    type: 'convertSelection',
    text: info.selectionText || '',
  }).catch(() => {
    // Content script might not be injected yet (e.g. chrome:// pages)
  });
});
