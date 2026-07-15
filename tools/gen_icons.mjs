// Regenerates icons/icon{16,48,128}.png by rendering an SVG badge in
// headless Chromium and screenshotting it at each size.
//
// Usage:  node tools/gen_icons.mjs
// Uses a locally installed playwright if present, otherwise the global one.
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  const globalRoot = execSync('npm root -g').toString().trim();
  ({ chromium } = require(join(globalRoot, 'playwright')));
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(repoRoot, 'icons');
mkdirSync(outDir, { recursive: true });

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1f2937"/>
      <stop offset="1" stop-color="#111827"/>
    </linearGradient>
  </defs>
  <rect x="4" y="4" width="120" height="120" rx="26" fill="url(#bg)"/>
  <text x="40" y="56" font-family="'DejaVu Sans', Arial, sans-serif" font-size="52"
        font-weight="bold" fill="#f87171" text-anchor="middle">&#165;</text>
  <path d="M 46 76 L 74 48 M 74 48 L 74 62 M 74 48 L 60 48" stroke="#9ca3af"
        stroke-width="7" stroke-linecap="round" fill="none" transform="rotate(90 60 62)"/>
  <text x="88" y="104" font-family="'DejaVu Sans', Arial, sans-serif" font-size="52"
        font-weight="bold" fill="#34d399" text-anchor="middle">$</text>
</svg>`;

const html = `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;background:transparent}#i{display:inline-block;line-height:0}</style>
<div id="i">${svg}</div>`;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
await page.setContent(html);

for (const size of [128, 48, 16]) {
  await page.evaluate(s => {
    const svgEl = document.querySelector('svg');
    svgEl.setAttribute('width', s);
    svgEl.setAttribute('height', s);
  }, size);
  const el = page.locator('#i');
  await el.screenshot({
    path: join(outDir, `icon${size}.png`),
    omitBackground: true
  });
  console.log(`wrote icons/icon${size}.png`);
}

await browser.close();
