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

export const WORK_MODES = [
  'offline_team_live',
  'offline_team_office',
  'offline_team_media',
  'offline_khac',
  'online',
] as const;

export type WorkMode = (typeof WORK_MODES)[number];

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
  workMode?: WorkMode;
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
    workMode: { type: String, enum: WORK_MODES },
  },
  {
    collection: 'users',
    timestamps: { createdAt: 'createdAt', updatedAt: false },
  }
);

export const UserModel = mongoose.model<UserDoc>('User', userSchema);
