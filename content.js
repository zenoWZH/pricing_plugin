// RMB → USD Price Converter — content-script JS shell (Go/WASM build).
//
// The DOM work lives here; the conversion brain lives in Go, compiled to
// dist/converter.wasm. WASM has no DOM or chrome.* access, so this shell:
//   1. instantiates the Go module (wasm_exec.js provides the Go runtime),
//   2. walks the page and hands text-node strings to Go's segment(),
//   3. builds annotation spans from the segments Go returns,
//   4. asks Go's formatUsd() for display strings on every refresh,
//   5. owns chrome.storage, the MutationObserver, and enable/disable.
(() => {
  'use strict';

  if (window.__rmb2usdLoaded) return;
  window.__rmb2usdLoaded = true;
  if (!(typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync)) return;

  const WRAP_CLASS = 'r2u-wrap';
  const ORIG_CLASS = 'r2u-orig';
  const USD_CLASS = 'r2u-usd';

  const DEFAULTS = {
    enabled: true,
    rate: 7,           // CNY per 1 USD
    mode: 'append',    // 'append' | 'replace'
    decimals: 'auto'   // 'auto' | '4' | '5' | '6' — always at least 4
  };
  let settings = { ...DEFAULTS };
  let started = false;
  let wasmReady = false;

  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'INPUT',
    'SELECT', 'OPTION', 'IFRAME', 'OBJECT', 'EMBED', 'CANVAS', 'TITLE'
  ]);

  // document + any open shadow roots we have discovered.
  const roots = new Set([document]);

  // ------------------------------------------------------------ WASM bridge

  async function initWasm() {
    const go = new Go(); // provided by wasm_exec.js, injected before this file
    const url = chrome.runtime.getURL('dist/converter.wasm');
    let instance;
    try {
      ({ instance } = await WebAssembly.instantiateStreaming(fetch(url), go.importObject));
    } catch {
      // Some servers/contexts lose the wasm MIME type; fall back to bytes.
      const bytes = await (await fetch(url)).arrayBuffer();
      ({ instance } = await WebAssembly.instantiate(bytes, go.importObject));
    }
    void go.run(instance); // resolves only if the Go program exits — it never does
    await new Promise((resolve, reject) => {
      const t0 = Date.now();
      (function poll() {
        if (window.__r2uGo && window.__r2uGo.ready) return resolve();
        if (Date.now() - t0 > 5000) return reject(new Error('Go WASM exports never appeared'));
        setTimeout(poll, 10);
      })();
    });
    wasmReady = true;
  }

  function goSegment(text) {
    return JSON.parse(window.__r2uGo.segment(text));
  }

  function goFormatUsd(value, decimals) {
    return window.__r2uGo.formatUsd(value, decimals);
  }

  // ---------------------------------------------------------------- helpers

  function skippableElement(el) {
    if (SKIP_TAGS.has(el.tagName)) return true;
    if (typeof SVGElement !== 'undefined' && el instanceof SVGElement) return true;
    if (el.isContentEditable) return true;
    if (el.classList && el.classList.contains(WRAP_CLASS)) return true;
    return false;
  }

  function convertibleTextNode(node) {
    const parent = node.parentElement;
    if (!parent) return false;
    if (skippableElement(parent)) return false;
    if (parent.closest('.' + WRAP_CLASS)) return false;
    if (parent.closest('[contenteditable=""], [contenteditable="true"]')) return false;
    return true;
  }

  // ------------------------------------------------------------- DOM output

  function makeWrap(originalText, cnyValue) {
    const wrap = document.createElement('span');
    wrap.className = WRAP_CLASS;
    wrap.dataset.cny = String(cnyValue);

    const orig = document.createElement('span');
    orig.className = ORIG_CLASS;
    orig.textContent = originalText;

    const usd = document.createElement('span');
    usd.className = USD_CLASS;
    // Inline styles so annotations also work inside open shadow roots,
    // where an injected stylesheet would not reach.
    usd.style.cssText = [
      'margin-left:.3em',
      'padding:0 .3em',
      'border-radius:.3em',
      'background:rgba(22,163,74,.14)',
      'color:#16a34a',
      'font-weight:600',
      'font-size:.92em',
      'white-space:nowrap'
    ].join(';');

    wrap.append(orig, usd);
    refreshWrap(wrap);
    return wrap;
  }

  function refreshWrap(wrap) {
    const orig = wrap.querySelector('.' + ORIG_CLASS);
    const usd = wrap.querySelector('.' + USD_CLASS);
    if (!orig || !usd) return;

    const cny = parseFloat(wrap.dataset.cny);
    const rate = Number(settings.rate);
    if (!settings.enabled || !wasmReady || !isFinite(cny) || !(rate > 0)) {
      usd.style.display = 'none';
      orig.style.display = '';
      wrap.removeAttribute('title');
      return;
    }

    const text = goFormatUsd(cny / rate, String(settings.decimals));
    usd.textContent = text;
    usd.style.display = '';
    orig.style.display = settings.mode === 'replace' ? 'none' : '';
    usd.style.marginLeft = settings.mode === 'replace' ? '0' : '.3em';
    wrap.title = `${orig.textContent} ≈ ${text}  (1 USD = ${rate} RMB)`;
  }

  function refreshAll() {
    for (const root of roots) {
      root.querySelectorAll('.' + WRAP_CLASS).forEach(refreshWrap);
    }
  }

  // Remove every annotation and restore the original text nodes.
  function unwrapAll() {
    for (const root of roots) {
      const parents = new Set();
      root.querySelectorAll('.' + WRAP_CLASS).forEach(wrap => {
        const orig = wrap.querySelector('.' + ORIG_CLASS);
        const parent = wrap.parentNode;
        wrap.replaceWith(document.createTextNode(orig ? orig.textContent : ''));
        if (parent) parents.add(parent);
      });
      parents.forEach(p => p.normalize());
    }
  }

  // ---------------------------------------------------------------- scanner

  function processTextNode(node) {
    const text = node.nodeValue;
    if (!text || text.length > 20000 || !node.isConnected) return;

    const segs = goSegment(text);
    if (segs.length === 0) return;
    if (!convertibleTextNode(node)) return;

    const frag = document.createDocumentFragment();
    for (const seg of segs) {
      if (seg.cny === undefined) {
        frag.append(seg.s);
      } else {
        frag.append(makeWrap(seg.s, seg.cny));
      }
    }
    node.replaceWith(frag);
  }

  function scan(node) {
    if (!node) return;
    if (node.nodeType === Node.TEXT_NODE) {
      processTextNode(node);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE &&
        node.nodeType !== Node.DOCUMENT_NODE &&
        node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE && skippableElement(node)) return;

    const doc = node.ownerDocument || node;
    const shadows = [];
    const walker = doc.createTreeWalker(node, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (n.nodeType === Node.ELEMENT_NODE) {
          if (skippableElement(n)) return NodeFilter.FILTER_REJECT;
          if (n.shadowRoot) shadows.push(n.shadowRoot);
          return NodeFilter.FILTER_SKIP;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    // Collect first — processTextNode mutates the tree under the walker.
    const texts = [];
    while (walker.nextNode()) texts.push(walker.currentNode);
    texts.forEach(processTextNode);

    if (node.nodeType === Node.ELEMENT_NODE && node.shadowRoot) shadows.push(node.shadowRoot);
    shadows.forEach(registerRoot);
  }

  function registerRoot(shadowRoot) {
    roots.add(shadowRoot);
    if (started) observer.observe(shadowRoot, OBSERVE_OPTS);
    scan(shadowRoot);
  }

  // --------------------------------------------------------------- observer

  const OBSERVE_OPTS = { childList: true, subtree: true, characterData: true };
  const pending = new Set();
  let flushTimer = null;

  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'characterData') {
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
    // Ignore our own output (and anything inside it).
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.classList.contains(WRAP_CLASS)) return;
      if (node.parentElement && node.parentElement.closest('.' + WRAP_CLASS)) return;
    } else if (node.nodeType === Node.TEXT_NODE) {
      if (node.parentElement && node.parentElement.closest('.' + WRAP_CLASS)) return;
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

  // ---------------------------------------------------------------- control

  function start() {
    if (started || !wasmReady) return;
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', () => {
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

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const key of Object.keys(changes)) {
      if (key in settings) settings[key] = changes[key].newValue;
    }
    if (settings.enabled) {
      start();
      refreshAll();
    } else {
      stop();
    }
  });

  const settingsLoaded = new Promise(resolve => {
    chrome.storage.sync.get(DEFAULTS, stored => {
      settings = { ...DEFAULTS, ...stored };
      resolve();
    });
  });

  Promise.all([settingsLoaded, initWasm()])
    .then(() => {
      if (settings.enabled) start();
    })
    .catch(err => {
      console.error('[rmb2usd] Go/WASM core failed to initialize:', err);
    });
})();
