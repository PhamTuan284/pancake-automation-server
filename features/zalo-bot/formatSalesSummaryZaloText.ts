import type { SalesSummaryProduct } from '../pancake-webhook/lib/salesSummaryAnalytics';

function fmtMoney(n: number): string {
  return n > 0 ? `${n.toLocaleString('vi-VN')}đ` : '—';
}

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
    const colorMap = new Map<string, Array<{ size: string; qty: number; currentStock: number | null }>>();
    for (const v of p.variants) {
      const key = v.color || '__';
      if (!colorMap.has(key)) colorMap.set(key, []);
      colorMap.get(key)!.push({ size: v.size, qty: v.qty, currentStock: v.currentStock });
    }

    const lines: string[] = [`🔖 ${p.productCode}`];
    for (const [colorKey, items] of colorMap) {
      const label = colorKey === '__' ? '' : `${colorKey}: `;
      const sizes = items.map((it) => `${it.qty}/${it.currentStock ?? '?'}${it.size}`).join(' · ');
      lines.push(`  ${label}${sizes}`);
    }
    lines.push('  (bán/tồn theo size)');

    let totalListValue = 0;
    let totalNetValue = 0;
    for (const v of p.variants) {
      totalListValue += v.listPrice * v.qty;
      totalNetValue += v.netPrice * v.qty;
    }
    const avgListPrice = p.totalQty > 0 ? Math.round(totalListValue / p.totalQty) : 0;
    const avgNetPrice = p.totalQty > 0 ? Math.round(totalNetValue / p.totalQty) : 0;
    lines.push(`  💰 Giá NY: ${fmtMoney(avgListPrice)}  ·  Thực nhận TB: ${fmtMoney(avgNetPrice)}`);
    lines.push(`  📦 Tổng bán: ${p.totalQty}`);

    blocks.push(lines.join('\n'));
  }
  return blocks.join('\n─────────────────────\n');
}
