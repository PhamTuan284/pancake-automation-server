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

export type StorefrontConfigDoc = {
  heroBanner: HeroBannerConfig;
  categoryBanners: CategoryBannerConfig[];
  productImageOverrides: ImageOverride[];
  variantImageOverrides: ImageOverride[];
};

const imageOverrideSchema = { id: { type: String }, imageUrl: { type: String } };

const storefrontConfigSchema = new mongoose.Schema<StorefrontConfigDoc>(
  {
    heroBanner: {
      videoUrl: { type: String, default: '' },
      posterUrl: { type: String, default: '' },
    },
    categoryBanners: [imageOverrideSchema],
    productImageOverrides: [imageOverrideSchema],
    variantImageOverrides: [imageOverrideSchema],
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
    });
  }
  return config;
}
