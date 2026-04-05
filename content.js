/**
 * Currenzy — content script v3
 *
 * Text-replacement approach: detected currency amounts are replaced in-place
 * with the converted value. A dashed underline marks converted text. Hovering
 * shows the original amount and exchange rate in a tooltip.
 *
 * Detection improvements over v2:
 *  • Symbol-after patterns  (100€, 50₫)
 *  • K / M / B / T suffixes ($1.5M, €2K)
 *  • Shadow DOM traversal
 *  • Scroll-triggered rescan for virtual / lazy lists
 *  • characterData MutationObserver
 *  • all_frames support (iframe prices detected via manifest)
 */

(function () {
  'use strict';

  if (window.__currenzyLoaded) return;
  window.__currenzyLoaded = true;

  // ── Constants ──────────────────────────────────────────────────────────────
  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED',
    'TEXTAREA', 'INPUT', 'SELECT', 'OPTION',
    'CODE', 'PRE', 'KBD', 'SAMP', 'VAR',
    'SVG', 'MATH', 'CANVAS',
    'S', 'STRIKE', 'DEL',  // strikethrough / deleted prices
  ]);
  const SKIP_ANCESTOR_SEL = 's, strike, del, [aria-hidden="true"]';

  // ── State ──────────────────────────────────────────────────────────────────
  let settings = {
    targetCurrency:    'USD',
    enabledCurrencies: [
      'USD','EUR','JPY','CAD','AUD','CHF','CNY',
      'INR','KRW','VND','SGD','HKD','NZD','THB','MXN','BRL',
    ],
    dollarDefault:    'USD',
    yenDefault:       'JPY',
    displayMode:      'converted',   // 'converted' | 'original'
    convertFreeText:  false,
  };
  let rates            = null;
  let ratesDate        = null;
  let ratesTimestamp   = null;
  let matcher          = null;
  let freeTextMatcher  = null;

  // Number sub-pattern shared by all regex builders.
  // Handles grouped separators (1.200,00 / 1,200.00 / 1 200,00),
  // K/M/B/T letter suffixes, and full word multipliers (million/billion/etc.)
  const N_PAT = '(?:[0-9]{1,3}(?:[,\\.\\u00A0][0-9]{3})*(?:[,\\.][0-9]{1,4})?|[0-9]+(?:[,\\.][0-9]{1,4})?)(?:[KkMmBbTt]|\\s*(?:million|billion|trillion|thousand))?';

  // ── Number parsing ─────────────────────────────────────────────────────────
  function parseAmount(raw) {
    if (!raw) return NaN;

    // Strip word multipliers first (e.g. "174.5 million", "2 billion")
    const wordSfxRe = /\s*(million|billion|trillion|thousand)\s*$/i;
    const wordSfxM  = raw.match(wordSfxRe);
    let mult = 1;
    if (wordSfxM) {
      const w = wordSfxM[1].toLowerCase();
      mult = w === 'million' ? 1e6 : w === 'billion' ? 1e9 : w === 'trillion' ? 1e12 : 1e3;
      raw = raw.replace(wordSfxRe, '').trim();
    } else {
      // Strip K / M / B / T suffixes (e.g. $1.5M, €2K, $500B)
      const sfxRe = /^([\s\S]+?)([KkMmBbTt])$/;
      const sfx   = raw.match(sfxRe);
      if (sfx) {
        mult = { K:1e3, M:1e6, B:1e9, T:1e12 }[sfx[2].toUpperCase()] || 1;
        raw  = sfx[1];
      }
    }
    let s = raw.replace(/[\u00A0\u202F\u2009\s]/g, '').trim();
    if (!s) return NaN;

    const commas = (s.match(/,/g) || []).length;
    const dots   = (s.match(/\./g) || []).length;

    if (commas > 1 && dots === 0) return parseFloat(s.replace(/,/g, ''))  * mult;
    if (dots   > 1 && commas === 0) return parseFloat(s.replace(/\./g, '')) * mult;

    const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');

    if (lc !== -1 && ld !== -1) {
      return (lc > ld
        ? parseFloat(s.replace(/\./g, '').replace(',', '.'))
        : parseFloat(s.replace(/,/g, ''))) * mult;
    }
    if (lc !== -1) {
      const a = s.substring(lc + 1);
      return (a.length === 3
        ? parseFloat(s.replace(',', ''))
        : parseFloat(s.replace(',', '.'))) * mult;
    }
    if (ld !== -1) {
      const a = s.substring(ld + 1);
      return (a.length === 3
        ? parseFloat(s.replace('.', ''))
        : parseFloat(s)) * mult;
    }
    return parseFloat(s) * mult;
  }

  // ── Formatting ─────────────────────────────────────────────────────────────
  function formatConverted(amount, code) {
    const noDecimals    = new Set(['JPY','KRW','VND','IDR','CLP','HUF','UGX','RWF','BIF','PYG','MMK']);
    const threeDecimals = new Set(['KWD','BHD','OMR','JOD','TND']);
    const digits = threeDecimals.has(code) ? 3 : noDecimals.has(code) ? 0 : amount >= 100 ? 0 : 2;
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency', currency: code,
        minimumFractionDigits: digits, maximumFractionDigits: digits,
      }).format(amount);
    } catch {
      return `${code} ${amount.toFixed(digits)}`;
    }
  }

  function formatRate(rate, toCode) {
    const whole = new Set(['JPY','KRW','VND','IDR','HUF','CLP','RWF','UGX','BIF']);
    if (whole.has(toCode)) return Math.round(rate).toLocaleString();
    if (rate >= 100) return rate.toFixed(0);
    if (rate >= 1)   return rate.toFixed(4);
    return rate.toFixed(6);
  }

  // ── Conversion ─────────────────────────────────────────────────────────────
  function convertAmount(amount, fromCode, toCode) {
    if (!rates || fromCode === toCode) return null;
    const fr = rates[fromCode.toLowerCase()];
    const tr = rates[toCode.toLowerCase()];
    if (!fr || !tr) return null;
    return (amount / fr) * tr;
  }

  // ── Regex builder ──────────────────────────────────────────────────────────
  function buildMatcher(enabled, dollarDefault, yenDefault) {
    const symMap = new Map();
    function addSym(sym, code) { if (!symMap.has(sym)) symMap.set(sym, code); }

    // Multi-char symbols (longest first to prevent partial matches)
    const multiPriority = [
      ['NZ$','NZD'], ['HK$','HKD'], ['CA$','CAD'], ['AU$','AUD'],
      ['C$','CAD'],  ['A$','AUD'],  ['S$','SGD'],  ['NT$','TWD'],
      ['MX$','MXN'], ['R$','BRL'],  ['E£','EGP'],  ['KSh','KES'],
      ['Rp','IDR'],  ['RM','MYR'],  ['Rs','PKR'],  ['SR','SAR'],
      ['QR','QAR'],  ['KD','KWD'],  ['zł','PLN'],  ['Kč','CZK'], ['Ft','HUF'],
    ];
    for (const [sym, code] of multiPriority) {
      if (enabled.includes(code)) addSym(sym, code);
    }

    const singleMap = [
      ['€','EUR'], ['£','GBP'], ['₹','INR'], ['₩','KRW'],
      ['₫','VND'], ['đ','VND'], ['฿','THB'], ['₱','PHP'],
      ['₦','NGN'], ['₺','TRY'], ['₽','RUB'], ['₴','UAH'],
      ['₪','ILS'], ['₨','PKR'], ['元','CNY'], ['﷼','SAR'],
      ['$', dollarDefault],
      ['¥', yenDefault],
    ];
    for (const [sym, code] of singleMap) {
      if (enabled.includes(code)) addSym(sym, code);
    }

    const escapedSyms = [...symMap.keys()]
      .sort((a, b) => b.length - a.length)
      .map(escapeRe);
    const codes = [...enabled].sort((a, b) => b.length - a.length);

    const N = N_PAT;

    const symPat  = escapedSyms.length ? `(${escapedSyms.join('|')})` : null;
    const codePat = codes.length       ? `(${codes.join('|')})`       : null;

    // Track capture group indices dynamically
    let g = 0;
    let gSym1, gSym2, gSymAft1, gSymAft2, gCodePre1, gCodePre2, gCodePost1, gCodePost2;

    const parts = [];

    if (symPat) {
      // Pattern 1: symbol BEFORE number  ($100, €1.200,00, S$ 155)
      parts.push(`${symPat}[ \\t\\u00A0\\u202F]?(${N})`);
      gSym1 = ++g; gSym2 = ++g;

      // Pattern 2: number THEN symbol  (100€, 50₫, 1000¥, 4.500.000 ₫)
      parts.push(`(${N})[ \\t\\u00A0\\u202F]?(${symPat})`);
      gSymAft1 = ++g; gSymAft2 = ++g;
    }

    if (codePat) {
      // Pattern 3: code BEFORE number  (USD 100, VND 50.000, USD100)
      parts.push(`(?<![A-Za-z])${codePat}[ \\t\\u00A0]?(${N})(?![A-Za-z])`);
      gCodePre1 = ++g; gCodePre2 = ++g;

      // Pattern 4: number THEN code  (100 USD, 50.000 VND)
      parts.push(`(${N})[ \\t\\u00A0]?\\b${codePat}\\b`);
      gCodePost1 = ++g; gCodePost2 = ++g;
    }

    if (parts.length === 0) return null;

    let regex;
    try {
      regex = new RegExp(parts.join('|'), 'g');
    } catch (e) {
      console.error('[Currenzy] Regex build error', e);
      return null;
    }

    function resolveMatch(m) {
      if (gSym1    && m[gSym1])                      return { currencyCode: symMap.get(m[gSym1]),    amountStr: m[gSym2]    };
      if (gSymAft1 && m[gSymAft1] && m[gSymAft2])   return { currencyCode: symMap.get(m[gSymAft2]), amountStr: m[gSymAft1] };
      if (gCodePre1 && m[gCodePre1])                 return { currencyCode: m[gCodePre1], amountStr: m[gCodePre2] };
      if (gCodePost1 && m[gCodePost1] && m[gCodePost2]) return { currencyCode: m[gCodePost2], amountStr: m[gCodePost1] };
      return null;
    }

    return { regex, resolveMatch };
  }

  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // ── Free-text currency name map ────────────────────────────────────────────
  // Multi-word phrases listed first; single-word fallbacks last.
  // "dollar/dollars" always maps to USD regardless of dollarDefault.
  const CURRENCY_NAMES = [
    { phrases: ['canadian dollar','canadian dollars'],                        code: 'CAD' },
    { phrases: ['australian dollar','australian dollars'],                    code: 'AUD' },
    { phrases: ['new zealand dollar','new zealand dollars'],                  code: 'NZD' },
    { phrases: ['hong kong dollar','hong kong dollars'],                      code: 'HKD' },
    { phrases: ['singapore dollar','singapore dollars'],                      code: 'SGD' },
    { phrases: ['us dollar','us dollars','american dollar','american dollars','united states dollar','united states dollars'], code: 'USD' },
    { phrases: ['british pound','british pounds','pound sterling','pounds sterling'], code: 'GBP' },
    { phrases: ['swiss franc','swiss francs'],                                code: 'CHF' },
    { phrases: ['chinese yuan','chinese renminbi'],                           code: 'CNY' },
    { phrases: ['south korean won','korean won'],                             code: 'KRW' },
    { phrases: ['indian rupee','indian rupees'],                              code: 'INR' },
    { phrases: ['japanese yen'],                                              code: 'JPY' },
    { phrases: ['thai baht'],                                                 code: 'THB' },
    { phrases: ['vietnamese dong'],                                           code: 'VND' },
    { phrases: ['mexican peso','mexican pesos'],                              code: 'MXN' },
    { phrases: ['brazilian real','brazilian reais','brazilian reals'],        code: 'BRL' },
    { phrases: ['uae dirham','emirati dirham','uae dirhams'],                 code: 'AED' },
    { phrases: ['saudi riyal','saudi riyals'],                                code: 'SAR' },
    { phrases: ['swedish krona','swedish kronor'],                            code: 'SEK' },
    { phrases: ['norwegian krone','norwegian kroner'],                        code: 'NOK' },
    { phrases: ['danish krone','danish kroner'],                              code: 'DKK' },
    // Single-word fallbacks
    { phrases: ['dollar','dollars'],   code: 'USD' },
    { phrases: ['euro','euros'],       code: 'EUR' },
    { phrases: ['pound','pounds'],     code: 'GBP' },
    { phrases: ['yen'],                code: 'JPY' },
    { phrases: ['yuan','renminbi'],    code: 'CNY' },
    { phrases: ['won'],                code: 'KRW' },
    { phrases: ['rupee','rupees'],     code: 'INR' },
    { phrases: ['baht'],               code: 'THB' },
    { phrases: ['dong'],               code: 'VND' },
    { phrases: ['franc','francs'],     code: 'CHF' },
    { phrases: ['peso','pesos'],       code: 'MXN' },
    { phrases: ['real','reais'],       code: 'BRL' },
    { phrases: ['krona','kronor','krone','kroner'], code: 'SEK' },
    { phrases: ['ruble','rubles','rouble','roubles'], code: 'RUB' },
    { phrases: ['lira'],               code: 'TRY' },
    { phrases: ['dirham','dirhams'],   code: 'AED' },
    { phrases: ['riyal','riyals'],     code: 'SAR' },
    { phrases: ['shekel','shekels'],   code: 'ILS' },
    { phrases: ['dinar','dinars'],     code: 'KWD' },
    { phrases: ['naira'],              code: 'NGN' },
    { phrases: ['rand'],               code: 'ZAR' },
    { phrases: ['ringgit'],            code: 'MYR' },
    { phrases: ['rupiah'],             code: 'IDR' },
  ];

  function buildFreeTextMatcher(enabled) {
    const pairs = [];
    for (const entry of CURRENCY_NAMES) {
      if (!enabled.includes(entry.code)) continue;
      for (const phrase of entry.phrases) pairs.push({ phrase, code: entry.code });
    }
    if (pairs.length === 0) return null;

    // Longest phrase first so "canadian dollar" matches before bare "dollar"
    pairs.sort((a, b) => b.phrase.length - a.phrase.length);

    const phraseMap = new Map(pairs.map(p => [p.phrase, p.code]));
    const phrasePat = pairs.map(p => escapeRe(p.phrase)).join('|');
    const N = N_PAT;

    let regex;
    try {
      regex = new RegExp(`\\b(${N})\\s+(${phrasePat})\\b`, 'gi');
    } catch (e) {
      console.error('[Currenzy] Free-text regex error', e);
      return null;
    }

    function resolveMatch(m) {
      const phrase = m[2]?.toLowerCase();
      const code   = phrase ? phraseMap.get(phrase) : null;
      if (!code || !m[1]) return null;
      return { currencyCode: code, amountStr: m[1] };
    }

    return { regex, resolveMatch };
  }

  // ── Text node processing (in-place text replacement) ──────────────────────
  function processTextNode(node, mtchr) {
    const text = node.nodeValue;
    if (!text || text.trim().length < 1) return;

    const { regex, resolveMatch } = mtchr;
    regex.lastIndex = 0;

    const segments = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
      const resolved = resolveMatch(match);
      if (!resolved?.currencyCode) continue;
      if (resolved.currencyCode === settings.targetCurrency) continue;

      const amount = parseAmount(resolved.amountStr);
      if (isNaN(amount) || amount <= 0 || amount > 1e12) continue;

      const converted = convertAmount(amount, resolved.currencyCode, settings.targetCurrency);
      if (converted === null || isNaN(converted) || converted <= 0) continue;

      const fr = rates[resolved.currencyCode.toLowerCase()];
      const tr = rates[settings.targetCurrency.toLowerCase()];

      segments.push({
        start: match.index,
        end:   match.index + match[0].length,
        original:     match[0],
        currencyCode: resolved.currencyCode,
        converted,
        rate: fr && tr ? tr / fr : null,
      });
    }
    if (segments.length === 0) return;

    const frag = document.createDocumentFragment();
    let lastIndex = 0;

    for (const seg of segments) {
      if (seg.start > lastIndex) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex, seg.start)));
      }

      const span = document.createElement('span');
      span.className        = 'cc-converted';
      span.dataset.original = seg.original;
      span.dataset.from     = seg.currencyCode;
      span.dataset.to       = settings.targetCurrency;
      span.dataset.rate     = seg.rate != null ? seg.rate.toFixed(6) : '';
      span.dataset.rateDate = ratesDate || '';

      if (settings.displayMode === 'original') {
        // Original mode: keep original text on page; store converted for tooltip
        span.textContent       = seg.original;
        span.dataset.hoverMode = '1';
        span.dataset.converted = formatConverted(seg.converted, settings.targetCurrency);
      } else {
        // Converted mode (default): replace with converted value; original in tooltip
        span.textContent = formatConverted(seg.converted, settings.targetCurrency);
      }

      frag.appendChild(span);
      lastIndex = seg.end;
    }
    if (lastIndex < text.length) {
      frag.appendChild(document.createTextNode(text.slice(lastIndex)));
    }

    node.parentNode.replaceChild(frag, node);
  }

  // ── Tree walker (text-node level) ──────────────────────────────────────────
  function scanSubtree(root, mtchr) {
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const el = node.parentElement;
          if (!el) return NodeFilter.FILTER_REJECT;
          if (SKIP_TAGS.has(el.tagName))         return NodeFilter.FILTER_REJECT;
          if (el.isContentEditable)              return NodeFilter.FILTER_REJECT;
          if (el.closest('.cc-converted'))       return NodeFilter.FILTER_REJECT;
          if (el.closest('[data-cc-skip]'))      return NodeFilter.FILTER_REJECT;
          if (el.closest(SKIP_ANCESTOR_SEL))     return NodeFilter.FILTER_REJECT;
          // Inline CSS strikethrough — walk up a few levels cheaply
          let anc = el;
          for (let i = 0; i < 4 && anc && anc !== document.body; i++) {
            if (anc.style?.textDecoration?.includes('line-through')) return NodeFilter.FILTER_REJECT;
            anc = anc.parentElement;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    for (const node of nodes) {
      if (node.isConnected) processTextNode(node, mtchr);
    }
  }

  // ── Element-level scanner (split DOM — symbol & number in separate nodes) ──
  // e.g. <span>S$</span><span>155</span> on Booking.com
  function hasBlockDescendant(el) {
    const BLOCK = new Set([
      'DIV','P','H1','H2','H3','H4','H5','H6','LI','TR','TD','TH',
      'BLOCKQUOTE','SECTION','ARTICLE','HEADER','FOOTER','MAIN',
      'NAV','ASIDE','UL','OL','TABLE','FIGURE','FORM',
    ]);
    for (const child of el.children) {
      if (BLOCK.has(child.tagName) || hasBlockDescendant(child)) return true;
    }
    return false;
  }

  function scanElementLevel(root, mtchr) {
    if (!mtchr) return;
    const { regex, resolveMatch } = mtchr;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode(el) {
        if (SKIP_TAGS.has(el.tagName))          return NodeFilter.FILTER_REJECT;
        if (el.closest?.('.cc-converted'))      return NodeFilter.FILTER_REJECT;
        if (el.closest?.('[data-cc-skip]'))     return NodeFilter.FILTER_REJECT;
        if (el.closest?.(SKIP_ANCESTOR_SEL))    return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const elements = [];
    let el;
    while ((el = walker.nextNode())) elements.push(el);

    for (const el of elements) {
      // Skip if already processed by either scanner
      if (!el || el?.dataset?.ccElDone)                  continue;
      if (el.querySelector?.('.cc-converted'))          continue;
      if (el.closest?.(SKIP_ANCESTOR_SEL))                         continue;
      if (window.getComputedStyle(el).textDecoration.includes('line-through')) continue;

      const raw = el.textContent;
      if (!raw || raw.trim().length < 1 || raw.trim().length > 60) continue;
      if (hasBlockDescendant(el)) continue;

      const collapsed = raw.replace(/[\s\u00A0\u202F]+/g, ' ').trim();
      regex.lastIndex = 0;
      const match = regex.exec(collapsed);
      if (!match) continue;

      const resolved = resolveMatch(match);
      if (!resolved?.currencyCode) continue;
      if (resolved.currencyCode === settings.targetCurrency) continue;

      const amount = parseAmount(resolved.amountStr);
      if (isNaN(amount) || amount <= 0 || amount > 1e12) continue;

      const converted = convertAmount(amount, resolved.currencyCode, settings.targetCurrency);
      if (converted === null || isNaN(converted) || converted <= 0) continue;

      const fr = rates[resolved.currencyCode.toLowerCase()];
      const tr = rates[settings.targetCurrency.toLowerCase()];
      const rate = fr && tr ? tr / fr : null;

      el.dataset.ccElDone = '1';

      // Replace the element's content in-place — same approach as processTextNode.
      // This handles split-DOM prices (e.g. <span>S$</span><span>155</span>)
      // where the text-node scanner can't match across node boundaries.
      const span = document.createElement('span');
      span.className = 'cc-converted';
      span.setAttribute('data-cc-skip', '');
      span.dataset.original = collapsed;
      span.dataset.from     = resolved.currencyCode;
      span.dataset.to       = settings.targetCurrency;
      span.dataset.rate     = rate != null ? rate.toFixed(6) : '';
      span.dataset.rateDate = ratesDate || '';

      if (settings.displayMode === 'original') {
        span.textContent       = collapsed;
        span.dataset.hoverMode = '1';
        span.dataset.converted = formatConverted(converted, settings.targetCurrency);
      } else {
        span.textContent = formatConverted(converted, settings.targetCurrency);
      }

      // Clear children and insert the converted span
      while (el.firstChild) el.removeChild(el.firstChild);
      el.appendChild(span);
    }
  }

  // ── Shadow DOM traversal ───────────────────────────────────────────────────
  function scanRoot(root, mtchr) {
    scanSubtree(root, mtchr);
    scanElementLevel(root, mtchr);
    // Recurse into shadow roots (Web Components)
    try {
      const all = root.querySelectorAll ? root.querySelectorAll('*') : [];
      for (const el of all) {
        if (el.shadowRoot) scanRoot(el.shadowRoot, mtchr);
      }
    } catch (_) { /* cross-origin shadow root — skip */ }
  }

  // ── Tooltip ────────────────────────────────────────────────────────────────
  let tooltipEl = null;

  function ensureTooltip() {
    if (tooltipEl) return;
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'cc-tooltip';
    tooltipEl.setAttribute('data-cc-skip', '');
    document.documentElement.appendChild(tooltipEl);

    document.addEventListener('mouseover', onEnter, { passive: true, capture: true });
    document.addEventListener('mousemove', onMove,  { passive: true, capture: true });
    document.addEventListener('mouseout',  onLeave, { passive: true, capture: true });
  }

  function getTarget(e) {
    return e.target.closest?.('.cc-converted, .cc-el-badge') || null;
  }

  function onEnter(e) {
    const el = getTarget(e);
    if (!el || !tooltipEl) return;

    const from      = el.dataset.from;
    const to        = el.dataset.to;
    const original  = el.dataset.original;
    const rate      = el.dataset.rate ? parseFloat(el.dataset.rate) : null;
    const date      = el.dataset.rateDate;
    const hoverMode = el.dataset.hoverMode;
    const converted = el.dataset.converted;

    let html = '';
    if (hoverMode) {
      // Hover mode: page shows original, tooltip reveals the converted value
      html += `<div class="cc-tt-label">Converted</div>`;
      html += `<div class="cc-tt-main">${converted}</div>`;
    } else {
      // Normal mode: page shows converted, tooltip reveals the original price
      html += `<div class="cc-tt-label">Original price</div>`;
      html += `<div class="cc-tt-original">${original}</div>`;
    }
    if (rate != null) {
      if (rate < 0.1) {
        html += `<div class="cc-tt-row">1 ${to} = ${formatRate(1 / rate, from)} ${from}</div>`;
      } else {
        html += `<div class="cc-tt-row">1 ${from} = ${formatRate(rate, to)} ${to}</div>`;
      }
    }
    if (date) {
      html += `<div class="cc-tt-date">Rates from ${date}</div>`;
    }

    tooltipEl.innerHTML = html;
    tooltipEl.style.display = 'block';
    positionTooltip(e.clientX, e.clientY);
  }

  function onMove(e) {
    if (!tooltipEl || tooltipEl.style.display === 'none') return;
    if (getTarget(e)) positionTooltip(e.clientX, e.clientY);
  }

  function onLeave(e) {
    if (!tooltipEl) return;
    const el = getTarget(e);
    if (el && !el.contains(e.relatedTarget)) tooltipEl.style.display = 'none';
  }

  function positionTooltip(cx, cy) {
    if (!tooltipEl) return;
    tooltipEl.style.visibility = 'hidden';
    tooltipEl.style.display = 'block';
    const tw = tooltipEl.offsetWidth, th = tooltipEl.offsetHeight;
    tooltipEl.style.visibility = '';
    const m = 12;
    let x = cx + m, y = cy - th - m;
    if (x + tw > window.innerWidth - m)  x = cx - tw - m;
    if (y < m)                           y = cy + m;
    tooltipEl.style.left = `${x}px`;
    tooltipEl.style.top  = `${y}px`;
  }

  // ── Manual conversion modal ────────────────────────────────────────────────
  let modalEl = null;

  function showConversionModal(result) {
    if (modalEl) { modalEl.remove(); modalEl = null; }

    modalEl = document.createElement('div');
    modalEl.className = 'cc-modal';
    modalEl.setAttribute('data-cc-skip', '');

    if (result.error) {
      modalEl.innerHTML = `
        <div class="cc-modal-header">
          <span class="cc-modal-title">💱 Currenzy</span>
          <button class="cc-modal-close">×</button>
        </div>
        <div class="cc-modal-error">${result.error}</div>`;
    } else {
      const rateHtml = result.rate != null
        ? (result.rate < 0.1
            ? `1 ${result.to} = ${formatRate(1 / result.rate, result.from)} ${result.from}`
            : `1 ${result.from} = ${formatRate(result.rate, result.to)} ${result.to}`)
        : '';
      modalEl.innerHTML = `
        <div class="cc-modal-header">
          <span class="cc-modal-title">💱 Currenzy</span>
          <button class="cc-modal-close">×</button>
        </div>
        <div class="cc-modal-body">
          <div class="cc-modal-original">${result.original}</div>
          <div class="cc-modal-arrow">↓</div>
          <div class="cc-modal-converted">${result.converted}</div>
          ${rateHtml ? `<div class="cc-modal-rate">${rateHtml}</div>` : ''}
          ${result.date ? `<div class="cc-modal-date">Rates from ${result.date}</div>` : ''}
        </div>`;
    }

    document.documentElement.appendChild(modalEl);
    modalEl.querySelector('.cc-modal-close').addEventListener('click', closeModal);
    setTimeout(() => {
      document.addEventListener('click', function outsideClick(e) {
        if (!modalEl?.contains(e.target)) {
          closeModal();
          document.removeEventListener('click', outsideClick);
        }
      });
    }, 50);
  }

  function closeModal() { if (modalEl) { modalEl.remove(); modalEl = null; } }

  function handleManualConversion(text) {
    if (!rates || !matcher) {
      showConversionModal({ error: 'Exchange rates not loaded yet. Please try again in a moment.' });
      return;
    }
    const cleaned = text.replace(/\s+/g, ' ').trim();

    // Try symbol/code matcher first, then fall back to free-text (e.g. "2,7 euro")
    const candidates = [matcher];
    const ftm = freeTextMatcher || buildFreeTextMatcher(settings.enabledCurrencies);
    if (ftm) candidates.push(ftm);

    let match = null, resolved = null, usedMatcher = null;
    for (const m of candidates) {
      m.regex.lastIndex = 0;
      const candidate = m.regex.exec(cleaned);
      if (!candidate) continue;
      const res = m.resolveMatch(candidate);
      if (res?.currencyCode) { match = candidate; resolved = res; usedMatcher = m; break; }
    }

    if (!match || !resolved) {
      showConversionModal({ error: `No currency detected in:<br><em>"${cleaned.slice(0, 80)}"</em><br><br>Try selecting text that includes the currency symbol, e.g. <em>$1,200</em> or <em>USD 1,200</em>.` });
      return;
    }
    const amount = parseAmount(resolved.amountStr);
    if (isNaN(amount) || amount <= 0) {
      showConversionModal({ error: 'Could not parse the amount.' });
      return;
    }
    const converted = convertAmount(amount, resolved.currencyCode, settings.targetCurrency);
    if (!converted) {
      showConversionModal({ error: `No exchange rate available for ${resolved.currencyCode}.` });
      return;
    }
    const fr = rates[resolved.currencyCode.toLowerCase()];
    const tr = rates[settings.targetCurrency.toLowerCase()];
    showConversionModal({
      original:  match[0],
      converted: formatConverted(converted, settings.targetCurrency),
      from:      resolved.currencyCode,
      to:        settings.targetCurrency,
      rate:      fr && tr ? tr / fr : null,
      date:      ratesDate,
    });
  }

  // ── MutationObserver ───────────────────────────────────────────────────────
  let observer    = null;
  let mutTimer    = null;
  const pending   = new Set();
  const churnMap  = new Map();
  const CHURN_LIM = 5, CHURN_WIN = 3000;

  function isChurning(node) {
    const now = Date.now();
    const info = churnMap.get(node) || { count: 0, lastSeen: 0 };
    if (now - info.lastSeen > CHURN_WIN) { churnMap.set(node, { count: 1, lastSeen: now }); return false; }
    info.count++; info.lastSeen = now; churnMap.set(node, info);
    return info.count > CHURN_LIM;
  }

  function startObserver() {
    if (observer) return;
    observer = new MutationObserver((muts) => {
      for (const mut of muts) {
        for (const node of mut.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) pending.add(node);
        }
      }
      if (!pending.size) return;
      clearTimeout(mutTimer);
      // 400 ms debounce — lets React / Angular finish their render cycle
      mutTimer = setTimeout(flushPending, 400);
    });
    observer.observe(document.documentElement, {
      childList:     true,
      subtree:       true,
      characterData: false, // enabling this fires too frequently on SPAs
    });
  }

  function flushPending() {
    if (!matcher) return;
    for (const node of pending) {
      if (!node.isConnected || isChurning(node)) continue;
      scanRoot(node, matcher);
      if (freeTextMatcher) scanRoot(node, freeTextMatcher);
    }
    pending.clear();
  }

  // ── Scroll-based rescan (virtual/lazy lists: Google Flights etc.) ─────────
  let scrollTimer = null;
  function onScroll() {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      if (matcher && document.body) scanRoot(document.body, matcher);
      if (freeTextMatcher && document.body) scanRoot(document.body, freeTextMatcher);
    }, 600);
  }

  // ── Settings change listener ───────────────────────────────────────────────
  chrome.storage.onChanged.addListener((_changes, _area) => {
    // Settings are applied on next page load (triggered when popup closes).
  });

  // ── Context menu message ───────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'convertSelection') handleManualConversion(msg.text || '');
  });

  // ── Init ───────────────────────────────────────────────────────────────────
  async function init() {
    // 1. Load settings
    const stored = await chrome.storage.local.get(['settings', 'rates', 'ratesDate', 'ratesTimestamp']);
    if (stored.settings) settings = { ...settings, ...stored.settings };

    // 1a. Check if this site is excluded
    const hostname = window.location.hostname.replace(/^www\./, '');
    if ((settings.excludedSites || []).includes(hostname)) return;
    if (stored.rates)    { rates = stored.rates; ratesDate = stored.ratesDate || null; ratesTimestamp = stored.ratesTimestamp || null; }

    // 2. Request fresh rates from background
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'getRates' });
      if (resp?.rates) { rates = resp.rates; ratesDate = resp.ratesDate || null; ratesTimestamp = resp.ratesTimestamp || null; }
    } catch (_) { /* background not ready — use cached rates */ }

    if (!rates) { console.warn('[Currenzy] No exchange rates — aborting.'); return; }

    // 3. Build matchers
    matcher = buildMatcher(
      settings.enabledCurrencies,
      settings.dollarDefault || 'USD',
      settings.yenDefault    || 'JPY'
    );
    if (!matcher) return;

    if (settings.convertFreeText) {
      freeTextMatcher = buildFreeTextMatcher(settings.enabledCurrencies);
    }

    // 4. Apply hover-mode class
    if (settings.displayMode === 'original') document.documentElement.classList.add('cc-hover-mode');

    // 5. Initial DOM scan
    if (document.body) {
      scanRoot(document.body, matcher);
      if (freeTextMatcher) scanRoot(document.body, freeTextMatcher);
    }

    // 6. Tooltip
    ensureTooltip();

    // 7. MutationObserver for dynamic content
    startObserver();

    // 8. Scroll listener for virtual/lazy lists
    window.addEventListener('scroll', onScroll, { passive: true });

    // 9. Delayed rescans — catches async-rendered content (SPAs, lazy routes)
    const rescan = () => {
      if (document.body && matcher) scanRoot(document.body, matcher);
      if (document.body && freeTextMatcher) scanRoot(document.body, freeTextMatcher);
    };
    setTimeout(rescan, 800);
    setTimeout(rescan, 2500);
    setTimeout(rescan, 6000); // extra pass for very slow loaders
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
