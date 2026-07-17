import mongoose from 'mongoose';
import { useMongo } from '../mongo';

/**
 * Persisted send history for the Telegram/Zalo bots, so the UI log panel
 * survives server restarts. Falls back to an in-memory ring buffer when
 * Mongo is not configured.
 */

export type BotSendLogEntry = {
  id: string;
  sentAt: string; // ISO
  kind: string;   // 'test' | 'report' | 'scheduled' | 'alert'
  success: boolean;
  error?: string;
  chatId: string;
  preview: string;
};

type BotName = 'telegram' | 'zalo';

const LOG_TTL_SECONDS = 30 * 24 * 60 * 60;
const MAX_LOGS = 50;

type BotSendLogDoc = {
  bot: BotName;
  sentAt: Date;
  kind: string;
  success: boolean;
  error?: string;
  chatId: string;
  preview: string;
};

const schema = new mongoose.Schema<BotSendLogDoc>(
  {
    bot: { type: String, required: true, index: true },
    sentAt: { type: Date, default: Date.now },
    kind: { type: String, default: 'report' },
    success: { type: Boolean, default: false },
    error: { type: String },
    chatId: { type: String, default: '' },
    preview: { type: String, default: '' },
  },
  { collection: 'bot_send_logs' }
);

schema.index({ sentAt: 1 }, { expireAfterSeconds: LOG_TTL_SECONDS });
schema.index({ bot: 1, sentAt: -1 });

const BotSendLogModel = mongoose.model<BotSendLogDoc>('BotSendLog', schema);

const memLogs: Record<BotName, BotSendLogEntry[]> = { telegram: [], zalo: [] };

export function addBotSendLog(
  bot: BotName,
  log: Omit<BotSendLogEntry, 'id'>
): void {
  const entry: BotSendLogEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    ...log,
  };
  const buffer = memLogs[bot];
  buffer.unshift(entry);
  if (buffer.length > MAX_LOGS) buffer.splice(MAX_LOGS);

  if (useMongo()) {
    void BotSendLogModel.create({
      bot,
      sentAt: new Date(log.sentAt),
      kind: log.kind,
      success: log.success,
      error: log.error,
      chatId: log.chatId,
      preview: log.preview,
    }).catch((err: unknown) => {
      console.error(`[bot-log] Failed to persist ${bot} send log:`, err);
    });
  }
}

export async function getBotSendLogs(bot: BotName): Promise<BotSendLogEntry[]> {
  if (useMongo()) {
    try {
      const docs = await BotSendLogModel.find({ bot })
        .sort({ sentAt: -1 })
        .limit(MAX_LOGS)
        .lean();
      return docs.map((d) => ({
        id: String(d._id),
        sentAt: new Date(d.sentAt).toISOString(),
        kind: d.kind,
        success: d.success,
        error: d.error ?? undefined,
        chatId: d.chatId,
        preview: d.preview,
      }));
    } catch { /* fall through to memory */ }
  }
  return [...memLogs[bot]];
}
