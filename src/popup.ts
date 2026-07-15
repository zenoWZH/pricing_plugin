// Popup logic: load settings, save changes, live conversion preview.
import { isDecimalsSetting, loadSettings, type DecimalsSetting, type DisplayMode } from './settings';
import { formatUsd } from './format';

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`popup: missing #${id}`);
  return el as T;
}

const $enabled = byId<HTMLInputElement>('enabled');
const $rate = byId<HTMLInputElement>('rate');
const $rateRow = byId<HTMLDivElement>('rate-row');
const $rateError = byId<HTMLParagraphElement>('rate-error');
const $preview = byId<HTMLParagraphElement>('preview');
const $decimals = byId<HTMLSelectElement>('decimals');
const $modes = [...document.querySelectorAll<HTMLInputElement>('input[name="mode"]')];

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function currentRate(): number {
  return parseFloat($rate.value);
}

function currentDecimals(): DecimalsSetting {
  return isDecimalsSetting($decimals.value) ? $decimals.value as DecimalsSetting : 'auto';
}

function updatePreview(): boolean {
  const rate = currentRate();
  if (!(rate > 0)) {
    $rateRow.classList.add('invalid');
    $rateError.hidden = false;
    $preview.textContent = '';
    return false;
  }
  $rateRow.classList.remove('invalid');
  $rateError.hidden = true;

  $preview.innerHTML = '';
  const sample = document.createDocumentFragment();
  sample.append('¥100 ≈ ');
  const b = document.createElement('b');
  b.textContent = formatUsd(100 / rate, currentDecimals());
  sample.append(b, `   ·   ¥1 ≈ ${formatUsd(1 / rate, 'auto')}`);
  $preview.append(sample);
  return true;
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 200);
}

function save(): void {
  const rate = currentRate();
  const mode: DisplayMode = ($modes.find(r => r.checked)?.value === 'replace') ? 'replace' : 'append';
  const payload: Record<string, unknown> = {
    enabled: $enabled.checked,
    mode,
    decimals: currentDecimals()
  };
  if (rate > 0) payload.rate = rate;
  chrome.storage.sync.set(payload);
}

void loadSettings().then(s => {
  $enabled.checked = Boolean(s.enabled);
  $rate.value = String(s.rate);
  $decimals.value = isDecimalsSetting(s.decimals) ? String(s.decimals) : 'auto';
  const mode = $modes.find(r => r.value === s.mode) ?? $modes[0];
  if (mode) mode.checked = true;
  updatePreview();
});

$enabled.addEventListener('change', save);
$decimals.addEventListener('change', () => {
  updatePreview();
  save();
});
$modes.forEach(r => r.addEventListener('change', save));
$rate.addEventListener('input', () => {
  if (updatePreview()) scheduleSave();
});
