import type { WdioBrowser } from './types';
import { FILLED_INVOICES_STORAGE_KEY } from './constants';

/** Row keys we already filled + saved (same normalization as in-run `processed`). */
export async function loadFilledInvoiceKeys(
  browser: WdioBrowser
): Promise<string[]> {
  return browser.execute((storageKey: string) => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter(Boolean).map(String);
      }
      if (
        parsed &&
        typeof parsed === 'object' &&
        Array.isArray((parsed as { keys?: unknown }).keys)
      ) {
        return (parsed as { keys: unknown[] }).keys.filter(Boolean).map(String);
      }
      return [];
    } catch {
      return [];
    }
  }, FILLED_INVOICES_STORAGE_KEY);
}

export async function persistFilledInvoiceKey(
  browser: WdioBrowser,
  key: string | undefined | null
) {
  if (!key) {
    return;
  }

  const result = await browser.execute(
    (storageKey: string, incomingKey: string) => {
      try {
        const raw = window.localStorage.getItem(storageKey);
        const parsed = raw ? (JSON.parse(raw) as unknown) : null;
        const fromPayload =
          parsed &&
          typeof parsed === 'object' &&
          Array.isArray((parsed as { keys?: unknown }).keys)
            ? (parsed as { keys: unknown[] }).keys
            : Array.isArray(parsed)
              ? parsed
              : [];
        const existing = new Set(fromPayload.filter(Boolean).map(String));
        const alreadySaved = existing.has(incomingKey);
        if (!alreadySaved) {
          existing.add(incomingKey);
          const keys = [...existing].sort();
          window.localStorage.setItem(
            storageKey,
            JSON.stringify({
              keys,
              updatedAt: new Date().toISOString(),
            })
          );
        }
        return { alreadySaved, total: existing.size };
      } catch {
        return { alreadySaved: false, total: null };
      }
    },
    FILLED_INVOICES_STORAGE_KEY,
    key
  );

  if (!result.alreadySaved) {
    console.log(
      `[filled] Saved row key to localStorage (${result.total ?? '?' } total)`
    );
  }
}
