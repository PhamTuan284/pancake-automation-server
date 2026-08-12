import mongoose from 'mongoose';
import { useMongo } from '../../common/mongo';

export interface ProductPriceConfig {
  productCode: string;
  /** Giá nhập */
  costPrice: number;
  /** Giá bán ngoài sàn (Zalo, Facebook) */
  offPlatformPrice: number;
  /** Giá bán trên sàn (Shopee, Tiktok) */
  platformPrice: number;
  /** Giá bán sỉ */
  wholesalePrice: number;
}

const memConfigs = new Map<string, ProductPriceConfig>();

const schema = new mongoose.Schema<ProductPriceConfig>(
  {
    productCode: { type: String, required: true, unique: true },
    costPrice: { type: Number, default: 0 },
    offPlatformPrice: { type: Number, default: 0 },
    platformPrice: { type: Number, default: 0 },
    wholesalePrice: { type: Number, default: 0 },
  },
  { collection: 'product_price_config' }
);

const ProductPriceConfigModel = mongoose.model<ProductPriceConfig>(
  'ProductPriceConfig',
  schema
);

export async function listProductPriceConfigs(): Promise<ProductPriceConfig[]> {
  if (useMongo()) {
    try {
      const docs = await ProductPriceConfigModel.find().lean();
      memConfigs.clear();
      for (const doc of docs) {
        memConfigs.set(doc.productCode, {
          productCode: doc.productCode,
          costPrice: doc.costPrice ?? 0,
          offPlatformPrice: doc.offPlatformPrice ?? 0,
          platformPrice: doc.platformPrice ?? 0,
          wholesalePrice: doc.wholesalePrice ?? 0,
        });
      }
    } catch { /* fall through to in-memory */ }
  }
  return Array.from(memConfigs.values()).sort((a, b) => a.productCode.localeCompare(b.productCode));
}

export async function getProductPriceConfigMap(): Promise<Map<string, ProductPriceConfig>> {
  await listProductPriceConfigs();
  return new Map(memConfigs);
}

export async function upsertProductPriceConfig(
  data: ProductPriceConfig
): Promise<ProductPriceConfig> {
  const productCode = data.productCode.trim();
  const updated: ProductPriceConfig = {
    productCode,
    costPrice: Number(data.costPrice) || 0,
    offPlatformPrice: Number(data.offPlatformPrice) || 0,
    platformPrice: Number(data.platformPrice) || 0,
    wholesalePrice: Number(data.wholesalePrice) || 0,
  };
  memConfigs.set(productCode, updated);

  if (useMongo()) {
    try {
      await ProductPriceConfigModel.findOneAndUpdate(
        { productCode },
        { $set: updated },
        { upsert: true }
      );
    } catch { /* ignore, in-memory is the fallback */ }
  }
  return updated;
}

export async function deleteProductPriceConfig(productCode: string): Promise<void> {
  memConfigs.delete(productCode);
  if (useMongo()) {
    try {
      await ProductPriceConfigModel.deleteOne({ productCode });
    } catch { /* ignore */ }
  }
}
