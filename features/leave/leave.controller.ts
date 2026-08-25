import type { Request, Response } from 'express';
import { ensureMongoConnected } from '../../common/mongo';
import {
  LeaveInputError,
  createLeaveRequest,
  decideLeaveRequest,
  deleteLeaveRequest,
  getMyLeaveBalance,
  listAllLeaveRequests,
  listLeaveBalances,
  listMyLeaveRequests,
} from './leave.service';

export async function postLeaveRequest(req: Request, res: Response): Promise<void> {
  try {
    await ensureMongoConnected();
    const record = await createLeaveRequest(req.auth!, (req.body || {}) as Record<string, unknown>);
    res.status(201).json({ ok: true, record });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Không thể ghi nhận nghỉ phép.';
    res.status(err instanceof LeaveInputError ? 400 : 500).json({ ok: false, error: message });
  }
}

export async function getMyLeaveRequests(req: Request, res: Response): Promise<void> {
  try {
    await ensureMongoConnected();
    const records = await listMyLeaveRequests(req.auth!.username);
    res.json({ ok: true, records });
  } catch (err) {
    console.error('[leave/mine]', err);
    res.status(500).json({ ok: false, error: 'Lỗi server.' });
  }
}

export async function getAllLeaveRequests(_req: Request, res: Response): Promise<void> {
  try {
    await ensureMongoConnected();
    const records = await listAllLeaveRequests();
    res.json({ ok: true, records });
  } catch (err) {
    console.error('[leave/all]', err);
    res.status(500).json({ ok: false, error: 'Lỗi server.' });
  }
}

export async function getLeaveBalances(_req: Request, res: Response): Promise<void> {
  try {
    await ensureMongoConnected();
    const balances = await listLeaveBalances();
    res.json({ ok: true, balances });
  } catch (err) {
    console.error('[leave/balances]', err);
    res.status(500).json({ ok: false, error: 'Lỗi server.' });
  }
}

export async function getMyLeaveBalanceController(req: Request, res: Response): Promise<void> {
  try {
    await ensureMongoConnected();
    const balance = await getMyLeaveBalance(req.auth!.username);
    res.json({ ok: true, balance });
  } catch (err) {
    console.error('[leave/my-balance]', err);
    res.status(500).json({ ok: false, error: 'Lỗi server.' });
  }
}

export async function approveLeaveRequestController(req: Request, res: Response): Promise<void> {
  try {
    await ensureMongoConnected();
    const record = await decideLeaveRequest(req.params.id, 'approved', req.auth!);
    res.json({ ok: true, record });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Không thể duyệt đơn.';
    res.status(err instanceof LeaveInputError ? 400 : 500).json({ ok: false, error: message });
  }
}

export async function rejectLeaveRequestController(req: Request, res: Response): Promise<void> {
  try {
    await ensureMongoConnected();
    const { reason } = (req.body || {}) as { reason?: string };
    const record = await decideLeaveRequest(req.params.id, 'rejected', req.auth!, reason);
    res.json({ ok: true, record });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Không thể từ chối đơn.';
    res.status(err instanceof LeaveInputError ? 400 : 500).json({ ok: false, error: message });
  }
}

export async function deleteLeaveRequestController(req: Request, res: Response): Promise<void> {
  try {
    await ensureMongoConnected();
    const ok = await deleteLeaveRequest(req.params.id, req.auth!);
    if (!ok) {
      res.status(404).json({ ok: false, error: 'Không tìm thấy bản ghi.' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Không thể xóa bản ghi.';
    res.status(err instanceof LeaveInputError ? 403 : 500).json({ ok: false, error: message });
  }
}
