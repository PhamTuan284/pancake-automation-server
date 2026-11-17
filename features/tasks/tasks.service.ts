import {
  TaskModel,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type TaskDoc,
  type TaskPriority,
  type TaskStatus,
} from '../../common/models/taskModel';
import { UserModel } from '../../common/models/userModel';
import { logAudit } from '../../common/models/auditLogModel';
import { sendZaloText } from '../zalo-bot/zalo-bot.service';

export class TaskInputError extends Error {}
export class TaskForbiddenError extends Error {}

type Auth = { username: string; role: 'admin' | 'user' };
type TaskInstance = InstanceType<typeof TaskModel>;

export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'Cần làm',
  in_progress: 'Đang làm',
  review: 'Chờ duyệt',
  done: 'Hoàn thành',
};

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: 'Thấp',
  medium: 'Trung bình',
  high: 'Cao',
  urgent: 'Khẩn cấp',
};

// ---- parsing helpers ----

function parseStatus(value: unknown): TaskStatus {
  const s = String(value ?? 'todo');
  if (!TASK_STATUSES.includes(s as TaskStatus)) throw new TaskInputError('Trạng thái không hợp lệ.');
  return s as TaskStatus;
}

function parsePriority(value: unknown): TaskPriority {
  const p = String(value ?? 'medium');
  if (!TASK_PRIORITIES.includes(p as TaskPriority)) throw new TaskInputError('Mức ưu tiên không hợp lệ.');
  return p as TaskPriority;
}

function parseOptionalDate(value: unknown, label: string): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) throw new TaskInputError(`Ngày "${label}" không hợp lệ.`);
  return d;
}

function parseStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((v) => String(v ?? '').trim()).filter(Boolean))];
}

