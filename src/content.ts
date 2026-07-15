// RMB → USD Price Converter — content script (TypeScript build).
//
// Scans the page for RMB amounts and annotates each one with its USD
// equivalent using the exchange rate configured in the popup. Reacts live to
// setting changes and to content added dynamically (SPAs), and can fully
// restore the page when disabled.
import { DEFAULTS, loadSettings, onSettingsChanged, type Settings } from './settings';
import { formatUsd } from './format';
import { findPrices } from './matcher';

declare global {
  interface Window {
    __rmb2usdLoaded?: boolean;
  }
}

(() => {
  if (window.__rmb2usdLoaded) return;
  window.__rmb2usdLoaded = true;
  if (typeof chrome === 'undefined' || !chrome.storage?.sync) return;

  const WRAP_CLASS = 'r2u-wrap';
  const ORIG_CLASS = 'r2u-orig';
  const USD_CLASS = 'r2u-usd';

  let settings: Settings = { ...DEFAULTS };
  let started = false;

  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'INPUT',
    'SELECT', 'OPTION', 'IFRAME', 'OBJECT', 'EMBED', 'CANVAS', 'TITLE'
  ]);

  // document + any open shadow roots we have discovered.
  const roots = new Set<Document | ShadowRoot>([document]);

  // ---------------------------------------------------------------- helpers

  function skippableElement(el: Element): boolean {
    if (SKIP_TAGS.has(el.tagName)) return true;
    if (el instanceof SVGElement) return true;
    if (el instanceof HTMLElement && el.isContentEditable) return true;
    if (el.classList.contains(WRAP_CLASS)) return true;
    return false;
  }

  function convertibleTextNode(node: Text): boolean {
    const parent = node.parentElement;
    if (!parent) return false;
    if (skippableElement(parent)) return false;
    if (parent.closest('.' + WRAP_CLASS)) return false;
    if (parent.closest('[contenteditable=""], [contenteditable="true"]')) return false;
    return true;
  }

  // ------------------------------------------------------------- DOM output

  function makeWrap(originalText: string, cnyValue: number): HTMLSpanElement {
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

  function refreshWrap(wrap: HTMLElement): void {
    const orig = wrap.querySelector<HTMLElement>('.' + ORIG_CLASS);
    const usd = wrap.querySelector<HTMLElement>('.' + USD_CLASS);
    if (!orig || !usd) return;

    const cny = parseFloat(wrap.dataset.cny ?? '');
    const rate = Number(settings.rate);
    if (!settings.enabled || !Number.isFinite(cny) || !(rate > 0)) {
      usd.style.display = 'none';
      orig.style.display = '';
      wrap.removeAttribute('title');
      return;
    }

    const text = formatUsd(cny / rate, settings.decimals);
    usd.textContent = text;
    usd.style.display = '';
    orig.style.display = settings.mode === 'replace' ? 'none' : '';
    usd.style.marginLeft = settings.mode === 'replace' ? '0' : '.3em';
    wrap.title = `${orig.textContent} ≈ ${text}  (1 USD = ${rate} RMB)`;
  }

  function refreshAll(): void {
    for (const root of roots) {
      root.querySelectorAll<HTMLElement>('.' + WRAP_CLASS).forEach(refreshWrap);
    }
  }

  // Remove every annotation and restore the original text nodes.
  function unwrapAll(): void {
    for (const root of roots) {
      const parents = new Set<Node>();
      root.querySelectorAll<HTMLElement>('.' + WRAP_CLASS).forEach(wrap => {
        const orig = wrap.querySelector<HTMLElement>('.' + ORIG_CLASS);
        const parent = wrap.parentNode;
        wrap.replaceWith(document.createTextNode(orig?.textContent ?? ''));
        if (parent) parents.add(parent);
      });
      parents.forEach(p => p.normalize());
    }
  }

  // ---------------------------------------------------------------- scanner

  function processTextNode(node: Text): void {
    const text = node.nodeValue;
    if (!text || text.length > 20000 || !node.isConnected) return;

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

  function scan(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      processTextNode(node as Text);
      return;
    }
    if (
      node.nodeType !== Node.ELEMENT_NODE &&
      node.nodeType !== Node.DOCUMENT_NODE &&
      node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE
    ) {
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE && skippableElement(node as Element)) return;

    const doc = node.ownerDocument ?? (node as Document);
    const shadows: ShadowRoot[] = [];
    const walker = doc.createTreeWalker(node, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(n: Node): number {
        if (n.nodeType === Node.ELEMENT_NODE) {
          const el = n as Element;
          if (skippableElement(el)) return NodeFilter.FILTER_REJECT;
          if (el.shadowRoot) shadows.push(el.shadowRoot);
          return NodeFilter.FILTER_SKIP;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    // Collect first — processTextNode mutates the tree under the walker.
    const texts: Text[] = [];
    while (walker.nextNode()) texts.push(walker.currentNode as Text);
    texts.forEach(processTextNode);

    if (node.nodeType === Node.ELEMENT_NODE) {
      const shadow = (node as Element).shadowRoot;
      if (shadow) shadows.push(shadow);
    }
    shadows.forEach(registerRoot);
  }

  function registerRoot(shadowRoot: ShadowRoot): void {
    roots.add(shadowRoot);
    if (started) observer.observe(shadowRoot, OBSERVE_OPTS);
    scan(shadowRoot);
  }

  // --------------------------------------------------------------- observer

  const OBSERVE_OPTS: MutationObserverInit = { childList: true, subtree: true, characterData: true };
  const pending = new Set<Node>();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

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

  function enqueue(node: Node): void {
    // Ignore our own output (and anything inside it).
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      if (el.classList.contains(WRAP_CLASS)) return;
      if (el.parentElement?.closest('.' + WRAP_CLASS)) return;
    } else if (node.nodeType === Node.TEXT_NODE) {
      if (node.parentElement?.closest('.' + WRAP_CLASS)) return;
    } else {
      return;
    }
    pending.add(node);
  }

  function flush(): void {
    flushTimer = null;
    const batch = [...pending];
    pending.clear();
    for (const node of batch) {
      if (node.isConnected) scan(node);
    }
  }

  // ---------------------------------------------------------------- control

  function start(): void {
    if (started) return;
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

  function stop(): void {
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

  onSettingsChanged(patch => {
    settings = { ...settings, ...patch };
    if (settings.enabled) {
      start();
      refreshAll();
    } else {
      stop();
    }
  });

  void loadSettings().then(loaded => {
    settings = loaded;
    if (settings.enabled) start();
  });
})();
