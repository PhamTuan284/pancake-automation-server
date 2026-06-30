import {
  fetchPancakeOpenApi,
  fetchPancakeOpenApiPaginated,
} from '../pancake-webhook/lib/pancakeWebhook';
import type { InvoiceShopKey } from '../pancake-einvoice/invoiceShops';
import { connectMongo } from '../../common/mongo';
import StorefrontOrder from '../../common/models/storefrontOrderModel';
import SoldCountCache from '../../common/models/soldCountCacheModel';
import { getStorefrontConfig } from '../../common/models/storefrontConfigModel';

export type StorefrontCategory = {
  id: string;
  nameVi: string;
  nameEn: string;
  slug: string;
  subcategories: StorefrontSubcategory[];
};

export type StorefrontSubcategory = {
  id: string;
  nameVi: string;
  nameEn: string;
  slug: string;
  pancakeCategoryIds: number[];
  keywords: string[];
};

export type StorefrontAttribute = {
  id: string;
  name: string;
  values: string[];
};

export type StorefrontVariantField = {
  name: string;
  value: string;
  keyValue: string;
};

export type StorefrontProduct = {
  id: string;
  name: string;
  slug: string;
  price: number;
  originalPrice?: number;
  images: string[];
  categoryId: string;
  subcategoryId: string;
  tags: string[];
  inStock: boolean;
  totalStock: number;
  soldCount: number;
  attributes: StorefrontAttribute[];
  variants: StorefrontVariant[];
  description?: string;
};

export type StorefrontVariant = {
  id: string;
  name: string;
  price: number;
  stock: number;
  images: string[];
  fields: StorefrontVariantField[];
};

const STOREFRONT_CATEGORIES: StorefrontCategory[] = [
  {
    id: 'thoi-trang-nu',
    nameVi: 'Thời Trang Nữ',
    nameEn: "Women's Fashion",
    slug: 'thoi-trang-nu',
    subcategories: [
      {
        id: 'quan-ao',
        nameVi: 'Quần Áo',
        nameEn: 'Clothing',
        slug: 'quan-ao',
        pancakeCategoryIds: [],
        keywords: ['áo', 'quần', 'váy', 'đầm', 'ao', 'quan', 'vay', 'dam', 'shirt', 'dress', 'top', 'blouse', 'skirt', 'clothing'],
      },
      {
        id: 'tui-xach',
        nameVi: 'Túi Xách',
        nameEn: 'Handbags',
        slug: 'tui-xach',
        pancakeCategoryIds: [],
        keywords: ['túi', 'xách', 'tui', 'bag', 'handbag', 'clutch', 'tote', 'purse'],
      },
    ],
  },
  {
    id: 'do-gia-dung',
    nameVi: 'Đồ Gia Dụng',
    nameEn: 'Household Goods',
    slug: 'do-gia-dung',
    subcategories: [
      {
        id: 'khan-mem',
        nameVi: 'Khăn Mềm Vạn Năng',
        nameEn: 'Multi-purpose Soft Towels',
        slug: 'khan-mem-van-nang',
        pancakeCategoryIds: [],
        keywords: ['khăn', 'khan', 'towel', 'vạn năng', 'van nang', 'soft'],
      },
    ],
  },
];

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

const FALLBACK_CATEGORY_ID = STOREFRONT_CATEGORIES[0].id;
const FALLBACK_SUBCATEGORY_ID = STOREFRONT_CATEGORIES[0].subcategories[0].id;

function classifyProduct(name: string, categoryName?: string): { categoryId: string; subcategoryId: string } {
  const searchText = `${name} ${categoryName ?? ''}`.toLowerCase();

  for (const cat of STOREFRONT_CATEGORIES) {
    for (const sub of cat.subcategories) {
      for (const kw of sub.keywords) {
        if (searchText.includes(kw.toLowerCase())) {
          return { categoryId: cat.id, subcategoryId: sub.id };
        }
      }
    }
  }
  // Don't drop unrecognised products — put them in the first category so they still appear
  return { categoryId: FALLBACK_CATEGORY_ID, subcategoryId: FALLBACK_SUBCATEGORY_ID };
}

