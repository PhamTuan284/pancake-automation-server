import mongoose from 'mongoose';
import { useMongo } from '../mongo';

/**
 * Admin-only activity trail (who did what, when). Falls back to an
 * in-memory ring buffer when Mongo is not configured, same pattern as
 * botSendLogModel.
 */

export type AuditLogEntry = {
  id: string;
  username: string;
  action: string;
  details: string;
  createdAt: string; // ISO
};

const MAX_LOGS = 500;
const LOG_TTL_SECONDS = 180 * 24 * 60 * 60;

type AuditLogDoc = {
  username: string;
  action: string;
  details: string;
  createdAt: Date;
};

const schema = new mongoose.Schema<AuditLogDoc>(
  {
    username: { type: String, required: true, index: true },
    action: { type: String, required: true },
    details: { type: String, default: '' },
  },
  { collection: 'audit_logs', timestamps: { createdAt: 'createdAt', updatedAt: false } }
);

schema.index({ createdAt: -1 }, { expireAfterSeconds: LOG_TTL_SECONDS });

const AuditLogModel = mongoose.model<AuditLogDoc>('AuditLog', schema);

const memLogs: AuditLogEntry[] = [];

export function logAudit(username: string, action: string, details = ''): void {
  const entry: AuditLogEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    username,
    action,
    details,
    createdAt: new Date().toISOString(),
  };
  memLogs.unshift(entry);
  if (memLogs.length > MAX_LOGS) memLogs.splice(MAX_LOGS);

  if (useMongo()) {
    void AuditLogModel.create({
      username,
      action,
      details,
      createdAt: new Date(entry.createdAt),
    }).catch((err: unknown) => {
      console.error('[audit-log] Failed to persist entry:', err);
    });
  }
}

export async function listAuditLogs(limit = 200): Promise<AuditLogEntry[]> {
  if (useMongo()) {
    try {
      const docs = await AuditLogModel.find().sort({ createdAt: -1 }).limit(limit).lean();
      return docs.map((d) => ({
        id: String(d._id),
        username: d.username,
        action: d.action,
        details: d.details,
        createdAt: new Date(d.createdAt).toISOString(),
      }));
    } catch {
      /* fall through to memory */
    }
  }
  return memLogs.slice(0, limit);
}
