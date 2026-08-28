import { Router } from 'express';
import { getScheduleSheets } from './drive.controller';
import { requireAuth } from '../../common/auth.middleware';

export const driveRouter = Router();

driveRouter.get('/drive/schedule-sheets', requireAuth, (req, res) => {
  void getScheduleSheets(req, res);
});
