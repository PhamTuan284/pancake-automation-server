import type { Request } from 'express';
import {
  clearWebhookEvents,
  fetchPancakeOpenApi,
  getLegacyWebhookPanelConfig,
  listWebhookEvents,
  recordWebhookEventWithPersistence,
  recordSyntheticWebhookEventWithPersistence,
  registerPancakeWebhook,
  resolveWebhookReceiverPath,
  shouldAutoRunFromWebhook,
  verifyWebhookSecret,
  webhookEventStorageSource,
} from './lib/pancakeWebhook';
import { extractPancakeProductCodes } from './lib/pancakeProductCodes';
import {
  computeVariantSalesAnalytics,
  stripVariantSalesInternalIds,
  type VariantSalesAnalyticsResult,
} from './lib/variantSalesAnalytics';

export {
  recordWebhookEventWithPersistence,
  recordSyntheticWebhookEventWithPersistence,
  shouldAutoRunFromWebhook,
  verifyWebhookSecret,
};

export function getLegacyWebhookReceiverPath(): string {
  return resolveWebhookReceiverPath();
}

export function getWebhookPanelConfig() {
  return getLegacyWebhookPanelConfig();
}

export async function registerWebhookWithPancake(
  body: Record<string, unknown>
) {
  return registerPancakeWebhook(body);
}

export function buildQueryFromRequest(req: Request): URLSearchParams {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(req.query)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const v of value) {
        if (v != null && String(v).trim() !== '') {
          q.append(key, String(v));
        }
      }
    } else if (String(value).trim() !== '') {
      q.set(key, String(value));
    }
  }
  return q;
}

export async function proxyPancakeOpenApiGet(
  pathname: string,
  query: URLSearchParams
): Promise<unknown> {
  return fetchPancakeOpenApi(pathname, query);
}

export async function listWebhookEventsForResponse(
  limit?: string | string[]
) {
  const source = webhookEventStorageSource();
  const raw = await listWebhookEvents(limit);
  const events = raw.map((ev, i) => ({
    id: ev.id || `${ev.at}-${i}`,
    receivedAt: ev.at,
    kind: ev.kind || 'unknown',
    contentType: ev.contentType || String(ev.headers['content-type'] || ''),
    payload: ev.payload,
  }));
  return { count: events.length, events, source };
}

export async function clearStoredWebhookEvents(): Promise<void> {
  await clearWebhookEvents();
}

function extractCatalogRows(root: unknown): Record<string, unknown>[] {
  if (!root) return [];
  if (Array.isArray(root)) {
    return root.filter(
      (x): x is Record<string, unknown> =>
        x !== null && typeof x === 'object' && !Array.isArray(x)
    );
  }
  if (typeof root !== 'object') return [];
  const o = root as Record<string, unknown>;
  for (const key of ['data', 'variations', 'products', 'items', 'results']) {
    const v = o[key];
    if (Array.isArray(v)) {
      return extractCatalogRows(v);
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const nested = extractCatalogRows(v);
      if (nested.length > 0) return nested;
    }
  }
  return [];
}

function enrichAnalyticsWithCatalogStock(
  analytics: VariantSalesAnalyticsResult,
  catalog: unknown
): VariantSalesAnalyticsResult {
  const rows = extractCatalogRows(catalog);
  if (rows.length === 0) return analytics;

  const stockById = new Map<string, number>();
  const codesById = new Map<
    string,
    ReturnType<typeof extractPancakeProductCodes>
  >();
  for (const row of rows) {
    const variationId = String(row.variation_id ?? row.id ?? '').trim();
    if (!variationId) continue;
    const qty = Number(
      row.quantity ?? row.remain_quantity ?? row.stock_quantity
    );
    if (Number.isFinite(qty) && qty >= 0) {
      stockById.set(variationId, qty);
    }
    codesById.set(variationId, extractPancakeProductCodes(row));
  }

  const variants = analytics.variants.map((v) => {
    const catalogCodes = codesById.get(v.variationId);
    const catalogStock = stockById.get(v.variationId);
    const productCode =
      v.productCode || catalogCodes?.productCode || '';
    const variantCode =
      v.variantCode || catalogCodes?.variantCode || '';
    let currentStock = v.currentStock;
    let stockSource = v.stockSource;
    let daysUntilSellOut = v.daysUntilSellOut;
    let stockUpdatedAt = v.stockUpdatedAt;

    if (currentStock == null && catalogStock != null) {
      currentStock = catalogStock;
      stockSource = 'catalog' as const;
      stockUpdatedAt = analytics.to;
      if (v.avgSoldPerDay > 0) {
        daysUntilSellOut =
          Math.round((catalogStock / v.avgSoldPerDay) * 10) / 10;
      }
    }

    return {
      ...v,
      productCode,
      variantCode,
      currentStock,
      stockSource,
      stockUpdatedAt,
      daysUntilSellOut,
    };
  });

  return { ...analytics, variants };
}

export async function getVariantSalesAnalytics(query: Record<string, unknown>) {
  const analytics = await computeVariantSalesAnalytics({
    days: query.days,
    eventLimit: query.eventLimit,
  });
  try {
    const catalog = await fetchPancakeOpenApi('/products/variations');
    return stripVariantSalesInternalIds(
      enrichAnalyticsWithCatalogStock(analytics, catalog)
    );
  } catch {
    return stripVariantSalesInternalIds(analytics);
  }
}
