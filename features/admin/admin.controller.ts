import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { UserModel, DEPARTMENTS, WORK_MODES } from '../../common/models/userModel';
import { AdminSettingsModel, getAdminSettings, DEFAULT_TAB_ACCESS } from '../../common/models/adminSettingsModel';
import { logAudit, listAuditLogs } from '../../common/models/auditLogModel';
import { ensureMongoConnected } from '../../common/mongo';
import { getJwtSecret } from '../../common/auth.middleware';

export async function login(req: Request, res: Response): Promise<void> {
  try {
    await ensureMongoConnected();
    const { username, password } = req.body as { username?: string; password?: string };
    if (!username || !password) {
      res.status(400).json({ error: 'Cần nhập tên đăng nhập và mật khẩu.' });
      return;
    }
    const user = await UserModel.findOne({ username: username.trim(), isActive: true });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không đúng.' });
      return;
    }
    const token = jwt.sign(
      { userId: String(user._id), username: user.username, role: user.role },
      getJwtSecret(),
      { expiresIn: '24h' }
    );
    logAudit(user.username, 'login');
    res.json({
      token,
      username: user.username,
      fullName: user.fullName,
      role: user.role,
      department: user.department,
      gender: user.gender,
    });
  } catch (err) {
    console.error('[admin/login]', err);
    res.status(500).json({ error: 'Lỗi server.' });
  }
}

export function getMe(req: Request, res: Response): void {
  res.json({ username: req.auth!.username, role: req.auth!.role });
}

export async function changeOwnPassword(req: Request, res: Response): Promise<void> {
  try {
    await ensureMongoConnected();
    const { currentPassword, newPassword } = req.body as {
      currentPassword?: string;
      newPassword?: string;
    };
    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: 'Cần nhập mật khẩu hiện tại và mật khẩu mới.' });
      return;
    }
    if (newPassword.length < 6) {
      res.status(400).json({ error: 'Mật khẩu mới phải có ít nhất 6 ký tự.' });
      return;
    }
    const user = await UserModel.findById(req.auth!.userId);
    if (!user) {
      res.status(404).json({ error: 'Không tìm thấy người dùng.' });
      return;
    }
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      res.status(401).json({ error: 'Mật khẩu hiện tại không đúng.' });
      return;
    }
    user.passwordHash = await bcrypt.hash(newPassword, 12);
    await user.save();
    logAudit(user.username, 'change_own_password');
    res.json({ ok: true });
  } catch (err) {
    console.error('[admin/changeOwnPassword]', err);
    res.status(500).json({ error: 'Lỗi server.' });
  }
}

export async function listUsers(_req: Request, res: Response): Promise<void> {
  try {
    await ensureMongoConnected();
    const users = await UserModel.find({}, '-passwordHash').sort({ createdAt: 1 });
    res.json(users);
  } catch (err) {
    console.error('[admin/listUsers]', err);
    res.status(500).json({ error: 'Lỗi server.' });
  }
}

