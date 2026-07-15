// Popup logic: load settings, save changes, live conversion preview.
(() => {
  'use strict';

  const DEFAULTS = {
    enabled: true,
    rate: 7,
    mode: 'append',
    decimals: 'auto'
  };

  const $enabled = document.getElementById('enabled');
  const $rate = document.getElementById('rate');
  const $rateRow = document.getElementById('rate-row');
  const $rateError = document.getElementById('rate-error');
  const $preview = document.getElementById('preview');
  const $decimals = document.getElementById('decimals');
  const $modes = [...document.querySelectorAll('input[name="mode"]')];

  let saveTimer = null;

  // Mirrors content.js: at least 4 decimal places, rounded; 'auto' extends
  // for sub-cent prices, fixed values pin the width.
  function formatUsd(value, decimals) {
    let min = 4;
    let max = 4;
    if (decimals === 'auto') {
      if (value > 0 && value < 1) {
        max = Math.max(4, Math.min(8, 2 - Math.floor(Math.log10(value))));
      }
    } else {
      const d = Math.max(4, Math.min(8, parseInt(decimals, 10) || 4));
      min = d;
      max = d;
    }
    return '$' + value.toLocaleString('en-US', {
      minimumFractionDigits: min,
      maximumFractionDigits: max
    });
  }

  function currentRate() {
    return parseFloat($rate.value);
  }

  function updatePreview() {
    const rate = currentRate();
    if (!(rate > 0)) {
      $rateRow.classList.add('invalid');
      $rateError.hidden = false;
      $preview.textContent = '';
      return false;
    }
    $rateRow.classList.remove('invalid');
    $rateError.hidden = true;
    const decimals = $decimals.value;
    $preview.innerHTML = '';
    const sample = document.createDocumentFragment();
    sample.append('¥100 ≈ ');
    const b = document.createElement('b');
    b.textContent = formatUsd(100 / rate, decimals);
    sample.append(b, `   ·   ¥1 ≈ ${formatUsd(1 / rate, 'auto')}`);
    $preview.append(sample);
    return true;
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 200);
  }

  function save() {
    const rate = currentRate();
    const payload = {
      enabled: $enabled.checked,
      mode: ($modes.find(r => r.checked) || $modes[0]).value,
      decimals: $decimals.value
    };
    if (rate > 0) payload.rate = rate;
    chrome.storage.sync.set(payload);
  }

  chrome.storage.sync.get(DEFAULTS, stored => {
    const s = { ...DEFAULTS, ...stored };
    $enabled.checked = Boolean(s.enabled);
    $rate.value = s.rate;
    $decimals.value = ['auto', '4', '5', '6'].includes(String(s.decimals)) ? String(s.decimals) : 'auto';
    const mode = $modes.find(r => r.value === s.mode) || $modes[0];
    mode.checked = true;
    updatePreview();
  });

  $enabled.addEventListener('change', save);
  $decimals.addEventListener('change', () => { updatePreview(); save(); });
  $modes.forEach(r => r.addEventListener('change', save));
  $rate.addEventListener('input', () => {
    if (updatePreview()) scheduleSave();
  });
})();
