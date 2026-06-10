import express from 'express';
import * as ctrl from './telegram-bot.controller';

export const telegramRouter = express.Router();

telegramRouter.get('/telegram-bot/config', (req, res) => {
  ctrl.getConfig(req, res);
});

telegramRouter.get('/telegram-bot/logs', (req, res) => {
  ctrl.getLogs(req, res);
});

telegramRouter.post('/telegram-bot/send-test', (req, res) => {
  void ctrl.postSendTest(req, res);
});

telegramRouter.post('/telegram-bot/send-report', (req, res) => {
  void ctrl.postSendReport(req, res);
});
