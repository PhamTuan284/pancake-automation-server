import type { Express } from 'express';
import { einvoiceRouter } from '../features/pancake-einvoice/einvoice.routes';
import { leaveRouter } from '../features/leave/leave.routes';
import { webhookRouter } from '../features/pancake-webhook/webhook.routes';
import { zaloRouter } from '../features/zalo-bot/zalo-bot.routes';
import { adminRouter } from '../features/admin/admin.routes';
import { storefrontRouter } from '../features/storefront/storefront.routes';
import { facebookRouter } from '../features/facebook/facebook.routes';
import { driveRouter } from '../features/drive/drive.routes';
import { teamMetricsRouter } from '../features/team-metrics/team-metrics.routes';
import { easyInvoiceRouter } from '../features/easyinvoice/easyinvoice.routes';
import { easyposAutomationRouter } from '../features/easypos-automation/easypos.routes';
import { healthRouter } from './health.routes';

export function mountRoutes(app: Express): void {
  app.use(einvoiceRouter);
  app.use(leaveRouter);
  app.use(webhookRouter);
  app.use(zaloRouter);
  app.use(adminRouter);
  app.use(storefrontRouter);
  app.use(facebookRouter);
  app.use(driveRouter);
  app.use(teamMetricsRouter);
  app.use(easyInvoiceRouter);
  app.use(easyposAutomationRouter);
  app.use(healthRouter);
}
