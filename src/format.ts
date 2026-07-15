import type { DecimalsSetting } from './settings';

// Always at least 4 decimal places, rounded. 'auto' extends beyond 4 for
// sub-cent unit prices so ~3 significant digits survive; '4'/'5'/'6' pin
// the width exactly.
export function formatUsd(value: number, decimals: DecimalsSetting): string {
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