function parseProductAttributes(raw: unknown): StorefrontAttribute[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a): a is Record<string, unknown> => a !== null && typeof a === 'object')
    .map((a) => ({
      id: String(a.id ?? ''),
      name: String(a.name ?? ''),
      values: Array.isArray(a.values) ? a.values.map(String) : [],
    }))
    .filter((a) => a.name && a.values.length > 0);
}

function parseEmbeddedVariations(
  rawVariations: unknown,
  stockMap: Map<string, number>,
  basePrice: number
): StorefrontVariant[] {
  if (!Array.isArray(rawVariations)) return [];
  return rawVariations
    .filter(
      (v): v is Record<string, unknown> =>
        v !== null && typeof v === 'object' && !v.is_removed && !v.is_hidden
    )
    .map((v) => {
      const varId = String(v.id ?? '');
      const fields: StorefrontVariantField[] = Array.isArray(v.fields)
        ? (v.fields as Record<string, unknown>[]).map((f) => ({
            name: String(f.name ?? ''),
            value: String(f.value ?? ''),
            keyValue: String(f.keyValue ?? ''),
          }))
        : [];
      const varImages = extractImageUrls(v.images ?? v.image ?? v.image_url ?? v.cover_url);
      const stock = stockMap.get(varId) ?? Number(v.remain_quantity ?? v.quantity ?? 0);
      return {
        id: varId,
        name: String(v.display_id ?? v.name ?? ''),
        price: Number(v.retail_price ?? v.price ?? basePrice) || basePrice,
        stock,
        images: varImages,
        fields,
      };
    });
}

function extractImageUrls(raw: unknown): string[] {
  if (!raw) return [];
  // If it's a plain URL string, return it directly
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('http') || trimmed.startsWith('//')) return [trimmed];
    // Try JSON-encoded array/object
    try {
      const parsed: unknown = JSON.parse(trimmed);
      return extractImageUrls(parsed);
    } catch {
      return [trimmed];
    }
  }
  if (Array.isArray(raw)) {
    return raw.flatMap((item) => {
      if (typeof item === 'string') return item.trim() ? [item.trim()] : [];
      if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>;
        // Try every common Pancake image object key
        const url = obj.url ?? obj.src ?? obj.image_url ?? obj.link ?? obj.path ?? obj.name;
        if (url && typeof url === 'string' && url.startsWith('http')) return [url];
        if (url) return extractImageUrls(url);
      }
      return [];
    });
  }
  return [];
}

