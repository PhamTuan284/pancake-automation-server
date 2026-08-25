import mongoose from 'mongoose';

export type UserRole = 'admin' | 'user';

export const DEPARTMENTS = [
  'Livestream',
  'Media',
  'Marketing',
  'Model',
  'Sale',
  'Warehouse',
  'Accountant',
  'Admin',
] as const;

export type Department = (typeof DEPARTMENTS)[number];

export type Gender = 'male' | 'female';

export type UserDoc = {
  username: string;
  passwordHash: string;
  fullName: string;
  role: UserRole;
  isActive: boolean;
  paidLeaveTotal: number;
  department: string;
  hireDate?: Date;
  gender?: Gender;
  createdAt: Date;
};

const userSchema = new mongoose.Schema<UserDoc>(
  {
    username: { type: String, required: true, unique: true, trim: true },
    passwordHash: { type: String, required: true },
    fullName: { type: String, default: '', trim: true },
    role: { type: String, enum: ['admin', 'user'], default: 'user' },
    isActive: { type: Boolean, default: true },
    paidLeaveTotal: { type: Number, default: 12, min: 0 },
    department: { type: String, enum: [...DEPARTMENTS, ''], default: '' },
    hireDate: { type: Date },
    gender: { type: String, enum: ['male', 'female'] },
  },
  {
    collection: 'users',
    timestamps: { createdAt: 'createdAt', updatedAt: false },
  }
);

export const UserModel = mongoose.model<UserDoc>('User', userSchema);
