import mongoose from 'mongoose';

export type UserRole = 'admin' | 'user';

export type UserDoc = {
  username: string;
  passwordHash: string;
  role: UserRole;
  isActive: boolean;
  paidLeaveTotal: number;
  createdAt: Date;
};

const userSchema = new mongoose.Schema<UserDoc>(
  {
    username: { type: String, required: true, unique: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['admin', 'user'], default: 'user' },
    isActive: { type: Boolean, default: true },
    paidLeaveTotal: { type: Number, default: 12, min: 0 },
  },
  {
    collection: 'users',
    timestamps: { createdAt: 'createdAt', updatedAt: false },
  }
);

export const UserModel = mongoose.model<UserDoc>('User', userSchema);
