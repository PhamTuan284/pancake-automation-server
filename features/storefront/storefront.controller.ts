import type { Request, Response } from 'express';
import {
  getStorefrontCategories,
  getStorefrontProducts,
  getStorefrontProductById,
  invalidateProductCache,
} from './storefront.service';
import { createStorefrontOrder, getStorefrontOrderById } from './storefront.order.service';
import { resolveInvoiceShopKey } from '../pancake-einvoice/invoiceShops';

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
