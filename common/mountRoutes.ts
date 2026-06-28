import type { Express } from 'express';
import { einvoiceRouter } from '../features/pancake-einvoice/einvoice.routes';
import { salaryRouter } from '../features/salary/salary.routes';
import { webhookRouter } from '../features/pancake-webhook/webhook.routes';
import { telegramRouter } from '../features/telegram-bot/telegram-bot.routes';
import { zaloRouter } from '../features/zalo-bot/zalo-bot.routes';
import { adminRouter } from '../features/admin/admin.routes';
import { storefrontRouter } from '../features/storefront/storefront.routes';
import { healthRouter } from './health.routes';

export function mountRoutes(app: Express): void {
  app.use(einvoiceRouter);
  app.use(salaryRouter);
  app.use(webhookRouter);
  app.use(telegramRouter);
  app.use(zaloRouter);
  app.use(adminRouter);
  app.use(storefrontRouter);
  app.use(healthRouter);
}
