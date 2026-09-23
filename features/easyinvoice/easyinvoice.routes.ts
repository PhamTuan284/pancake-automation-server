import { Router } from 'express';
import { requireAuth } from '../../common/auth.middleware';
import { postCheckStatus, postTestConnection } from './easyinvoice.controller';

export const easyInvoiceRouter = Router();

easyInvoiceRouter.post('/easyinvoice/test-connection', requireAuth, (req, res) => {
  void postTestConnection(req, res);
});

easyInvoiceRouter.post('/easyinvoice/check-status', requireAuth, (req, res) => {
  void postCheckStatus(req, res);
});
