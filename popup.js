/**
 * Currenzy — popup script v2
 * Settings UI with geographic currency sections (collapsible).
 */

// ── Currency data organised by geography ──────────────────────────────────
const CURRENCY_GROUPS = [
  {
    id: 'popular', label: 'Popular', defaultOpen: true,
    currencies: [
      { code: 'USD', name: 'US Dollar',           flag: '🇺🇸' },
      { code: 'EUR', name: 'Euro',                flag: '🇪🇺' },
      { code: 'GBP', name: 'British Pound',       flag: '🇬🇧' },
      { code: 'JPY', name: 'Japanese Yen',        flag: '🇯🇵' },
      { code: 'CAD', name: 'Canadian Dollar',     flag: '🇨🇦' },
      { code: 'AUD', name: 'Australian Dollar',   flag: '🇦🇺' },
      { code: 'CHF', name: 'Swiss Franc',         flag: '🇨🇭' },
      { code: 'CNY', name: 'Chinese Yuan',        flag: '🇨🇳' },
      { code: 'SGD', name: 'Singapore Dollar',    flag: '🇸🇬' },
    ],
  },
  {
    id: 'asia', label: 'Asia Pacific', defaultOpen: false,
    currencies: [
      { code: 'KRW', name: 'South Korean Won',    flag: '🇰🇷' },
      { code: 'INR', name: 'Indian Rupee',        flag: '🇮🇳' },
      { code: 'VND', name: 'Vietnamese Dong',     flag: '🇻🇳' },
      { code: 'THB', name: 'Thai Baht',           flag: '🇹🇭' },
      { code: 'HKD', name: 'Hong Kong Dollar',    flag: '🇭🇰' },
      { code: 'TWD', name: 'New Taiwan Dollar',   flag: '🇹🇼' },
      { code: 'MYR', name: 'Malaysian Ringgit',   flag: '🇲🇾' },
      { code: 'IDR', name: 'Indonesian Rupiah',   flag: '🇮🇩' },
      { code: 'PHP', name: 'Philippine Peso',     flag: '🇵🇭' },
      { code: 'NZD', name: 'New Zealand Dollar',  flag: '🇳🇿' },
      { code: 'PKR', name: 'Pakistani Rupee',     flag: '🇵🇰' },
      { code: 'BDT', name: 'Bangladeshi Taka',    flag: '🇧🇩' },
    ],
  },
  {
    id: 'europe', label: 'Europe', defaultOpen: false,
    currencies: [
      { code: 'SEK', name: 'Swedish Krona',       flag: '🇸🇪' },
      { code: 'NOK', name: 'Norwegian Krone',     flag: '🇳🇴' },
      { code: 'DKK', name: 'Danish Krone',        flag: '🇩🇰' },
      { code: 'PLN', name: 'Polish Złoty',        flag: '🇵🇱' },
      { code: 'CZK', name: 'Czech Koruna',        flag: '🇨🇿' },
      { code: 'HUF', name: 'Hungarian Forint',    flag: '🇭🇺' },
      { code: 'TRY', name: 'Turkish Lira',        flag: '🇹🇷' },
      { code: 'RUB', name: 'Russian Ruble',       flag: '🇷🇺' },
      { code: 'UAH', name: 'Ukrainian Hryvnia',   flag: '🇺🇦' },
      { code: 'ILS', name: 'Israeli Shekel',      flag: '🇮🇱' },
    ],
  },
  {
    id: 'americas', label: 'Americas', defaultOpen: false,
    currencies: [
      { code: 'MXN', name: 'Mexican Peso',        flag: '🇲🇽' },
      { code: 'BRL', name: 'Brazilian Real',      flag: '🇧🇷' },
      { code: 'ARS', name: 'Argentine Peso',      flag: '🇦🇷' },
      { code: 'CLP', name: 'Chilean Peso',        flag: '🇨🇱' },
      { code: 'COP', name: 'Colombian Peso',      flag: '🇨🇴' },
      { code: 'PEN', name: 'Peruvian Sol',        flag: '🇵🇪' },
    ],
  },
  {
    id: 'mea', label: 'Middle East & Africa', defaultOpen: false,
    currencies: [
      { code: 'AED', name: 'UAE Dirham',          flag: '🇦🇪' },
      { code: 'SAR', name: 'Saudi Riyal',         flag: '🇸🇦' },
      { code: 'QAR', name: 'Qatari Riyal',        flag: '🇶🇦' },
      { code: 'KWD', name: 'Kuwaiti Dinar',       flag: '🇰🇼' },
      { code: 'EGP', name: 'Egyptian Pound',      flag: '🇪🇬' },
      { code: 'NGN', name: 'Nigerian Naira',       flag: '🇳🇬' },
      { code: 'KES', name: 'Kenyan Shilling',     flag: '🇰🇪' },
      { code: 'ZAR', name: 'South African Rand',  flag: '🇿🇦' },
      { code: 'MAD', name: 'Moroccan Dirham',     flag: '🇲🇦' },
      { code: 'GHS', name: 'Ghanaian Cedi',       flag: '🇬🇭' },
    ],
  },
];

