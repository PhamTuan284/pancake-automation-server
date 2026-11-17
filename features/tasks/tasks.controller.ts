import type { Request, Response } from 'express';
import { ensureMongoConnected } from '../../common/mongo';
import {
  TaskForbiddenError,
  TaskInputError,
  addChecklistItem,
  addComment,
  archiveTask,
  createTask,
  deleteComment,
  deleteTask,
  getTask,
  listAssignableUsers,
  listTasks,
  moveTask,
  reorderColumn,
  taskStats,
  updateChecklistItem,
  updateTask,
  workloadByUser,
} from './tasks.service';

function sendError(res: Response, err: unknown, fallback: string, tag: string): void {
  if (err instanceof TaskInputError) {
    res.status(400).json({ ok: false, error: err.message });
    return;
  }
  if (err instanceof TaskForbiddenError) {
    res.status(403).json({ ok: false, error: err.message });
    return;
  }
  console.error(`[tasks/${tag}]`, err);
  res.status(500).json({ ok: false, error: err instanceof Error ? err.message : fallback });
}

type Handler = (req: Request, res: Response) => Promise<void>;

/** Shared wrapper: connect Mongo, run, wrap result as `{ ok: true, ...payload }`, map errors to HTTP codes. */
function handler(
  tag: string,
  fallback: string,
  run: (req: Request) => Promise<Record<string, unknown>>,
  status = 200
): Handler {
  return async (req, res) => {
    try {
      await ensureMongoConnected();
      const payload = await run(req);
      res.status(status).json({ ok: true, ...payload });
    } catch (err) {
      sendError(res, err, fallback, tag);
    }
  };
}

const body = (req: Request) => (req.body || {}) as Record<string, unknown>;

export const getTasks = handler('list', 'Không thể tải danh sách công việc.', async (req) => {
  const q = req.query as Record<string, string | undefined>;
  const scope = q.scope === 'mine' || q.scope === 'created' ? q.scope : 'all';
  const tasks = await listTasks(req.auth!, {
    scope,
    status: q.status,
    assignee: q.assignee,
    department: q.department,
    priority: q.priority,
    q: q.q?.trim(),
    archived: q.archived === '1' || q.archived === 'true',
  });
  return { tasks };
});

export const getTaskDetail = handler('detail', 'Không thể tải công việc.', async (req) => ({
  task: await getTask(req.params.id),
}));

export const postTask = handler(
  'create',
  'Không thể tạo công việc.',
  async (req) => ({ task: await createTask(req.auth!, body(req)) }),
  201
);

export const patchTask = handler('update', 'Không thể cập nhật công việc.', async (req) => ({
  task: await updateTask(req.params.id, req.auth!, body(req)),
}));

export const postMove = handler('move', 'Không thể di chuyển công việc.', async (req) => ({
  task: await moveTask(req.params.id, req.auth!, body(req)),
}));

export const postReorder = handler('reorder', 'Không thể sắp xếp cột.', async (req) => {
  await reorderColumn(req.auth!, body(req));
  return {};
});

export const postArchive = handler('archive', 'Không thể lưu trữ công việc.', async (req) => ({
  task: await archiveTask(req.params.id, req.auth!, body(req).archived !== false),
}));

export const removeTask = handler('delete', 'Không thể xóa công việc.', async (req) => {
  await deleteTask(req.params.id, req.auth!);
  return {};
});

export const postComment = handler(
  'comment',
  'Không thể thêm bình luận.',
  async (req) => ({ task: await addComment(req.params.id, req.auth!, body(req).text) }),
  201
);

export const removeComment = handler('comment-delete', 'Không thể xóa bình luận.', async (req) => ({
  task: await deleteComment(req.params.id, req.params.commentId, req.auth!),
}));

export const postChecklistItem = handler(
  'checklist-add',
  'Không thể thêm mục checklist.',
  async (req) => ({ task: await addChecklistItem(req.params.id, req.auth!, body(req).text) }),
  201
);

export const patchChecklistItem = handler('checklist-update', 'Không thể cập nhật checklist.', async (req) => ({
  task: await updateChecklistItem(req.params.id, req.params.itemId, req.auth!, body(req)),
}));

export const getStats = handler('stats', 'Không thể tải thống kê.', async (req) => ({
  stats: await taskStats(req.auth!, req.query.scope === 'mine' ? 'mine' : 'all'),
}));

export const getUsers = handler('users', 'Không thể tải danh sách nhân viên.', async () => ({
  users: await listAssignableUsers(),
}));

export const getWorkload = handler('workload', 'Không thể tải khối lượng công việc.', async () => ({
  workload: await workloadByUser(),
}));
