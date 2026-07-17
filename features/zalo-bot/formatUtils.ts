/** Shared formatting helpers for Zalo report texts. */

/** Compact VND: 1.2tỷ / 3.4tr / 950.000đ */
export function fmtMoney(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}tỷ`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}tr`;
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.') + 'đ';
}

/** Signed percent change vs a previous value: +12.3% / -4.5% / — */
export function fmtPct(curr: number, prev: number): string {
  if (prev === 0) return curr > 0 ? '+∞%' : '—';
  const pct = ((curr - prev) / prev) * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}
