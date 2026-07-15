"use strict";
(() => {
  // src/settings.ts
  var DEFAULTS = {
    enabled: true,
    rate: 7,
    mode: "append",
    decimals: "auto"
  };
  var DECIMAL_CHOICES = ["auto", "4", "5", "6"];
  function isDecimalsSetting(v) {
    return DECIMAL_CHOICES.includes(String(v));
  }
  function loadSettings() {
    return new Promise((resolve) => {
      const defaults = DEFAULTS;
      chrome.storage.sync.get(defaults, (stored) => {
        resolve({ ...DEFAULTS, ...stored });
      });
    });
  }

  // src/format.ts
  function formatUsd(value, decimals) {
    let min = 4;
    let max = 4;
    if (decimals === "auto") {
      if (value > 0 && value < 1) {
        max = Math.max(4, Math.min(8, 2 - Math.floor(Math.log10(value))));
      }
    } else {
      const d = Math.max(4, Math.min(8, parseInt(decimals, 10) || 4));
      min = d;
      max = d;
    }
    return "$" + value.toLocaleString("en-US", {
      minimumFractionDigits: min,
      maximumFractionDigits: max
    });
  }

  // src/popup.ts
  function byId(id) {
    const el = document.getElementById(id);
    if (!el) throw new Error(`popup: missing #${id}`);
    return el;
  }
  var $enabled = byId("enabled");
  var $rate = byId("rate");
  var $rateRow = byId("rate-row");
  var $rateError = byId("rate-error");
  var $preview = byId("preview");
  var $decimals = byId("decimals");
  var $modes = [...document.querySelectorAll('input[name="mode"]')];
  var saveTimer = null;
  function currentRate() {
    return parseFloat($rate.value);
  }
  function currentDecimals() {
    return isDecimalsSetting($decimals.value) ? $decimals.value : "auto";
  }
  function updatePreview() {
    const rate = currentRate();
    if (!(rate > 0)) {
      $rateRow.classList.add("invalid");
      $rateError.hidden = false;
      $preview.textContent = "";
      return false;
    }
    $rateRow.classList.remove("invalid");
    $rateError.hidden = true;
    $preview.innerHTML = "";
    const sample = document.createDocumentFragment();
    sample.append("\xA5100 \u2248 ");
    const b = document.createElement("b");
    b.textContent = formatUsd(100 / rate, currentDecimals());
    sample.append(b, `   \xB7   \xA51 \u2248 ${formatUsd(1 / rate, "auto")}`);
    $preview.append(sample);
    return true;
  }
  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 200);
  }
  function save() {
    const rate = currentRate();
    const mode = $modes.find((r) => r.checked)?.value === "replace" ? "replace" : "append";
    const payload = {
      enabled: $enabled.checked,
      mode,
      decimals: currentDecimals()
    };
    if (rate > 0) payload.rate = rate;
    chrome.storage.sync.set(payload);
  }
  void loadSettings().then((s) => {
    $enabled.checked = Boolean(s.enabled);
    $rate.value = String(s.rate);
    $decimals.value = isDecimalsSetting(s.decimals) ? String(s.decimals) : "auto";
    const mode = $modes.find((r) => r.value === s.mode) ?? $modes[0];
    if (mode) mode.checked = true;
    updatePreview();
  });
  $enabled.addEventListener("change", save);
  $decimals.addEventListener("change", () => {
    updatePreview();
    save();
  });
  $modes.forEach((r) => r.addEventListener("change", save));
  $rate.addEventListener("input", () => {
    if (updatePreview()) scheduleSave();
  });
})();
