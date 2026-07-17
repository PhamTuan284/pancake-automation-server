import mongoose from 'mongoose';
import { connectMongo, useMongo } from '../mongo';

/** Analytics never looks back more than 90 days; expire events after that. */
const EVENT_TTL_SECONDS = 90 * 24 * 60 * 60;

const pancakeWebhookEventSchema = new mongoose.Schema(
  {
    receivedAt: { type: Date, default: Date.now },
    kind: { type: String, default: 'unknown', index: true },
    shopKey: { type: String, default: '', index: true },
    contentType: { type: String, default: '' },
    headers: { type: mongoose.Schema.Types.Mixed, default: {} },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { collection: 'pancake_webhook_events' }
);

pancakeWebhookEventSchema.index(
  { receivedAt: 1 },
  { expireAfterSeconds: EVENT_TTL_SECONDS }
);

const PancakeWebhookEvent = mongoose.model(
  'PancakeWebhookEvent',
  pancakeWebhookEventSchema
);

/**
 * Drops stale indexes (the old non-TTL receivedAt indexes) and creates the
 * TTL index. Mongo rejects a TTL index whose key pattern collides with an
 * existing plain index, so plain autoIndex is not enough — call this once
 * at startup.
 */
export async function syncWebhookEventIndexes(): Promise<void> {
  if (!useMongo()) return;
  try {
    await connectMongo();
    await PancakeWebhookEvent.syncIndexes();
  } catch (err) {
    console.error('[webhook] Failed to sync event indexes:', err);
  }
}

export default PancakeWebhookEvent;
