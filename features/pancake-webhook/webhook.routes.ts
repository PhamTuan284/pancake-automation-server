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

webhookRouter.post('/pancake/webhook', (req, res) => {
  void webhookController.postPancakeWebhookIngress(req, res);
});

const legacyReceiverPath = getLegacyWebhookReceiverPath();
webhookRouter.post(legacyReceiverPath, (req, res) => {
  void webhookController.postLegacyWebhookReceiver(req, res);
});

webhookRouter.get('/pancake-webhook/events', (req, res) => {
  void webhookController.getPancakeWebhookEvents(req, res);
});

webhookRouter.delete('/pancake-webhook/events', (req, res) => {
  void webhookController.deletePancakeWebhookEvents(req, res);
});
