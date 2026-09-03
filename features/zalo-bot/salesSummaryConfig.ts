import mongoose from 'mongoose';
import { useMongo } from '../../common/mongo';

export interface SalesSummaryConfigData {
  shopKey: string;
  enabled: boolean;
  sendTime: string;      // "HH:MM" in Vietnam time (e.g. "09:00")
  lastSentDate: string;  // "YYYY-MM-DD" last date the 5-day report was sent
}

const DEFAULT_CONFIG: SalesSummaryConfigData = {
  shopKey: 'meit',
  enabled: true,
  sendTime: '09:00',
  lastSentDate: '',
};

let memConfig: SalesSummaryConfigData = { ...DEFAULT_CONFIG };

const schema = new mongoose.Schema<SalesSummaryConfigData>(
  {
    shopKey: { type: String, default: 'meit' },
    enabled: { type: Boolean, default: true },
    sendTime: { type: String, default: '09:00' },
    lastSentDate: { type: String, default: '' },
  },
  { collection: 'zalo_sales_summary_config' }
);

const SalesSummaryConfigModel = mongoose.model<SalesSummaryConfigData>(
  'ZaloSalesSummaryConfig',
  schema
);

export async function getSalesSummaryConfig(): Promise<SalesSummaryConfigData> {
  if (useMongo()) {
    try {
      let doc = await SalesSummaryConfigModel.findOne();
      if (!doc) {
        doc = await SalesSummaryConfigModel.create({ ...DEFAULT_CONFIG });
      }
      memConfig = {
        shopKey: doc.shopKey ?? 'meit',
        enabled: doc.enabled ?? true,
        sendTime: doc.sendTime ?? '09:00',
        lastSentDate: doc.lastSentDate ?? '',
      };
    } catch { /* fall through to in-memory */ }
  }
  return { ...memConfig };
}

export async function saveSalesSummaryConfig(
  data: Partial<SalesSummaryConfigData>
): Promise<SalesSummaryConfigData> {
  const updated: SalesSummaryConfigData = { ...memConfig, ...data };
  memConfig = updated;

  if (useMongo()) {
    try {
      await SalesSummaryConfigModel.findOneAndUpdate({}, { $set: updated }, { upsert: true });
    } catch { /* ignore, in-memory is the fallback */ }
  }
  return { ...updated };
}
