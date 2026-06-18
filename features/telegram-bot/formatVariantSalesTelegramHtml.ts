import type { VariantSalesRow } from '../pancake-webhook/lib/variantSalesAnalytics';

export type TelegramReportInput = {
  windowDays: number;
  orderEventsUsed: number;
  variants: VariantSalesRow[];
};

// Target ≤ 36 chars per row so the <pre> block fits mobile without wrapping.
// Row formula: W_RANK + 1 + W_CODE + 1 + W_SOLD + 1 + W_AVG + 1 + W_STOCK + 1 + W_DAYS = 36
const W_RANK  = 2;   //  '#'     — right-align
const W_CODE  = 12;  // 'Mã SP'  — left-align, truncate at 12
const W_SOLD  = 3;   // 'Bán'   — right-align
const W_AVG   = 6;   // 'Bán/ng' — right-align, e.g. '11.6' (6 = header length)
const W_STOCK = 4;   // 'Tồn'   — right-align, e.g. '1556'
const W_DAYS  = 5;   // 'Hết'   — right-align, e.g. '170ng'
const W_FLAG  = 1;   //  status — 'X' | '!' | ' '
// Total row width: 2+1+12+1+3+1+6+1+4+1+5+1+1 = 39 chars
const GAP = ' ';

function padL(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : ' '.repeat(w - s.length) + s;
}

function padR(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : s + ' '.repeat(w - s.length);
}

function fmtInt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return Math.round(n).toString();
}

function fmtAvg(n: number): string {
  return Number.isFinite(n) ? n.toFixed(1) : '—';
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtDays(v: VariantSalesRow): string {
  const n = v.daysUntilSellOut;
  if (n == null) return '—';
  return `${Math.round(n)}ng`;
}

function statusFlag(stock: number | null, days: number | null): string {
  if (stock === 0 || (days != null && days <= 3)) return 'X';
  if (days != null && days <= 7) return '!';
  return ' ';
}

function buildRow(v: VariantSalesRow, displayRank: number): string {
  const rank  = padL(String(displayRank), W_RANK);
  const code  = padR(escapeHtml(v.variantCode || '—'), W_CODE);
  const sold  = padL(fmtInt(v.soldInWindow), W_SOLD);
  const avg   = padL(fmtAvg(v.avgSoldPerDay), W_AVG);
  const stock = padL(v.currentStock != null ? fmtInt(v.currentStock) : '—', W_STOCK);
  const days  = padL(fmtDays(v), W_DAYS);
  const flag  = padL(statusFlag(v.currentStock, v.daysUntilSellOut), W_FLAG);
  return `${rank}${GAP}${code}${GAP}${sold}${GAP}${avg}${GAP}${stock}${GAP}${days}${GAP}${flag}`;
}

function buildTable(rows: VariantSalesRow[]): string {
  const header =
    padL('#',    W_RANK)  + GAP +
    padR('Mã SP', W_CODE) + GAP +
    padL('Bán',  W_SOLD)  + GAP +
    padL('Bán/ng',  W_AVG)   + GAP +
    padL('Tồn',  W_STOCK) + GAP +
    padL('Hết',  W_DAYS)  + GAP +
    padL(' ',    W_FLAG);
  const divider = '─'.repeat(header.length);
  return [header, divider, ...rows.map((v, i) => buildRow(v, i + 1))].join('\n');
}

function normalizeLimit(limit?: unknown): number {
  const n = Number(limit);
  if (!Number.isInteger(n) || n <= 0) return 15;
  return Math.min(n, 50);
}

export function formatVariantSalesTelegramHtml(
  analytics: TelegramReportInput,
  options?: { limit?: unknown }
): { html: string; lineCount: number } {
  const limit = normalizeLimit(options?.limit);
  const rows = analytics.variants.slice(0, limit);

  const topLabel =
    rows.length < analytics.variants.length
      ? `Top ${rows.length}/${analytics.variants.length} biến thể`
      : `${analytics.variants.length} biến thể`;

  const title =
    `📊 <b>Bán chạy ${analytics.windowDays} ngày</b>` +
    `  •  ${analytics.orderEventsUsed} đơn  •  ${topLabel}`;

  if (rows.length === 0) {
    return { html: `${title}\n\nChưa có dữ liệu bán trong kỳ.`, lineCount: 0 };
  }

  const table = buildTable(rows);
  const legend = `<i>Hết: X=nguy hiểm  !=sắp hết(≤7ng)  ng=ngày</i>`;

  return {
    html: `${title}\n\n<pre>${table}</pre>\n${legend}`,
    lineCount: rows.length,
  };
}
