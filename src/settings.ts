// Shared settings model — the single source of truth for both entry points.

export type DisplayMode = 'append' | 'replace';
export type DecimalsSetting = 'auto' | '4' | '5' | '6';

export interface Settings {
  enabled: boolean;
  /** CNY per 1 USD — the divisor for every conversion. */
  rate: number;
  mode: DisplayMode;
  /** Fraction digits: always at least 4; 'auto' extends for tiny prices. */
  decimals: DecimalsSetting;
}

export const DEFAULTS: Settings = {
  enabled: true,
  rate: 7,
  mode: 'append',
  decimals: 'auto'
};

export const DECIMAL_CHOICES: readonly DecimalsSetting[] = ['auto', '4', '5', '6'];

export function isDecimalsSetting(v: unknown): v is DecimalsSetting {
  return (DECIMAL_CHOICES as readonly string[]).includes(String(v));
}

export function loadSettings(): Promise<Settings> {
  return new Promise(resolve => {
    // @types/chrome wants an index signature on the defaults object.
    const defaults = DEFAULTS as unknown as Record<string, unknown>;
    chrome.storage.sync.get(defaults, stored => {
      resolve({ ...DEFAULTS, ...(stored as Partial<Settings>) });
    });
  });
}

/** Invokes `fn` with the changed keys whenever another context edits settings. */
export function onSettingsChanged(fn: (patch: Partial<Settings>) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    const patch: Partial<Record<keyof Settings, unknown>> = {};
    for (const key of Object.keys(changes) as (keyof Settings)[]) {
      if (key in DEFAULTS) patch[key] = changes[key]?.newValue;
    }
    fn(patch as Partial<Settings>);
  });
}
