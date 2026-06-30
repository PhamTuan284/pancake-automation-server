import mongoose, { Schema } from 'mongoose';

interface SoldCountCacheDocument extends mongoose.Document {
  shopKey: string;
  counts: Record<string, number>;
  calculatedAt: Date;
}

const SoldCountCacheSchema = new Schema<SoldCountCacheDocument>({
  shopKey: { type: String, required: true, unique: true },
  counts: { type: Schema.Types.Mixed, default: {} },
  calculatedAt: { type: Date, required: true },
});

export default mongoose.models['SoldCountCache'] as mongoose.Model<SoldCountCacheDocument> ||
  mongoose.model<SoldCountCacheDocument>('SoldCountCache', SoldCountCacheSchema);
