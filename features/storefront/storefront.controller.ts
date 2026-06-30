import type { Request, Response } from 'express';
import {
  getStorefrontCategories,
  getStorefrontProducts,
  getStorefrontProductById,
  invalidateProductCache,
} from './storefront.service';
import { createStorefrontOrder, getStorefrontOrderById } from './storefront.order.service';
import { resolveInvoiceShopKey } from '../pancake-einvoice/invoiceShops';
import {
  getStorefrontConfig,
  StorefrontConfigModel,
} from '../../common/models/storefrontConfigModel';
import { ensureMongoConnected } from '../../common/mongo';

function resolveShopKey(req: Request) {
  const raw = String(req.query.shop ?? req.query.shopKey ?? 'meit').toLowerCase();
  try {
    return resolveInvoiceShopKey(raw);
  } catch {
    return 'meit' as const;
  }
}

export function getCategories(_req: Request, res: Response): void {
  res.json(getStorefrontCategories());
}

export async function getProducts(req: Request, res: Response): Promise<void> {
  const shopKey = resolveShopKey(req);
  const categoryId = String(req.query.category ?? req.query.categoryId ?? '').trim() || undefined;
  const subcategoryId = String(req.query.subcategory ?? req.query.subcategoryId ?? '').trim() || undefined;
  const search = String(req.query.search ?? req.query.q ?? '').trim() || undefined;
  const page = Number(req.query.page ?? 1);
  const pageSize = Number(req.query.pageSize ?? req.query.limit ?? 24);

  try {
    const result = await getStorefrontProducts(shopKey, { categoryId, subcategoryId, search, page, pageSize });
    res.json(result);
  } catch (err) {
    console.error('[storefront] getProducts error:', err);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
}

export async function getProduct(req: Request, res: Response): Promise<void> {
  const shopKey = resolveShopKey(req);
  const { id } = req.params;
  if (!id) {
    res.status(400).json({ error: 'Missing product id' });
    return;
  }
  try {
    const product = await getStorefrontProductById(shopKey, id);
    if (!product) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }
    res.json(product);
  } catch (err) {
    console.error('[storefront] getProduct error:', err);
    res.status(500).json({ error: 'Failed to fetch product' });
  }
}

export async function postOrder(req: Request, res: Response): Promise<void> {
  const shopKey = resolveShopKey(req);
  const body = req.body as Record<string, unknown>;
  const customer = body.customer as Record<string, unknown> | undefined;
  const items = body.items as unknown[] | undefined;

  if (!customer?.name || !customer?.phone || !customer?.address || !customer?.city) {
    res.status(400).json({ error: 'Missing required customer fields: name, phone, address, city' });
    return;
  }
  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: 'Order must contain at least one item' });
    return;
  }

  try {
    const order = await createStorefrontOrder({
      customer: customer as unknown as Parameters<typeof createStorefrontOrder>[0]['customer'],
      items: items as unknown as Parameters<typeof createStorefrontOrder>[0]['items'],
      shopKey,
    });
    res.status(201).json(order);
  } catch (err) {
    console.error('[storefront] postOrder error:', err);
    res.status(500).json({ error: 'Failed to create order' });
  }
}

export async function getOrder(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  if (!id) {
    res.status(400).json({ error: 'Missing order id' });
    return;
  }
  try {
    const order = await getStorefrontOrderById(id);
    if (!order) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }
    res.json(order);
  } catch (err) {
    console.error('[storefront] getOrder error:', err);
    res.status(500).json({ error: 'Failed to fetch order' });
  }
}

export function postInvalidateCache(_req: Request, res: Response): void {
  invalidateProductCache();
  res.json({ ok: true, message: 'Product cache cleared' });
}

export async function getAdminStorefrontConfig(_req: Request, res: Response): Promise<void> {
  try {
    await ensureMongoConnected();
    const config = await getStorefrontConfig();
    res.json({
      heroBanner: config.heroBanner,
      categoryBanners: config.categoryBanners,
    });
  } catch (err) {
    console.error('[storefront] getAdminStorefrontConfig error:', err);
    res.status(500).json({ error: 'Lỗi server.' });
  }
}

export async function updateAdminStorefrontConfig(req: Request, res: Response): Promise<void> {
  try {
    await ensureMongoConnected();
    const body = req.body as {
      heroBanner?: { videoUrl?: string; posterUrl?: string };
      categoryBanners?: { id: string; imageUrl: string }[];
      productImageOverrides?: { id: string; imageUrl: string }[];
      variantImageOverrides?: { id: string; imageUrl: string }[];
    };

    let config = await StorefrontConfigModel.findOne();
    if (!config) {
      config = await StorefrontConfigModel.create({
        heroBanner: { videoUrl: '', posterUrl: '' },
        categoryBanners: [],
        productImageOverrides: [],
        variantImageOverrides: [],
      });
    }

    if (body.heroBanner) {
      if (typeof body.heroBanner.videoUrl === 'string') config.heroBanner.videoUrl = body.heroBanner.videoUrl.trim();
      if (typeof body.heroBanner.posterUrl === 'string') config.heroBanner.posterUrl = body.heroBanner.posterUrl.trim();
    }

    const sanitizeOverrides = (arr: { id: string; imageUrl: string }[]) =>
      arr
        .filter((b) => typeof b.id === 'string' && typeof b.imageUrl === 'string')
        .map((b) => ({ id: b.id.trim(), imageUrl: b.imageUrl.trim() }));

    if (Array.isArray(body.categoryBanners)) {
      config.categoryBanners = sanitizeOverrides(body.categoryBanners);
    }
    if (Array.isArray(body.productImageOverrides)) {
      config.productImageOverrides = sanitizeOverrides(body.productImageOverrides).filter((b) => b.imageUrl !== '');
    }
    if (Array.isArray(body.variantImageOverrides)) {
      config.variantImageOverrides = sanitizeOverrides(body.variantImageOverrides).filter((b) => b.imageUrl !== '');
    }

    await config.save();
    // Invalidate product cache so overrides apply on next fetch
    invalidateProductCache();

    res.json({
      heroBanner: config.heroBanner,
      categoryBanners: config.categoryBanners,
      productImageOverrides: config.productImageOverrides,
      variantImageOverrides: config.variantImageOverrides,
    });
  } catch (err) {
    console.error('[storefront] updateAdminStorefrontConfig error:', err);
    res.status(500).json({ error: 'Lỗi server.' });
  }
}