function rawProductToStorefront(
  product: Record<string, unknown>,
  stockMap: Map<string, number>
): StorefrontProduct | null {
  const id = String(product.id ?? '').trim();
  const name = String(product.name ?? '').trim();
  if (!id || !name) return null;

  const categoryName = String(
    (product.category as Record<string, unknown> | undefined)?.name ??
    product.category_name ??
    ''
  );

  const classification = classifyProduct(name, categoryName);

  const basePrice = Number(
    product.retail_price ?? product.price ?? product.base_price ?? product.sale_price ?? 0
  );
  const originalPrice =
    Number(product.original_price ?? product.compare_price ?? product.list_price ?? 0) || undefined;

  // Parse product-level attribute definitions (axes like "Màu sắc", "Size")
  const attributes = parseProductAttributes(product.product_attributes);

  // Parse embedded variations using fields[] for attribute structure
  const variants = parseEmbeddedVariations(product.variations, stockMap, basePrice);

  // Collect product-level images, then merge unique variant images
  const rootImages = [product.images, product.image, product.image_url, product.cover, product.cover_url, product.thumbnail, product.thumbnail_url];
  const productImages = [...new Set(rootImages.flatMap(extractImageUrls).filter((u) => u.startsWith('http')))];
  const variantImages = variants.flatMap((v) => v.images);
  const allImages = [...new Set([...productImages, ...variantImages])];

  const totalStock = variants.reduce((sum, v) => sum + v.stock, 0);
  const variantPrices = variants.map((v) => v.price).filter((p) => p > 0);
  const effectivePrice = basePrice > 0 ? basePrice : (variantPrices.length > 0 ? Math.min(...variantPrices) : 0);

  // Only trust stock = 0 if at least one of THIS product's variants appears in the warehouse data.
  // If none of them are in the stockMap, the warehouse endpoint simply didn't include this product
  // and we should assume it's available rather than hiding it.
  const thisProductHasStockData = variants.some((v) => stockMap.has(v.id));
  const inStock = !thisProductHasStockData || totalStock > 0;

  const tags: string[] = [];
  if (Array.isArray(product.tags)) {
    tags.push(...product.tags.map(String));
  }

  // Pancake may expose sold counts under these fields
  const pancakeSold = Number(product.total_sold ?? product.sold_count ?? product.number_sold ?? product.sold ?? 0);

  return {
    id,
    name,
    slug: slugify(name) + '-' + id,
    price: effectivePrice,
    originalPrice,
    images: allImages,
    categoryId: classification.categoryId,
    subcategoryId: classification.subcategoryId,
    tags,
    inStock,
    totalStock,
    soldCount: pancakeSold,
    attributes,
    variants,
    description: String(product.description ?? product.content ?? product.note_product ?? '').trim() || undefined,
  };
}

let productCache: { data: StorefrontProduct[]; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;
const SOLD_COUNT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

function getOrderItems(order: Record<string, unknown>): Record<string, unknown>[] {
  for (const key of ['order_details', 'items', 'line_items', 'details', 'products']) {
    if (Array.isArray(order[key])) return order[key] as Record<string, unknown>[];
  }
  return [];
}

async function recalculateSoldCounts(shopKey: InvoiceShopKey): Promise<Map<string, number>> {
  const combined = new Map<string, number>();

  // Pancake order history (last 180 days, up to 600 orders)
  try {
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - 180);
    const query = new URLSearchParams({ from_date: fromDate.toISOString().split('T')[0] });
    const orders = await fetchPancakeOpenApiPaginated('/orders', query, shopKey, { pageSize: 50, maxPages: 12 });
    for (const order of orders) {
      for (const item of getOrderItems(order)) {
        const productId = String(
          item.product_id ??
          (item.product as Record<string, unknown> | undefined)?.id ??
          item.item_id ?? ''
        ).trim();
        const qty = Math.max(0, Number(item.quantity ?? item.qty ?? item.amount ?? 1));
        if (productId && qty > 0) combined.set(productId, (combined.get(productId) ?? 0) + qty);
      }
    }
  } catch { /* non-fatal */ }

  // MongoDB storefront orders
  try {
    const rows = await StorefrontOrder.aggregate<{ _id: string; totalSold: number }>([
      { $unwind: '$items' },
      { $group: { _id: '$items.productId', totalSold: { $sum: '$items.quantity' } } },
    ]);
    for (const r of rows) {
      combined.set(r._id, (combined.get(r._id) ?? 0) + r.totalSold);
    }
  } catch { /* non-fatal */ }

  return combined;
}

async function getSoldCountMap(shopKey: InvoiceShopKey): Promise<Map<string, number>> {
  try {
    await connectMongo();
    const cached = await SoldCountCache.findOne({ shopKey });
    const isStale = !cached || Date.now() - cached.calculatedAt.getTime() > SOLD_COUNT_TTL_MS;

    if (!isStale && cached) {
      return new Map(Object.entries(cached.counts as Record<string, number>));
    }

    // Stale or missing — recalculate and persist
    const counts = await recalculateSoldCounts(shopKey);
    const countsObj = Object.fromEntries(counts);
    await SoldCountCache.findOneAndUpdate(
      { shopKey },
      { counts: countsObj, calculatedAt: new Date() },
      { upsert: true }
    );
    console.log(`[storefront] sold counts recalculated for ${shopKey}: ${counts.size} products`);
    return counts;
  } catch {
    return new Map();
  }
}

