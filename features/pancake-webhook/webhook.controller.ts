import type { Request, Response } from 'express';
import {
  isAutomationRunning,
  triggerAutomationRun,
} from '../pancake-einvoice/automationRunner.service';
import * as webhookService from './webhook.service';

export function getPancakeWebhookConfig(_req: Request, res: Response): void {
  res.json(webhookService.getWebhookPanelConfig());
}

export async function postPancakeWebhookRegister(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const result = await webhookService.registerWebhookWithPancake(
      (req.body || {}) as Record<string, unknown>
    );
    res.json({ ok: true, ...result });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to register webhook';
    res.status(400).json({ ok: false, error: message });
  }
}

export async function getPancakeProductsVariations(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const data = await webhookService.proxyPancakeOpenApiGet(
      '/products/variations',
      webhookService.buildQueryFromRequest(req)
    );
    res.json({ ok: true, data });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to call Pancake Open API';
    res.status(400).json({ ok: false, error: message });
  }
}

export async function postPancakeWebhookIngress(
  req: Request,
  res: Response
): Promise<void> {
  if (!webhookService.verifyWebhookSecret(req)) {
    res
      .status(401)
      .json({ success: false, error: 'Invalid webhook secret' });
    return;
  }
  const event = await webhookService.recordWebhookEventWithPersistence(req);
  console.log(`[webhook] Received type=${event.kind} at=${event.at}`);

  if (webhookService.shouldAutoRunFromWebhook()) {
    if (isAutomationRunning()) {
      console.log(
        '[webhook] Automation already running, skipping auto-run trigger'
      );
    } else {
      try {
        await triggerAutomationRun();
        console.log('[webhook] Auto-run completed');
      } catch (err) {
        console.error('[webhook] Auto-run failed:', err);
      }
    }
  }

  res.json({ success: true });
}

export async function postLegacyWebhookReceiver(
  req: Request,
  res: Response
): Promise<void> {
  if (!webhookService.verifyWebhookSecret(req)) {
    res
      .status(401)
      .json({ success: false, error: 'Invalid webhook secret' });
    return;
  }
  const event = await webhookService.recordWebhookEventWithPersistence(req);
  console.log(`[webhook] Received type=${event.kind} at=${event.at}`);
  res.json({ success: true });
}

export async function getPancakeWebhookEvents(
  req: Request,
  res: Response
): Promise<void> {
  const lr = req.query.limit;
  const limit: string | string[] | undefined =
    typeof lr === 'string'
      ? lr
      : Array.isArray(lr)
        ? lr.map((x) => String(x))
        : undefined;
  const payload = await webhookService.listWebhookEventsForResponse(limit);
  res.json(payload);
}

export async function deletePancakeWebhookEvents(
  _req: Request,
  res: Response
): Promise<void> {
  await webhookService.clearStoredWebhookEvents();
  res.json({ ok: true });
}
