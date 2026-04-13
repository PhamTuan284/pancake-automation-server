import express from 'express';
import * as healthController from './health.controller';

/** Cross-feature ops (not tied to a single UI tab). */
export const healthRouter = express.Router();

healthRouter.get('/health', (req, res) => {
  healthController.getHealth(req, res);
});
