import type { TeamSalesWeeklyResult } from '../pancake-webhook/lib/revenueAnalytics';
import { fmtMoney, fmtPct } from './formatUtils';

function vnLabel(date: string): string {
  const [, mm, dd] = date.split('-');
  return `${dd}/${mm}`;
}

const MEDALS = ['🥇', '🥈', '🥉'];

export function formatTeamSalesZaloText(result: TeamSalesWeeklyResult): string {
  const { weekStart, weekEnd, sellers, total, prevWeekTotal } = result;

  const [yyyy] = weekStart.split('-');
  const weekNum = (() => {
    const d = new Date(weekStart + 'T00:00:00Z');
    const dayOfYear = Math.floor((d.getTime() - new Date(`${yyyy}-01-01T00:00:00Z`).getTime()) / 86_400_000);
    return Math.ceil((dayOfYear + 1) / 7);
  })();

  const header = `📊 Doanh số Team Sale — Tuần ${weekNum}/${yyyy}`;
  const period = `${vnLabel(weekStart)} → ${vnLabel(weekEnd)}/${yyyy}`;

  const lines: string[] = [header, period, ''];

  if (sellers.length === 0) {
    lines.push('Chưa có dữ liệu đơn hàng trong tuần này.');
    return lines.join('\n');
  }

  // Leaderboard
  lines.push('🏆 Bảng xếp hạng:');
  sellers.forEach((s, i) => {
    const medal = MEDALS[i] ?? `${i + 1}.`;
    lines.push(`${medal} ${s.name}`);
    lines.push(`   ${s.orderCount} đơn  |  thực ${fmtMoney(s.netRevenue)}  |  gốc ${fmtMoney(s.grossRevenue)}`);

    const topSources = Object.entries(s.sources)
      .sort(([, a], [, b]) => b.revenue - a.revenue)
      .slice(0, 3)
      .map(([name, v]) => `${name} ${v.orders}đ`)
      .join('  ·  ');
    if (topSources) lines.push(`   Kênh: ${topSources}`);
  });

  // Team total
  lines.push('');
  lines.push(`📦 Cả team: ${total.orderCount} đơn  |  thực ${fmtMoney(total.netRevenue)}  |  gốc ${fmtMoney(total.grossRevenue)}`);

  if (prevWeekTotal.orderCount > 0) {
    const cmpOrders  = fmtPct(total.orderCount, prevWeekTotal.orderCount);
    const cmpRevenue = fmtPct(total.netRevenue, prevWeekTotal.netRevenue);
    lines.push(`vs tuần trước: đơn ${cmpOrders}  |  doanh thu ${cmpRevenue}`);
    lines.push(`(tuần trước: ${prevWeekTotal.orderCount} đơn  |  ${fmtMoney(prevWeekTotal.netRevenue)})`);
  }

  return lines.join('\n');
}
