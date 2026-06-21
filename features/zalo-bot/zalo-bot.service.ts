import https from 'https';
import { getVariantSalesAnalytics } from '../pancake-webhook/webhook.service';
import { formatVariantSalesZaloText } from './formatVariantSalesZaloText';

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
  kind: 'test' | 'report' | 'scheduled';
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

// ---- Daily scheduler ----

let schedulerStarted = false;
let lastScheduledDate = '';

export function startZaloDailyScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;

  setInterval(() => {
    const env = getEnvConfig();
    if (!env.botToken || !env.chatId) return;

    const vnHour = (new Date().getUTCHours() + 7) % 24;
    const vnDate = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().split('T')[0];

    if (vnHour === env.reportHour && lastScheduledDate !== vnDate) {
      lastScheduledDate = vnDate;
      void dispatchZaloSend('scheduled').then((result) => {
        if (result.ok) {
          console.log(`[zalo-bot] Đã gửi báo cáo tự động lúc ${vnDate} ${vnHour}h (VN).`);
        } else {
          console.error(`[zalo-bot] Lỗi gửi báo cáo tự động: ${result.error ?? ''}`);
        }
      });
    }
  }, 60_000);

  console.log('[zalo-bot] Bộ lập lịch hàng ngày đã khởi động.');
}
