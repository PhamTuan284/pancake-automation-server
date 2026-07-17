import PancakeWebhookEvent from '../../../common/models/PancakeWebhookEvent';
import { connectMongo, useMongo } from '../../../common/mongo';
import { listWebhookEvents } from './pancakeWebhook';
import { mongoShopKeyFilter, eventMatchesShopKey } from './shopKeyFilter';

export type SellerWeekly = {
  name: string;
  orderCount: number;
  grossRevenue: number;
  netRevenue: number;
  sources: Record<string, { orders: number; revenue: number }>;
};

export type TeamSalesWeeklyResult = {
  weekStart: string; // YYYY-MM-DD VN (Monday)
  weekEnd: string;   // YYYY-MM-DD VN (Sunday)
  sellers: SellerWeekly[];
  total: { orderCount: number; grossRevenue: number; netRevenue: number };
  prevWeekTotal: { orderCount: number; grossRevenue: number; netRevenue: number };
  shopKey: string;
};

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
        ...mongoShopKeyFilter(shopKey),
      };
      // Sort newest-first so the limit trims OLD events, never today's orders.
      const docs = await PancakeWebhookEvent.find(filter)
        .sort({ receivedAt: -1 })
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
      if (!eventMatchesShopKey(ev.shopKey, shopKey)) continue;
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

// ---- Team sales analytics ----

type RawOrderFull = RawOrder & { seller: string };

function extractSeller(payload: unknown): string {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 'Không phân công';
  const root = payload as Record<string, unknown>;

  // 1. Order-level assigning_seller
  const rootSeller = root.assigning_seller as Record<string, unknown> | null | undefined;
  if (rootSeller?.name) return trimStr(rootSeller.name);

  // 2. Order creator
  const creator = root.creator as Record<string, unknown> | null | undefined;
  if (creator?.name) return trimStr(creator.name);

  // 3. Most frequent assigning_seller across items
  const items = root.items as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(items) && items.length > 0) {
    const counts = new Map<string, number>();
    for (const item of items) {
      const s = item.assigning_seller as Record<string, unknown> | null | undefined;
      const n = trimStr(s?.name);
      if (n) counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    if (counts.size > 0) {
      return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    }
  }

  return 'Không phân công';
}

function extractRevenueFull(payload: unknown, receivedAt: string): RawOrderFull | null {
  const base = extractRevenue(payload, receivedAt);
  if (!base) return null;
  return { ...base, seller: extractSeller(payload) };
}

/** Returns Monday YYYY-MM-DD of the ISO week containing `vnDate`. */
function weekMonday(vnDate: string): string {
  const d = new Date(vnDate + 'T00:00:00Z');
  const day = d.getUTCDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function addDaysDate(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export async function computeTeamSalesAnalytics(options?: {
  shopKey?: string;
  /** VN date inside the target week; defaults to current week */
  targetVnDate?: string;
}): Promise<TeamSalesWeeklyResult> {
  const shopKey = options?.shopKey ?? 'meit';
  const todayVn = options?.targetVnDate
    ?? new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);

  // Current week: Mon → Sun
  const weekStart = weekMonday(todayVn);
  const weekEnd   = addDaysDate(weekStart, 6);
  // Previous week: Mon → Sun
  const prevStart = addDaysDate(weekStart, -7);
  const prevEnd   = addDaysDate(weekStart, -1);

  const since = new Date(prevStart + 'T00:00:00+07:00');
  const latestByOrderId = new Map<string, RawOrderFull>();

  const upsert = (raw: RawOrderFull) => {
    const ex = latestByOrderId.get(raw.orderId);
    if (!ex || raw.receivedAt > ex.receivedAt) latestByOrderId.set(raw.orderId, raw);
  };

  if (useMongo()) {
    try {
      await connectMongo();
      const filter: Record<string, unknown> = {
        receivedAt: { $gte: since },
        kind: 'orders',
        ...mongoShopKeyFilter(shopKey),
      };
      // Sort newest-first so the limit trims OLD events, never this week's orders.
      const docs = await PancakeWebhookEvent.find(filter).sort({ receivedAt: -1 }).limit(5000).lean();
      for (const doc of docs) {
        const raw = extractRevenueFull(doc.payload, new Date(doc.receivedAt || new Date()).toISOString());
        if (raw) upsert(raw);
      }
    } catch (err) {
      console.error('[team-sales] Mongo read failed:', err);
    }
  }

  if (latestByOrderId.size === 0) {
    const memory = await listWebhookEvents(2000);
    for (const ev of memory) {
      if (ev.kind !== 'orders') continue;
      if (new Date(ev.at) < since) continue;
      if (!eventMatchesShopKey(ev.shopKey, shopKey)) continue;
      const raw = extractRevenueFull(ev.payload, ev.at);
      if (raw) upsert(raw);
    }
  }

  const sellerMap = new Map<string, SellerWeekly>();
  const total = { orderCount: 0, grossRevenue: 0, netRevenue: 0 };
  const prevWeekTotal = { orderCount: 0, grossRevenue: 0, netRevenue: 0 };

  for (const order of latestByOrderId.values()) {
    const inCurrent = order.date >= weekStart && order.date <= weekEnd;
    const inPrev    = order.date >= prevStart && order.date <= prevEnd;

    if (inCurrent) {
      total.orderCount++;
      total.grossRevenue += order.gross;
      total.netRevenue   += order.net;

      let seller = sellerMap.get(order.seller);
      if (!seller) {
        seller = { name: order.seller, orderCount: 0, grossRevenue: 0, netRevenue: 0, sources: {} };
        sellerMap.set(order.seller, seller);
      }
      seller.orderCount++;
      seller.grossRevenue += order.gross;
      seller.netRevenue   += order.net;
      const src = seller.sources[order.source] ?? { orders: 0, revenue: 0 };
      src.orders++;
      src.revenue += order.net;
      seller.sources[order.source] = src;
    }

    if (inPrev) {
      prevWeekTotal.orderCount++;
      prevWeekTotal.grossRevenue += order.gross;
      prevWeekTotal.netRevenue   += order.net;
    }
  }

  const sellers = [...sellerMap.values()].sort((a, b) => b.netRevenue - a.netRevenue);
  return { weekStart, weekEnd, sellers, total, prevWeekTotal, shopKey };
}