const CATEGORY_ORDER: Record<string, number> = {
  'quan-ao': 0,
  'tui-xach': 1,
  'khan-mem': 2,
};

async function fetchAllProducts(shopKey: InvoiceShopKey): Promise<StorefrontProduct[]> {
  const now = Date.now();
  if (productCache && now - productCache.fetchedAt < CACHE_TTL_MS) {
    return productCache.data;
  }

  const [rawProducts, rawVariationsStock, soldCounts] = await Promise.all([
    fetchPancakeOpenApiPaginated('/products', undefined, shopKey).catch(() => [] as Record<string, unknown>[]),
    fetchPancakeOpenApiPaginated('/products/variations', undefined, shopKey).catch(() => [] as Record<string, unknown>[]),
    getSoldCountMap(shopKey),
  ]);

  const stockMap = new Map<string, number>();
  for (const v of rawVariationsStock) {
    const varId = String(v.variation_id ?? v.id ?? '');
    const qty = Number(v.remain_quantity ?? v.quantity ?? v.stock_quantity ?? 0);
    if (varId) stockMap.set(varId, qty);
  }

  const products = rawProducts
    .map((p) => rawProductToStorefront(p, stockMap))
    .filter((p): p is StorefrontProduct => p !== null)
    .filter((p) => p.inStock)
    .filter((p) => p.price > 0);

  for (const p of products) {
    p.soldCount += soldCounts.get(p.id) ?? 0;
  }

  products.sort((a, b) => {
    const catDiff = (CATEGORY_ORDER[a.subcategoryId] ?? 1) - (CATEGORY_ORDER[b.subcategoryId] ?? 1);
    return catDiff !== 0 ? catDiff : b.soldCount - a.soldCount;
  });

  // Apply admin image overrides; fall back to Pancake images when no override is set
  try {
    const config = await getStorefrontConfig();
    const productOverrides = new Map(config.productImageOverrides.map((o) => [o.id, o.imageUrl]));
    const variantOverrides = new Map(config.variantImageOverrides.map((o) => [o.id, o.imageUrl]));

    for (const p of products) {
      const override = productOverrides.get(p.id);
      if (override) p.images = [override];

      for (const v of p.variants) {
        const varOverride = variantOverrides.get(v.id);
        if (varOverride) v.images = [varOverride];
      }
    }
  } catch { /* non-fatal — show Pancake images if config unavailable */ }

  productCache = { data: products, fetchedAt: now };
  return products;
}

export function getStorefrontCategories(): StorefrontCategory[] {
  return STOREFRONT_CATEGORIES;
}

export async function getStorefrontProducts(
  shopKey: InvoiceShopKey,
  opts: { categoryId?: string; subcategoryId?: string; search?: string; page?: number; pageSize?: number }
): Promise<{ products: StorefrontProduct[]; total: number; page: number; pageSize: number }> {
  const allProducts = await fetchAllProducts(shopKey);
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 24));

  let filtered = allProducts;
  if (opts.categoryId) {
    filtered = filtered.filter((p) => p.categoryId === opts.categoryId);
  }
  if (opts.subcategoryId) {
    filtered = filtered.filter((p) => p.subcategoryId === opts.subcategoryId);
  }
  if (opts.search) {
    const q = opts.search.toLowerCase();
    filtered = filtered.filter((p) => p.name.toLowerCase().includes(q));
  }

  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const products = filtered.slice(start, start + pageSize);

  return { products, total, page, pageSize };
}

export async function getStorefrontProductById(
  shopKey: InvoiceShopKey,
  productId: string
): Promise<StorefrontProduct | null> {
  const allProducts = await fetchAllProducts(shopKey);
  return allProducts.find((p) => p.id === productId || p.slug === productId) ?? null;
}

export function invalidateProductCache(): void {
  productCache = null;
}