// Flat list for the "Convert to" dropdown
const ALL_CURRENCIES = CURRENCY_GROUPS.flatMap(g => g.currencies);

// ── Default settings ───────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  targetCurrency:    'USD',
  enabledCurrencies: ['USD','EUR','JPY','CAD','AUD','CHF','CNY','INR','KRW','VND','SGD','HKD','NZD','THB','MXN','BRL'],
  dollarDefault:     'USD',
  yenDefault:        'JPY',
  displayMode:       'converted',   // 'converted' | 'original'
  convertFreeText:   false,
  openGroups:        [],
  excludedSites:     [],
};

let settings = { ...DEFAULT_SETTINGS };

// ── DOM refs ───────────────────────────────────────────────────────────────
const targetSelect        = document.getElementById('targetSelect');
const displayModeControl  = document.getElementById('displayModeControl');
const segDesc             = document.getElementById('segDesc');
const groupsContainer     = document.getElementById('groupsContainer');
const ratesDot            = document.getElementById('ratesDot');
const ratesLabel          = document.getElementById('ratesLabel');
const refreshBtn          = document.getElementById('refreshBtn');
const freeTextToggle      = document.getElementById('freeTextToggle');
const blockedList         = document.getElementById('blockedList');
const blockedInput        = document.getElementById('blockedInput');
const blockedAddBtn       = document.getElementById('blockedAddBtn');
const addCurrentBtn       = document.getElementById('addCurrentBtn');

let activeTabId      = null;
let currentHostname  = null;
let settingsDirty    = false;

// ── Build "Convert to" dropdown ────────────────────────────────────────────
function buildTargetSelect() {
  targetSelect.innerHTML = '';
  for (const group of CURRENCY_GROUPS) {
    const optgroup = document.createElement('optgroup');
    optgroup.label = group.label;
    for (const c of group.currencies) {
      const opt = document.createElement('option');
      opt.value       = c.code;
      opt.textContent = `${c.flag}  ${c.code} — ${c.name}`;
      optgroup.appendChild(opt);
    }
    targetSelect.appendChild(optgroup);
  }
  targetSelect.value = settings.targetCurrency;
}

// ── Build grouped currency sections ───────────────────────────────────────
const checkSVG = `<svg viewBox="0 0 10 8" xmlns="http://www.w3.org/2000/svg" width="8" height="8">
  <polyline points="1,4 3.5,6.5 9,1" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
</svg>`;
const chevronSVG = (open) => `<svg class="chevron${open ? ' open' : ''}" viewBox="0 0 12 8" xmlns="http://www.w3.org/2000/svg">
  <polyline points="1,1 6,7 11,1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
</svg>`;

function countEnabled(group) {
  return group.currencies.filter(c => settings.enabledCurrencies.includes(c.code)).length;
}

