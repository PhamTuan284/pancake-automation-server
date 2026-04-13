import type { Request } from 'express';
import PancakeWebhookEvent from '../../../common/models/PancakeWebhookEvent';
import { connectMongo, useMongo } from '../../../common/mongo';

const DEFAULT_PANCAKE_API_BASE_URL = 'https://pos.pages.fm/api/v1';
const MAX_WEBHOOK_EVENTS_IN_MEMORY = 200;
const DEFAULT_INCOMING_SECRET_HEADER = 'x-webhook-secret';
const DEFAULT_WEBHOOK_RECEIVER_PATH = '/webhooks/pancake';
const DEFAULT_WEBHOOK_TYPES = [
  'orders',
  'customers',
  'products',
  'variations_warehouses',
];

export type PancakeWebhookType =
  | 'orders'
  | 'customers'
  | 'products'
  | 'variations_warehouses'
  | string;

export type PancakeWebhookConfig = {
  webhook_enable: boolean;
  webhook_url: string;
  webhook_email?: string;
  webhook_types?: PancakeWebhookType[];
  webhook_partner?: string;
  webhook_headers?: Record<string, string>;
};

type PancakeWebhookConfigRequest = {
  shop?: Partial<PancakeWebhookConfig>;
  shopId?: number | string;
  apiKey?: string;
  webhook_enable?: boolean;
  webhook_url?: string;
  webhook_email?: string;
  webhook_types?: PancakeWebhookType[];
  webhook_partner?: string;
  webhook_headers?: Record<string, string>;
};

export type ReceivedWebhookEvent = {
  id?: string;
  at: string;
  kind: string;
  contentType?: string;
  payload: unknown;
  headers: Record<string, string | string[] | undefined>;
};

const receivedWebhookEvents: ReceivedWebhookEvent[] = [];

function trimString(value: unknown): string {
  return String(value ?? '').trim();
}

function resolvePancakeApiBaseUrl(): string {
  const url = trimString(process.env.PANCAKE_API_BASE_URL);
  return (url || DEFAULT_PANCAKE_API_BASE_URL).replace(/\/+$/, '');
}

function resolveApiKey(inputApiKey?: unknown): string {
  return trimString(inputApiKey) || trimString(process.env.PANCAKE_API_KEY);
}

function resolveShopId(inputShopId?: unknown): number {
  const raw = trimString(inputShopId) || trimString(process.env.PANCAKE_SHOP_ID);
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('Missing or invalid shop id (set PANCAKE_SHOP_ID or send shopId)');
  }
  return value;
}

function normalizeHeaders(
  value: unknown
): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const pairs = Object.entries(value as Record<string, unknown>)
    .map(([k, v]) => [trimString(k), trimString(v)] as const)
    .filter(([k, v]) => k && v);
  if (pairs.length === 0) {
    return undefined;
  }
  return Object.fromEntries(pairs);
}

function normalizeWebhookTypes(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const out = value.map((item) => trimString(item)).filter(Boolean);
  return out.length > 0 ? out : undefined;
}

function extractFlatConfig(
  reqBody: PancakeWebhookConfigRequest
): Partial<PancakeWebhookConfig> {
  if (reqBody.shop && typeof reqBody.shop === 'object') {
    return reqBody.shop;
  }
  return {
    webhook_enable: reqBody.webhook_enable,
    webhook_url: reqBody.webhook_url,
    webhook_email: reqBody.webhook_email,
    webhook_types: reqBody.webhook_types,
    webhook_partner: reqBody.webhook_partner,
    webhook_headers: reqBody.webhook_headers,
  };
}

export function normalizeWebhookConfigInput(
  reqBody: PancakeWebhookConfigRequest
): PancakeWebhookConfig {
  const flat = extractFlatConfig(reqBody);
  const webhookEnable = Boolean(flat.webhook_enable);
  const webhookUrl = trimString(flat.webhook_url);
  if (!webhookUrl) {
    throw new Error('Missing webhook_url');
  }
  return {
    webhook_enable: webhookEnable,
    webhook_url: webhookUrl,
    webhook_email: trimString(flat.webhook_email) || undefined,
    webhook_types: normalizeWebhookTypes(flat.webhook_types),
    webhook_partner: trimString(flat.webhook_partner) || undefined,
    webhook_headers: normalizeHeaders(flat.webhook_headers),
  };
}

