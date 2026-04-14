import express from 'express';
import * as webhookController from './webhook.controller';
import { getLegacyWebhookReceiverPath } from './webhook.service';

/** Routes for UI tab: Pancake · Webhook */
export const webhookRouter = express.Router();

webhookRouter.get('/pancake-webhook/config', (req, res) => {
  webhookController.getPancakeWebhookConfig(req, res);
});

webhookRouter.post('/pancake-webhook/register', (req, res) => {
  void webhookController.postPancakeWebhookRegister(req, res);
});

webhookRouter.get('/pancake-webhook/products/variations', (req, res) => {
  void webhookController.getPancakeProductsVariations(req, res);
});

function handleWebhookIngress(
  req: express.Request,
  res: express.Response
): void {
  void webhookController.postPancakeWebhookIngress(req, res);
}

webhookRouter.post('/pancake/webhook', handleWebhookIngress);
webhookRouter.post('/api/pancake/webhook', handleWebhookIngress);

const legacyReceiverPath = getLegacyWebhookReceiverPath();
const legacyReceiverPathWithApiPrefix = legacyReceiverPath.startsWith('/api/')
  ? legacyReceiverPath
  : `/api${legacyReceiverPath}`;

webhookRouter.post(legacyReceiverPath, (req, res) => {
  void webhookController.postLegacyWebhookReceiver(req, res);
});
if (legacyReceiverPathWithApiPrefix !== legacyReceiverPath) {
  webhookRouter.post(legacyReceiverPathWithApiPrefix, (req, res) => {
    void webhookController.postLegacyWebhookReceiver(req, res);
  });
}

webhookRouter.get('/pancake-webhook/events', (req, res) => {
  void webhookController.getPancakeWebhookEvents(req, res);
});

webhookRouter.post('/pancake-webhook/ping', (req, res) => {
  void webhookController.postPancakeWebhookPing(req, res);
});

webhookRouter.delete('/pancake-webhook/events', (req, res) => {
  void webhookController.deletePancakeWebhookEvents(req, res);
});
