import {
  fetchPancakeOpenApi,
  fetchPancakeOpenApiPaginated,
} from '../pancake-webhook/lib/pancakeWebhook';
import type { InvoiceShopKey } from '../pancake-einvoice/invoiceShops';

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

function classifyProduct(name: string, categoryName?: string): { categoryId: string; subcategoryId: string } | null {
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
  return null;
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
        price: Number(v.retail_price ?? v.price ?? basePrice),
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
  stockMap: Map<string, number>,
  hasStockData: boolean
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
  if (!classification) return null;

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

  const tags: string[] = [];
  if (Array.isArray(product.tags)) {
    tags.push(...product.tags.map(String));
  }

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
    inStock: !hasStockData || totalStock > 0,
    totalStock,
    attributes,
    variants,
    description: String(product.description ?? product.content ?? product.note_product ?? '').trim() || undefined,
  };
}

let productCache: { data: StorefrontProduct[]; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function fetchAllProducts(shopKey: InvoiceShopKey): Promise<StorefrontProduct[]> {
  const now = Date.now();
  if (productCache && now - productCache.fetchedAt < CACHE_TTL_MS) {
    return productCache.data;
  }

  const [rawProducts, rawVariationsStock] = await Promise.all([
    fetchPancakeOpenApiPaginated('/products', undefined, shopKey).catch(() => [] as Record<string, unknown>[]),
    // Still fetch /products/variations for warehouse stock quantities
    fetchPancakeOpenApiPaginated('/products/variations', undefined, shopKey).catch(() => [] as Record<string, unknown>[]),
  ]);

  // Build variation ID -> stock quantity map from warehouse endpoint
  const stockMap = new Map<string, number>();
  for (const v of rawVariationsStock) {
    const varId = String(v.variation_id ?? v.id ?? '');
    const qty = Number(v.remain_quantity ?? v.quantity ?? v.stock_quantity ?? 0);
    if (varId) stockMap.set(varId, qty);
  }

  // Only trust stock data when the warehouse endpoint returned actual quantities
  const hasStockData = [...stockMap.values()].some((qty) => qty > 0);

  const products = rawProducts
    .map((p) => rawProductToStorefront(p, stockMap, hasStockData))
    .filter((p): p is StorefrontProduct => p !== null)
    .filter((p) => p.inStock);

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
