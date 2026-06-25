import mongoose from 'mongoose';
import { useMongo } from '../../common/mongo';

export interface DailyStockConfigData {
  productCodes: string[];
  shopKey: string;
  enabled: boolean;
  sendTime: string;       // "HH:MM" in Vietnam time (e.g. "16:30")
  lastSentDate: string;   // "YYYY-MM-DD" last date the daily report was sent
}

const DEFAULT_CONFIG: DailyStockConfigData = {
  productCodes: [],
  shopKey: 'meit',
  enabled: true,
  sendTime: '16:30',
  lastSentDate: '',
};

let memConfig: DailyStockConfigData = { ...DEFAULT_CONFIG };

const schema = new mongoose.Schema<DailyStockConfigData>(
  {
    productCodes: [{ type: String }],
    shopKey: { type: String, default: 'meit' },
    enabled: { type: Boolean, default: true },
    sendTime: { type: String, default: '16:30' },
    lastSentDate: { type: String, default: '' },
  },
  { collection: 'zalo_daily_stock_config' }
);

const DailyStockConfigModel = mongoose.model<DailyStockConfigData>(
  'ZaloDailyStockConfig',
  schema
);

export async function getDailyStockConfig(): Promise<DailyStockConfigData> {
  if (useMongo()) {
    try {
      let doc = await DailyStockConfigModel.findOne();
      if (!doc) {
        doc = await DailyStockConfigModel.create({ ...DEFAULT_CONFIG });
      }
      memConfig = {
        productCodes: doc.productCodes ?? [],
        shopKey: doc.shopKey ?? 'meit',
        enabled: doc.enabled ?? true,
        sendTime: doc.sendTime ?? '16:30',
        lastSentDate: doc.lastSentDate ?? '',
      };
    } catch { /* fall through to in-memory */ }
  }
  return { ...memConfig };
}

export async function saveDailyStockConfig(
  data: Partial<DailyStockConfigData>
): Promise<DailyStockConfigData> {
  const updated: DailyStockConfigData = {
    ...memConfig,
    ...data,
    productCodes: data.productCodes ?? memConfig.productCodes,
  };
  memConfig = updated;

  if (useMongo()) {
    try {
      await DailyStockConfigModel.findOneAndUpdate(
        {},
        { $set: updated },
        { upsert: true }
      );
    } catch { /* ignore, in-memory is the fallback */ }
  }
  return { ...updated };
}
