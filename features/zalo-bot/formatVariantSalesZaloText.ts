import type { VariantSalesRow } from '../pancake-webhook/lib/variantSalesAnalytics';

export type ZaloReportInput = {
  windowDays: number;
  orderEventsUsed: number;
  variants: VariantSalesRow[];
};

function fmtAvg(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toFixed(1);
}

function fmtDays(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${Math.round(n)}ng`;
}

function statusEmoji(stock: number | null, days: number | null): string {
  if (stock === 0 || (days != null && days <= 3)) return ' 🔴';
  if (days != null && days <= 7) return ' ⚠️';
  return '';
}

function buildRow(v: VariantSalesRow, rank: number): string {
  const code  = v.variantCode || '—';
  const sold  = v.soldInWindow != null ? String(Math.round(v.soldInWindow)) : '—';
  const avg   = fmtAvg(v.avgSoldPerDay);
  const stock = v.currentStock != null ? String(Math.round(v.currentStock)) : '—';
  const days  = fmtDays(v.daysUntilSellOut);
  const flag  = statusEmoji(v.currentStock, v.daysUntilSellOut);

  return `${rank}. ${code} — ${sold} bán · ${avg}/ng · tồn ${stock} · hết ${days}${flag}`;
}

function normalizeLimit(limit?: unknown): number {
  const n = Number(limit);
  if (!Number.isInteger(n) || n <= 0) return 15;
  return Math.min(n, 50);
}

export function formatVariantSalesZaloText(
  analytics: ZaloReportInput,
  options?: { limit?: unknown }
): { text: string; lineCount: number } {
  const limit = normalizeLimit(options?.limit);
  const rows = analytics.variants.slice(0, limit);

  const topLabel =
    rows.length < analytics.variants.length
      ? `Top ${rows.length}/${analytics.variants.length} biến thể`
      : `${analytics.variants.length} biến thể`;

  const title = `📊 Bán chạy ${analytics.windowDays} ngày  •  ${analytics.orderEventsUsed} đơn  •  ${topLabel}`;

  if (rows.length === 0) {
    return { text: `${title}\n\nChưa có dữ liệu bán trong kỳ.`, lineCount: 0 };
  }

  const body = rows.map((v, i) => buildRow(v, i + 1)).join('\n');
  const legend = '🔴 nguy hiểm (hết/≤3ng)  ⚠️ sắp hết (≤7ng)';

  return {
    text: `${title}\n\n${body}\n\n${legend}`,
    lineCount: rows.length,
  };
}
