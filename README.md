# RMB → USD Price Converter (Chrome extension)

Reading a page priced in RMB (like an AI-model pricing dashboard showing
`¥30.0000 / 1M Tokens`)? This extension shows the USD equivalent right next to
every RMB price, using an exchange rate **you** set — no network calls, no
tracking, everything stays local.

```
输入价格 ¥30.0000 / 1M Tokens      →      输入价格 ¥30.0000 [$4.2857] / 1M Tokens
```

## Features

- **Custom exchange rate** — set “1 USD = ? RMB” in the popup; conversions on
  every open tab update instantly.
- **Recognizes common RMB formats** — `¥30.00`, `￥1,234.56`, `CNY 88.8`,
  `RMB6`, `99元`, plus `万`/`亿` multipliers (`3.5万元`, `¥2亿`).
- **Two display modes** — *Append* keeps the original price and adds a green
  USD badge; *Replace* shows only the USD amount (hover to see the original).
- **Precise decimals** — every USD amount shows at least 4 decimal places,
  rounded (`¥30.0000` → `$4.2857`). “Auto” adds extra digits for sub-cent
  unit prices (`¥0.0100 / 1M Tokens` → `$0.00143`); or pin exactly 4–6.
- **Works on dynamic pages** — a MutationObserver converts content added later
  (SPAs, infinite scroll), and open shadow DOM is handled too.
- **Cleanly reversible** — toggling the extension off restores the page text.
- Settings sync via `chrome.storage.sync` (only permission the extension asks
  for, besides running on pages).

## Documentation

- **[Usage guide](docs/USAGE.md)** — installation, every setting explained,
  supported price formats, troubleshooting, privacy.
- **[Architecture](docs/ARCHITECTURE.md)** — how the content script scans and
  annotates pages, the settings flow, design decisions, testing, limitations.

## Install (Load unpacked)

1. Clone or download this repository.
2. Open `chrome://extensions` in Chrome / Edge / any Chromium browser.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select this repository folder.
5. Pin the “RMB → USD Price Converter” icon and click it to set your rate.

To test it on the bundled demo page, either serve it
(`npx http-server . -p 8080` → `http://localhost:8080/demo/demo.html`) or open
`demo/demo.html` directly after enabling **Allow access to file URLs** for the
extension in `chrome://extensions`.

## Usage

- Click the toolbar icon to open settings:
  - **Toggle** conversion on/off (off fully restores pages).
  - **Exchange rate** — how many RMB one USD buys (default `7`).
  - **Display** — Append (badge next to the price) or Replace.
  - **USD decimals** — Auto (≥4), or exactly 4, 5, or 6.
- Hover any converted price to see `original ≈ USD (rate)` as a tooltip.
- Changes save automatically and apply to open tabs immediately — no reload
  needed.

## Development (Go/WASM branch)

The conversion core is Go compiled to WebAssembly; the compiled module is
committed, so Load-unpacked works without any toolchain. To modify the core
you need Go ≥ 1.21:

```bash
./tools/build_wasm.sh   # rebuilds dist/converter.wasm + refreshes wasm_exec.js
```

Then reload the extension in `chrome://extensions`. The JS shell
(`content.js`) and popup need no build step.

## Repository layout

| Path                  | Purpose                                              |
| --------------------- | ---------------------------------------------------- |
| `manifest.json`       | MV3 manifest (WASM CSP + web-accessible resource)    |
| `go/main.go`          | Go conversion core: matching, parsing, formatting    |
| `dist/converter.wasm` | Compiled core, committed (~3.3 MB)                   |
| `wasm_exec.js`        | Go's JS runtime shim (vendored from the Go distro)   |
| `content.js`          | JS shell: DOM walking, annotations, storage          |
| `popup.html/js`       | Settings UI (plain JS)                               |
| `tools/build_wasm.sh` | Rebuilds the WASM module                             |
| `icons/`              | Toolbar/store icons                                  |
| `tools/gen_icons.mjs` | Regenerates the icons (`node tools/gen_icons.mjs`)   |
| `demo/demo.html`      | Demo/test page with typical and edge-case prices     |
| `docs/`               | Usage guide and architecture documentation           |

## Notes & limitations

- `¥` is also used for Japanese yen; the extension assumes it means RMB. If a
  page mixes JPY and RMB, use the toggle per-need.
- A price split across multiple DOM elements (e.g. `<span>¥</span><span>30</span>`)
  is not detected — the symbol and number must be in the same text node, which
  covers the vast majority of sites.
- Closed shadow roots cannot be reached by any extension.
