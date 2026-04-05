# Currenzy

Chrome extension (Manifest V3) for inline currency conversion on any webpage.

## What it does
- Detects currency amounts in page text and replaces them with converted values
- Rates fetched daily from `@fawazahmed0/currency-api` (no API key required), cached via `chrome.storage.local`
- Right-click context menu for manual conversion of selected text

## Files
- `manifest.json` — MV3 manifest, permissions: `storage`, `alarms`, `tabs`, `contextMenus`
- `background.js` — service worker: rate fetching/caching, context menu registration, message broker
- `content.js` — DOM scanning, regex matching, in-place replacement, tooltip, modal, MutationObserver
- `popup.js` / `popup.html` / `popup.css` — settings UI
- `content.css` — tooltip and converted-span styles
- `icons/` — 16/48/128px icons

## Architecture notes
- Content script builds a dynamic regex from enabled currencies and scans text nodes + elements
- Handles split-DOM prices (e.g. `<span>S$</span><span>155</span>`), shadow DOM, SPAs via MutationObserver
- Number parser handles `1.200,00`, `1,200.00`, and K/M/B/T suffixes (`$1.5M`)
- Settings changes trigger a full page reload (`window.location.reload`) to re-scan with new config

## Loading in Chrome
1. Go to `chrome://extensions`
2. Enable Developer mode
3. Click "Load unpacked" → select this folder
