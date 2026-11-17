import { Router } from 'express';
import { requireAuth } from '../../common/auth.middleware';
import {
  getStats,
  getTaskDetail,
  getTasks,
  getUsers,
  getWorkload,
  patchChecklistItem,
  patchTask,
  postArchive,
  postChecklistItem,
  postComment,
  postMove,
  postReorder,
  postTask,
  removeComment,
  removeTask,
} from './tasks.controller';

export const tasksRouter = Router();

// Every logged-in user can see the board; per-task edit rights are enforced in the service.
tasksRouter.get('/tasks', requireAuth, getTasks);
tasksRouter.get('/tasks/stats', requireAuth, getStats);
tasksRouter.get('/tasks/users', requireAuth, getUsers);
tasksRouter.get('/tasks/workload', requireAuth, getWorkload);
tasksRouter.post('/tasks', requireAuth, postTask);
tasksRouter.post('/tasks/reorder', requireAuth, postReorder);
tasksRouter.get('/tasks/:id', requireAuth, getTaskDetail);
tasksRouter.patch('/tasks/:id', requireAuth, patchTask);
tasksRouter.post('/tasks/:id/move', requireAuth, postMove);
tasksRouter.post('/tasks/:id/archive', requireAuth, postArchive);
tasksRouter.delete('/tasks/:id', requireAuth, removeTask);
tasksRouter.post('/tasks/:id/comments', requireAuth, postComment);
tasksRouter.delete('/tasks/:id/comments/:commentId', requireAuth, removeComment);
tasksRouter.post('/tasks/:id/checklist', requireAuth, postChecklistItem);
tasksRouter.patch('/tasks/:id/checklist/:itemId', requireAuth, patchChecklistItem);
