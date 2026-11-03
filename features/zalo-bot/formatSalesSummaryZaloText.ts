import type { SalesSummaryProduct } from '../pancake-webhook/lib/salesSummaryAnalytics';

export function buildSalesSummaryHeaderText(windowDays: number, from: string, to: string): string {
  const vnLabel = (iso: string) => {
    const d = new Date(new Date(iso).getTime() + 7 * 60 * 60 * 1000);
    return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  };
  return [
    `🛍 Tổng hợp bán hàng ${windowDays} ngày`,
    `📅 ${vnLabel(from)} → ${vnLabel(to)}`,
    '━━━━━━━━━━━━━━━━━━━━━━━━',
  ].join('\n');
}

export function buildSalesSummaryChunkText(chunk: SalesSummaryProduct[]): string {
  const blocks: string[] = [];
  for (const p of chunk) {
    const colorMap = new Map<string, Array<{ size: string; qty: number }>>();
    for (const v of p.variants) {
      const key = v.color || '__';
      if (!colorMap.has(key)) colorMap.set(key, []);
      colorMap.get(key)!.push({ size: v.size, qty: v.qty });
    }

    const lines: string[] = [`🔖 ${p.productCode}`];
    for (const [colorKey, items] of colorMap) {
      const label = colorKey === '__' ? '' : `${colorKey}: `;
      const sizes = items.map((it) => `${it.qty}${it.size}`).join(' · ');
      lines.push(`  ${label}${sizes}`);
    }
    lines.push(`  📦 Tổng bán: ${p.totalQty}`);

    blocks.push(lines.join('\n'));
  }
  return blocks.join('\n─────────────────────\n');
}

/** Header for the admin "sold qty by product + date range" report: date range plus a per-code total line. */
export function buildProductSalesRangeHeaderText(
  fromDate: string,
  toDate: string,
  sold: SalesSummaryProduct[],
  unsoldCodes: string[]
): string {
  const label = (ymd: string) => {
    const [y, m, d] = ymd.split('-');
    return `${d}/${m}/${y}`;
  };
  const total = sold.reduce((sum, p) => sum + p.totalQty, 0);
  const lines = [
    '📊 Số lượng đã bán theo mã',
    `📅 ${label(fromDate)} → ${label(toDate)}`,
    '━━━━━━━━━━━━━━━━━━━━━━━━',
    ...sold.map((p) => `• ${p.productCode}: ${p.totalQty}`),
    ...unsoldCodes.map((c) => `• ${c}: 0`),
    '━━━━━━━━━━━━━━━━━━━━━━━━',
    `📦 Tổng: ${total}`,
  ];
  return lines.join('\n');
}
