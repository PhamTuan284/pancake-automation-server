import mongoose from 'mongoose';

export type LivePlatform = 'tiktok' | 'facebook';

export type LiveAttendanceDoc = {
  platform: LivePlatform;
  sessionId: string; // Room ID (TikTok) or video ID (Facebook)
  date: string; // "YYYY-MM-DD", the session's local start date
  employeeNames: string[];
  scheduledSlotLabel?: string;
  scheduledStart?: string; // "HH:mm"
  actualStart: Date;
  actualEnd: Date;
  durationMinutes: number;
  lateMinutes: number;
  underMinDuration: boolean;
  createdAt: Date;
};

const liveAttendanceSchema = new mongoose.Schema<LiveAttendanceDoc>(
  {
    platform: { type: String, enum: ['tiktok', 'facebook'], required: true },
    sessionId: { type: String, required: true },
    date: { type: String, required: true },
    employeeNames: { type: [String], default: [] },
    scheduledSlotLabel: { type: String },
    scheduledStart: { type: String },
    actualStart: { type: Date, required: true },
    actualEnd: { type: Date, required: true },
    durationMinutes: { type: Number, required: true, min: 0 },
    lateMinutes: { type: Number, default: 0 },
    underMinDuration: { type: Boolean, default: false },
  },
  {
    collection: 'live_attendance',
    timestamps: { createdAt: 'createdAt', updatedAt: false },
  }
);

// Re-uploading the same date range upserts by original session id instead of duplicating it.
liveAttendanceSchema.index({ platform: 1, sessionId: 1 }, { unique: true });
liveAttendanceSchema.index({ date: 1 });

export const LiveAttendanceModel = mongoose.model<LiveAttendanceDoc>(
  'LiveAttendance',
  liveAttendanceSchema
);