function parseTitle(value: unknown): string {
  const title = String(value ?? '').trim();
  if (!title) throw new TaskInputError('Vui lòng nhập tiêu đề công việc.');
  if (title.length > 200) throw new TaskInputError('Tiêu đề tối đa 200 ký tự.');
  return title;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function resolveAssignees(usernames: string[]): Promise<{ usernames: string[]; names: string[] }> {
  if (usernames.length === 0) return { usernames: [], names: [] };
  const users = await UserModel.find({ username: { $in: usernames }, isActive: true }, 'username fullName').lean();
  const found = new Map(users.map((u) => [u.username, u.fullName || u.username]));
  const missing = usernames.filter((u) => !found.has(u));
  if (missing.length > 0) {
    throw new TaskInputError(`Không tìm thấy nhân viên: ${missing.join(', ')}`);
  }
  return { usernames, names: usernames.map((u) => found.get(u)!) };
}

async function displayName(username: string): Promise<string> {
  const u = await UserModel.findOne({ username }, 'fullName').lean();
  return u?.fullName || username;
}

// ---- permissions ----

function isAssignee(task: Pick<TaskDoc, 'assignees'>, auth: Auth): boolean {
  return task.assignees.includes(auth.username);
}

/** Admins and the person who created (assigned) the task may edit or delete it. */
function canManage(task: Pick<TaskDoc, 'createdBy'>, auth: Auth): boolean {
  return auth.role === 'admin' || task.createdBy === auth.username;
}

/** Assignees may move the task and tick checklist items; managers can do anything. */
function canWork(task: Pick<TaskDoc, 'assignees' | 'createdBy'>, auth: Auth): boolean {
  return canManage(task, auth) || isAssignee(task, auth);
}

// ---- formatting ----

function formatVnDate(date?: Date): string {
  return date ? date.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '—';
}

function pushActivity(task: TaskInstance, username: string, action: string, detail = '') {
  task.activity.push({ username, action, detail, at: new Date() });
  if (task.activity.length > 100) task.activity.splice(0, task.activity.length - 100);
}

function notifyZalo(text: string) {
  void sendZaloText(text).catch((err) => console.error('[tasks] Zalo notify failed:', err));
}

// ---- directory ----

export async function listAssignableUsers() {
  const users = await UserModel.find({ isActive: true }, 'username fullName department role')
    .sort({ department: 1, fullName: 1, username: 1 })
    .lean();
  return users.map((u) => ({
    username: u.username,
    fullName: u.fullName || u.username,
    department: u.department ?? '',
    role: u.role,
  }));
}

// ---- CRUD ----

export type TaskListFilter = {
  scope?: 'all' | 'mine' | 'created';
  status?: string;
  assignee?: string;
  department?: string;
  priority?: string;
  q?: string;
  archived?: boolean;
};

export async function listTasks(auth: Auth, filter: TaskListFilter) {
  const query: Record<string, unknown> = { archived: filter.archived === true };
  if (filter.scope === 'mine') query.assignees = auth.username;
  else if (filter.scope === 'created') query.createdBy = auth.username;
  if (filter.status && TASK_STATUSES.includes(filter.status as TaskStatus)) query.status = filter.status;
  if (filter.priority && TASK_PRIORITIES.includes(filter.priority as TaskPriority)) query.priority = filter.priority;
  if (filter.assignee) query.assignees = filter.assignee;
  if (filter.department) query.department = filter.department;
  if (filter.q) {
    const re = new RegExp(escapeRegex(filter.q), 'i');
    query.$or = [{ title: re }, { description: re }, { labels: re }];
  }
  return TaskModel.find(query, '-activity -comments').sort({ status: 1, order: 1, createdAt: -1 }).lean();
}

export async function getTask(id: string): Promise<TaskInstance> {
  const task = await TaskModel.findById(id);
  if (!task) throw new TaskInputError('Không tìm thấy công việc.');
  return task;
}

export async function createTask(auth: Auth, raw: Record<string, unknown>) {
  const title = parseTitle(raw.title);
  const description = String(raw.description ?? '').trim();
  const status = parseStatus(raw.status);
  const priority = parsePriority(raw.priority);
  const startDate = parseOptionalDate(raw.startDate, 'bắt đầu');
  const dueDate = parseOptionalDate(raw.dueDate, 'hạn hoàn thành');
  if (startDate && dueDate && dueDate < startDate) {
    throw new TaskInputError('Hạn hoàn thành phải sau ngày bắt đầu.');
  }
  const { usernames: assignees, names: assigneeNames } = await resolveAssignees(parseStringList(raw.assignees));
  const labels = parseStringList(raw.labels).slice(0, 10);
  const department = String(raw.department ?? '').trim();
  const checklist = parseStringList(raw.checklist).map((text) => ({ text, done: false }));
  const createdByName = await displayName(auth.username);

  const last = await TaskModel.findOne({ status, archived: false }).sort({ order: -1 }).select('order').lean();
  const order = (last?.order ?? 0) + 1;

  const task = await TaskModel.create({
    title,
    description,
    status,
    priority,
    assignees,
    department,
    labels,
    createdBy: auth.username,
    createdByName,
    startDate,
    dueDate,
    order,
    checklist,
    activity: [{ username: auth.username, action: 'create', detail: '', at: new Date() }],
    completedAt: status === 'done' ? new Date() : undefined,
  });

  logAudit(auth.username, 'task_create', `${title} → ${assigneeNames.join(', ') || 'chưa giao'}`);
  if (assignees.length > 0) {
    notifyZalo(
      [
        '📋 Giao việc mới',
        `Công việc: ${title}`,
        `Người thực hiện: ${assigneeNames.join(', ')}`,
        `Ưu tiên: ${PRIORITY_LABEL[priority]}`,
        `Hạn: ${formatVnDate(dueDate)}`,
        `Người giao: ${createdByName}`,
        description ? `Mô tả: ${description.slice(0, 300)}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    );
  }
  return task;
}

function applyStatus(task: TaskInstance, status: TaskStatus, changes: string[]) {
  if (status === task.status) return;
  changes.push(`${STATUS_LABEL[task.status]} → ${STATUS_LABEL[status]}`);
  task.status = status;
  task.completedAt = status === 'done' ? new Date() : undefined;
}

export async function updateTask(id: string, auth: Auth, raw: Record<string, unknown>) {
  const task = await getTask(id);
  if (!canManage(task, auth)) {
    throw new TaskForbiddenError('Chỉ người giao việc hoặc Admin mới được sửa công việc này.');
  }

  const changes: string[] = [];
  let newlyAssigned: string[] = [];

  if (raw.title !== undefined) {
    const title = parseTitle(raw.title);
    if (title !== task.title) {
      changes.push('tiêu đề');
      task.title = title;
    }
  }
  if (raw.description !== undefined) {
    const description = String(raw.description ?? '').trim();
    if (description !== task.description) {
      changes.push('mô tả');
      task.description = description;
    }
  }
  if (raw.priority !== undefined) {
    const priority = parsePriority(raw.priority);
    if (priority !== task.priority) {
      changes.push(`ưu tiên → ${PRIORITY_LABEL[priority]}`);
      task.priority = priority;
    }
  }
  if (raw.startDate !== undefined) task.startDate = parseOptionalDate(raw.startDate, 'bắt đầu');
  if (raw.dueDate !== undefined) {
    const dueDate = parseOptionalDate(raw.dueDate, 'hạn hoàn thành');
    if ((dueDate?.getTime() ?? 0) !== (task.dueDate?.getTime() ?? 0)) {
      changes.push(`hạn → ${formatVnDate(dueDate)}`);
    }
    task.dueDate = dueDate;
  }
  if (task.startDate && task.dueDate && task.dueDate < task.startDate) {
    throw new TaskInputError('Hạn hoàn thành phải sau ngày bắt đầu.');
  }
  if (raw.department !== undefined) task.department = String(raw.department ?? '').trim();
  if (raw.labels !== undefined) task.labels = parseStringList(raw.labels).slice(0, 10);
  if (raw.assignees !== undefined) {
    const { usernames, names } = await resolveAssignees(parseStringList(raw.assignees));
    newlyAssigned = usernames.filter((u) => !task.assignees.includes(u));
    const removed = task.assignees.filter((u) => !usernames.includes(u));
    if (newlyAssigned.length > 0 || removed.length > 0) {
      changes.push(`người thực hiện → ${names.join(', ') || 'chưa giao'}`);
    }
    task.assignees = usernames;
  }
  if (raw.status !== undefined) {
    applyStatus(task, parseStatus(raw.status), changes);
  }

  if (changes.length > 0) pushActivity(task, auth.username, 'update', changes.join('; '));
  await task.save();

  if (newlyAssigned.length > 0) {
    const { names } = await resolveAssignees(newlyAssigned);
    notifyZalo(
      [
        '📋 Bạn được giao việc',
        `Công việc: ${task.title}`,
        `Người thực hiện: ${names.join(', ')}`,
        `Ưu tiên: ${PRIORITY_LABEL[task.priority]}`,
        `Hạn: ${formatVnDate(task.dueDate)}`,
        `Người giao: ${await displayName(auth.username)}`,
      ].join('\n')
    );
  }
  if (changes.length > 0) logAudit(auth.username, 'task_update', `${task.title} · ${changes.join('; ')}`);
  return task;
}

/** Move a task on the Kanban board: new column and/or new position within it. */
export async function moveTask(id: string, auth: Auth, raw: { status?: unknown; order?: unknown }) {
  const task = await getTask(id);
  if (!canWork(task, auth)) throw new TaskForbiddenError('Bạn không có quyền di chuyển công việc này.');

  const changes: string[] = [];
  const wasDone = task.status === 'done';
  if (raw.status !== undefined) applyStatus(task, parseStatus(raw.status), changes);
  if (raw.order !== undefined) {
    const order = Number(raw.order);
    if (!Number.isFinite(order)) throw new TaskInputError('Vị trí không hợp lệ.');
    task.order = order;
  } else if (changes.length > 0) {
    const last = await TaskModel.findOne({ status: task.status, archived: false, _id: { $ne: task._id } })
      .sort({ order: -1 })
      .select('order')
      .lean();
    task.order = (last?.order ?? 0) + 1;
  }
  if (changes.length > 0) pushActivity(task, auth.username, 'status', changes.join('; '));
  await task.save();

  if (!wasDone && task.status === 'done') {
    logAudit(auth.username, 'task_done', task.title);
    notifyZalo(
      [
        '✅ Công việc hoàn thành',
        `Công việc: ${task.title}`,
        `Hoàn thành bởi: ${await displayName(auth.username)}`,
        `Người giao: ${task.createdByName || task.createdBy}`,
      ].join('\n')
    );
  } else if (changes.length > 0) {
    logAudit(auth.username, 'task_status', `${task.title} · ${changes.join('; ')}`);
  }
  return task;
}

/**
 * Persist the order of one Kanban column after a drag-and-drop. Only positions
 * change here — status changes go through moveTask (which checks permissions),
 * so any board member may reorder cards that are already in this column.
 */
export async function reorderColumn(_auth: Auth, raw: { status?: unknown; ids?: unknown }) {
  const status = parseStatus(raw.status);
  const ids = parseStringList(raw.ids).filter((id) => /^[a-f0-9]{24}$/i.test(id));
  if (ids.length === 0) return;
  await TaskModel.bulkWrite(
    ids.map((id, index) => ({
      updateOne: { filter: { _id: id, status }, update: { $set: { order: index + 1 } } },
    }))
  );
}

export async function deleteTask(id: string, auth: Auth) {
  const task = await getTask(id);
  if (!canManage(task, auth)) {
    throw new TaskForbiddenError('Chỉ người giao việc hoặc Admin mới được xóa công việc này.');
  }
  await task.deleteOne();
  logAudit(auth.username, 'task_delete', task.title);
  return true;
}

export async function archiveTask(id: string, auth: Auth, archived: boolean) {
  const task = await getTask(id);
  if (!canManage(task, auth)) {
    throw new TaskForbiddenError('Chỉ người giao việc hoặc Admin mới được lưu trữ công việc này.');
  }
  task.archived = archived;
  pushActivity(task, auth.username, archived ? 'archive' : 'unarchive');
  await task.save();
  return task;
}

// ---- comments & checklist ----

export async function addComment(id: string, auth: Auth, rawText: unknown) {
  const text = String(rawText ?? '').trim();
  if (!text) throw new TaskInputError('Vui lòng nhập nội dung bình luận.');
  if (text.length > 2000) throw new TaskInputError('Bình luận tối đa 2000 ký tự.');
  const task = await getTask(id);
  task.comments.push({
    username: auth.username,
    authorName: await displayName(auth.username),
    text,
    createdAt: new Date(),
  } as TaskDoc['comments'][number]);
  pushActivity(task, auth.username, 'comment', text.slice(0, 80));
  await task.save();
  return task;
}

export async function deleteComment(id: string, commentId: string, auth: Auth) {
  const task = await getTask(id);
  const comment = task.comments.find((c) => String(c._id) === commentId);
  if (!comment) throw new TaskInputError('Không tìm thấy bình luận.');
  if (comment.username !== auth.username && auth.role !== 'admin') {
    throw new TaskForbiddenError('Chỉ người viết hoặc Admin mới được xóa bình luận.');
  }
  task.comments = task.comments.filter((c) => String(c._id) !== commentId);
  await task.save();
  return task;
}

export async function addChecklistItem(id: string, auth: Auth, rawText: unknown) {
  const text = String(rawText ?? '').trim();
  if (!text) throw new TaskInputError('Vui lòng nhập nội dung mục cần làm.');
  const task = await getTask(id);
  if (!canWork(task, auth)) throw new TaskForbiddenError('Bạn không có quyền sửa checklist này.');
  if (task.checklist.length >= 50) throw new TaskInputError('Checklist tối đa 50 mục.');
  task.checklist.push({ text, done: false } as TaskDoc['checklist'][number]);
  await task.save();
  return task;
}

export async function updateChecklistItem(
  id: string,
  itemId: string,
  auth: Auth,
  raw: { done?: unknown; text?: unknown; remove?: unknown }
) {
  const task = await getTask(id);
  if (!canWork(task, auth)) throw new TaskForbiddenError('Bạn không có quyền sửa checklist này.');
  const item = task.checklist.find((c) => String(c._id) === itemId);
  if (!item) throw new TaskInputError('Không tìm thấy mục checklist.');
  if (raw.remove === true) {
    task.checklist = task.checklist.filter((c) => String(c._id) !== itemId);
  } else {
    if (raw.done !== undefined) item.done = Boolean(raw.done);
    if (raw.text !== undefined) {
      const text = String(raw.text).trim();
      if (!text) throw new TaskInputError('Nội dung mục không được để trống.');
      item.text = text;
    }
  }
  await task.save();
  return task;
}

// ---- stats ----

/** UTC-midnight of today's date in Vietnam (UTC+7), matching how date-only due dates are stored. */
function vnStartOfToday(): Date {
  const vnNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return new Date(Date.UTC(vnNow.getUTCFullYear(), vnNow.getUTCMonth(), vnNow.getUTCDate()));
}

export async function taskStats(auth: Auth, scope: 'all' | 'mine') {
  const base: Record<string, unknown> = { archived: false };
  if (scope === 'mine') base.assignees = auth.username;
  const startOfToday = vnStartOfToday();
  const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [byStatus, overdue, dueToday, doneThisWeek] = await Promise.all([
    TaskModel.aggregate<{ _id: TaskStatus; count: number }>([
      { $match: base },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    TaskModel.countDocuments({ ...base, status: { $ne: 'done' }, dueDate: { $lt: startOfToday } }),
    TaskModel.countDocuments({ ...base, status: { $ne: 'done' }, dueDate: { $gte: startOfToday, $lt: endOfToday } }),
    TaskModel.countDocuments({ ...base, status: 'done', completedAt: { $gte: weekAgo } }),
  ]);
  const counts: Record<TaskStatus, number> = { todo: 0, in_progress: 0, review: 0, done: 0 };
  for (const row of byStatus) counts[row._id] = row.count;
  return { counts, overdue, dueToday, doneThisWeek, total: Object.values(counts).reduce((a, b) => a + b, 0) };
}

/** Per-assignee workload: open tasks and overdue count, for the manager's overview. */
export async function workloadByUser() {
  const startOfToday = vnStartOfToday();
  const rows = await TaskModel.aggregate<{
    _id: string;
    open: number;
    inProgress: number;
    review: number;
    overdue: number;
    done: number;
  }>([
    { $match: { archived: false } },
    { $unwind: '$assignees' },
    {
      $group: {
        _id: '$assignees',
        open: { $sum: { $cond: [{ $ne: ['$status', 'done'] }, 1, 0] } },
        inProgress: { $sum: { $cond: [{ $eq: ['$status', 'in_progress'] }, 1, 0] } },
        review: { $sum: { $cond: [{ $eq: ['$status', 'review'] }, 1, 0] } },
        done: { $sum: { $cond: [{ $eq: ['$status', 'done'] }, 1, 0] } },
        overdue: {
          $sum: {
            $cond: [{ $and: [{ $ne: ['$status', 'done'] }, { $lt: ['$dueDate', startOfToday] }] }, 1, 0],
          },
        },
      },
    },
  ]);
  const users = await listAssignableUsers();
  const byUser = new Map(rows.map((r) => [r._id, r]));
  return users.map((u) => {
    const r = byUser.get(u.username);
    return {
      ...u,
      open: r?.open ?? 0,
      inProgress: r?.inProgress ?? 0,
      review: r?.review ?? 0,
      overdue: r?.overdue ?? 0,
      done: r?.done ?? 0,
    };
  });
}
