import PancakeWebhookEvent from '../../../common/models/PancakeWebhookEvent';
import { connectMongo, useMongo } from '../../../common/mongo';
import { listWebhookEvents } from './pancakeWebhook';
import { mongoShopKeyFilter, eventMatchesShopKey } from './shopKeyFilter';
import { getAllProductVariations } from '../webhook.service';
import type { InvoiceShopKey } from '../../pancake-einvoice/invoiceShops';

export type SalesSummaryVariant = {
  color: string;
  size: string;
  qty: number;
  listPrice: number;
  netPrice: number;
};

export type SalesSummaryProduct = {
  productCode: string;
  productName: string;
  imageUrl: string | null;
  totalQty: number;
  variants: SalesSummaryVariant[];
};

export type SalesSummaryResult = {
  windowDays: number;
  from: string;
  to: string;
  orderEventsUsed: number;
  products: SalesSummaryProduct[];
};

function trimString(value: unknown): string {
  return String(value ?? '').trim();
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
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const obj = payload as Record<string, unknown>;
  const data = obj.data as Record<string, unknown> | undefined;
  const record = data?.record as Record<string, unknown> | undefined;
  const candidates = [obj.id, obj.order_id, obj.orderId, record?.id, record?.order_id, data?.id];
  for (const c of candidates) {
    const id = trimString(c);
    if (id) return id;
  }
  return null;
}

function extractImageUrl(variationInfo: Record<string, unknown>): string | null {
  const images = variationInfo.images;
  if (!Array.isArray(images) || images.length === 0) return null;
  const first = images[0];
  if (typeof first === 'string' && first.trim()) return first.trim();
  if (first && typeof first === 'object') {
    const img = first as Record<string, unknown>;
    const url = img.thumbnail_url ?? img.url ?? img.src;
    if (typeof url === 'string' && url.trim()) return url.trim();
  }
  return null;
}

type RawLine = {
  variationId: string;
  productCode: string;
  productName: string;
  imageUrl: string | null;
  color: string;
  size: string;
  qty: number;
  listPrice: number;
  netPrice: number;
};

function extractLinesFromItem(item: Record<string, unknown>): RawLine | null {
  const variationInfo = item.variation_info;
  if (!variationInfo || typeof variationInfo !== 'object' || Array.isArray(variationInfo)) return null;
  const info = variationInfo as Record<string, unknown>;

  const productCode = trimString(info.product_display_id);
  if (!productCode) return null;

  const variationId = trimString(item.variation_id ?? item.variationId);

  const qty = Number(item.quantity);
  if (!Number.isFinite(qty) || qty <= 0) return null;

  const fields = Array.isArray(info.fields) ? (info.fields as Array<Record<string, unknown>>) : [];
  const colorField = fields.find((f) => typeof f.name === 'string' && /màu/i.test(f.name));
  const sizeField = fields.find((f) => typeof f.name === 'string' && /size|kích/i.test(f.name));
  const color = typeof colorField?.value === 'string' ? colorField.value : '';
  const rawLabel = trimString(info.name);
  const size = typeof sizeField?.value === 'string' && sizeField.value.trim()
    ? sizeField.value.trim()
    : (() => {
        const parts = rawLabel.split(/\s+/);
        return parts.length > 1 ? parts[parts.length - 1] : rawLabel;
      })();

  const listPrice = Number(info.retail_price) || 0;
  if (listPrice <= 0) return null; // exclude free giveaways/packaging (e.g. quà tặng, hộp quà)
  const discountEach = Number(item.discount_each_product) || 0;
  const netPrice = Math.max(0, listPrice - discountEach);

  return {
    variationId,
    productCode,
    productName: rawLabel,
    imageUrl: extractImageUrl(info),
    color,
    size,
    qty,
    listPrice,
    netPrice,
  };
}

const LINE_ARRAY_KEYS = ['items', 'order_items', 'line_items', 'products', 'variations', 'details'] as const;

function collectRawLines(payload: unknown): RawLine[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  const root = payload as Record<string, unknown>;
  if (isCancelledOrder(root)) return [];

  const out: RawLine[] = [];
  const pushFromArray = (arr: unknown) => {
    if (!Array.isArray(arr)) return;
    for (const item of arr) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const line = extractLinesFromItem(item as Record<string, unknown>);
      if (line) out.push(line);
    }
  };

  for (const key of LINE_ARRAY_KEYS) pushFromArray(root[key]);

  const data = root.data as Record<string, unknown> | undefined;
  if (data) {
    for (const key of LINE_ARRAY_KEYS) pushFromArray(data[key]);
    const record = data.record as Record<string, unknown> | undefined;
    if (record) {
      for (const key of LINE_ARRAY_KEYS) pushFromArray(record[key]);
    }
  }

  return out;
}

type AnalyticsEvent = { receivedAt: string; payload: unknown };

