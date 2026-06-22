import https from 'https';
import { getVariantSalesAnalytics } from '../pancake-webhook/webhook.service';
import { formatVariantSalesTelegramHtml } from './formatVariantSalesTelegramHtml';
import { getAdminSettings } from '../../common/models/adminSettingsModel';
import { useMongo } from '../../common/mongo';

export type TelegramBotConfig = {
  botConfigured: boolean;
  chatId: string | null;
  reportHour: number;
  shopKey: string;
  windowDays: number;
  topLimit: number;
};

export type TelegramSendLog = {
  id: string;
  sentAt: string;
  kind: 'test' | 'report' | 'scheduled';
  success: boolean;
  error?: string;
  chatId: string;
  preview: string;
};

const MAX_LOGS = 50;
const sendLogs: TelegramSendLog[] = [];

function getEnvConfig() {
  return {
    botToken: process.env.TELEGRAM_BOT_TOKEN?.trim() || null,
    chatId: process.env.TELEGRAM_CHAT_ID?.trim() || null,
    reportHour: Math.max(0, Math.min(23, parseInt(process.env.TELEGRAM_REPORT_HOUR ?? '8', 10) || 8)),
    shopKey: process.env.TELEGRAM_REPORT_SHOP?.trim() || 'meit',
    windowDays: Math.max(1, parseInt(process.env.TELEGRAM_REPORT_DAYS ?? '7', 10) || 7),
    topLimit: Math.max(1, parseInt(process.env.TELEGRAM_REPORT_LIMIT ?? '15', 10) || 15),
    excludeVariants: (process.env.TELEGRAM_EXCLUDE_VARIANTS ?? '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean),
  };
}

export function getTelegramBotConfig(): TelegramBotConfig {
  const env = getEnvConfig();
  return {
    botConfigured: !!env.botToken,
    chatId: env.chatId,
    reportHour: env.reportHour,
    shopKey: env.shopKey,
    windowDays: env.windowDays,
    topLimit: env.topLimit,
  };
}

export function getTelegramSendLogs(): TelegramSendLog[] {
  return [...sendLogs];
}

function addLog(log: Omit<TelegramSendLog, 'id'>): void {
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
        res.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
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

async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
  parseMode?: 'HTML'
): Promise<{ ok: boolean; error?: string }> {
  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const payload: Record<string, unknown> = { chat_id: chatId, text };
    if (parseMode) payload.parse_mode = parseMode;
    const body = JSON.stringify(payload);
    const res = await httpsPost(url, body);
    if (!res.ok) {
      const parsed = JSON.parse(res.body) as { description?: string };
      return { ok: false, error: parsed.description ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function buildReportHtml(
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
    ? {
        ...analytics,
        variants: analytics.variants.filter(
          (v) => !excluded.has((v.variantCode ?? '').toUpperCase())
        ),
      }
    : analytics;

  const { html } = formatVariantSalesTelegramHtml(filtered, { limit });
  return html;
}

export async function dispatchTelegramSend(
  kind: 'test' | 'report' | 'scheduled'
): Promise<{ ok: boolean; error?: string; text?: string }> {
  const env = getEnvConfig();

  if (!env.botToken) {
    return { ok: false, error: 'TELEGRAM_BOT_TOKEN chưa được cấu hình trên server.' };
  }
  if (!env.chatId) {
    return { ok: false, error: 'TELEGRAM_CHAT_ID chưa được cấu hình trên server.' };
  }

  let text: string;
  let parseMode: 'HTML' | undefined;

  if (kind === 'test') {
    const now = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    text = `✅ <b>Kết nối thành công!</b>\nServer MeiT Tools đang hoạt động.\nThời điểm: ${now}`;
    parseMode = 'HTML';
  } else {
    try {
      text = await buildReportHtml(env.shopKey, env.windowDays, env.topLimit, env.excludeVariants);
      parseMode = 'HTML';
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Không thể tạo báo cáo.';
      addLog({ sentAt: new Date().toISOString(), kind, success: false, error, chatId: env.chatId, preview: '' });
      return { ok: false, error };
    }
  }

  const result = await sendTelegramMessage(env.botToken, env.chatId, text, parseMode);
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

// ---- Daily scheduler (setInterval, checks every minute) ----

let schedulerStarted = false;
let lastScheduledDate = '';

export function startTelegramDailyScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;

  setInterval(() => {
    const env = getEnvConfig();
    if (!env.botToken || !env.chatId) return;

    // Vietnam is UTC+7 with no DST
    const vnHour = (new Date().getUTCHours() + 7) % 24;
    const vnDate = new Date(Date.now() + 7 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    if (vnHour === env.reportHour && lastScheduledDate !== vnDate) {
      lastScheduledDate = vnDate;
      void (async () => {
        if (useMongo()) {
          const settings = await getAdminSettings().catch(() => null);
          if (settings && !settings.botEnabled.telegram) {
            console.log('[telegram-bot] Bot đang bị tắt trong cài đặt admin, bỏ qua lịch gửi.');
            return;
          }
        }
        const result = await dispatchTelegramSend('scheduled');
        if (result.ok) {
          console.log(`[telegram-bot] Đã gửi báo cáo tự động lúc ${vnDate} ${vnHour}h (VN).`);
        } else {
          console.error(`[telegram-bot] Lỗi gửi báo cáo tự động: ${result.error ?? ''}`);
        }
      })();
    }
  }, 60_000);

  console.log('[telegram-bot] Bộ lập lịch hàng ngày đã khởi động.');
}
