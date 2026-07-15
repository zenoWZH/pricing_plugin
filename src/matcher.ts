// Pure text→price matching, independent of the DOM.

export interface PriceMatch {
  /** Start offset of the match within the input string. */
  index: number;
  /** The exact matched substring, e.g. "¥30.0000" or "3.5万元". */
  text: string;
  /** Parsed amount in yuan (multipliers applied). */
  cny: number;
}

// Matches, in one pass:
//   symbol/code first:  ¥30.00  ￥1,299.5  CNY 88  RMB6  ¥3.5万  ¥2亿
//   unit last:          99元  1,000 元  3.5万元  88.8 CNY  6 RMB
const PRICE_RE =
  /(?:¥|￥|\b(?:RMB|CNY))\s*([0-9][0-9,]*(?:\.[0-9]+)?)(?:\s*([万亿]))?|\b([0-9][0-9,]*(?:\.[0-9]+)?)(?:\s*([万亿]))?\s*(?:元|(?:RMB|CNY)\b)/g;

function multiplierOf(ch: string | undefined): number {
  return ch === '万' ? 1e4 : ch === '亿' ? 1e8 : 1;
}

export function findPrices(text: string): PriceMatch[] {
  const out: PriceMatch[] = [];
  PRICE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PRICE_RE.exec(text)) !== null) {
    const numStr = m[1] ?? m[3];
    const mult = m[1] !== undefined ? m[2] : m[4];
    if (numStr === undefined) continue;
    const cny = parseFloat(numStr.replace(/,/g, '')) * multiplierOf(mult);
    if (Number.isFinite(cny)) out.push({ index: m.index, text: m[0], cny });
  }
  return out;
}
