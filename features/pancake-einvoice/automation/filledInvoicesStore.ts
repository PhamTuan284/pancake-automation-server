import fs from 'fs';
import { FILLED_INVOICES_FILE } from './constants';

/** Row keys we already filled + saved (same normalization as in-run `processed`). */
export function loadFilledInvoiceKeys(): string[] {
  try {
    if (!fs.existsSync(FILLED_INVOICES_FILE)) {
      return [];
    }
    const j = JSON.parse(
      fs.readFileSync(FILLED_INVOICES_FILE, 'utf8')
    ) as unknown;
    if (Array.isArray(j)) {
      return j.filter(Boolean).map(String);
    }
    if (
      j &&
      typeof j === 'object' &&
      Array.isArray((j as { keys?: unknown }).keys)
    ) {
      return (j as { keys: unknown[] }).keys.filter(Boolean).map(String);
    }
    return [];
  } catch {
    return [];
  }
}

export function persistFilledInvoiceKey(key: string | undefined | null) {
  if (!key) {
    return;
  }
  const existing = new Set(loadFilledInvoiceKeys());
  if (existing.has(key)) {
    return;
  }
  existing.add(key);
  const keys = [...existing].sort();
  fs.writeFileSync(
    FILLED_INVOICES_FILE,
    JSON.stringify(
      { keys, updatedAt: new Date().toISOString() },
      null,
      2
    ),
    'utf8'
  );
  console.log(
    `[filled] Saved row key to filledInvoices.json (${keys.length} total)`
  );
}
