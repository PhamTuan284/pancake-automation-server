import PancakeWebhookEvent from '../../../common/models/PancakeWebhookEvent';
import { connectMongo, useMongo } from '../../../common/mongo';
import { listWebhookEvents } from './pancakeWebhook';

export type DailyRevenue = {
  date: string; // YYYY-MM-DD VN
  orderCount: number;
  grossRevenue: number;
  netRevenue: number;
  sources: Record<string, { orders: number; revenue: number }>;
};

export type RevenueAnalyticsResult = {
  byDay: Map<string, DailyRevenue>;
  shopKey: string;
};

type RawOrder = {
  orderId: string;
  date: string;        // YYYY-MM-DD VN, from inserted_at
  receivedAt: string;  // ISO — used to pick latest update per order
  gross: number;
  net: number;
  source: string;
};

function trimStr(v: unknown): string {
  return String(v ?? '').trim();
}

function isoToVnDate(iso: string): string {
  // inserted_at from Pancake has no timezone suffix → treat as UTC+7 local
  // webhook receivedAt is UTC ISO. We add 7h offset.
  try {
    const d = new Date(iso.includes('T') && !iso.endsWith('Z') && !iso.includes('+')
      ? iso + '+07:00'
      : iso);
    const vn = new Date(d.getTime() + (iso.endsWith('Z') || iso.includes('+') ? 7 * 3_600_000 : 0));
    return vn.toISOString().slice(0, 10);
  } catch {
    return '';
  }
}

function isVnToday(vnDate: string, todayVnDate: string): boolean {
  return vnDate === todayVnDate;
}

function extractRevenue(payload: unknown, receivedAt: string): RawOrder | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const root = payload as Record<string, unknown>;

  const status = trimStr(root.status ?? root.state ?? '').toLowerCase();
  if (status.includes('cancel') || status.includes('return') || status.includes('refund') || status === 'deleted') {
    return null;
  }

  const orderId = trimStr(root.id ?? root.order_id ?? '');
  if (!orderId) return null;

  const gross = Number(root.total_price ?? 0);
  const net = Number(root.total_price_after_sub_discount ?? root.total_price ?? 0);
  if (gross <= 0) return null;

  const rawInserted = trimStr(root.inserted_at ?? root.created_at ?? '');
  const date = rawInserted ? isoToVnDate(rawInserted) : '';
  if (!date) return null;

  const source = trimStr(root.order_sources_name ?? root.source_name ?? 'Khác') || 'Khác';

  return { orderId, date, receivedAt, gross, net, source };
}

function buildDayEntry(): DailyRevenue {
  return { date: '', orderCount: 0, grossRevenue: 0, netRevenue: 0, sources: {} };
}

function mergeOrder(byDay: Map<string, DailyRevenue>, order: RawOrder): void {
  let day = byDay.get(order.date);
  if (!day) {
    day = buildDayEntry();
    day.date = order.date;
    byDay.set(order.date, day);
  }
  day.orderCount += 1;
  day.grossRevenue += order.gross;
  day.netRevenue += order.net;

  const src = day.sources[order.source] ?? { orders: 0, revenue: 0 };
  src.orders += 1;
  src.revenue += order.net;
  day.sources[order.source] = src;
}

export async function computeRevenueAnalytics(options?: {
  shopKey?: string;
  days?: number;
}): Promise<RevenueAnalyticsResult> {
  const shopKey = options?.shopKey ?? 'meit';
  const days = Math.max(1, Math.min(90, Number(options?.days) || 35));
  const since = new Date(Date.now() - days * 24 * 60 * 60_000);

  // orderId → latest raw order (most recent receivedAt wins)
  const latestByOrderId = new Map<string, RawOrder>();

  const upsert = (raw: RawOrder) => {
    const existing = latestByOrderId.get(raw.orderId);
    if (!existing || raw.receivedAt > existing.receivedAt) {
      latestByOrderId.set(raw.orderId, raw);
    }
  };

  if (useMongo()) {
    try {
      await connectMongo();
      const filter: Record<string, unknown> = {
        receivedAt: { $gte: since },
        kind: 'orders',
      };
      if (shopKey === 'meit') {
        filter.$or = [{ shopKey }, { shopKey: '' }, { shopKey: { $exists: false } }];
      } else {
        filter.shopKey = shopKey;
      }
      const docs = await PancakeWebhookEvent.find(filter)
        .sort({ receivedAt: 1 })
        .limit(5000)
        .lean();
      for (const doc of docs) {
        const raw = extractRevenue(doc.payload, new Date(doc.receivedAt || new Date()).toISOString());
        if (raw) upsert(raw);
      }
    } catch (err) {
      console.error('[revenue] Mongo read failed, fallback to memory:', err);
      // fall through to in-memory
    }
  }

  if (latestByOrderId.size === 0) {
    const memory = await listWebhookEvents(2000);
    for (const ev of memory) {
      if (ev.kind !== 'orders') continue;
      if (new Date(ev.at) < since) continue;
      if (shopKey !== 'meit' && (ev.shopKey || 'meit') !== shopKey) continue;
      const raw = extractRevenue(ev.payload, ev.at);
      if (raw) upsert(raw);
    }
  }

  const byDay = new Map<string, DailyRevenue>();
  for (const order of latestByOrderId.values()) {
    mergeOrder(byDay, order);
  }

  return { byDay, shopKey };
}
