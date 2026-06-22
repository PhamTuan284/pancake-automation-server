import bcrypt from 'bcryptjs';
import { UserModel } from './models/userModel';
import { ensureMongoConnected } from './mongo';

export async function seedFirstAdmin(): Promise<void> {
  if (!process.env.MONGODB_URI && !process.env.MONGO_URL) return;
  try {
    await ensureMongoConnected();
    const adminExists = await UserModel.findOne({ role: 'admin' });
    if (adminExists) return;
    const passwordHash = await bcrypt.hash('cahenemo', 12);
    await UserModel.create({ username: 'TuanPM28', passwordHash, role: 'admin' });
    console.log('[admin] Tài khoản admin đầu tiên đã được tạo: TuanPM28');
  } catch (err) {
    console.error('[admin] Lỗi seed admin:', err);
  }
}
