import mongoose from 'mongoose';
import { LEAVE_TYPE_IDS, type LeaveType } from '../leaveTypes';

export type LeaveStatus = 'pending' | 'approved' | 'rejected';
export type LeaveSession = 'full' | 'morning' | 'afternoon';

export type LeaveRequestDoc = {
  username: string;
  employeeName: string;
  department: string;
  type: LeaveType;
  startDate: Date;
  endDate: Date;
  session: LeaveSession;
  days: number;
  checkInTime?: string;
  checkOutTime?: string;
  reason: string;
  status: LeaveStatus;
  approvedBy?: string;
  approvedAt?: Date;
  rejectReason?: string;
  createdAt: Date;
};

const leaveRequestSchema = new mongoose.Schema<LeaveRequestDoc>(
  {
    username: { type: String, required: true, trim: true },
    employeeName: { type: String, required: true, trim: true },
    department: { type: String, default: '', trim: true },
    type: { type: String, enum: LEAVE_TYPE_IDS, default: 'annual' },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    session: { type: String, enum: ['full', 'morning', 'afternoon'], default: 'full' },
    // 0 is valid for "đi muộn"/"về sớm" — they don't consume day-off quota.
    // Real leave requests are validated in leave.service.ts to be >= 0.5.
    days: { type: Number, required: true, min: 0 },
    // HH:mm strings, only set for "Đi làm khác giờ chuẩn" requests.
    checkInTime: { type: String },
    checkOutTime: { type: String },
    reason: { type: String, default: '', trim: true },
    // Records created before the approval workflow existed had no concept
    // of pending/rejected, so they default to 'approved' on read — new
    // requests explicitly set 'pending' at creation time.
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'approved' },
    approvedBy: { type: String },
    approvedAt: { type: Date },
    rejectReason: { type: String },
  },
  {
    collection: 'leave_requests',
    timestamps: { createdAt: 'createdAt', updatedAt: false },
  }
);

leaveRequestSchema.index({ username: 1, startDate: -1 });

export const LeaveRequestModel = mongoose.model<LeaveRequestDoc>(
  'LeaveRequest',
  leaveRequestSchema
);
