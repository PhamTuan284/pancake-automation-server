import { Router } from 'express';
import {
  login,
  getMe,
  changeOwnPassword,
  listUsers,
  createUser,
  updateUser,
  bulkUpdateUsers,
  deleteUser,
  getSettings,
  updateSettings,
  getAuditLogs,
} from './admin.controller';
import { requireAuth, requireAdmin } from '../../common/auth.middleware';

export const adminRouter = Router();

adminRouter.post('/admin/login', login);
adminRouter.get('/admin/me', requireAuth, getMe);
adminRouter.post('/admin/change-password', requireAuth, changeOwnPassword);
adminRouter.get('/admin/settings', getSettings);
adminRouter.put('/admin/settings', requireAdmin, updateSettings);
adminRouter.get('/admin/users', requireAdmin, listUsers);
adminRouter.post('/admin/users', requireAdmin, createUser);
adminRouter.patch('/admin/users/bulk', requireAdmin, bulkUpdateUsers);
adminRouter.patch('/admin/users/:id', requireAdmin, updateUser);
adminRouter.delete('/admin/users/:id', requireAdmin, deleteUser);
adminRouter.get('/admin/audit-log', requireAdmin, getAuditLogs);
