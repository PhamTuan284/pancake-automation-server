import { Router } from 'express';
import { requireAuth } from '../../common/auth.middleware';
import { postCall, postTestConnection } from './easyinvoice.controller';

export const easyInvoiceRouter = Router();

easyInvoiceRouter.post('/easyinvoice/test-connection', requireAuth, (req, res) => {
  void postTestConnection(req, res);
});

easyInvoiceRouter.post('/easyinvoice/call', requireAuth, (req, res) => {
  void postCall(req, res);
});
