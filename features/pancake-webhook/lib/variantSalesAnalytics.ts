import PancakeWebhookEvent from '../../../common/models/PancakeWebhookEvent';
import { connectMongo, useMongo } from '../../../common/mongo';
import {
  extractPancakeProductCodes,
  mergePancakeProductCodes,
  type PancakeProductCodes,
} from './pancakeProductCodes';
import { listWebhookEvents } from './pancakeWebhook';

/** Public API row (merchant codes only, no Pancake numeric ids). */
export type VariantSalesRow = {
  productCode: string;
  variantCode: string;
  soldInWindow: number;
  avgSoldPerDay: number;
  soldByDay: { date: string; quantity: number }[];
  currentStock: number | null;
  daysUntilSellOut: number | null;
  hotRank: number;
  lastSoldAt: string | null;
  stockUpdatedAt: string | null;
  stockSource: 'webhook' | 'catalog' | null;
};

/** Includes variationId for catalog enrichment; stripped before HTTP response. */
export type VariantSalesRowInternal = VariantSalesRow & {
  variationId: string;
};

export type VariantSalesAnalyticsResult = {
  windowDays: number;
  from: string;
  to: string;
  orderEventsUsed: number;
  stockEventsUsed: number;
  variants: VariantSalesRowInternal[];
  note: string;
};

export function stripVariantSalesInternalIds(
  analytics: VariantSalesAnalyticsResult
): Omit<VariantSalesAnalyticsResult, 'variants'> & {
  variants: VariantSalesRow[];
} {
  return {
    ...analytics,
    variants: analytics.variants.map(({ variationId: _id, ...row }) => row),
  };
}

type LineItem = {
  variationId: string;
  quantity: number;
  codes: PancakeProductCodes;
};

type StockSnapshot = {
  variationId: string;
  quantity: number;
  at: string;
  codes: PancakeProductCodes;
};

type VariantAccumulator = {
  variationId: string;
  codes: PancakeProductCodes;
  soldByDay: Map<string, number>;
  soldInWindow: number;
  lastSoldAt: string | null;
};

function trimString(value: unknown): string {
  return String(value ?? '').trim();
}

