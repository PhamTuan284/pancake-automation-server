import mongoose from 'mongoose';
import { useMongo } from '../../common/mongo';

export interface AbnormalOrderAlertConfig {
  enabled: boolean;
  /** Cảnh báo khi (sau chiết khấu / giá gốc) < thresholdPct%. Mặc định: 60 */
  thresholdPct: number;
}

const DEFAULT_CONFIG: AbnormalOrderAlertConfig = {
  enabled: true,
  thresholdPct: 60,
};

let memConfig: AbnormalOrderAlertConfig = { ...DEFAULT_CONFIG };

const schema = new mongoose.Schema<AbnormalOrderAlertConfig>(
  {
    enabled: { type: Boolean, default: true },
    thresholdPct: { type: Number, default: 60 },
  },
  { collection: 'zalo_abnormal_order_config' }
);

const AbnormalOrderConfigModel = mongoose.model<AbnormalOrderAlertConfig>(
  'ZaloAbnormalOrderConfig',
  schema
);

export async function getAbnormalOrderConfig(): Promise<AbnormalOrderAlertConfig> {
  if (useMongo()) {
    try {
      let doc = await AbnormalOrderConfigModel.findOne();
      if (!doc) {
        doc = await AbnormalOrderConfigModel.create({ ...DEFAULT_CONFIG });
      }
      memConfig = {
        enabled: doc.enabled ?? true,
        thresholdPct: doc.thresholdPct ?? 60,
      };
    } catch { /* fall through to in-memory */ }
  }
  return { ...memConfig };
}

export async function saveAbnormalOrderConfig(
  data: Partial<AbnormalOrderAlertConfig>
): Promise<AbnormalOrderAlertConfig> {
  const updated: AbnormalOrderAlertConfig = { ...memConfig, ...data };
  memConfig = updated;

  if (useMongo()) {
    try {
      await AbnormalOrderConfigModel.findOneAndUpdate(
        {},
        { $set: updated },
        { upsert: true }
      );
    } catch { /* ignore, in-memory is the fallback */ }
  }
  return { ...updated };
}
