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
  variants: StorefrontVariant[];
  description?: string;
};

export type StorefrontVariant = {
  id: string;
  name: string;
  price: number;
  stock: number;
  attributes: Record<string, string>;
  images?: string[];
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

function parseVariantAttributes(variantName: string): Record<string, string> {
  const parts = variantName.split(/[,\-\/]/).map((p) => p.trim());
  const attrs: Record<string, string> = {};
  parts.forEach((part, i) => {
    const lower = part.toLowerCase();
    if (/^(xs|s|m|l|xl|xxl|\d{2,3}cm|\d+)$/i.test(part)) {
      attrs['size'] = part;
    } else if (i === 0 && parts.length > 1) {
      attrs['color'] = part;
    } else {
      attrs[`option${i + 1}`] = part;
    }
  });
  if (Object.keys(attrs).length === 0) attrs['option'] = variantName;
  return attrs;
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
  variations: Record<string, unknown>[]
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

  const rawImages = [
    product.images,
    product.image,
    product.image_url,
    product.cover,
    product.cover_url,
    product.thumbnail,
    product.thumbnail_url,
  ];
  const images = [
    ...new Set(rawImages.flatMap(extractImageUrls).filter((u) => u.startsWith('http'))),
  ];
  const basePrice = Number(product.price ?? product.base_price ?? 0);
  const originalPrice = Number(product.original_price ?? product.compare_price ?? 0) || undefined;

  const productVariations = variations.filter(
    (v) => String(v.product_id ?? '') === id || String(v.productId ?? '') === id
  );

  const variants: StorefrontVariant[] = productVariations.map((v) => {
    const variantImages = extractImageUrls(v.image_url ?? v.images ?? v.image ?? v.cover_url);
    return {
      id: String(v.variation_id ?? v.id ?? ''),
      name: String(v.name ?? v.variation_name ?? ''),
      price: Number(v.price ?? basePrice),
      stock: Number(v.quantity ?? v.remain_quantity ?? v.stock_quantity ?? 0),
      attributes: parseVariantAttributes(String(v.name ?? v.variation_name ?? '')),
      images: variantImages,
    };
  });

  // Merge variant images into product images (deduplicated)
  const variantImages = variants.flatMap((v) => v.images ?? []);
  const allImages = [...new Set([...images, ...variantImages])];

  const totalStock = variants.reduce((sum, v) => sum + v.stock, 0);

  const tags: string[] = [];
  if (Array.isArray(product.tags)) {
    tags.push(...product.tags.map(String));
  }

  return {
    id,
    name,
    slug: slugify(name) + '-' + id,
    price: basePrice,
    originalPrice,
    images: allImages,
    categoryId: classification.categoryId,
    subcategoryId: classification.subcategoryId,
    tags,
    inStock: totalStock > 0,
    totalStock,
    variants,
    description: String(product.description ?? product.content ?? '').trim() || undefined,
  };
}

let productCache: { data: StorefrontProduct[]; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function fetchAllProducts(shopKey: InvoiceShopKey): Promise<StorefrontProduct[]> {
  const now = Date.now();
  if (productCache && now - productCache.fetchedAt < CACHE_TTL_MS) {
    return productCache.data;
  }

  const [rawProducts, rawVariations] = await Promise.all([
    fetchPancakeOpenApiPaginated('/products', undefined, shopKey).catch(() => [] as Record<string, unknown>[]),
    fetchPancakeOpenApiPaginated('/products/variations', undefined, shopKey).catch(() => [] as Record<string, unknown>[]),
  ]);

  const products = rawProducts
    .map((p) => rawProductToStorefront(p, rawVariations))
    .filter((p): p is StorefrontProduct => p !== null);

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
