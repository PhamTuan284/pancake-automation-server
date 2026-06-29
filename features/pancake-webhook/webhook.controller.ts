import type { Request, Response } from 'express';
import {
  isAutomationRunning,
  triggerE2eTestRun,
  WDIO_SPEC_EINVOICE_AUTOMATION,
} from '../pancake-einvoice/automationRunner.service';
import * as webhookService from './webhook.service';
import { checkAndSendAbnormalOrderAlert } from '../zalo-bot/abnormalOrderAlert';

function debugWebhookIngress(req: Request, label: string): void {
  const secretHeaderName = webhookService
    .getWebhookPanelConfig()
    .incomingSecretHeader;
  const candidateHeaders = [
    'content-type',
    'user-agent',
    'x-forwarded-for',
    'x-forwarded-proto',
    'x-real-ip',
    secretHeaderName,
  ];
  const headerDump = Object.fromEntries(
    candidateHeaders
      .map((name) => [name, req.header(name)])
      .filter(([, value]) => value != null)
  );
  console.log(
    `[webhook][debug] ${label} hit: ${req.method} ${req.originalUrl}`,
    headerDump
  );
}

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
    const shopKey = webhookService.resolveWebhookShopKeyFromRequest(req);
    const data = await webhookService.getAllProductVariations(shopKey);
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
  debugWebhookIngress(req, 'primary');
  if (!webhookService.verifyWebhookSecret(req)) {
    const secretHeaderName = webhookService
      .getWebhookPanelConfig()
      .incomingSecretHeader;
    const provided = req.header(secretHeaderName);
    console.warn(
      `[webhook] Rejected: invalid webhook secret header (${secretHeaderName})`,
      { provided }
    );
    res
      .status(401)
      .json({ success: false, error: 'Invalid webhook secret' });
    return;
  }
  const event = await webhookService.recordWebhookEventWithPersistence(req);
  console.log(`[webhook] Received type=${event.kind} at=${event.at}`);

  res.json({ success: true });

  if (event.kind === 'orders') {
    void checkAndSendAbnormalOrderAlert(event.payload);
  }

  if (webhookService.shouldAutoRunFromWebhook()) {
    void (async () => {
      if (isAutomationRunning()) {
        console.log(
          '[webhook] Automation already running, skipping auto-run trigger'
        );
        return;
      }
      try {
        await triggerE2eTestRun([
          '--spec',
          WDIO_SPEC_EINVOICE_AUTOMATION,
        ]);
        console.log('[webhook] Auto-run completed');
      } catch (err) {
        console.error('[webhook] Auto-run failed:', err);
      }
    })();
  }
}

export async function postLegacyWebhookReceiver(
  req: Request,
  res: Response
): Promise<void> {
  debugWebhookIngress(req, 'legacy');
  if (!webhookService.verifyWebhookSecret(req)) {
    const secretHeaderName = webhookService
      .getWebhookPanelConfig()
      .incomingSecretHeader;
    const provided = req.header(secretHeaderName);
    console.warn(
      `[webhook] Rejected legacy receiver: invalid webhook secret header (${secretHeaderName})`,
      { provided }
    );
    res
      .status(401)
      .json({ success: false, error: 'Invalid webhook secret' });
    return;
  }
  const event = await webhookService.recordWebhookEventWithPersistence(req);
  console.log(`[webhook] Received type=${event.kind} at=${event.at}`);
  res.json({ success: true });

  if (event.kind === 'orders') {
    void checkAndSendAbnormalOrderAlert(event.payload);
  }
}

export async function postPancakeWebhookPing(
  req: Request,
  res: Response
): Promise<void> {
  const body = (req.body || {}) as {
    payload?: unknown;
    headers?: Record<string, unknown>;
  };
  const payload =
    body.payload ??
    ({
      webhook_type: 'orders',
      id: `ping-${Date.now()}`,
      customer_id: 'ping-customer',
      bill_full_name: 'Webhook Ping',
      order_sources: ['manual_ping'],
      note: 'Synthetic event to verify webhook ingestion',
    } as const);
  const hdrs = body.headers && typeof body.headers === 'object' ? body.headers : {};
  const headers = Object.fromEntries(
    Object.entries(hdrs).map(([k, v]) => [k, String(v)])
  );
  const event = await webhookService.recordSyntheticWebhookEventWithPersistence(
    payload,
    headers
  );
  console.log(`[webhook] Synthetic ping type=${event.kind} at=${event.at}`);
  res.json({ ok: true, event });
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

export async function getPancakeVariantSalesAnalytics(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const analytics = await webhookService.getVariantSalesAnalytics(
      req.query as Record<string, unknown>
    );
    res.json({ ok: true, analytics });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to compute variant analytics';
    res.status(400).json({ ok: false, error: message });
  }
}

export async function getPancakeEmployeeProductivity(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const query = req.query as Record<string, unknown>;
    const shopKey = webhookService.resolveWebhookShopKeyFromRequest(req);
    const result = await webhookService.computeEmployeeProductivity({
      days: query.days,
      shopKey,
      role: query.role,
    });
    res.json({ ok: true, result });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to compute employee productivity';
    res.status(400).json({ ok: false, error: message });
  }
}

/** Plain-text report for n8n → Zalo Bot sendMessage. */
export async function getPancakeVariantSalesZaloText(
  req: Request,
  res: Response
): Promise<void> {
  const query = req.query as Record<string, unknown>;
  if (!webhookService.verifyZaloReportSecret(query, req.header('x-report-secret'))) {
    res.status(401).json({ ok: false, error: 'Invalid report secret' });
    return;
  }
  try {
    const payload = await webhookService.getVariantSalesZaloText(query);
    res.json({ ok: true, ...payload });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to build Zalo report text';
    res.status(400).json({ ok: false, error: message });
  }
}
