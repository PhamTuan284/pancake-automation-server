import type { DailyRevenue, RevenueAnalyticsResult } from '../pancake-webhook/lib/revenueAnalytics';

function fmtMoney(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}tỷ`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}tr`;
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.') + 'đ';
}

function fmtPct(curr: number, prev: number): string {
  if (prev === 0) return curr > 0 ? '+∞%' : '—';
  const pct = ((curr - prev) / prev) * 100;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

function vnDateLabel(date: string): string {
  if (!date) return '—';
  const [, mm, dd] = date.split('-');
  return `${dd}/${mm}`;
}

function vnMonthLabel(date: string): string {
  if (!date) return '—';
  const [yyyy, mm] = date.split('-');
  return `tháng ${parseInt(mm, 10)}/${yyyy}`;
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00+07:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function sourceRows(day: DailyRevenue | undefined, topN = 4): string {
  if (!day || Object.keys(day.sources).length === 0) return '';
  const sorted = Object.entries(day.sources)
    .sort(([, a], [, b]) => b.revenue - a.revenue)
    .slice(0, topN);
  return sorted
    .map(([name, s]) => `  ${name.padEnd(12)} ${s.orders} đơn  |  ${fmtMoney(s.revenue)}`)
    .join('\n');
}

export function formatDailyRevenueText(result: RevenueAnalyticsResult, todayVnDate: string): string {
  const { byDay } = result;
  const today = byDay.get(todayVnDate);
  const yesterday = byDay.get(addDays(todayVnDate, -1));
  const lastWeek  = byDay.get(addDays(todayVnDate, -7));

  const [yyyy, mm, dd] = todayVnDate.split('-');
  const header = `📈 Doanh thu hôm nay — ${dd}/${mm}/${yyyy}`;

  if (!today || today.orderCount === 0) {
    return `${header}\n\nChưa có đơn hàng nào hôm nay.`;
  }

  const lines: string[] = [header, ''];
  lines.push(`🛒 ${today.orderCount} đơn  |  gốc ${fmtMoney(today.grossRevenue)}  |  thực ${fmtMoney(today.netRevenue)}`);

  if (yesterday && yesterday.orderCount > 0) {
    lines.push('');
    lines.push(`So với hôm qua (${vnDateLabel(addDays(todayVnDate, -1))}):  ${yesterday.orderCount} đơn  |  ${fmtMoney(yesterday.netRevenue)}`);
    lines.push(`  → Đơn: ${fmtPct(today.orderCount, yesterday.orderCount)}  |  Doanh thu: ${fmtPct(today.netRevenue, yesterday.netRevenue)}`);
  }

  if (lastWeek && lastWeek.orderCount > 0) {
    lines.push('');
    lines.push(`So với tuần trước (${vnDateLabel(addDays(todayVnDate, -7))}):  ${lastWeek.orderCount} đơn  |  ${fmtMoney(lastWeek.netRevenue)}`);
    lines.push(`  → Đơn: ${fmtPct(today.orderCount, lastWeek.orderCount)}  |  Doanh thu: ${fmtPct(today.netRevenue, lastWeek.netRevenue)}`);
  }

  const srcRows = sourceRows(today);
  if (srcRows) {
    lines.push('');
    lines.push('Theo kênh:');
    lines.push(srcRows);
  }

  return lines.join('\n');
}

export function formatMonthlyRevenueText(result: RevenueAnalyticsResult, monthVnDate: string): string {
  const { byDay } = result;
  const [yyyy, mm] = monthVnDate.split('-');
  const monthPrefix = `${yyyy}-${mm}`;
  const prevMonthDate = addDays(`${yyyy}-${mm}-01`, -1); // last day of prev month
  const [pY, pM] = prevMonthDate.split('-');
  const prevPrefix = `${pY}-${pM}`;

  let orders = 0, gross = 0, net = 0;
  let daysWithOrders = 0;
  const sourceTotals: Record<string, { orders: number; revenue: number }> = {};

  let prevOrders = 0, prevNet = 0;

  for (const [date, day] of byDay) {
    if (date.startsWith(monthPrefix)) {
      orders += day.orderCount;
      gross += day.grossRevenue;
      net += day.netRevenue;
      if (day.orderCount > 0) daysWithOrders++;
      for (const [src, s] of Object.entries(day.sources)) {
        const t = sourceTotals[src] ?? { orders: 0, revenue: 0 };
        t.orders += s.orders;
        t.revenue += s.revenue;
        sourceTotals[src] = t;
      }
    }
    if (date.startsWith(prevPrefix)) {
      prevOrders += day.orderCount;
      prevNet += day.netRevenue;
    }
  }

  const header = `📊 Tổng kết ${vnMonthLabel(monthVnDate)}`;

  if (orders === 0) {
    return `${header}\n\nChưa có đơn hàng nào trong tháng.`;
  }

  const avgOrders = daysWithOrders > 0 ? (orders / daysWithOrders).toFixed(1) : '—';
  const avgRevenue = daysWithOrders > 0 ? fmtMoney(net / daysWithOrders) : '—';

  const lines: string[] = [header, ''];
  lines.push(`✅ ${orders} đơn  |  gốc ${fmtMoney(gross)}  |  thực ${fmtMoney(net)}`);
  lines.push(`📅 TB/ngày có đơn: ${avgOrders} đơn  |  ${avgRevenue}`);

  if (prevOrders > 0) {
    lines.push('');
    lines.push(`So với ${vnMonthLabel(prevMonthDate)}:  ${prevOrders} đơn  |  ${fmtMoney(prevNet)}`);
    lines.push(`  → Đơn: ${fmtPct(orders, prevOrders)}  |  Doanh thu: ${fmtPct(net, prevNet)}`);
  }

  const sortedSrc = Object.entries(sourceTotals).sort(([, a], [, b]) => b.revenue - a.revenue).slice(0, 5);
  if (sortedSrc.length > 0) {
    lines.push('');
    lines.push('Theo kênh:');
    for (const [name, s] of sortedSrc) {
      lines.push(`  ${name.padEnd(12)} ${s.orders} đơn  |  ${fmtMoney(s.revenue)}`);
    }
  }

  return lines.join('\n');
}
