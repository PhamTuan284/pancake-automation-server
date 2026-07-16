import https from 'https';
import path from 'path';
import fs from 'fs';
import { getVariantSalesAnalytics, getAllProductVariations } from '../pancake-webhook/webhook.service';
import { computeVariantSalesAnalytics } from '../pancake-webhook/lib/variantSalesAnalytics';
import { formatVariantSalesZaloText } from './formatVariantSalesZaloText';
import { getAdminSettings } from '../../common/models/adminSettingsModel';
import { useMongo } from '../../common/mongo';
import { getDailyStockConfig, saveDailyStockConfig } from './dailyStockConfig';
import type { InvoiceShopKey } from '../pancake-einvoice/invoiceShops';
import { generateStockImageServer, stitchIntoCompositeServer } from './stockImageServer';

const TEMP_IMG_DIR = path.join(process.cwd(), 'public', 'temp-images');
const TEMP_IMG_MAX_AGE_MS = 30 * 24 * 60 * 60_000; // 30 days

function cleanOldTempImages(): void {
  try {
    if (!fs.existsSync(TEMP_IMG_DIR)) return;
    const now = Date.now();
    for (const name of fs.readdirSync(TEMP_IMG_DIR)) {
      const fp = path.join(TEMP_IMG_DIR, name);
      try {
        const stat = fs.statSync(fp);
        if (now - stat.mtimeMs > TEMP_IMG_MAX_AGE_MS) fs.unlinkSync(fp);
      } catch { /* ignore per-file errors */ }
    }
  } catch { /* ignore */ }
}

export type ZaloBotConfig = {
  botConfigured: boolean;
  chatId: string | null;
  reportHour: number;
  shopKey: string;
  windowDays: number;
  topLimit: number;
  excludeVariants: string[];
};

export type ZaloSendLog = {
  id: string;
  sentAt: string;
  kind: 'test' | 'report' | 'scheduled' | 'alert';
  success: boolean;
  error?: string;
  chatId: string;
  preview: string;
};

const MAX_LOGS = 50;
const sendLogs: ZaloSendLog[] = [];

function getEnvConfig() {
  return {
    botToken: process.env.ZALO_BOT_TOKEN?.trim() || null,
    chatId: process.env.ZALO_CHAT_ID?.trim() || null,
    stockChatId: process.env.ZALO_STOCK_CHAT_ID?.trim() || null,
    reportHour: Math.max(0, Math.min(23, parseInt(process.env.ZALO_REPORT_HOUR ?? '8', 10) || 8)),
    shopKey: process.env.ZALO_REPORT_SHOP?.trim() || 'meit',
    windowDays: Math.max(1, parseInt(process.env.ZALO_REPORT_DAYS ?? '7', 10) || 7),
    topLimit: Math.max(1, parseInt(process.env.ZALO_REPORT_LIMIT ?? '15', 10) || 15),
    excludeVariants: (process.env.ZALO_EXCLUDE_VARIANTS ?? '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean),
  };
}

export function getZaloBotConfig(): ZaloBotConfig {
  const env = getEnvConfig();
  return {
    botConfigured: !!env.botToken,
    chatId: env.chatId,
    reportHour: env.reportHour,
    shopKey: env.shopKey,
    windowDays: env.windowDays,
    topLimit: env.topLimit,
    excludeVariants: env.excludeVariants,
  };
}

export function getZaloSendLogs(): ZaloSendLog[] {
  return [...sendLogs];
}

function addLog(log: Omit<ZaloSendLog, 'id'>): void {
  sendLogs.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    ...log,
  });
  if (sendLogs.length > MAX_LOGS) sendLogs.splice(MAX_LOGS);
}

function httpsPost(
  url: string,
  body: string
): Promise<{ ok: boolean; body: string; status: number }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          resolve({ ok: status >= 200 && status < 300, body: data, status });
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}


export type ZaloUpdateChat = {
  id: string;
  title: string;
  type: string;
};

