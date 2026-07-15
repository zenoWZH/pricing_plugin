"use strict";
(() => {
  // src/settings.ts
  var DEFAULTS = {
    enabled: true,
    rate: 7,
    mode: "append",
    decimals: "auto"
  };
  function loadSettings() {
    return new Promise((resolve) => {
      const defaults = DEFAULTS;
      chrome.storage.sync.get(defaults, (stored) => {
        resolve({ ...DEFAULTS, ...stored });
      });
    });
  }
  function onSettingsChanged(fn) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync") return;
      const patch = {};
      for (const key of Object.keys(changes)) {
        if (key in DEFAULTS) patch[key] = changes[key]?.newValue;
      }
      fn(patch);
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

  // src/matcher.ts
  var PRICE_RE = /(?:¥|￥|\b(?:RMB|CNY))\s*([0-9][0-9,]*(?:\.[0-9]+)?)(?:\s*([万亿]))?|\b([0-9][0-9,]*(?:\.[0-9]+)?)(?:\s*([万亿]))?\s*(?:元|(?:RMB|CNY)\b)/g;
  function multiplierOf(ch) {
    return ch === "\u4E07" ? 1e4 : ch === "\u4EBF" ? 1e8 : 1;
  }
  function findPrices(text) {
    const out = [];
    PRICE_RE.lastIndex = 0;
    let m;
    while ((m = PRICE_RE.exec(text)) !== null) {
      const numStr = m[1] ?? m[3];
      const mult = m[1] !== void 0 ? m[2] : m[4];
      if (numStr === void 0) continue;
      const cny = parseFloat(numStr.replace(/,/g, "")) * multiplierOf(mult);
      if (Number.isFinite(cny)) out.push({ index: m.index, text: m[0], cny });
    }
    return out;
  }

  // src/content.ts
  (() => {
    if (window.__rmb2usdLoaded) return;
    window.__rmb2usdLoaded = true;
    if (typeof chrome === "undefined" || !chrome.storage?.sync) return;
    const WRAP_CLASS = "r2u-wrap";
    const ORIG_CLASS = "r2u-orig";
    const USD_CLASS = "r2u-usd";
    let settings = { ...DEFAULTS };
    let started = false;
    const SKIP_TAGS = /* @__PURE__ */ new Set([
      "SCRIPT",
      "STYLE",
      "NOSCRIPT",
      "TEMPLATE",
      "TEXTAREA",
      "INPUT",
      "SELECT",
      "OPTION",
      "IFRAME",
      "OBJECT",
      "EMBED",
      "CANVAS",
      "TITLE"
    ]);
    const roots = /* @__PURE__ */ new Set([document]);
    function skippableElement(el) {
      if (SKIP_TAGS.has(el.tagName)) return true;
      if (el instanceof SVGElement) return true;
      if (el instanceof HTMLElement && el.isContentEditable) return true;
      if (el.classList.contains(WRAP_CLASS)) return true;
      return false;
    }
    function convertibleTextNode(node) {
      const parent = node.parentElement;
      if (!parent) return false;
      if (skippableElement(parent)) return false;
      if (parent.closest("." + WRAP_CLASS)) return false;
      if (parent.closest('[contenteditable=""], [contenteditable="true"]')) return false;
      return true;
    }
    function makeWrap(originalText, cnyValue) {
      const wrap = document.createElement("span");
      wrap.className = WRAP_CLASS;
      wrap.dataset.cny = String(cnyValue);
      const orig = document.createElement("span");
      orig.className = ORIG_CLASS;
      orig.textContent = originalText;
      const usd = document.createElement("span");
      usd.className = USD_CLASS;
      usd.style.cssText = [
        "margin-left:.3em",
        "padding:0 .3em",
        "border-radius:.3em",
        "background:rgba(22,163,74,.14)",
        "color:#16a34a",
        "font-weight:600",
        "font-size:.92em",
        "white-space:nowrap"
      ].join(";");
      wrap.append(orig, usd);
      refreshWrap(wrap);
      return wrap;
    }
    function refreshWrap(wrap) {
      const orig = wrap.querySelector("." + ORIG_CLASS);
      const usd = wrap.querySelector("." + USD_CLASS);
      if (!orig || !usd) return;
      const cny = parseFloat(wrap.dataset.cny ?? "");
      const rate = Number(settings.rate);
      if (!settings.enabled || !Number.isFinite(cny) || !(rate > 0)) {
        usd.style.display = "none";
        orig.style.display = "";
        wrap.removeAttribute("title");
        return;
      }
      const text = formatUsd(cny / rate, settings.decimals);
      usd.textContent = text;
      usd.style.display = "";
      orig.style.display = settings.mode === "replace" ? "none" : "";
      usd.style.marginLeft = settings.mode === "replace" ? "0" : ".3em";
      wrap.title = `${orig.textContent} \u2248 ${text}  (1 USD = ${rate} RMB)`;
    }
    function refreshAll() {
      for (const root of roots) {
        root.querySelectorAll("." + WRAP_CLASS).forEach(refreshWrap);
      }
    }
    function unwrapAll() {
      for (const root of roots) {
        const parents = /* @__PURE__ */ new Set();
        root.querySelectorAll("." + WRAP_CLASS).forEach((wrap) => {
          const orig = wrap.querySelector("." + ORIG_CLASS);
          const parent = wrap.parentNode;
          wrap.replaceWith(document.createTextNode(orig?.textContent ?? ""));
          if (parent) parents.add(parent);
        });
        parents.forEach((p) => p.normalize());
      }
    }
    function processTextNode(node) {
      const text = node.nodeValue;
      if (!text || text.length > 2e4 || !node.isConnected) return;
      const matches = findPrices(text);
      if (matches.length === 0) return;
      if (!convertibleTextNode(node)) return;
      const frag = document.createDocumentFragment();
      let last = 0;
      for (const m of matches) {
        if (m.index > last) frag.append(text.slice(last, m.index));
        frag.append(makeWrap(m.text, m.cny));
        last = m.index + m.text.length;
      }
      if (last < text.length) frag.append(text.slice(last));
      node.replaceWith(frag);
    }
    function scan(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        processTextNode(node);
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
        return;
      }
      if (node.nodeType === Node.ELEMENT_NODE && skippableElement(node)) return;
      const doc = node.ownerDocument ?? node;
      const shadows = [];
      const walker = doc.createTreeWalker(node, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode(n) {
          if (n.nodeType === Node.ELEMENT_NODE) {
            const el = n;
            if (skippableElement(el)) return NodeFilter.FILTER_REJECT;
            if (el.shadowRoot) shadows.push(el.shadowRoot);
            return NodeFilter.FILTER_SKIP;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      const texts = [];
      while (walker.nextNode()) texts.push(walker.currentNode);
      texts.forEach(processTextNode);
      if (node.nodeType === Node.ELEMENT_NODE) {
        const shadow = node.shadowRoot;
        if (shadow) shadows.push(shadow);
      }
      shadows.forEach(registerRoot);
    }
    function registerRoot(shadowRoot) {
      roots.add(shadowRoot);
      if (started) observer.observe(shadowRoot, OBSERVE_OPTS);
      scan(shadowRoot);
    }
    const OBSERVE_OPTS = { childList: true, subtree: true, characterData: true };
    const pending = /* @__PURE__ */ new Set();
    let flushTimer = null;
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "characterData") {
          enqueue(record.target);
        } else {
          record.addedNodes.forEach(enqueue);
        }
      }
      if (pending.size && !flushTimer) {
        flushTimer = setTimeout(flush, 150);
      }
    });
    function enqueue(node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node;
        if (el.classList.contains(WRAP_CLASS)) return;
        if (el.parentElement?.closest("." + WRAP_CLASS)) return;
      } else if (node.nodeType === Node.TEXT_NODE) {
        if (node.parentElement?.closest("." + WRAP_CLASS)) return;
      } else {
        return;
      }
      pending.add(node);
    }
    function flush() {
      flushTimer = null;
      const batch = [...pending];
      pending.clear();
      for (const node of batch) {
        if (node.isConnected) scan(node);
      }
    }
    function start() {
      if (started) return;
      if (!document.body) {
        document.addEventListener("DOMContentLoaded", () => {
          if (settings.enabled) start();
        }, { once: true });
        return;
      }
      started = true;
      for (const root of roots) {
        observer.observe(root === document ? document.documentElement : root, OBSERVE_OPTS);
      }
      scan(document.body);
    }
    function stop() {
      if (!started) return;
      started = false;
      observer.disconnect();
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      pending.clear();
      unwrapAll();
    }
    onSettingsChanged((patch) => {
      settings = { ...settings, ...patch };
      if (settings.enabled) {
        start();
        refreshAll();
      } else {
        stop();
      }
    });
    void loadSettings().then((loaded) => {
      settings = loaded;
      if (settings.enabled) start();
    });
  })();
})();
