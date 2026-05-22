import type { VariantSalesRow } from './variantSalesAnalytics';

export type VariantSalesZaloReportInput = {
  windowDays: number;
  orderEventsUsed: number;
  stockEventsUsed: number;
  variants: VariantSalesRow[];
};

function formatQty(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return Number(n).toLocaleString('vi-VN');
}

function formatRowLine(v: VariantSalesRow): string {
  return (
    `${v.hotRank}. ${v.variantCode || '—'} | SP: ${v.productCode || '—'}\n` +
    `   Đã bán: ${formatQty(v.soldInWindow)} | TB/ngày: ${formatQty(v.avgSoldPerDay)} | ` +
    `Tồn: ${formatQty(v.currentStock)} | Hết ~: ${formatQty(v.daysUntilSellOut)} ngày`
  );
}

function normalizeLimit(limit?: unknown): number {
  const n = Number(limit);
  if (!Number.isInteger(n) || n <= 0) return 15;
  return Math.min(n, 50);
}

export function formatVariantSalesZaloText(
  analytics: VariantSalesZaloReportInput,
  options?: { limit?: unknown }
): { text: string; lineCount: number } {
  const limit = normalizeLimit(options?.limit);
  const rows = analytics.variants.slice(0, limit);

  const header = [
    `📊 Biến thể bán chạy (${analytics.windowDays} ngày)`,
    `Đơn webhook: ${analytics.orderEventsUsed} · Tồn webhook: ${analytics.stockEventsUsed}`,
    rows.length < analytics.variants.length
      ? `Top ${rows.length} / ${analytics.variants.length} biến thể`
      : `${analytics.variants.length} biến thể`,
    '',
  ].join('\n');

  if (rows.length === 0) {
    return {
      text: `${header}Chưa có dữ liệu bán trong kỳ.`,
      lineCount: 0,
    };
  }

  const body = rows.map(formatRowLine).join('\n\n');
  return {
    text: `${header}${body}`,
    lineCount: rows.length,
  };
}
