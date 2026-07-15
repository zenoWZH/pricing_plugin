# Usage Guide

RMB → USD Price Converter annotates RMB prices on any web page with their USD
equivalent, converted at an exchange rate you control. Everything runs locally
in your browser — no network requests, no analytics, no accounts.

## Installation

The extension is not on the Chrome Web Store; install it unpacked:

1. Clone or download this repository (or unzip a release archive).
2. Open `chrome://extensions` in Chrome, Edge, Brave, or any Chromium browser.
3. Turn on **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the repository folder (the one
   containing `manifest.json`).
5. (Optional) Click the puzzle-piece icon in the toolbar and pin
   **RMB → USD Price Converter** so its icon is always visible.

To upgrade later, pull the new code and press the ↻ reload button on the
extension's card in `chrome://extensions`.

## Setting the exchange rate

Click the toolbar icon to open the settings popup:

| Setting | What it does |
| --- | --- |
| **On/off switch** (top right) | Enables or disables conversion everywhere. Turning it off restores every page to its original text. |
| **Exchange rate** | How many RMB one USD buys, e.g. `7.25`. This is the number *you* choose — check your bank, card issuer, or a rate site and enter the rate that matters to you. |
| **Display** | *Append* keeps the original price and adds a green USD badge after it: `¥30.0000 [$4.14]`. *Replace* hides the RMB amount and shows only `$4.14`. |
| **USD decimals** | *Auto* uses 2 decimals normally but keeps ~3 significant digits for sub-dollar amounts (`¥0.4000` → `$0.0552`), which matters on per-token AI pricing pages. Or pin exactly 2, 3, or 4 decimals. |

Every change saves automatically and applies **immediately to all open
tabs** — you never need to reload a page. Settings sync through your browser
profile (`chrome.storage.sync`), so they follow you to other machines where
you're signed in.

## Reading the annotations

- The green badge after a price is the USD equivalent:
  `补全价格 ¥150.0000 [$20.69] / 1M Tokens`.
- Hover any converted price to see a tooltip with the exact conversion and
  the rate used: `¥150.0000 ≈ $20.69 (1 USD = 7.25 RMB)`.
- In *Replace* mode the tooltip is how you check the original RMB amount.

## What gets converted

| Written as | Example | Converted |
| --- | --- | --- |
| Half-width yuan sign | `¥30.0000` | ✔ |
| Full-width yuan sign | `￥1,234.56` | ✔ |
| Currency code before | `CNY 88.8`, `RMB6` | ✔ |
| Currency code after | `88.8 CNY`, `6 RMB` | ✔ |
| 元 suffix | `99元` | ✔ |
| 万 / 亿 multipliers | `3.5万元`, `¥2亿` | ✔ (×10 000 / ×100 000 000) |
| Other currencies | `$19.99`, `€10.00` | ✘ left untouched |

Prices added to the page *after* it loads (single-page apps, infinite
scroll, tab switches inside dashboards) are converted automatically as they
appear.

## Trying it on the demo page

`demo/demo.html` reproduces an AI-model pricing dashboard plus edge cases.
Two ways to open it:

- Serve it: `npx http-server . -p 8080`, then visit
  `http://localhost:8080/demo/demo.html`; or
- Open the file directly — but first enable **Allow access to file URLs**
  for this extension on its card in `chrome://extensions`.

The demo includes an "add a dynamic row" button to see live conversion of
injected content.

## Troubleshooting

**Nothing converts on a `file://` page** — enable *Allow access to file
URLs* on the extension card in `chrome://extensions`.

**One specific price isn't converted** — the symbol and the number must sit
in the same text node. A few sites render `<span>¥</span><span>30</span>`,
which the scanner deliberately doesn't stitch together (see
[ARCHITECTURE.md](ARCHITECTURE.md#known-limitations)).

**A Japanese-yen price got converted** — `¥` is shared by JPY and RMB; the
extension assumes RMB. On JPY pages, flip the switch off for a moment.

**Copied text contains the badge** — in *Append* mode the USD text is part
of the page, so copy includes it. Switch to *Replace* (copies only the USD
value) or toggle off before copying.

**Prices look stale after editing the rate** — they shouldn't; changes apply
live. If a page misbehaves, reload it — the content script starts fresh.

## Privacy & permissions

- `storage` — saves your four settings; that's the only Chrome permission
  requested.
- Content-script access to pages (`http`/`https`/`file`) is required to read
  and annotate prices; nothing is transmitted anywhere. There is no
  background service worker, no fetch calls, and no third-party code.
