import { Router } from 'express';
import {
  postLeaveRequest,
  getMyLeaveRequests,
  getAllLeaveRequests,
  getLeaveBalances,
  getMyLeaveBalanceController,
  approveLeaveRequestController,
  rejectLeaveRequestController,
  deleteLeaveRequestController,
} from './leave.controller';
import { requireAuth, requireAdmin } from '../../common/auth.middleware';

export const leaveRouter = Router();

leaveRouter.post('/leave', requireAuth, postLeaveRequest);
leaveRouter.get('/leave/mine', requireAuth, getMyLeaveRequests);
leaveRouter.get('/leave/my-balance', requireAuth, getMyLeaveBalanceController);
leaveRouter.get('/leave/all', requireAdmin, getAllLeaveRequests);
leaveRouter.get('/leave/balances', requireAdmin, getLeaveBalances);
leaveRouter.post('/leave/:id/approve', requireAdmin, approveLeaveRequestController);
leaveRouter.post('/leave/:id/reject', requireAdmin, rejectLeaveRequestController);
leaveRouter.delete('/leave/:id', requireAuth, deleteLeaveRequestController);
