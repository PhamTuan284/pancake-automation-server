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

zaloRouter.post('/zalo-bot/send-product-stock', (req, res) => {
  void ctrl.postSendProductStock(req, res);
});

zaloRouter.post('/zalo-bot/send-product-stock-multi', (req, res) => {
  void ctrl.postSendProductStockMulti(req, res);
});

zaloRouter.get('/zalo-bot/daily-stock-config', (req, res) => {
  void ctrl.getDailyStockConfigHandler(req, res);
});

zaloRouter.put('/zalo-bot/daily-stock-config', (req, res) => {
  void ctrl.saveDailyStockConfigHandler(req, res);
});

zaloRouter.post('/zalo-bot/send-daily-stock', (req, res) => {
  void ctrl.postSendDailyStockNow(req, res);
});

zaloRouter.post('/zalo-bot/send-mock-abnormal-order', (req, res) => {
  void ctrl.postSendMockAbnormalOrder(req, res);
});

zaloRouter.get('/zalo-bot/abnormal-order-config', (req, res) => {
  void ctrl.getAbnormalOrderConfigHandler(req, res);
});

zaloRouter.put('/zalo-bot/abnormal-order-config', (req, res) => {
  void ctrl.saveAbnormalOrderConfigHandler(req, res);
});