function buildGroups() {
  groupsContainer.innerHTML = '';

  for (const group of CURRENCY_GROUPS) {
    const isOpen    = (settings.openGroups || []).includes(group.id);
    const enabled   = countEnabled(group);
    const total     = group.currencies.length;

    const section = document.createElement('div');
    section.className = 'group-section';
    section.dataset.groupId = group.id;

    section.innerHTML = `
      <div class="group-header" data-group="${group.id}">
        <div class="group-header-left">
          <span class="group-label">${group.label}</span>
          <span class="group-count" id="count-${group.id}">${enabled}/${total}</span>
        </div>
        <div class="group-header-right">
          <button class="group-all-btn"  data-group="${group.id}" title="Enable all">All</button>
          <button class="group-none-btn" data-group="${group.id}" title="Disable all">None</button>
          ${chevronSVG(isOpen)}
        </div>
      </div>
      <div class="group-body ${isOpen ? 'open' : ''}" id="body-${group.id}">
        <div class="chips-grid" id="grid-${group.id}"></div>
      </div>
    `;
    groupsContainer.appendChild(section);

    // Build chips
    const grid = section.querySelector(`#grid-${group.id}`);
    for (const c of group.currencies) {
      const active = settings.enabledCurrencies.includes(c.code);
      const chip   = document.createElement('div');
      chip.className    = `chip${active ? ' active' : ''}`;
      chip.dataset.code = c.code;
      chip.title        = c.name;
      chip.innerHTML    = `
        <span class="chip-flag">${c.flag}</span>
        <span class="chip-code">${c.code}</span>
        <span class="chip-check">${checkSVG}</span>
      `;
      chip.addEventListener('click', () => toggleCurrency(c.code, chip, group.id));
      grid.appendChild(chip);
    }

    // Header click — toggle accordion
    section.querySelector('.group-header').addEventListener('click', (e) => {
      if (e.target.closest('.group-all-btn, .group-none-btn')) return;
      toggleGroup(group.id, section);
    });

    // All / None buttons
    section.querySelector('.group-all-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      for (const c of group.currencies) {
        if (!settings.enabledCurrencies.includes(c.code)) settings.enabledCurrencies.push(c.code);
      }
      refreshGroupChips(group.id);
      saveSettings();
    });
    section.querySelector('.group-none-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      settings.enabledCurrencies = settings.enabledCurrencies.filter(
        code => !group.currencies.find(c => c.code === code)
      );
      refreshGroupChips(group.id);
      saveSettings();
    });
  }
}

function toggleGroup(groupId, section) {
  const body    = section.querySelector(`#body-${groupId}`);
  const chevron = section.querySelector('.chevron');
  const isOpen  = body.classList.toggle('open');
  chevron.classList.toggle('open', isOpen);

  const open = settings.openGroups || [];
  if (isOpen) {
    if (!open.includes(groupId)) open.push(groupId);
  } else {
    settings.openGroups = open.filter(id => id !== groupId);
    return;
  }
  settings.openGroups = open;
  saveSettings();
}

function toggleCurrency(code, chipEl, groupId) {
  const idx = settings.enabledCurrencies.indexOf(code);
  if (idx > -1) {
    settings.enabledCurrencies.splice(idx, 1);
    chipEl.classList.remove('active');
  } else {
    settings.enabledCurrencies.push(code);
    chipEl.classList.add('active');
  }
  updateGroupCount(groupId);
  saveSettings();
}

function refreshGroupChips(groupId) {
  const group = CURRENCY_GROUPS.find(g => g.id === groupId);
  if (!group) return;
  const grid = document.getElementById(`grid-${groupId}`);
  if (!grid) return;
  for (const chip of grid.querySelectorAll('.chip')) {
    chip.classList.toggle('active', settings.enabledCurrencies.includes(chip.dataset.code));
  }
  updateGroupCount(groupId);
}

function updateGroupCount(groupId) {
  const group = CURRENCY_GROUPS.find(g => g.id === groupId);
  const el    = document.getElementById(`count-${groupId}`);
  if (!group || !el) return;
  el.textContent = `${countEnabled(group)}/${group.currencies.length}`;
}

// ── Display mode segmented control ─────────────────────────────────────────
const SEGMENT_DESCS = {
  converted: 'Prices replaced with converted amount — hover to see original',
  original:  'Original prices shown — hover to see converted amount',
};

