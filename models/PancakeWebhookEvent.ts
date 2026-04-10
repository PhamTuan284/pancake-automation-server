import mongoose from 'mongoose';

const collection =
  String(
    process.env.MONGODB_WEBHOOK_EVENTS_COLLECTION || 'pancake_webhook_events'
  ).trim() || 'pancake_webhook_events';

const pancakeWebhookEventSchema = new mongoose.Schema(
  {
    receivedAt: { type: Date, required: true, index: true },
    contentType: { type: String, default: '' },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { collection }
);

export default mongoose.model('PancakeWebhookEvent', pancakeWebhookEventSchema);
