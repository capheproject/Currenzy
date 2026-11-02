# Currenzy

A Chrome extension (Manifest V3) that converts prices into your currency right on the page.

- Detects currency amounts in page text and shows the converted value inline, with the original in a tooltip.
- Handles prices split across elements (e.g. `<span>S$</span><span>155</span>`), shadow DOM, and single-page apps.
- Understands `1.200,00`, `1,200.00` and suffixes like `$1.5M`.
- Right-click selected text to convert it manually.
- Rates come from the free [fawazahmed0/currency-api](https://github.com/fawazahmed0/exchange-api) (no API key), refreshed daily and cached locally.

## Install

1. Go to `chrome://extensions`
2. Turn on Developer mode
3. Click **Load unpacked** and select this folder

## License

MIT
