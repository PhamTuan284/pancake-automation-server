import mongoose from 'mongoose';

export type HeroBannerConfig = {
  videoUrl: string;
  posterUrl: string;
};

export type CategoryBannerConfig = {
  id: string;
  imageUrl: string;
};

export type StorefrontConfigDoc = {
  heroBanner: HeroBannerConfig;
  categoryBanners: CategoryBannerConfig[];
};

const storefrontConfigSchema = new mongoose.Schema<StorefrontConfigDoc>(
  {
    heroBanner: {
      videoUrl: { type: String, default: '' },
      posterUrl: { type: String, default: '' },
    },
    categoryBanners: [
      {
        id: { type: String },
        imageUrl: { type: String },
      },
    ],
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
    });
  }
  return config;
}
