import type { Request } from 'express';
import {
  clearWebhookEvents,
  fetchPancakeOpenApi,
  getLegacyWebhookPanelConfig,
  listWebhookEvents,
  recordWebhookEventWithPersistence,
  recordSyntheticWebhookEventWithPersistence,
  registerPancakeWebhook,
  resolveWebhookReceiverPath,
  shouldAutoRunFromWebhook,
  verifyWebhookSecret,
  webhookEventStorageSource,
} from './lib/pancakeWebhook';

export {
  recordWebhookEventWithPersistence,
  recordSyntheticWebhookEventWithPersistence,
  shouldAutoRunFromWebhook,
  verifyWebhookSecret,
};

export function getLegacyWebhookReceiverPath(): string {
  return resolveWebhookReceiverPath();
}

export function getWebhookPanelConfig() {
  return getLegacyWebhookPanelConfig();
}

export async function registerWebhookWithPancake(
  body: Record<string, unknown>
) {
  return registerPancakeWebhook(body);
}

export function buildQueryFromRequest(req: Request): URLSearchParams {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(req.query)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const v of value) {
        if (v != null && String(v).trim() !== '') {
          q.append(key, String(v));
        }
      }
    } else if (String(value).trim() !== '') {
      q.set(key, String(value));
    }
  }
  return q;
}

export async function proxyPancakeOpenApiGet(
  pathname: string,
  query: URLSearchParams
): Promise<unknown> {
  return fetchPancakeOpenApi(pathname, query);
}

export async function listWebhookEventsForResponse(
  limit?: string | string[]
) {
  const source = webhookEventStorageSource();
  const raw = await listWebhookEvents(limit);
  const events = raw.map((ev, i) => ({
    id: ev.id || `${ev.at}-${i}`,
    receivedAt: ev.at,
    contentType: ev.contentType || String(ev.headers['content-type'] || ''),
    payload: ev.payload,
  }));
  return { count: events.length, events, source };
}

export async function clearStoredWebhookEvents(): Promise<void> {
  await clearWebhookEvents();
}