function toPositiveNumber(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function toNonNegativeNumber(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function normalizeDays(days?: unknown): number {
  const n = Number(days);
  if (!Number.isInteger(n) || n <= 0) return 7;
  return Math.min(n, 90);
}

function normalizeEventLimit(limit?: unknown): number {
  const n = Number(limit);
  if (!Number.isInteger(n) || n <= 0) return 500;
  return Math.min(n, 2000);
}

function dateKeyFromIso(iso: string): string {
  return iso.slice(0, 10);
}

function isCancelledOrder(payload: Record<string, unknown>): boolean {
  const status = trimString(
    payload.status ??
      payload.state ??
      (payload.data as Record<string, unknown> | undefined)?.status ??
      (payload.data as Record<string, unknown> | undefined)?.state
  ).toLowerCase();
  return (
    status.includes('cancel') ||
    status.includes('return') ||
    status.includes('refund') ||
    status === 'deleted'
  );
}

function extractOrderId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  const obj = payload as Record<string, unknown>;
  const data = obj.data as Record<string, unknown> | undefined;
  const record = data?.record as Record<string, unknown> | undefined;
  const candidates = [
    obj.id,
    obj.order_id,
    obj.orderId,
    record?.id,
    record?.order_id,
    data?.id,
  ];
  for (const c of candidates) {
    const id = trimString(c);
    if (id) return id;
  }
  return null;
}

function lineFromObject(obj: Record<string, unknown>): LineItem | null {
  const variationId = trimString(
    obj.variation_id ?? obj.variationId ?? obj.product_variation_id
  );
  const quantity = toPositiveNumber(
    obj.quantity ?? obj.qty ?? obj.count ?? obj.amount
  );
  if (!variationId || quantity == null) {
    return null;
  }
  return {
    variationId,
    quantity,
    codes: extractPancakeProductCodes(obj),
  };
}

const LINE_ARRAY_KEYS = [
  'items',
  'order_items',
  'line_items',
  'products',
  'variations',
  'details',
] as const;

function collectLinesFromArray(arr: unknown): LineItem[] {
  if (!Array.isArray(arr)) return [];
  const out: LineItem[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const line = lineFromObject(item as Record<string, unknown>);
    if (line) out.push(line);
  }
  return out;
}

function extractOrderLines(payload: unknown): LineItem[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return [];
  }
  const root = payload as Record<string, unknown>;
  if (isCancelledOrder(root)) {
    return [];
  }

  const lines: LineItem[] = [];
  const seen = new Set<string>();

  const pushUnique = (batch: LineItem[]) => {
    for (const line of batch) {
      const key = `${line.variationId}:${line.quantity}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(line);
    }
  };

  for (const key of LINE_ARRAY_KEYS) {
    pushUnique(collectLinesFromArray(root[key]));
  }

  const data = root.data as Record<string, unknown> | undefined;
  if (data) {
    for (const key of LINE_ARRAY_KEYS) {
      pushUnique(collectLinesFromArray(data[key]));
    }
    const record = data.record as Record<string, unknown> | undefined;
    if (record) {
      for (const key of LINE_ARRAY_KEYS) {
        pushUnique(collectLinesFromArray(record[key]));
      }
      const single = lineFromObject(record);
      if (single) pushUnique([single]);
    }
  }

  return lines;
}

function extractStockFromPayload(
  payload: unknown,
  receivedAt: string
): StockSnapshot | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  const root = payload as Record<string, unknown>;
  const data = root.data as Record<string, unknown> | undefined;
  const record = (data?.record ?? root) as Record<string, unknown>;

  const variationId = trimString(record.variation_id ?? record.variationId);
  if (!variationId) return null;

  const quantity =
    toNonNegativeNumber(
      record.remain_quantity ??
        record.remaining_quantity ??
        record.stock_quantity ??
        record.quantity ??
        record.available_quantity ??
        record.stock
    ) ?? null;
  if (quantity == null) return null;

  return {
    variationId,
    quantity,
    at: receivedAt,
    codes: extractPancakeProductCodes(record),
  };
}

type AnalyticsEvent = {
  receivedAt: string;
  kind: string;
  payload: unknown;
};

async function loadAnalyticsEvents(
  since: Date,
  limit: number
): Promise<AnalyticsEvent[]> {
  if (useMongo()) {
    try {
      await connectMongo();
      const docs = await PancakeWebhookEvent.find({
        receivedAt: { $gte: since },
        kind: { $in: ['orders', 'variations_warehouses'] },
      })
        .sort({ receivedAt: -1 })
        .limit(limit)
        .lean();
      return docs.map((doc) => ({
        receivedAt: new Date(doc.receivedAt || new Date()).toISOString(),
        kind: String(doc.kind || 'unknown'),
        payload: doc.payload,
      }));
    } catch (err) {
      console.error(
        '[webhook][analytics] Mongo read failed, fallback to memory:',
        err
      );
    }
  }

  const memory = await listWebhookEvents(limit);
  return memory
    .filter((ev) => {
      const at = new Date(ev.at);
      return (
        at >= since &&
        (ev.kind === 'orders' || ev.kind === 'variations_warehouses')
      );
    })
    .map((ev) => ({
      receivedAt: ev.at,
      kind: ev.kind,
      payload: ev.payload,
    }));
}

function mergeVariantMeta(acc: VariantAccumulator, line: LineItem): void {
  acc.codes = mergePancakeProductCodes(acc.codes, line.codes);
}

export async function computeVariantSalesAnalytics(options?: {
  days?: unknown;
  eventLimit?: unknown;
}): Promise<VariantSalesAnalyticsResult> {
  const windowDays = normalizeDays(options?.days);
  const eventLimit = normalizeEventLimit(options?.eventLimit);
  const to = new Date();
  const from = new Date(to.getTime() - windowDays * 24 * 60 * 60 * 1000);

  const events = await loadAnalyticsEvents(from, eventLimit);
  const byVariant = new Map<string, VariantAccumulator>();
  const stockByVariant = new Map<string, StockSnapshot>();
  const seenOrderIds = new Set<string>();

  let orderEventsUsed = 0;
  let stockEventsUsed = 0;

  const getAcc = (variationId: string): VariantAccumulator => {
    let acc = byVariant.get(variationId);
    if (!acc) {
      acc = {
        variationId,
        codes: { productCode: '', variantCode: '' },
        soldByDay: new Map(),
        soldInWindow: 0,
        lastSoldAt: null,
      };
      byVariant.set(variationId, acc);
    }
    return acc;
  };

  for (const ev of events) {
    if (ev.kind === 'variations_warehouses') {
      const snap = extractStockFromPayload(ev.payload, ev.receivedAt);
      if (!snap) continue;
      stockEventsUsed += 1;
      const existing = stockByVariant.get(snap.variationId);
      if (
        !existing ||
        new Date(snap.at).getTime() >= new Date(existing.at).getTime()
      ) {
        stockByVariant.set(snap.variationId, snap);
        const acc = getAcc(snap.variationId);
        acc.codes = mergePancakeProductCodes(acc.codes, snap.codes);
      }
      continue;
    }

    if (ev.kind !== 'orders') continue;

    const orderId = extractOrderId(ev.payload);
    if (orderId) {
      if (seenOrderIds.has(orderId)) continue;
      seenOrderIds.add(orderId);
    }

    const lines = extractOrderLines(ev.payload);
    if (lines.length === 0) continue;

    orderEventsUsed += 1;
    const day = dateKeyFromIso(ev.receivedAt);

    for (const line of lines) {
      const acc = getAcc(line.variationId);
      mergeVariantMeta(acc, line);
      acc.soldInWindow += line.quantity;
      acc.soldByDay.set(day, (acc.soldByDay.get(day) ?? 0) + line.quantity);
      if (
        !acc.lastSoldAt ||
        new Date(ev.receivedAt).getTime() > new Date(acc.lastSoldAt).getTime()
      ) {
        acc.lastSoldAt = ev.receivedAt;
      }
    }
  }

  const variants: VariantSalesRowInternal[] = [...byVariant.values()]
    .map((acc): VariantSalesRowInternal => {
      const soldByDay = [...acc.soldByDay.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, quantity]) => ({ date, quantity }));
      const avgSoldPerDay = acc.soldInWindow / windowDays;
      const stock = stockByVariant.get(acc.variationId);
      const currentStock = stock?.quantity ?? null;
      const daysUntilSellOut =
        currentStock != null && avgSoldPerDay > 0
          ? Math.round((currentStock / avgSoldPerDay) * 10) / 10
          : null;

      return {
        variationId: acc.variationId,
        productCode: acc.codes.productCode,
        variantCode: acc.codes.variantCode,
        soldInWindow: acc.soldInWindow,
        avgSoldPerDay: Math.round(avgSoldPerDay * 100) / 100,
        soldByDay,
        currentStock,
        daysUntilSellOut,
        hotRank: 0,
        lastSoldAt: acc.lastSoldAt,
        stockUpdatedAt: stock?.at ?? null,
        stockSource: stock ? ('webhook' as const) : null,
      };
    })
    .sort((a, b) => b.avgSoldPerDay - a.avgSoldPerDay || b.soldInWindow - a.soldInWindow);

  variants.forEach((row, i) => {
    row.hotRank = i + 1;
  });

  return {
    windowDays,
    from: from.toISOString(),
    to: to.toISOString(),
    orderEventsUsed,
    stockEventsUsed,
    variants,
    note:
      'Mã SP = product_display_id / product.display_id; mã biến thể = display_id (thường trong variation_info trên đơn). avgSoldPerDay = soldInWindow / windowDays. daysUntilSellOut = currentStock / avgSoldPerDay. Duplicate order IDs in the window are counted once (latest event).',
  };
}
