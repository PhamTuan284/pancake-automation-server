import { Router } from 'express';
import {
  login,
  getMe,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  getSettings,
  updateSettings,
} from './admin.controller';
import { requireAuth, requireAdmin } from '../../common/auth.middleware';

export const adminRouter = Router();

adminRouter.post('/admin/login', login);
adminRouter.get('/admin/me', requireAuth, getMe);
adminRouter.get('/admin/settings', getSettings);
adminRouter.put('/admin/settings', requireAdmin, updateSettings);
adminRouter.get('/admin/users', requireAdmin, listUsers);
adminRouter.post('/admin/users', requireAdmin, createUser);
adminRouter.patch('/admin/users/:id', requireAdmin, updateUser);
adminRouter.delete('/admin/users/:id', requireAdmin, deleteUser);
