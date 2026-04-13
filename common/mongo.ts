import mongoose from 'mongoose';

/**
 * Railway’s MongoDB plugin usually exposes MONGO_URL.
 * You can also set MONGODB_URI in .env (Atlas, local, etc.).
 */
export function mongoUri(): string {
  return String(
    process.env.MONGODB_URI || process.env.MONGO_URL || ''
  ).trim();
}

export function useMongo(): boolean {
  return mongoUri().length > 0;
}

export async function connectMongo(): Promise<void> {
  if (!useMongo()) {
    throw new Error('No MONGODB_URI or MONGO_URL');
  }
  if (mongoose.connection.readyState === 1) {
    return;
  }
  await mongoose.connect(mongoUri(), {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 15000,
  });
}

export async function ensureMongoConnected(): Promise<void> {
  if (!useMongo()) return;
  await connectMongo();
}
