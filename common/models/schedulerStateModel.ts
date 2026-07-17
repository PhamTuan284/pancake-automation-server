import mongoose from 'mongoose';
import { useMongo } from '../mongo';

/**
 * Persisted "last sent" dates for the daily/weekly bot schedulers, so a
 * server restart inside the send window does not double-send. Keys are
 * e.g. 'telegram-sales', 'zalo-sales', 'zalo-revenue', 'zalo-team-sales'.
 */

type SchedulerStateDoc = {
  key: string;
  lastSentDate: string; // YYYY-MM-DD (VN)
};

const schema = new mongoose.Schema<SchedulerStateDoc>(
  {
    key: { type: String, required: true, unique: true },
    lastSentDate: { type: String, default: '' },
  },
  { collection: 'scheduler_state' }
);

const SchedulerStateModel = mongoose.model<SchedulerStateDoc>('SchedulerState', schema);

const memState = new Map<string, string>();

export async function getLastSentDate(key: string): Promise<string> {
  if (useMongo()) {
    try {
      const doc = await SchedulerStateModel.findOne({ key }).lean();
      if (doc) {
        memState.set(key, doc.lastSentDate);
        return doc.lastSentDate;
      }
    } catch { /* fall through to memory */ }
  }
  return memState.get(key) ?? '';
}

export async function markSentDate(key: string, date: string): Promise<void> {
  memState.set(key, date);
  if (useMongo()) {
    try {
      await SchedulerStateModel.findOneAndUpdate(
        { key },
        { $set: { lastSentDate: date } },
        { upsert: true }
      );
    } catch { /* memory is the fallback */ }
  }
}
