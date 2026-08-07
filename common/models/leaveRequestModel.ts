import mongoose from 'mongoose';

export type LeaveRequestDoc = {
  username: string;
  employeeName: string;
  startDate: Date;
  endDate: Date;
  days: number;
  reason: string;
  createdAt: Date;
};

const leaveRequestSchema = new mongoose.Schema<LeaveRequestDoc>(
  {
    username: { type: String, required: true, trim: true },
    employeeName: { type: String, required: true, trim: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    days: { type: Number, required: true, min: 0.5 },
    reason: { type: String, default: '', trim: true },
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
