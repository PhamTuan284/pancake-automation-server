import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { UserModel } from '../../common/models/userModel';
import { AdminSettingsModel, getAdminSettings } from '../../common/models/adminSettingsModel';
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
    res.json({ token, username: user.username, role: user.role });
  } catch (err) {
    console.error('[admin/login]', err);
    res.status(500).json({ error: 'Lỗi server.' });
  }
}

export function getMe(req: Request, res: Response): void {
  res.json({ username: req.auth!.username, role: req.auth!.role });
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
    const { username, password, role } = req.body as {
      username?: string;
      password?: string;
      role?: string;
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
    const user = await UserModel.create({
      username: username.trim(),
      passwordHash,
      role: role === 'admin' ? 'admin' : 'user',
    });
    res.status(201).json({ id: String(user._id), username: user.username, role: user.role });
  } catch (err) {
    console.error('[admin/createUser]', err);
    res.status(500).json({ error: 'Lỗi server.' });
  }
}

export async function updateUser(req: Request, res: Response): Promise<void> {
  try {
    await ensureMongoConnected();
    const { id } = req.params;
    const { role, isActive, password } = req.body as {
      role?: string;
      isActive?: boolean;
      password?: string;
    };
    const update: Record<string, unknown> = {};
    if (role === 'admin' || role === 'user') update.role = role;
    if (typeof isActive === 'boolean') update.isActive = isActive;
    if (password) update.passwordHash = await bcrypt.hash(password, 12);

    const user = await UserModel.findByIdAndUpdate(id, update, {
      new: true,
      projection: '-passwordHash',
    });
    if (!user) {
      res.status(404).json({ error: 'Không tìm thấy người dùng.' });
      return;
    }
    res.json(user);
  } catch (err) {
    console.error('[admin/updateUser]', err);
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
    await UserModel.findByIdAndDelete(id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[admin/deleteUser]', err);
    res.status(500).json({ error: 'Lỗi server.' });
  }
}

const VALID_LEVELS = new Set(['guest', 'user', 'admin']);

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
      tabAccess?: Record<string, string>;
      botEnabled?: { telegram?: boolean; zalo?: boolean };
    };
    let settings = await AdminSettingsModel.findOne();
    if (!settings) {
      settings = await AdminSettingsModel.create({
        tabAccess: new Map(),
        botEnabled: { telegram: true, zalo: true },
      });
    }
    if (tabAccess) {
      const sanitized = Object.entries(tabAccess).filter(([, v]) => VALID_LEVELS.has(v));
      settings.tabAccess = new Map(sanitized) as Map<string, 'guest' | 'user' | 'admin'>;
    }
    if (botEnabled) {
      if (typeof botEnabled.telegram === 'boolean') settings.botEnabled.telegram = botEnabled.telegram;
      if (typeof botEnabled.zalo === 'boolean') settings.botEnabled.zalo = botEnabled.zalo;
    }
    await settings.save();
    res.json({
      tabAccess: Object.fromEntries(settings.tabAccess),
      botEnabled: settings.botEnabled,
    });
  } catch (err) {
    console.error('[admin/updateSettings]', err);
    res.status(500).json({ error: 'Lỗi server.' });
  }
}
