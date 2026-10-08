import { Router } from 'express';
import { requireAuth } from '../../common/auth.middleware';
import { postRunCustomerNameFix } from './easypos.controller';

export const easyposAutomationRouter = Router();

easyposAutomationRouter.post('/easypos-automation/fix-customer-names', requireAuth, (req, res) => {
  void postRunCustomerNameFix(req, res);
});