export async function setZaloWebhook(
  webhookUrl: string
): Promise<{ ok: boolean; secretToken?: string; error?: string }> {
  const env = getEnvConfig();
  if (!env.botToken) {
    return { ok: false, error: 'ZALO_BOT_TOKEN chưa được cấu hình.' };
  }
  const secretToken = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  try {
    const url = `https://bot-api.zaloplatforms.com/bot${env.botToken}/setWebhook`;
    const res = await httpsPost(url, JSON.stringify({ url: webhookUrl, secret_token: secretToken }));
    if (res.body.trimStart().startsWith('<')) {
      return { ok: false, error: `Zalo trả về HTML (HTTP ${res.status}).` };
    }
    const parsed = JSON.parse(res.body) as { ok?: boolean; description?: string };
    if (!parsed.ok) {
      return { ok: false, error: parsed.description ?? `HTTP ${res.status}` };
    }
    return { ok: true, secretToken };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function fetchZaloUpdates(): Promise<{ ok: boolean; chats: ZaloUpdateChat[]; error?: string }> {
  const env = getEnvConfig();
  if (!env.botToken) {
    return { ok: false, chats: [], error: 'ZALO_BOT_TOKEN chưa được cấu hình.' };
  }
  try {
    const url = `https://bot-api.zaloplatforms.com/bot${env.botToken}/getUpdates`;
    const res = await httpsPost(url, JSON.stringify({ timeout: 0 }));

    if (res.body.trimStart().startsWith('<')) {
      return {
        ok: false,
        chats: [],
        error: `Zalo trả về HTML (HTTP ${res.status}). Endpoint getUpdates có thể không được hỗ trợ tại URL này. Hãy thử dùng webhook.site để lấy chat_id thay thế.`,
      };
    }

    const parsed = JSON.parse(res.body) as {
      ok?: boolean;
      description?: string;
      result?: Array<{ message?: { chat?: { id?: string; title?: string; type?: string } } }>;
    };
    if (!parsed.ok) {
      return { ok: false, chats: [], error: parsed.description ?? `HTTP ${res.status}` };
    }
    const seen = new Map<string, ZaloUpdateChat>();
    for (const update of parsed.result ?? []) {
      const chat = update.message?.chat;
      if (chat?.id && !seen.has(chat.id)) {
        seen.set(chat.id, { id: chat.id, title: chat.title ?? '', type: chat.type ?? '' });
      }
    }
    return { ok: true, chats: [...seen.values()] };
  } catch (err) {
    return { ok: false, chats: [], error: err instanceof Error ? err.message : String(err) };
  }
}

async function sendZaloMessage(
  botToken: string,
  chatId: string,
  text: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const url = `https://bot-api.zaloplatforms.com/bot${botToken}/sendMessage`;
    const body = JSON.stringify({ chat_id: chatId, text });
    const res = await httpsPost(url, body);
    if (!res.ok) {
      const parsed = JSON.parse(res.body) as { description?: string; message?: string };
      return { ok: false, error: parsed.description ?? parsed.message ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function buildReportText(
  shopKey: string,
  windowDays: number,
  limit: number,
  excludeVariants: string[]
): Promise<string> {
  const analytics = await getVariantSalesAnalytics({
    shop: shopKey,
    days: windowDays,
    eventLimit: 1000,
  });

  const excluded = new Set(excludeVariants);
  const filtered = excluded.size > 0
    ? { ...analytics, variants: analytics.variants.filter(
        (v) => !excluded.has((v.variantCode ?? '').toUpperCase())
      ) }
    : analytics;

  const { text } = formatVariantSalesZaloText(filtered, { limit });
  return text;
}

async function sendZaloPhoto(
  botToken: string,
  chatId: string,
  photoUrl: string,
  caption: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const url = `https://bot-api.zaloplatforms.com/bot${botToken}/sendPhoto`;
    const body = JSON.stringify({ chat_id: chatId, photo: photoUrl, caption });
    const res = await httpsPost(url, body);
    if (!res.ok) {
      let parsed: { description?: string; message?: string } = {};
      try { parsed = JSON.parse(res.body) as typeof parsed; } catch { /* ignore */ }
      return { ok: false, error: parsed.description ?? parsed.message ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function sendZaloPhotoBase64(
  imageBase64: string,
  caption = '',
  overrideChatId?: string
): Promise<{ ok: boolean; error?: string }> {
  const { botToken, chatId: defaultChatId } = getEnvConfig();
  const chatId = overrideChatId ?? defaultChatId;
  if (!botToken) return { ok: false, error: 'ZALO_BOT_TOKEN chưa được cấu hình.' };
  if (!chatId) return { ok: false, error: 'ZALO_CHAT_ID chưa được cấu hình.' };

  const publicBaseUrl = (
    process.env.SERVER_PUBLIC_URL?.trim() ||
    process.env.PANCAKE_PUBLIC_WEBHOOK_BASE?.trim()
  )?.replace(/\/$/, '');
  if (!publicBaseUrl) {
    return { ok: false, error: 'SERVER_PUBLIC_URL hoặc PANCAKE_PUBLIC_WEBHOOK_BASE chưa được cấu hình trong .env.' };
  }

  try {
    const buffer = Buffer.from(imageBase64, 'base64');
    if (!fs.existsSync(TEMP_IMG_DIR)) fs.mkdirSync(TEMP_IMG_DIR, { recursive: true });

    // Detect JPEG (FF D8 FF) vs PNG
    const ext = buffer[0] === 0xFF && buffer[1] === 0xD8 ? 'jpg' : 'png';
    const filename = `stock-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
    const filepath = path.join(TEMP_IMG_DIR, filename);
    fs.writeFileSync(filepath, buffer);

    const imageUrl = `${publicBaseUrl}/temp-images/${filename}`;
    console.log(`[zalo-bot] sendPhoto via URL: ${imageUrl}`);

    const result = await sendZaloPhoto(botToken, chatId, imageUrl, caption);
    console.log(`[zalo-bot] sendPhoto result: ok=${String(result.ok)} error=${result.error ?? ''}`);
    addLog({ sentAt: new Date().toISOString(), kind: 'report', success: result.ok, error: result.error, chatId, preview: caption.slice(0, 100) });
    return result;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    addLog({ sentAt: new Date().toISOString(), kind: 'report', success: false, error, chatId, preview: caption.slice(0, 100) });
    return { ok: false, error };
  }
}

export async function sendProductStockMultiToZalo(
  imagesBase64: string[]
): Promise<{ ok: boolean; error?: string }> {
  const { botToken, chatId } = getEnvConfig();
  if (!botToken) return { ok: false, error: 'ZALO_BOT_TOKEN chưa được cấu hình.' };
  if (!chatId) return { ok: false, error: 'ZALO_CHAT_ID chưa được cấu hình.' };

  const publicBaseUrl = (
    process.env.SERVER_PUBLIC_URL?.trim() ||
    process.env.PANCAKE_PUBLIC_WEBHOOK_BASE?.trim()
  )?.replace(/\/$/, '');
  if (!publicBaseUrl) {
    return { ok: false, error: 'SERVER_PUBLIC_URL hoặc PANCAKE_PUBLIC_WEBHOOK_BASE chưa được cấu hình.' };
  }

  try {
    if (!fs.existsSync(TEMP_IMG_DIR)) fs.mkdirSync(TEMP_IMG_DIR, { recursive: true });

    const filepaths: string[] = [];
    let lastResult: { ok: boolean; error?: string } = { ok: true };

    for (const b64 of imagesBase64) {
      const filename = `stock-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.png`;
      const filepath = path.join(TEMP_IMG_DIR, filename);
      fs.writeFileSync(filepath, Buffer.from(b64, 'base64'));
      filepaths.push(filepath);

      const imageUrl = `${publicBaseUrl}/temp-images/${filename}`;
      console.log(`[zalo-bot] sendPhoto (multi) via URL: ${imageUrl}`);
      lastResult = await sendZaloPhoto(botToken, chatId, imageUrl, '');
      console.log(`[zalo-bot] sendPhoto result: ok=${String(lastResult.ok)} error=${lastResult.error ?? ''}`);
      if (!lastResult.ok) break;
    }

    addLog({
      sentAt: new Date().toISOString(),
      kind: 'report',
      success: lastResult.ok,
      error: lastResult.error,
      chatId,
      preview: `${imagesBase64.length} ảnh tồn kho`,
    });
    return lastResult;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    addLog({ sentAt: new Date().toISOString(), kind: 'report', success: false, error, chatId, preview: '' });
    return { ok: false, error };
  }
}

export type ZaloProductStockVariant = {
  label: string;
  displayId: string;
  stock: number | null;
};

export type ZaloProductStockPayload = {
  productCode: string;
  productName: string;
  imageUrl: string | null;
  price: string;
  variants: ZaloProductStockVariant[];
};

function formatProductStockCaption(p: ZaloProductStockPayload): string {
  const header = p.productName !== '—' ? `📦 ${p.productName}` : `📦 ${p.productCode}`;
  const priceStr = p.price && p.price !== '—' ? `\n💰 ${p.price}` : '';
  const divider = '─────────────────────';
  const totalStock = p.variants.reduce((sum, v) => sum + (v.stock ?? 0), 0);
  const rows = p.variants
    .map((v) => {
      const stockStr = v.stock === null ? '?' : String(v.stock);
      const label = v.label || v.displayId;
      return `  ${label}  [${v.displayId}]  Tồn: ${stockStr}`;
    })
    .join('\n');
  return [header + priceStr, divider, rows, divider, `📊 Tổng tồn: ${totalStock} · ${p.variants.length} biến thể`].join('\n');
}

export async function sendProductStockToZalo(
  payload: ZaloProductStockPayload
): Promise<{ ok: boolean; error?: string; text?: string }> {
  const env = getEnvConfig();
  if (!env.botToken) return { ok: false, error: 'ZALO_BOT_TOKEN chưa được cấu hình.' };
  if (!env.chatId) return { ok: false, error: 'ZALO_CHAT_ID chưa được cấu hình.' };

  const caption = formatProductStockCaption(payload);

  let result: { ok: boolean; error?: string };
  if (payload.imageUrl) {
    result = await sendZaloPhoto(env.botToken, env.chatId, payload.imageUrl, caption);
    if (!result.ok) {
      // Fallback: send as text with image URL appended
      result = await sendZaloMessage(env.botToken, env.chatId, caption + (payload.imageUrl ? `\n🖼 ${payload.imageUrl}` : ''));
    }
  } else {
    result = await sendZaloMessage(env.botToken, env.chatId, caption);
  }

  addLog({
    sentAt: new Date().toISOString(),
    kind: 'report',
    success: result.ok,
    error: result.error,
    chatId: env.chatId,
    preview: caption.slice(0, 100),
  });
  return { ...result, text: caption };
}

export async function dispatchZaloSend(
  kind: 'test' | 'report' | 'scheduled'
): Promise<{ ok: boolean; error?: string; text?: string }> {
  const env = getEnvConfig();

  if (!env.botToken) {
    return { ok: false, error: 'ZALO_BOT_TOKEN chưa được cấu hình trên server.' };
  }
  if (!env.chatId) {
    return { ok: false, error: 'ZALO_CHAT_ID chưa được cấu hình trên server.' };
  }

  let text: string;
  if (kind === 'test') {
    const now = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    text = `✅ Kết nối Zalo thành công!\nServer MeiT Tools đang hoạt động.\nThời điểm: ${now}`;
  } else {
    try {
      text = await buildReportText(env.shopKey, env.windowDays, env.topLimit, env.excludeVariants);
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Không thể tạo báo cáo.';
      addLog({ sentAt: new Date().toISOString(), kind, success: false, error, chatId: env.chatId, preview: '' });
      return { ok: false, error };
    }
  }

  const result = await sendZaloMessage(env.botToken, env.chatId, text);
  addLog({
    sentAt: new Date().toISOString(),
    kind,
    success: result.ok,
    error: result.error,
    chatId: env.chatId,
    preview: text.slice(0, 100),
  });
  return { ...result, text };
}

export async function sendZaloText(
  text: string,
  overrideChatId?: string
): Promise<{ ok: boolean; error?: string }> {
  const env = getEnvConfig();
  const chatId = overrideChatId ?? env.chatId;
  if (!env.botToken) return { ok: false, error: 'ZALO_BOT_TOKEN chưa được cấu hình.' };
  if (!chatId) return { ok: false, error: 'ZALO_CHAT_ID chưa được cấu hình.' };
  const result = await sendZaloMessage(env.botToken, chatId, text);
  addLog({
    sentAt: new Date().toISOString(),
    kind: 'alert',
    success: result.ok,
    error: result.error,
    chatId,
    preview: text.slice(0, 100),
  });
  return result;
}

// ---- Daily stock report (for schedule) ----

type ProductEntry = {
  name: string;
  imageUrl: string | null;
  variants: Array<{ color: string; size: string; stock: number | null }>;
};

function extractImageUrl(r: Record<string, unknown>, prod: Record<string, unknown> | null): string | null {
  const fromArr = (images: unknown): string | null => {
    if (!Array.isArray(images) || images.length === 0) return null;
    const first = images[0];
    if (typeof first === 'string' && first.trim()) return first.trim();
    if (first && typeof first === 'object') {
      const img = first as Record<string, unknown>;
      const url = img.thumbnail_url ?? img.url ?? img.src;
      if (typeof url === 'string' && url.trim()) return url.trim();
    }
    return null;
  };
  return fromArr(r.images)
    ?? fromArr(prod?.images)
    ?? (typeof prod?.thumbnail_url === 'string' ? prod.thumbnail_url : null)
    ?? (typeof r.thumbnail_url === 'string' ? r.thumbnail_url : null)
    ?? null;
}

async function fetchProductMap(
  productCodes: string[],
  shopKey: string
): Promise<Map<string, ProductEntry>> {
  const rows = await getAllProductVariations(shopKey as InvoiceShopKey);
  const codeSet = new Set(productCodes);
  const productMap = new Map<string, ProductEntry>();

  for (const row of rows) {
    const r = row as Record<string, unknown>;
    const prod = (r.product && typeof r.product === 'object' && !Array.isArray(r.product))
      ? (r.product as Record<string, unknown>)
      : null;
    const code = String(r.product_display_id ?? prod?.display_id ?? '').trim();
    if (!code || !codeSet.has(code)) continue;

    if (!productMap.has(code)) {
      const name = String(r.product_name ?? prod?.name ?? r.name ?? '').trim();
      productMap.set(code, { name, imageUrl: extractImageUrl(r, prod), variants: [] });
    }

    const fields = Array.isArray(r.fields) ? (r.fields as Array<Record<string, unknown>>) : [];
    const colorField = fields.find((f) => typeof f.name === 'string' && /màu/i.test(f.name));
    const sizeField = fields.find((f) => typeof f.name === 'string' && /size|kích/i.test(f.name));
    const color = typeof colorField?.value === 'string' ? colorField.value : '';
    const rawLabel = String(r.name ?? r.variant_name ?? '').trim();
    const size = typeof sizeField?.value === 'string' && sizeField.value.trim()
      ? sizeField.value.trim()
      : (() => {
          const parts = rawLabel.split(/\s+/);
          return parts.length > 1 ? parts[parts.length - 1] : rawLabel;
        })();
    let stock: number | null = null;
    for (const field of ['quantity', 'remain_quantity', 'stock_quantity']) {
      const v = Number(r[field]);
      if (Number.isFinite(v) && v >= 0) { stock = v; break; }
    }
    productMap.get(code)!.variants.push({ color, size, stock });
  }

  return productMap;
}

function buildHeaderText(): string {
  const vnNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const dd = String(vnNow.getUTCDate()).padStart(2, '0');
  const mm = String(vnNow.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = vnNow.getUTCFullYear();
  const hh = String(vnNow.getUTCHours()).padStart(2, '0');
  const min = String(vnNow.getUTCMinutes()).padStart(2, '0');
  return `📦 Tồn kho MeiT\n📅 ${dd}/${mm}/${yyyy} · ${hh}:${min} VN\n━━━━━━━━━━━━━━━━━━━━━━━━`;
}

function buildChunkStockText(chunk: string[], productMap: Map<string, ProductEntry>): string {
  const blocks: string[] = [];
  for (const code of chunk) {
    const entry = productMap.get(code);
    if (!entry) continue;

    const colorMap = new Map<string, Array<{ size: string; stock: number | null }>>();
    for (const v of entry.variants) {
      const key = v.color || '__';
      if (!colorMap.has(key)) colorMap.set(key, []);
      colorMap.get(key)!.push({ size: v.size, stock: v.stock });
    }

    const lines: string[] = [`🔖 ${code}`];
    for (const [colorKey, items] of colorMap) {
      const label = colorKey === '__' ? '' : `${colorKey}: `;
      const sizes = items.map((it) => `${it.stock ?? '?'}${it.size}`).join(' · ');
      lines.push(`  ${label}${sizes}`);
    }
    blocks.push(lines.join('\n'));
  }
  return blocks.join('\n─────────────────────\n');
}

type SlowMover = { code: string; totalStock: number; soldPerDay: number; daysLeft: number | null };

async function fetchSlowMovers(
  productCodes: string[],
  shopKey: string,
  windowDays: number
): Promise<SlowMover[]> {
  const analytics = await computeVariantSalesAnalytics({ days: windowDays, shopKey });
  const codeSet = new Set(productCodes);

  const agg = new Map<string, { stock: number; soldPerDay: number }>();
  for (const v of analytics.variants) {
    if (!v.productCode || !codeSet.has(v.productCode)) continue;
    const cur = agg.get(v.productCode) ?? { stock: 0, soldPerDay: 0 };
    cur.stock += v.currentStock ?? 0;
    cur.soldPerDay += v.avgSoldPerDay;
    agg.set(v.productCode, cur);
  }

  const results: SlowMover[] = [];
  for (const [code, { stock, soldPerDay }] of agg) {
    if (stock < 20) continue;
    const daysLeft = soldPerDay > 0 ? Math.round(stock / soldPerDay) : null;
    if (daysLeft === null || daysLeft > 14) {
      results.push({ code, totalStock: stock, soldPerDay: Math.round(soldPerDay * 10) / 10, daysLeft });
    }
  }

  return results.sort((a, b) => {
    if (a.daysLeft === null && b.daysLeft === null) return b.totalStock - a.totalStock;
    if (a.daysLeft === null) return -1;
    if (b.daysLeft === null) return 1;
    return b.daysLeft - a.daysLeft;
  });
}

function buildSlowMoversText(items: SlowMover[], windowDays: number): string {
  const lines = [`⚠️ Hàng tồn chậm bán mọi người chú ý đẩy hàng`, '━━━━━━━━━━━━━━━━━━━━━━━━'];
  for (const p of items) {
    const rate = p.soldPerDay.toFixed(1);
    lines.push(`📦 ${p.code}  Tồn: ${p.totalStock}  |  ${rate}/ngày`);
  }
  return lines.join('\n');
}

const PRODUCTS_PER_MESSAGE = 9;

export async function sendDailyStockReport(
  kind: 'scheduled' | 'manual' = 'manual'
): Promise<{ ok: boolean; error?: string; text?: string }> {
  const env = getEnvConfig();
  if (!env.botToken) return { ok: false, error: 'ZALO_BOT_TOKEN chưa được cấu hình.' };
  const targetChatId = env.stockChatId ?? env.chatId;
  if (!targetChatId) return { ok: false, error: 'ZALO_STOCK_CHAT_ID hoặc ZALO_CHAT_ID chưa được cấu hình.' };

  const publicBaseUrl = (
    process.env.SERVER_PUBLIC_URL?.trim() ||
    process.env.PANCAKE_PUBLIC_WEBHOOK_BASE?.trim()
  )?.replace(/\/$/, '');
  if (!publicBaseUrl) {
    return { ok: false, error: 'SERVER_PUBLIC_URL hoặc PANCAKE_PUBLIC_WEBHOOK_BASE chưa được cấu hình.' };
  }

  const config = await getDailyStockConfig();
  if (config.productCodes.length === 0) {
    return { ok: false, error: 'Chưa cấu hình sản phẩm nào cho lịch gửi.' };
  }

  // Fetch Pancake data once
  let productMap: Map<string, ProductEntry>;
  try {
    productMap = await fetchProductMap(config.productCodes, config.shopKey);
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Không thể tải dữ liệu tồn kho.';
    addLog({ sentAt: new Date().toISOString(), kind: 'report', success: false, error, chatId: targetChatId, preview: '' });
    return { ok: false, error };
  }

  // Split into chunks of PRODUCTS_PER_MESSAGE
  const chunks: string[][] = [];
  for (let i = 0; i < config.productCodes.length; i += PRODUCTS_PER_MESSAGE) {
    chunks.push(config.productCodes.slice(i, i + PRODUCTS_PER_MESSAGE));
  }

  const logKind = kind === 'scheduled' ? 'scheduled' : 'report';

  // Send header as a separate message before images
  const headerResult = await sendZaloMessage(env.botToken, targetChatId, buildHeaderText());
  if (!headerResult.ok) {
    addLog({ sentAt: new Date().toISOString(), kind: logKind, success: false, error: headerResult.error, chatId: targetChatId, preview: 'header message' });
    return headerResult;
  }

  for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
    const chunk = chunks[chunkIdx];

    // Generate one stock image per product in this chunk
    const images: string[] = [];
    for (const code of chunk) {
      const entry = productMap.get(code);
      if (!entry) continue;
      const variants = entry.variants;
      try {
        const b64 = await generateStockImageServer(code, entry.imageUrl, variants);
        images.push(b64);
      } catch (err) {
        console.error(`[zalo-bot] generateStockImage failed for ${code}:`, err);
      }
    }

    if (images.length === 0) continue;

    // Stitch into composite (or send single image directly)
    let compositeB64: string;
    try {
      compositeB64 = images.length === 1
        ? images[0]
        : await stitchIntoCompositeServer(images);
    } catch (err) {
      console.error('[zalo-bot] stitchIntoComposite failed:', err);
      compositeB64 = images[0];
    }

    const imgResult = await sendZaloPhotoBase64(compositeB64, '', targetChatId);
    addLog({
      sentAt: new Date().toISOString(),
      kind: logKind,
      success: imgResult.ok,
      error: imgResult.error,
      chatId: targetChatId,
      preview: `chunk ${chunkIdx + 1}/${chunks.length} · ${images.length} ảnh`,
    });
    if (!imgResult.ok) return imgResult;

    const stockText = buildChunkStockText(chunk, productMap);
    const textResult = await sendZaloMessage(env.botToken, targetChatId, stockText);
    addLog({
      sentAt: new Date().toISOString(),
      kind: logKind,
      success: textResult.ok,
      error: textResult.error,
      chatId: targetChatId,
      preview: stockText.slice(0, 80),
    });
    if (!textResult.ok) return textResult;
  }

  // Slow-movers alert
  try {
    const slowMovers = await fetchSlowMovers(config.productCodes, config.shopKey, env.windowDays);
    if (slowMovers.length > 0) {
      const slowText = buildSlowMoversText(slowMovers, env.windowDays);
      const slowResult = await sendZaloMessage(env.botToken, targetChatId, slowText);
      addLog({ sentAt: new Date().toISOString(), kind: logKind, success: slowResult.ok, error: slowResult.error, chatId: targetChatId, preview: 'slow-movers' });
    }
  } catch (err) {
    console.error('[zalo-bot] fetchSlowMovers failed:', err);
  }

  return { ok: true };
}

// ---- Daily scheduler ----

let schedulerStarted = false;
let lastSalesScheduledDate = '';
let lastStockScheduledKey = '';

export function startZaloDailyScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;
  cleanOldTempImages();

  setInterval(() => {
    void (async () => {
      const env = getEnvConfig();
      const vnNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
      const vnDate = vnNow.toISOString().split('T')[0];
      const vnHour = vnNow.getUTCHours();
      const vnMinute = vnNow.getUTCMinutes();

      // Sales report: fires at configured hour (whole hour)
      if (env.botToken && env.chatId && vnHour === env.reportHour && lastSalesScheduledDate !== vnDate) {
        lastSalesScheduledDate = vnDate;
        if (useMongo()) {
          const settings = await getAdminSettings().catch(() => null);
          if (settings && !settings.botEnabled.zalo) {
            console.log('[zalo-bot] Bot đang bị tắt trong cài đặt admin, bỏ qua lịch gửi báo cáo doanh số.');
            return;
          }
        }
        const result = await dispatchZaloSend('scheduled');
        if (result.ok) {
          console.log(`[zalo-bot] Đã gửi báo cáo doanh số tự động lúc ${vnDate} ${vnHour}h (VN).`);
        } else {
          console.error(`[zalo-bot] Lỗi gửi báo cáo doanh số: ${result.error ?? ''}`);
        }
      }

      // Stock report: fires at configured sendTime (e.g. "16:30")
      const stockConfig = await getDailyStockConfig().catch(() => null);
      if (
        stockConfig?.enabled &&
        env.botToken && env.chatId &&
        stockConfig.productCodes.length > 0
      ) {
        const [configH, configM] = stockConfig.sendTime.split(':').map(Number);
        const stockKey = `${vnDate}-${stockConfig.sendTime}`;
        if (vnHour === configH && vnMinute === configM && lastStockScheduledKey !== stockKey) {
          lastStockScheduledKey = stockKey;
          if (useMongo()) {
            const settings = await getAdminSettings().catch(() => null);
            if (settings && !settings.botEnabled.zalo) {
              console.log('[zalo-bot] Bot đang bị tắt, bỏ qua lịch gửi tồn kho.');
              return;
            }
          }
          const result = await sendDailyStockReport('scheduled');
          if (result.ok) {
            await saveDailyStockConfig({ lastSentDate: vnDate });
            console.log(`[zalo-bot] Đã gửi tồn kho tự động lúc ${vnDate} ${stockConfig.sendTime} (VN).`);
          } else {
            console.error(`[zalo-bot] Lỗi gửi tồn kho: ${result.error ?? ''}`);
          }
        }
      }
    })();
  }, 60_000);

  console.log('[zalo-bot] Bộ lập lịch hàng ngày đã khởi động.');
}
