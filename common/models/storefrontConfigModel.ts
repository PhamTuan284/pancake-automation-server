import mongoose from 'mongoose';

export type HeroBannerConfig = {
  videoUrl: string;
  posterUrl: string;
};

export type CategoryBannerConfig = {
  id: string;
  imageUrl: string;
};

export type ImageOverride = {
  id: string;
  imageUrl: string;
};

export type CostPriceOverride = {
  id: string;
  costPrice: number;
};

export type StorefrontConfigDoc = {
  heroBanner: HeroBannerConfig;
  categoryBanners: CategoryBannerConfig[];
  productImageOverrides: ImageOverride[];
  variantImageOverrides: ImageOverride[];
  productCostPrices: CostPriceOverride[];
};

const imageOverrideSchema = { id: { type: String }, imageUrl: { type: String } };
const costPriceSchema = { id: { type: String }, costPrice: { type: Number } };

const storefrontConfigSchema = new mongoose.Schema<StorefrontConfigDoc>(
  {
    heroBanner: {
      videoUrl: { type: String, default: '' },
      posterUrl: { type: String, default: '' },
    },
    categoryBanners: [imageOverrideSchema],
    productImageOverrides: [imageOverrideSchema],
    variantImageOverrides: [imageOverrideSchema],
    productCostPrices: [costPriceSchema],
  },
  { collection: 'storefront_config' }
);

export const StorefrontConfigModel = mongoose.model<StorefrontConfigDoc>(
  'StorefrontConfig',
  storefrontConfigSchema
);

export async function getStorefrontConfig(): Promise<StorefrontConfigDoc> {
  let config = await StorefrontConfigModel.findOne();
  if (!config) {
    config = await StorefrontConfigModel.create({
      heroBanner: { videoUrl: '', posterUrl: '' },
      categoryBanners: [],
      productImageOverrides: [],
      variantImageOverrides: [],
      productCostPrices: [],
    });
  }
  return config;
}
