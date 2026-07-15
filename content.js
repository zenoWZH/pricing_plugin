// RMB → USD Price Converter — content script.
//
// Scans the page for RMB amounts (¥30.00, ￥1,299, CNY 88, RMB 6, 99元,
// 3.5万元, ¥2亿 …) and annotates each one with its USD equivalent using the
// exchange rate configured in the popup. Reacts live to setting changes and
// to content added dynamically (SPAs), and can fully restore the page when
// disabled.
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

  // Matches, in one pass:
  //   symbol/code first:  ¥30.00  ￥1,299.5  CNY 88  RMB6  ¥3.5万  ¥2亿
  //   unit last:          99元  1,000 元  3.5万元  88.8 CNY  6 RMB
  const PRICE_RE = /(?:¥|￥|\b(?:RMB|CNY))\s*([0-9][0-9,]*(?:\.[0-9]+)?)(?:\s*([万亿]))?|\b([0-9][0-9,]*(?:\.[0-9]+)?)(?:\s*([万亿]))?\s*(?:元|(?:RMB|CNY)\b)/g;

  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'INPUT',
    'SELECT', 'OPTION', 'IFRAME', 'OBJECT', 'EMBED', 'CANVAS', 'TITLE'
  ]);

  // document + any open shadow roots we have discovered.
  const roots = new Set([document]);

  // ---------------------------------------------------------------- helpers

  function multiplierOf(ch) {
    return ch === '万' ? 1e4 : ch === '亿' ? 1e8 : 1;
  }

  // Always at least 4 decimal places, rounded. 'auto' extends beyond 4 for
  // sub-cent unit prices so ~3 significant digits survive; '4'/'5'/'6' pin
  // the width exactly.
  function formatUsd(value) {
    let min = 4;
    let max = 4;
    if (settings.decimals === 'auto') {
      if (value > 0 && value < 1) {
        max = Math.max(4, Math.min(8, 2 - Math.floor(Math.log10(value))));
      }
    } else {
      const d = Math.max(4, Math.min(8, parseInt(settings.decimals, 10) || 4));
      min = d;
      max = d;
    }
    return '$' + value.toLocaleString('en-US', {
      minimumFractionDigits: min,
      maximumFractionDigits: max
    });
  }

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
    if (!settings.enabled || !isFinite(cny) || !(rate > 0)) {
      usd.style.display = 'none';
      orig.style.display = '';
      wrap.removeAttribute('title');
      return;
    }

    const text = formatUsd(cny / rate);
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

    PRICE_RE.lastIndex = 0;
    if (!PRICE_RE.test(text)) return;
    if (!convertibleTextNode(node)) return;

    PRICE_RE.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0;
    let m;
    while ((m = PRICE_RE.exec(text)) !== null) {
      const numStr = m[1] !== undefined ? m[1] : m[3];
      const mult = m[1] !== undefined ? m[2] : m[4];
      const value = parseFloat(numStr.replace(/,/g, '')) * multiplierOf(mult);
      if (!isFinite(value)) continue;
      if (m.index > last) frag.append(text.slice(last, m.index));
      frag.append(makeWrap(m[0], value));
      last = m.index + m[0].length;
    }
    if (last === 0) return;
    if (last < text.length) frag.append(text.slice(last));
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
    if (started) return;
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', () => {
        if (settings.enabled) start();
      }, { once: true });
      return;
    }
    started = true;
    for (const root of roots) observer.observe(root === document ? document.documentElement : root, OBSERVE_OPTS);
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

  chrome.storage.sync.get(DEFAULTS, stored => {
    settings = { ...DEFAULTS, ...stored };
    if (settings.enabled) start();
  });
})();