export async function updatePancakeWebhookConfig(
  reqBody: PancakeWebhookConfigRequest
) {
  const apiKey = resolveApiKey(reqBody.apiKey);
  if (!apiKey) {
    throw new Error('Missing API key (set PANCAKE_API_KEY or send apiKey)');
  }
  const shopId = resolveShopId(reqBody.shopId);
  const config = normalizeWebhookConfigInput(reqBody);
  const baseUrl = resolvePancakeApiBaseUrl();
  const url = `${baseUrl}/shops/${shopId}?api_key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shop: config }),
  });

  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    throw new Error(
      `Pancake API error (${response.status}): ${
        typeof data === 'string' ? data : JSON.stringify(data)
      }`
    );
  }

  return {
    request: { shopId, baseUrl, config },
    response: data,
  };
}

type LegacyWebhookRegisterInput = {
  webhook_enable?: boolean;
  webhook_url?: string;
  webhook_email?: string;
  webhook_types?: string[];
  webhook_headers?: Record<string, string>;
  webhook_partner?: string;
};

export async function registerPancakeWebhook(
  input: LegacyWebhookRegisterInput
) {
  return updatePancakeWebhookConfig(input);
}

function resolveOpenApiEndpoint(pathname: string, query?: URLSearchParams): string {
  const baseUrl = resolvePancakeApiBaseUrl();
  const shopId = resolveShopId();
  const apiKey = resolveApiKey();
  if (!apiKey) {
    throw new Error('Missing API key (set PANCAKE_API_KEY)');
  }
  const q = query ?? new URLSearchParams();
  q.set('api_key', apiKey);
  return `${baseUrl}/shops/${shopId}${pathname}?${q.toString()}`;
}

export async function fetchPancakeOpenApi(
  pathname: string,
  query?: URLSearchParams
): Promise<unknown> {
  const url = resolveOpenApiEndpoint(pathname, query);
  const response = await fetch(url, { method: 'GET' });
  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!response.ok) {
    throw new Error(
      `Pancake API error (${response.status}): ${
        typeof data === 'string' ? data : JSON.stringify(data)
      }`
    );
  }
  return data;
}

function detectWebhookKind(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return 'unknown';
  }
  const obj = payload as Record<string, unknown>;
  const record = (obj.data as Record<string, unknown> | undefined)?.record as
    | Record<string, unknown>
    | undefined;

  if (record && 'variation_id' in record && 'warehouse_id' in record) {
    return 'variations_warehouses';
  }
  if (record && ('sku' in record || 'barcode' in record || 'retail_price' in record)) {
    return 'products';
  }
  if (record) {
    return 'crm';
  }
  if ('customer_id' in obj || 'bill_full_name' in obj || 'order_sources' in obj) {
    return 'orders';
  }
  if ('customer_group_id' in obj || 'phone_numbers' in obj || 'total_order' in obj) {
    return 'customers';
  }
  return 'unknown';
}

export function verifyWebhookSecret(req: Request): boolean {
  const expected = trimString(process.env.PANCAKE_WEBHOOK_SECRET);
  if (!expected) {
    return true;
  }
  const provided = trimString(req.header(resolveIncomingSecretHeaderName()));
  return provided === expected;
}

export function recordWebhookEvent(req: Request): ReceivedWebhookEvent {
  const payload = req.body as unknown;
  const event: ReceivedWebhookEvent = {
    at: new Date().toISOString(),
    kind: detectWebhookKind(payload),
    payload,
    headers: req.headers,
  };
  receivedWebhookEvents.unshift(event);
  if (receivedWebhookEvents.length > MAX_WEBHOOK_EVENTS_IN_MEMORY) {
    receivedWebhookEvents.length = MAX_WEBHOOK_EVENTS_IN_MEMORY;
  }
  return event;
}

async function persistWebhookEventToMongo(event: ReceivedWebhookEvent): Promise<void> {
  if (!useMongo()) {
    return;
  }
  try {
    await connectMongo();
    await PancakeWebhookEvent.create({
      receivedAt: new Date(event.at),
      kind: event.kind,
      contentType: event.contentType || String(event.headers['content-type'] || ''),
      headers: event.headers,
      payload: event.payload,
    });
  } catch (err) {
    console.error('[webhook] Failed to persist event to MongoDB:', err);
  }
}

export async function recordWebhookEventWithPersistence(
  req: Request
): Promise<ReceivedWebhookEvent> {
  const event = recordWebhookEvent(req);
  event.contentType = String(event.headers['content-type'] || '');
  await persistWebhookEventToMongo(event);
  return event;
}

function normalizeLimit(limit?: unknown): number {
  const n = Number(limit);
  return Number.isInteger(n) && n > 0 ? Math.min(n, 100) : 20;
}

function mapMongoEventDoc(doc: {
  _id?: unknown;
  receivedAt?: Date | string;
  kind?: string;
  contentType?: string;
  payload?: unknown;
  headers?: Record<string, string | string[] | undefined>;
}): ReceivedWebhookEvent {
  return {
    id: String(doc._id ?? ''),
    at: new Date(doc.receivedAt || new Date()).toISOString(),
    kind: String(doc.kind || 'unknown'),
    contentType: String(doc.contentType || ''),
    payload: doc.payload,
    headers: (doc.headers || {}) as Record<string, string | string[] | undefined>,
  };
}

export async function listWebhookEvents(limit?: unknown): Promise<ReceivedWebhookEvent[]> {
  const size = normalizeLimit(limit);
  if (useMongo()) {
    try {
      await connectMongo();
      const docs = await PancakeWebhookEvent.find()
        .sort({ receivedAt: -1 })
        .limit(size)
        .lean();
      return docs.map(mapMongoEventDoc);
    } catch (err) {
      console.error('[webhook] Failed to read events from MongoDB, fallback to memory:', err);
    }
  }
  return receivedWebhookEvents.slice(0, size);
}

export function webhookEventStorageSource(): 'mongo' | 'memory' {
  return useMongo() ? 'mongo' : 'memory';
}

export async function clearWebhookEvents(): Promise<void> {
  receivedWebhookEvents.length = 0;
  if (!useMongo()) {
    return;
  }
  try {
    await connectMongo();
    await PancakeWebhookEvent.deleteMany({});
  } catch (err) {
    console.error('[webhook] Failed to clear MongoDB webhook events:', err);
  }
}

export function shouldAutoRunFromWebhook(): boolean {
  return trimString(process.env.PANCAKE_WEBHOOK_AUTO_RUN) === 'true';
}

export function resolveIncomingSecretHeaderName(): string {
  return (
    trimString(process.env.PANCAKE_WEBHOOK_SECRET_HEADER) ||
    DEFAULT_INCOMING_SECRET_HEADER
  ).toLowerCase();
}

export function resolveWebhookReceiverPath(): string {
  const raw =
    trimString(process.env.PANCAKE_WEBHOOK_RECEIVER_PATH) ||
    DEFAULT_WEBHOOK_RECEIVER_PATH;
  return raw.startsWith('/') ? raw : `/${raw}`;
}

export function resolvePublicWebhookBaseUrl(): string | null {
  const raw =
    trimString(process.env.PANCAKE_PUBLIC_WEBHOOK_BASE) ||
    trimString(process.env.PUBLIC_BASE_URL);
  if (!raw) {
    return null;
  }
  return raw.replace(/\/+$/, '');
}

export function getLegacyWebhookPanelConfig() {
  const receiverPath = resolveWebhookReceiverPath();
  const publicBaseUrl = resolvePublicWebhookBaseUrl();
  const fullReceiverUrl = publicBaseUrl
    ? `${publicBaseUrl}${receiverPath}`
    : null;
  const shopRaw = trimString(process.env.PANCAKE_SHOP_ID);
  return {
    receiverPath,
    publicBaseUrl,
    fullReceiverUrl,
    shopId: shopRaw || '',
    hasApiKey: Boolean(resolveApiKey()),
    incomingSecretConfigured: Boolean(trimString(process.env.PANCAKE_WEBHOOK_SECRET)),
    incomingSecretHeader: resolveIncomingSecretHeaderName(),
    docUrl: 'https://api-docs.pancake.vn/#tag/webhook/put/shopsshop_id',
    webhookTypes: DEFAULT_WEBHOOK_TYPES,
  };
}
