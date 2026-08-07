import { Router } from 'express';
import {
  postLeaveRequest,
  getMyLeaveRequests,
  getAllLeaveRequests,
  getLeaveBalances,
  deleteLeaveRequestController,
} from './leave.controller';
import { requireAuth, requireAdmin } from '../../common/auth.middleware';

export const leaveRouter = Router();

leaveRouter.post('/leave', requireAuth, postLeaveRequest);
leaveRouter.get('/leave/mine', requireAuth, getMyLeaveRequests);
leaveRouter.get('/leave/all', requireAdmin, getAllLeaveRequests);
leaveRouter.get('/leave/balances', requireAdmin, getLeaveBalances);
leaveRouter.delete('/leave/:id', requireAuth, deleteLeaveRequestController);