async function loadOrderEvents(since: Date, shopKey?: string): Promise<AnalyticsEvent[]> {
  if (useMongo()) {
    try {
      await connectMongo();
      const filter: Record<string, unknown> = {
        receivedAt: { $gte: since },
        kind: 'orders',
        ...(shopKey ? mongoShopKeyFilter(shopKey) : {}),
      };
      const docs = await PancakeWebhookEvent.find(filter).sort({ receivedAt: -1 }).limit(5000).lean();
      return docs.map((doc) => ({
        receivedAt: new Date(doc.receivedAt || new Date()).toISOString(),
        payload: doc.payload,
      }));
    } catch (err) {
      console.error('[sales-summary] Mongo read failed, fallback to memory:', err);
    }
  }

  const memory = await listWebhookEvents(2000);
  return memory
    .filter((ev) => {
      if (ev.kind !== 'orders') return false;
      if (new Date(ev.at) < since) return false;
      if (!shopKey) return true;
      return eventMatchesShopKey(ev.shopKey, shopKey);
    })
    .map((ev) => ({ receivedAt: ev.at, payload: ev.payload }));
}

type VariantAgg = {
  color: string;
  size: string;
  qty: number;
  listPriceWeighted: number;
  netPriceWeighted: number;
};

type ProductAgg = {
  productCode: string;
  productName: string;
  imageUrl: string | null;
  variants: Map<string, VariantAgg>;
};

export async function computeSalesSummaryAnalytics(options?: {
  days?: number;
  shopKey?: string;
}): Promise<SalesSummaryResult> {
  const windowDays = Math.max(1, Math.min(90, Number(options?.days) || 5));
  const to = new Date();
  const from = new Date(to.getTime() - windowDays * 24 * 60 * 60 * 1000);

  const events = await loadOrderEvents(from, options?.shopKey);

  // Different Pancake shops share the same event store but have completely
  // separate variation_id spaces — restrict to this shop's catalog so stray
  // events from other shops (e.g. missing/legacy shopKey tags) don't leak in.
  // Fail closed (throw) rather than silently sending an unfiltered report
  // if the catalog can't be verified.
  let catalogIds: Set<string> | null = null;
  if (options?.shopKey) {
    let catalog: Awaited<ReturnType<typeof getAllProductVariations>>;
    try {
      catalog = await getAllProductVariations(options.shopKey as InvoiceShopKey);
    } catch (err) {
      console.error(`[sales-summary] Failed to fetch "${options.shopKey}" catalog for shop filtering:`, err);
      throw new Error(`Không thể tải danh mục sản phẩm của shop "${options.shopKey}" để lọc mẫu theo shop.`);
    }
    const ids = catalog
      .map((row) => String((row as Record<string, unknown>).variation_id ?? (row as Record<string, unknown>).id ?? '').trim())
      .filter(Boolean);
    if (ids.length === 0) {
      throw new Error(`Danh mục sản phẩm của shop "${options.shopKey}" trống — không thể lọc mẫu theo shop an toàn.`);
    }
    catalogIds = new Set(ids);
  }

  const seenOrderIds = new Set<string>();
  const products = new Map<string, ProductAgg>();
  let orderEventsUsed = 0;

  for (const ev of events) {
    const orderId = extractOrderId(ev.payload);
    if (orderId) {
      if (seenOrderIds.has(orderId)) continue;
      seenOrderIds.add(orderId);
    }

    let lines = collectRawLines(ev.payload);
    if (catalogIds) {
      lines = lines.filter((line) => line.variationId && catalogIds!.has(line.variationId));
    }
    if (lines.length === 0) continue;
    orderEventsUsed += 1;

    for (const line of lines) {
      let prod = products.get(line.productCode);
      if (!prod) {
        prod = { productCode: line.productCode, productName: line.productName, imageUrl: line.imageUrl, variants: new Map() };
        products.set(line.productCode, prod);
      }
      if (!prod.imageUrl && line.imageUrl) prod.imageUrl = line.imageUrl;

      const key = `${line.color}__${line.size}`;
      let variant = prod.variants.get(key);
      if (!variant) {
        variant = { color: line.color, size: line.size, qty: 0, listPriceWeighted: 0, netPriceWeighted: 0 };
        prod.variants.set(key, variant);
      }
      variant.qty += line.qty;
      variant.listPriceWeighted += line.listPrice * line.qty;
      variant.netPriceWeighted += line.netPrice * line.qty;
    }
  }

  const result: SalesSummaryProduct[] = [...products.values()]
    .map((prod): SalesSummaryProduct => {
      const variants = [...prod.variants.values()]
        .map((v): SalesSummaryVariant => ({
          color: v.color,
          size: v.size,
          qty: v.qty,
          listPrice: v.qty > 0 ? Math.round(v.listPriceWeighted / v.qty) : 0,
          netPrice: v.qty > 0 ? Math.round(v.netPriceWeighted / v.qty) : 0,
        }))
        .sort((a, b) => b.qty - a.qty);
      const totalQty = variants.reduce((sum, v) => sum + v.qty, 0);
      return {
        productCode: prod.productCode,
        productName: prod.productName,
        imageUrl: prod.imageUrl,
        totalQty,
        variants,
      };
    })
    .sort((a, b) => b.totalQty - a.totalQty);

  return {
    windowDays,
    from: from.toISOString(),
    to: to.toISOString(),
    orderEventsUsed,
    products: result,
  };
}
