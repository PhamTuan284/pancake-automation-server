import mongoose from 'mongoose';

const pancakeWebhookEventSchema = new mongoose.Schema(
  {
    receivedAt: { type: Date, default: Date.now, index: true },
    kind: { type: String, default: 'unknown', index: true },
    contentType: { type: String, default: '' },
    headers: { type: mongoose.Schema.Types.Mixed, default: {} },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { collection: 'pancake_webhook_events' }
);

pancakeWebhookEventSchema.index({ receivedAt: -1 });

export default mongoose.model('PancakeWebhookEvent', pancakeWebhookEventSchema);
