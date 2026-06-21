import express from 'express';
import * as ctrl from './zalo-bot.controller';

export const zaloRouter = express.Router();

zaloRouter.get('/zalo-bot/config', (req, res) => {
  ctrl.getConfig(req, res);
});

zaloRouter.get('/zalo-bot/logs', (req, res) => {
  ctrl.getLogs(req, res);
});

zaloRouter.post('/zalo-bot/set-webhook', (req, res) => {
  void ctrl.postSetWebhook(req, res);
});

zaloRouter.post('/zalo-bot/get-updates', (req, res) => {
  void ctrl.postGetUpdates(req, res);
});

zaloRouter.post('/zalo-bot/send-test', (req, res) => {
  void ctrl.postSendTest(req, res);
});

zaloRouter.post('/zalo-bot/send-report', (req, res) => {
  void ctrl.postSendReport(req, res);
});
