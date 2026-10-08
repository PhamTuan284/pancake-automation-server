import { Router } from 'express';
import { postRunCustomerNameFix } from './easypos.controller';

export const easyposAutomationRouter = Router();

// No requireAuth: matches the existing /run-e2e-tests route this panel also calls with a plain
// fetch (no bearer token) — PancakeEinvoicePanel doesn't have access to the auth token here.
easyposAutomationRouter.post('/easypos-automation/fix-customer-names', (req, res) => {
  void postRunCustomerNameFix(req, res);
});
