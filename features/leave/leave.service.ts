import { LeaveRequestModel } from '../../common/models/leaveRequestModel';
import { UserModel } from '../../common/models/userModel';
import { sendZaloText } from '../zalo-bot/zalo-bot.service';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export class LeaveInputError extends Error {}

function parseDate(value: unknown, label: string): Date {
  const date = new Date(String(value ?? ''));
  if (Number.isNaN(date.getTime())) {
    throw new LeaveInputError(`Ngày "${label}" không hợp lệ.`);
  }
  return date;
}

export async function createLeaveRequest(
  auth: { username: string },
  raw: Record<string, unknown>
) {
  const employeeName = String(raw.employeeName ?? '').trim() || auth.username;
  const startDate = parseDate(raw.startDate, 'bắt đầu');
  const endDate = parseDate(raw.endDate, 'kết thúc');
  if (endDate < startDate) {
    throw new LeaveInputError('Ngày kết thúc phải sau ngày bắt đầu.');
  }
  const days = Math.round((endDate.getTime() - startDate.getTime()) / MS_PER_DAY) + 1;
  const reason = String(raw.reason ?? '').trim();

  const record = await LeaveRequestModel.create({
    username: auth.username,
    employeeName,
    startDate,
    endDate,
    days,
    reason,
  });

  void sendZaloText(formatLeaveNotification(record)).catch((err) => {
    console.error('[leave] Failed to notify Zalo group:', err);
  });

  return record;
}

function formatVnDate(date: Date): string {
  return date.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
}

function formatLeaveNotification(record: {
  employeeName: string;
  startDate: Date;
  endDate: Date;
  days: number;
  reason: string;
}): string {
  const range =
    record.startDate.getTime() === record.endDate.getTime()
      ? formatVnDate(record.startDate)
      : `${formatVnDate(record.startDate)} → ${formatVnDate(record.endDate)}`;
  const lines = [
    '🌴 Đăng ký nghỉ phép mới',
    `Nhân viên: ${record.employeeName}`,
    `Thời gian: ${range} (${record.days} ngày)`,
  ];
  if (record.reason) lines.push(`Lý do: ${record.reason}`);
  return lines.join('\n');
}

export async function listMyLeaveRequests(username: string) {
  return LeaveRequestModel.find({ username }).sort({ startDate: -1 });
}

export async function listAllLeaveRequests() {
  return LeaveRequestModel.find().sort({ startDate: -1 });
}

export async function listLeaveBalances() {
  const users = await UserModel.find({ isActive: true }, 'username paidLeaveTotal')
    .sort({ username: 1 })
    .lean();
  const usage = await LeaveRequestModel.aggregate<{ _id: string; usedDays: number }>([
    { $group: { _id: '$username', usedDays: { $sum: '$days' } } },
  ]);
  const usedByUsername = new Map(usage.map((u) => [u._id, u.usedDays]));

  return users.map((user) => {
    const paidLeaveTotal = user.paidLeaveTotal ?? 12;
    const usedDays = usedByUsername.get(user.username) ?? 0;
    return {
      username: user.username,
      paidLeaveTotal,
      usedDays,
      remainingDays: Math.max(paidLeaveTotal - usedDays, 0),
    };
  });
}

export async function deleteLeaveRequest(id: string, auth: { username: string; role: string }) {
  const record = await LeaveRequestModel.findById(id);
  if (!record) return false;
  if (auth.role !== 'admin' && record.username !== auth.username) {
    throw new LeaveInputError('Không có quyền xóa bản ghi này.');
  }
  await record.deleteOne();
  return true;
}
