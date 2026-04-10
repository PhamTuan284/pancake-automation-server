import type { Request, Response } from 'express';
import { connectMongo, useMongo } from './invoiceStore';
import PancakeWebhookEvent from './models/PancakeWebhookEvent';

const DOC_WEBHOOK =
  'https://api-docs.pancake.vn/#tag/webhook/put/shopsshop_id';

const DEFAULT_SHOP_ID = '1942925579';
const DEFAULT_API_BASE = 'https://pos.pages.fm/api/v1';

const MEMORY_CAP = Math.min(
  Math.max(Number(process.env.PANCAKE_WEBHOOK_MEMORY_MAX) || 500, 10),
  5000
);

type MemoryEvent = {
  id: string;
  receivedAt: string;
  contentType: string;
  payload: unknown;
};

const memoryEvents: MemoryEvent[] = [];

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function trimSecretHeader(req: Request): string {
  const name = (
    process.env.PANCAKE_INCOMING_WEBHOOK_HEADER || 'x-meit-webhook-secret'
  )
    .trim()
    .toLowerCase();
  const raw = req.headers[name] ?? req.headers[name.replace(/-/g, '_')];
  if (Array.isArray(raw)) return raw[0]?.trim() ?? '';
  return typeof raw === 'string' ? raw.trim() : '';
}

function verifyIncomingSecret(req: Request): boolean {
  const expected = String(
    process.env.PANCAKE_INCOMING_WEBHOOK_SECRET || ''
  ).trim();
  if (!expected) return true;
  return trimSecretHeader(req) === expected;
}

export async function handlePancakeWebhookPost(
  req: Request,
  res: Response
): Promise<void> {
  if (!verifyIncomingSecret(req)) {
    res.status(401).json({ error: 'Invalid webhook secret' });
    return;
  }

  const receivedAt = new Date();
  const contentType = String(req.headers['content-type'] || '').split(';')[0];
  const payload =
    req.body !== undefined && req.body !== null ? req.body : { _empty: true };

  const id = newId();
  const event: MemoryEvent = {
    id,
    receivedAt: receivedAt.toISOString(),
    contentType,
    payload,
  };

  if (useMongo()) {
    try {
      await connectMongo();
      await PancakeWebhookEvent.create({
        receivedAt,
        contentType,
        payload,
      });
    } catch (e) {
      console.error('[pancake-webhook] Mongo persist failed:', e);
      memoryEvents.unshift(event);
      if (memoryEvents.length > MEMORY_CAP) {
        memoryEvents.length = MEMORY_CAP;
      }
    }
  } else {
    memoryEvents.unshift(event);
    if (memoryEvents.length > MEMORY_CAP) {
      memoryEvents.length = MEMORY_CAP;
    }
  }

  res.status(200).json({ ok: true });
}

export async function handlePancakeWebhookEventsGet(
  req: Request,
  res: Response
): Promise<void> {
  const limitRaw = Number(req.query.limit) || 50;
  const limit = Math.min(Math.max(Math.floor(limitRaw), 1), 200);

  try {
    if (useMongo()) {
      await connectMongo();
      const docs = await PancakeWebhookEvent.find()
        .sort({ receivedAt: -1 })
        .limit(limit)
        .lean();
      const events = docs.map((d) => ({
        id: String(d._id),
        receivedAt:
          d.receivedAt instanceof Date
            ? d.receivedAt.toISOString()
            : String(d.receivedAt),
        contentType: d.contentType || '',
        payload: d.payload,
      }));
      res.json({ events, count: events.length, source: 'mongodb' });
      return;
    }
  } catch (e) {
    console.error('[pancake-webhook] list from Mongo failed:', e);
    res.status(500).json({ error: 'Could not load webhook events' });
    return;
  }

  const events = memoryEvents.slice(0, limit);
  res.json({ events, count: events.length, source: 'memory' });
}

export async function handlePancakeWebhookClearDelete(
  _req: Request,
  res: Response
): Promise<void> {
  try {
    if (useMongo()) {
      await connectMongo();
      const r = await PancakeWebhookEvent.deleteMany({});
      res.json({ ok: true, deleted: r.deletedCount, source: 'mongodb' });
      return;
    }
  } catch (e) {
    console.error('[pancake-webhook] clear Mongo failed:', e);
    res.status(500).json({ error: 'Could not clear webhook events' });
    return;
  }

  memoryEvents.length = 0;
  res.json({ ok: true, deleted: 0, source: 'memory' });
}

export function handlePancakeWebhookConfigGet(
  _req: Request,
  res: Response
): void {
  const publicBase = String(process.env.PANCAKE_PUBLIC_WEBHOOK_BASE || '')
    .trim()
    .replace(/\/+$/, '');
  const path = '/webhooks/pancake';
  const full = publicBase ? `${publicBase}${path}` : null;
  const apiKeySet = Boolean(
    String(process.env.PANCAKE_API_KEY || '').trim()
  );
  res.json({
    receiverPath: path,
    publicBaseUrl: publicBase || null,
    fullReceiverUrl: full,
    shopId: String(process.env.PANCAKE_SHOP_ID || DEFAULT_SHOP_ID).trim(),
    hasApiKey: apiKeySet,
    incomingSecretConfigured: Boolean(
      String(process.env.PANCAKE_INCOMING_WEBHOOK_SECRET || '').trim()
    ),
    incomingSecretHeader:
      String(process.env.PANCAKE_INCOMING_WEBHOOK_HEADER || 'x-meit-webhook-secret').trim(),
    docUrl: DOC_WEBHOOK,
    webhookTypes: [
      'orders',
      'customers',
      'products',
      'variations_warehouses',
    ],
  });
}