function updateDisplayModeUI() {
  const mode = settings.displayMode || 'converted';
  displayModeControl.querySelectorAll('.segment-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  segDesc.textContent = SEGMENT_DESCS[mode] || '';
}

displayModeControl.addEventListener('click', (e) => {
  const btn = e.target.closest('.segment-btn');
  if (!btn) return;
  settings.displayMode = btn.dataset.mode;
  updateDisplayModeUI();
  saveSettings();
});

// ── Target currency change ─────────────────────────────────────────────────
targetSelect.addEventListener('change', () => {
  settings.targetCurrency = targetSelect.value;
  saveSettings();
});

// ── Written amounts toggle ─────────────────────────────────────────────────
freeTextToggle.addEventListener('change', () => {
  settings.convertFreeText = freeTextToggle.checked;
  saveSettings();
});

// ── Save settings (reload deferred to popup close) ────────────────────────
async function saveSettings() {
  await chrome.storage.local.set({ settings });
  settingsDirty = true;
}

// Reload the active tab when the popup is closed (use unload + background message
// so the reload survives popup context teardown)
window.addEventListener('unload', () => {
  if (settingsDirty && activeTabId) {
    chrome.runtime.sendMessage({ type: 'reloadTab', tabId: activeTabId });
  }
});

// ── Blocked sites manager ─────────────────────────────────────────────────
function renderBlockedList() {
  const sites = settings.excludedSites || [];
  if (sites.length === 0) {
    blockedList.innerHTML = '<div class="blocked-empty">No blocked sites</div>';
    return;
  }
  blockedList.innerHTML = sites.map(s => `
    <div class="blocked-row">
      <span class="blocked-domain">${s}</span>
      <button class="blocked-remove" data-site="${s}" title="Remove">×</button>
    </div>
  `).join('');
  blockedList.querySelectorAll('.blocked-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      settings.excludedSites = (settings.excludedSites || []).filter(s => s !== btn.dataset.site);
      renderBlockedList();
      saveSettings();
    });
  });
}

function addBlockedSite(domain) {
  const clean = domain.trim().toLowerCase().replace(/^https?:\/\//,'').replace(/^www\./,'').split('/')[0];
  if (!clean) return;
  const excluded = settings.excludedSites || [];
  if (!excluded.includes(clean)) {
    settings.excludedSites = [...excluded, clean];
    renderBlockedList();
    saveSettings();
  }
}

blockedAddBtn.addEventListener('click', () => {
  addBlockedSite(blockedInput.value);
  blockedInput.value = '';
});

blockedInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    addBlockedSite(blockedInput.value);
    blockedInput.value = '';
  }
});

addCurrentBtn.addEventListener('click', () => {
  if (currentHostname) addBlockedSite(currentHostname);
});

// ── Rates status ───────────────────────────────────────────────────────────
async function updateRatesStatus() {
  const { ratesDate: date, ratesTimestamp: ts } = await chrome.storage.local.get(['ratesDate', 'ratesTimestamp']);
  if (!ts) { ratesDot.className = 'rates-dot stale'; ratesLabel.textContent = 'No rates yet'; return; }
  const stale = Date.now() - ts > 25 * 60 * 60 * 1000;
  ratesDot.className     = stale ? 'rates-dot stale' : 'rates-dot';
  ratesLabel.textContent = date ? `Rates from ${date}` : 'Rates loaded';
}

// ── Refresh button ─────────────────────────────────────────────────────────
refreshBtn.addEventListener('click', async () => {
  refreshBtn.textContent = '…';
  refreshBtn.disabled    = true;
  try {
    await chrome.storage.local.remove(['rates', 'ratesDate', 'ratesTimestamp']);
    await chrome.runtime.sendMessage({ type: 'getRates' });
    await updateRatesStatus();
  } catch (_) {}
  refreshBtn.textContent = 'Refresh';
  refreshBtn.disabled    = false;
});

// ── Init ───────────────────────────────────────────────────────────────────
async function init() {
  const [stored, tabs] = await Promise.all([
    chrome.storage.local.get('settings'),
    chrome.tabs.query({ active: true, currentWindow: true }),
  ]);
  if (stored.settings) settings = { ...DEFAULT_SETTINGS, ...stored.settings };

  const tab = tabs[0];
  activeTabId = tab?.id ?? null;
  try {
    currentHostname = tab?.url ? new URL(tab.url).hostname.replace(/^www\./, '') : null;
  } catch (_) { currentHostname = null; }

  buildTargetSelect();
  buildGroups();
  updateDisplayModeUI();
  updateRatesStatus();
  freeTextToggle.checked = !!settings.convertFreeText;
  renderBlockedList();
  if (!currentHostname) addCurrentBtn.style.display = 'none';
}

init();
