import mongoose from 'mongoose';

export type OfficeAttendanceDoc = {
  username: string;
  employeeName: string;
  date: string; // "YYYY-MM-DD"
  checkIn?: string; // "HH:mm"
  checkOut?: string; // "HH:mm"
  lateMinutes: number;
  earlyLeaveMinutes: number;
  matchedException?: {
    leaveRequestId: string;
    checkInTime?: string;
    checkOutTime?: string;
  };
  createdAt: Date;
};

const officeAttendanceSchema = new mongoose.Schema<OfficeAttendanceDoc>(
  {
    username: { type: String, required: true, trim: true },
    employeeName: { type: String, required: true, trim: true },
    date: { type: String, required: true },
    checkIn: { type: String },
    checkOut: { type: String },
    lateMinutes: { type: Number, default: 0, min: 0 },
    earlyLeaveMinutes: { type: Number, default: 0, min: 0 },
    matchedException: {
      leaveRequestId: { type: String },
      checkInTime: { type: String },
      checkOutTime: { type: String },
    },
  },
  {
    collection: 'office_attendance',
    timestamps: { createdAt: 'createdAt', updatedAt: false },
  }
);

// Re-uploading the same day's punch overwrites the previous computation instead of duplicating it.
officeAttendanceSchema.index({ username: 1, date: 1 }, { unique: true });

export const OfficeAttendanceModel = mongoose.model<OfficeAttendanceDoc>(
  'OfficeAttendance',
  officeAttendanceSchema
);