type RegisterShopPayload = {
  webhook_enable?: boolean;
  webhook_url: string;
  webhook_email?: string;
  webhook_types?: string[];
  webhook_partner?: string;
  webhook_headers?: Record<string, string>;
};

export async function handlePancakeWebhookRegisterPost(
  req: Request,
  res: Response
): Promise<void> {
  const apiKey = String(process.env.PANCAKE_API_KEY || '').trim();
  if (!apiKey) {
    res.status(503).json({
      error:
        'Đặt PANCAKE_API_KEY trong .env (Cấu hình → Ứng dụng / Webhook API trên Pancake).',
    });
    return;
  }

  const shopId = String(
    process.env.PANCAKE_SHOP_ID || DEFAULT_SHOP_ID
  ).trim();
  const body = req.body as Partial<RegisterShopPayload> & {
    shop?: Partial<RegisterShopPayload>;
  };

  const shopFlat: Partial<RegisterShopPayload> = {
    ...body,
    ...(body.shop && typeof body.shop === 'object' ? body.shop : {}),
  };

  const webhook_url = String(shopFlat.webhook_url || '').trim();
  if (!webhook_url) {
    res.status(400).json({
      error: 'Cần webhook_url (URL công khai HTTPS trỏ tới POST /webhooks/pancake).',
    });
    return;
  }

  const shop: RegisterShopPayload = {
    webhook_enable:
      shopFlat.webhook_enable !== undefined ? shopFlat.webhook_enable : true,
    webhook_url,
    webhook_email: shopFlat.webhook_email
      ? String(shopFlat.webhook_email).trim()
      : undefined,
    webhook_types: Array.isArray(shopFlat.webhook_types)
      ? shopFlat.webhook_types.map((t) => String(t).trim()).filter(Boolean)
      : ['orders', 'customers'],
    webhook_partner: shopFlat.webhook_partner
      ? String(shopFlat.webhook_partner)
      : '',
    webhook_headers:
      shopFlat.webhook_headers &&
      typeof shopFlat.webhook_headers === 'object' &&
      !Array.isArray(shopFlat.webhook_headers)
        ? shopFlat.webhook_headers
        : undefined,
  };

  const base = String(process.env.PANCAKE_API_BASE || DEFAULT_API_BASE)
    .trim()
    .replace(/\/+$/, '');
  const url = `${base}/shops/${encodeURIComponent(shopId)}?api_key=${encodeURIComponent(apiKey)}`;

  try {
    const r = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shop }),
    });
    const text = await r.text();
    let json: unknown;
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      json = { raw: text };
    }
    if (!r.ok) {
      res.status(r.status === 401 || r.status === 403 ? 401 : 502).json({
        error: 'Pancake API từ chối yêu cầu. Kiểm tra API key và shop ID.',
        status: r.status,
        body: json,
      });
      return;
    }
    res.json({ ok: true, shopId, response: json });
  } catch (e) {
    console.error('[pancake-webhook] register failed:', e);
    res.status(502).json({
      error:
        e instanceof Error
          ? e.message
          : 'Không gọi được API Pancake (mạng / DNS).',
    });
  }
}

/** GET …/shops/{SHOP_ID}/warehouses — see https://api-docs.pancake.vn/#tag/kho-h%C3%A0ng/GET/shops/{SHOP_ID}/warehouses */
export async function handlePancakeWarehousesGet(
  _req: Request,
  res: Response
): Promise<void> {
  const apiKey = String(process.env.PANCAKE_API_KEY || '').trim();
  if (!apiKey) {
    res.status(503).json({
      error:
        'Đặt PANCAKE_API_KEY trong .env để gọi Open API (danh sách kho).',
    });
    return;
  }

  const shopId = String(
    process.env.PANCAKE_SHOP_ID || DEFAULT_SHOP_ID
  ).trim();

  const base = String(process.env.PANCAKE_API_BASE || DEFAULT_API_BASE)
    .trim()
    .replace(/\/+$/, '');
  const url = `${base}/shops/${encodeURIComponent(shopId)}/warehouses?api_key=${encodeURIComponent(apiKey)}`;

  try {
    const r = await fetch(url);
    const text = await r.text();
    let json: unknown;
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      json = { raw: text };
    }
    if (!r.ok) {
      res.status(r.status === 401 || r.status === 403 ? 401 : 502).json({
        error: 'Pancake API từ chối yêu cầu. Kiểm tra API key và shop ID.',
        status: r.status,
        body: json,
      });
      return;
    }
    res.json({ ok: true, shopId, data: json });
  } catch (e) {
    console.error('[pancake-webhook] warehouses failed:', e);
    res.status(502).json({
      error:
        e instanceof Error
          ? e.message
          : 'Không gọi được API Pancake (mạng / DNS).',
    });
  }
}
