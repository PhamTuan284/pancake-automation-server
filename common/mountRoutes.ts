import type { Express } from 'express';
import { einvoiceRouter } from '../features/pancake-einvoice/einvoice.routes';
import { salaryRouter } from '../features/salary/salary.routes';
import { webhookRouter } from '../features/pancake-webhook/webhook.routes';
import { healthRouter } from './health.routes';

export function mountRoutes(app: Express): void {
  app.use(einvoiceRouter);
  app.use(salaryRouter);
  app.use(webhookRouter);
  app.use(healthRouter);
}