export async function createUser(req: Request, res: Response): Promise<void> {
  try {
    await ensureMongoConnected();
    const { username, password, fullName, role, department, hireDate, gender, workMode } = req.body as {
      username?: string;
      password?: string;
      fullName?: string;
      role?: string;
      department?: string;
      hireDate?: string;
      gender?: string;
      workMode?: string;
    };
    if (!username?.trim() || !password) {
      res.status(400).json({ error: 'Cần nhập tên đăng nhập và mật khẩu.' });
      return;
    }
    if (await UserModel.findOne({ username: username.trim() })) {
      res.status(409).json({ error: 'Tên đăng nhập đã tồn tại.' });
      return;
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const parsedHireDate = hireDate ? new Date(hireDate) : undefined;
    const user = await UserModel.create({
      username: username.trim(),
      passwordHash,
      fullName: (fullName ?? '').trim(),
      role: role === 'admin' ? 'admin' : 'user',
      department: DEPARTMENTS.includes(department as (typeof DEPARTMENTS)[number]) ? department : '',
      hireDate: parsedHireDate && !Number.isNaN(parsedHireDate.getTime()) ? parsedHireDate : undefined,
      gender: gender === 'male' || gender === 'female' ? gender : undefined,
      workMode: WORK_MODES.includes(workMode as (typeof WORK_MODES)[number]) ? workMode : undefined,
    });
    logAudit(req.auth!.username, 'create_user', `Tạo người dùng "${user.username}"`);
    res.status(201).json({
      id: String(user._id),
      username: user.username,
      fullName: user.fullName,
      role: user.role,
      department: user.department,
      hireDate: user.hireDate,
      gender: user.gender,
      workMode: user.workMode,
    });
  } catch (err) {
    console.error('[admin/createUser]', err);
    res.status(500).json({ error: 'Lỗi server.' });
  }
}

type UserUpdateInput = {
  role?: string;
  isActive?: boolean;
  password?: string;
  paidLeaveTotal?: number;
  department?: string;
  hireDate?: string;
  gender?: string;
  workMode?: string;
  fullName?: string;
};

/** Builds a Mongo update object from partial user-edit input; only fields present in `body` are included. */
async function buildUserUpdate(body: UserUpdateInput): Promise<Record<string, unknown>> {
  const { role, isActive, password, paidLeaveTotal, department, hireDate, gender, workMode, fullName } = body;
  const update: Record<string, unknown> = {};
  if (fullName !== undefined) update.fullName = fullName.trim();
  if (role === 'admin' || role === 'user') update.role = role;
  if (typeof isActive === 'boolean') update.isActive = isActive;
  if (password) update.passwordHash = await bcrypt.hash(password, 12);
  if (typeof paidLeaveTotal === 'number' && Number.isFinite(paidLeaveTotal) && paidLeaveTotal >= 0) {
    update.paidLeaveTotal = paidLeaveTotal;
  }
  if (department !== undefined) {
    update.department = DEPARTMENTS.includes(department as (typeof DEPARTMENTS)[number]) ? department : '';
  }
  if (hireDate !== undefined) {
    if (hireDate === '') {
      update.hireDate = null;
    } else {
      const parsed = new Date(hireDate);
      if (!Number.isNaN(parsed.getTime())) update.hireDate = parsed;
    }
  }
  if (gender !== undefined) {
    update.gender = gender === 'male' || gender === 'female' ? gender : null;
  }
  if (workMode !== undefined) {
    update.workMode = WORK_MODES.includes(workMode as (typeof WORK_MODES)[number]) ? workMode : null;
  }
  return update;
}

export async function updateUser(req: Request, res: Response): Promise<void> {
  try {
    await ensureMongoConnected();
    const { id } = req.params;
    const update = await buildUserUpdate(req.body as UserUpdateInput);

    const user = await UserModel.findByIdAndUpdate(id, update, {
      new: true,
      projection: '-passwordHash',
    });
    if (!user) {
      res.status(404).json({ error: 'Không tìm thấy người dùng.' });
      return;
    }
    const changedFields = Object.keys(update).map((k) => (k === 'passwordHash' ? 'password' : k));
    logAudit(req.auth!.username, 'update_user', `Cập nhật người dùng "${user.username}" (${changedFields.join(', ')})`);
    res.json(user);
  } catch (err) {
    console.error('[admin/updateUser]', err);
    res.status(500).json({ error: 'Lỗi server.' });
  }
}

/** Bulk edit: applies the same partial update to many users at once (no password/fullName — those don't make sense shared across people). */
export async function bulkUpdateUsers(req: Request, res: Response): Promise<void> {
  try {
    await ensureMongoConnected();
    const { ids, ...body } = req.body as UserUpdateInput & { ids?: string[] };
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'Cần chọn ít nhất 1 người dùng.' });
      return;
    }
    const update = await buildUserUpdate({ ...body, password: undefined, fullName: undefined });
    if (Object.keys(update).length === 0) {
      res.status(400).json({ error: 'Chưa chọn thay đổi nào để áp dụng.' });
      return;
    }
    // Never let a bulk action lock the acting admin out of their own account.
    const targetIds = ids.filter((targetId) => targetId !== req.auth!.userId);
    const result = await UserModel.updateMany({ _id: { $in: targetIds } }, update);
    logAudit(
      req.auth!.username,
      'bulk_update_users',
      `Cập nhật hàng loạt ${result.modifiedCount} người dùng (${Object.keys(update).join(', ')})`
    );
    res.json({ ok: true, matched: result.matchedCount, modified: result.modifiedCount });
  } catch (err) {
    console.error('[admin/bulkUpdateUsers]', err);
    res.status(500).json({ error: 'Lỗi server.' });
  }
}

export async function deleteUser(req: Request, res: Response): Promise<void> {
  try {
    await ensureMongoConnected();
    const { id } = req.params;
    if (req.auth!.userId === id) {
      res.status(400).json({ error: 'Không thể xóa tài khoản đang đăng nhập.' });
      return;
    }
    const deleted = await UserModel.findByIdAndDelete(id);
    if (deleted) logAudit(req.auth!.username, 'delete_user', `Xóa người dùng "${deleted.username}"`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[admin/deleteUser]', err);
    res.status(500).json({ error: 'Lỗi server.' });
  }
}

const VALID_TAB_VALUES = new Set<string>([...DEPARTMENTS, '*']);

export async function getSettings(_req: Request, res: Response): Promise<void> {
  try {
    await ensureMongoConnected();
    const settings = await getAdminSettings();
    res.json({
      tabAccess: Object.fromEntries(settings.tabAccess),
      botEnabled: settings.botEnabled,
    });
  } catch (err) {
    console.error('[admin/getSettings]', err);
    res.status(500).json({ error: 'Lỗi server.' });
  }
}

export async function updateSettings(req: Request, res: Response): Promise<void> {
  try {
    await ensureMongoConnected();
    const { tabAccess, botEnabled } = req.body as {
      tabAccess?: Record<string, string[]>;
      botEnabled?: { zalo?: boolean };
    };
    let settings = await AdminSettingsModel.findOne();
    if (!settings) {
      settings = await AdminSettingsModel.create({
        tabAccess: new Map(Object.entries(DEFAULT_TAB_ACCESS)),
        botEnabled: { zalo: true },
      });
    }
    if (tabAccess) {
      const sanitized = Object.entries(tabAccess)
        .filter(([, v]) => Array.isArray(v))
        .map(([k, v]) => [k, v.filter((d) => VALID_TAB_VALUES.has(d))] as [string, string[]]);
      settings.tabAccess = new Map(sanitized);
    }
    if (botEnabled) {
      if (typeof botEnabled.zalo === 'boolean') settings.botEnabled.zalo = botEnabled.zalo;
    }
    await settings.save();
    logAudit(req.auth!.username, 'update_settings', 'Cập nhật phân quyền tab / cài đặt bot');
    res.json({
      tabAccess: Object.fromEntries(settings.tabAccess),
      botEnabled: settings.botEnabled,
    });
  } catch (err) {
    console.error('[admin/updateSettings]', err);
    res.status(500).json({ error: 'Lỗi server.' });
  }
}

export async function getAuditLogs(_req: Request, res: Response): Promise<void> {
  try {
    await ensureMongoConnected();
    const logs = await listAuditLogs();
    res.json({ ok: true, logs });
  } catch (err) {
    console.error('[admin/getAuditLogs]', err);
    res.status(500).json({ ok: false, error: 'Lỗi server.' });
  }
}
