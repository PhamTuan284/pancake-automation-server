import { LeaveRequestModel, type LeaveStatus, type LeaveSession } from '../../common/models/leaveRequestModel';
import { UserModel } from '../../common/models/userModel';
import { LEAVE_TYPES, LEAVE_TYPE_IDS, countLeaveDays, leaveQuotaDays, type LeaveType } from '../../common/leaveTypes';
import { logAudit } from '../../common/models/auditLogModel';
import { sendZaloText } from '../zalo-bot/zalo-bot.service';

export class LeaveInputError extends Error {}

function parseDate(value: unknown, label: string): Date {
  const date = new Date(String(value ?? ''));
  if (Number.isNaN(date.getTime())) {
    throw new LeaveInputError(`Ngày "${label}" không hợp lệ.`);
  }
  return date;
}

function parseType(value: unknown): LeaveType {
  const type = String(value ?? 'annual');
  if (!LEAVE_TYPE_IDS.includes(type as LeaveType)) {
    throw new LeaveInputError('Loại nghỉ phép không hợp lệ.');
  }
  return type as LeaveType;
}

const SESSIONS: LeaveSession[] = ['full', 'morning', 'afternoon'];

function parseSession(value: unknown): LeaveSession {
  const session = String(value ?? 'full');
  if (!SESSIONS.includes(session as LeaveSession)) {
    throw new LeaveInputError('Buổi nghỉ không hợp lệ.');
  }
  return session as LeaveSession;
}

const LEAVE_TYPE_LABEL = new Map(LEAVE_TYPES.map((t) => [t.id, t.label]));

export async function createLeaveRequest(
  auth: { username: string },
  raw: Record<string, unknown>
) {
  // The employee name is always the logged-in account's own name — never
  // taken from client input, so a request can't be filed under someone else.
  const account = await UserModel.findOne({ username: auth.username }, 'fullName department').lean();
  const employeeName = account?.fullName || auth.username;
  const department = account?.department || '';
  const type = parseType(raw.type);
  const session = parseSession(raw.session);
  const startDate = parseDate(raw.startDate, 'bắt đầu');
  const endDate = parseDate(raw.endDate, 'kết thúc');
  if (endDate < startDate) {
    throw new LeaveInputError('Ngày kết thúc phải sau ngày bắt đầu.');
  }
  if (session !== 'full' && startDate.getTime() !== endDate.getTime()) {
    throw new LeaveInputError('Nghỉ nửa ngày chỉ áp dụng cho 1 ngày duy nhất.');
  }
  const isSunday = startDate.getUTCDay() === 0;
  if (session !== 'full' && isSunday) {
    throw new LeaveInputError('Chủ nhật không tính vào ngày nghỉ.');
  }
  const days = session === 'full' ? countLeaveDays(startDate, endDate) : 0.5;
  if (days <= 0) {
    throw new LeaveInputError('Khoảng thời gian đã chọn không có ngày nào được tính (Chủ nhật không tính vào ngày nghỉ).');
  }
  const reason = String(raw.reason ?? '').trim();

  const record = await LeaveRequestModel.create({
    username: auth.username,
    employeeName,
    department,
    type,
    startDate,
    endDate,
    session,
    days,
    reason,
    status: 'pending',
  });

  void sendZaloText(formatLeaveNotification(record)).catch((err) => {
    console.error('[leave] Failed to notify Zalo group:', err);
  });
  logAudit(auth.username, 'leave_request', `${LEAVE_TYPE_LABEL.get(type) ?? type} · ${formatRange(record)}`);

  return record;
}

function formatVnDate(date: Date): string {
  return date.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
}

const SESSION_SUFFIX: Record<LeaveSession, string> = {
  full: '',
  morning: ' (buổi sáng)',
  afternoon: ' (buổi chiều)',
};

function formatRange(record: { startDate: Date; endDate: Date; session: LeaveSession; days: number }): string {
  const range =
    record.startDate.getTime() === record.endDate.getTime()
      ? formatVnDate(record.startDate)
      : `${formatVnDate(record.startDate)} → ${formatVnDate(record.endDate)}`;
  return `${range}${SESSION_SUFFIX[record.session]} (${record.days} ngày)`;
}

/** "Nguyễn Văn A (username)" when a full name is on file, else just the username. */
function formatEmployee(record: { employeeName: string; username: string }): string {
  return record.employeeName && record.employeeName !== record.username
    ? `${record.employeeName} (${record.username})`
    : record.username;
}

function formatLeaveNotification(record: {
  username: string;
  employeeName: string;
  department?: string;
  type: LeaveType;
  startDate: Date;
  endDate: Date;
  session: LeaveSession;
  days: number;
  reason: string;
}): string {
  const lines = [
    '🌴 Đăng ký nghỉ phép mới — chờ duyệt',
    `Nhân viên: ${formatEmployee(record)}`,
  ];
  if (record.department) lines.push(`Phòng ban: ${record.department}`);
  lines.push(
    `Loại: ${LEAVE_TYPE_LABEL.get(record.type) ?? record.type}`,
    `Thời gian: ${formatRange(record)}`
  );
  if (record.reason) lines.push(`Lý do: ${record.reason}`);
  return lines.join('\n');
}

function formatDecisionNotification(record: {
  username: string;
  employeeName: string;
  department?: string;
  type: LeaveType;
  startDate: Date;
  endDate: Date;
  session: LeaveSession;
  days: number;
  status: LeaveStatus;
  approvedBy?: string;
  rejectReason?: string;
}): string {
  const verb = record.status === 'approved' ? 'ĐÃ DUYỆT ✅' : 'TỪ CHỐI ❌';
  const lines = [
    `🌴 Nghỉ phép ${verb}`,
    `Nhân viên: ${formatEmployee(record)}`,
  ];
  if (record.department) lines.push(`Phòng ban: ${record.department}`);
  lines.push(
    `Loại: ${LEAVE_TYPE_LABEL.get(record.type) ?? record.type}`,
    `Thời gian: ${formatRange(record)}`
  );
  if (record.approvedBy) lines.push(`Người duyệt: ${record.approvedBy}`);
  if (record.status === 'rejected' && record.rejectReason) lines.push(`Lý do từ chối: ${record.rejectReason}`);
  return lines.join('\n');
}

export async function listMyLeaveRequests(username: string) {
  return LeaveRequestModel.find({ username }).sort({ startDate: -1 });
}

export async function listAllLeaveRequests() {
  return LeaveRequestModel.find().sort({ startDate: -1 });
}

/** Days used per type, counting only approved requests that start in `year`. */
async function usedDaysByUser(year: number): Promise<Map<string, Map<LeaveType, number>>> {
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year + 1, 0, 1));
  const usage = await LeaveRequestModel.aggregate<{ _id: { username: string; type: LeaveType }; usedDays: number }>([
    { $match: { status: 'approved', startDate: { $gte: start, $lt: end } } },
    { $group: { _id: { username: '$username', type: '$type' }, usedDays: { $sum: '$days' } } },
  ]);
  const byUser = new Map<string, Map<LeaveType, number>>();
  for (const row of usage) {
    const perType = byUser.get(row._id.username) ?? new Map<LeaveType, number>();
    perType.set(row._id.type, row.usedDays);
    byUser.set(row._id.username, perType);
  }
  return byUser;
}

type UserBalance = {
  username: string;
  department: string;
  types: {
    type: LeaveType;
    label: string;
    quota: number;
    usedDays: number;
    remainingDays: number;
  }[];
};

function buildBalance(
  user: {
    username: string;
    department?: string;
    paidLeaveTotal?: number;
    hireDate?: Date;
    gender?: 'male' | 'female';
  },
  usedByType: Map<LeaveType, number> | undefined
): UserBalance {
  return {
    username: user.username,
    department: user.department ?? '',
    types: LEAVE_TYPES.map(({ id, label }) => {
      const quota = leaveQuotaDays(id, user);
      const usedDays = usedByType?.get(id) ?? 0;
      return { type: id, label, quota, usedDays, remainingDays: Math.max(quota - usedDays, 0) };
    }),
  };
}

export async function listLeaveBalances(year: number = new Date().getFullYear()) {
  const users = await UserModel.find(
    { isActive: true },
    'username department paidLeaveTotal hireDate gender'
  )
    .sort({ username: 1 })
    .lean();
  const usedByUser = await usedDaysByUser(year);
  return users.map((user) => buildBalance(user, usedByUser.get(user.username)));
}

export async function getMyLeaveBalance(username: string, year: number = new Date().getFullYear()) {
  const user = await UserModel.findOne(
    { username },
    'username department paidLeaveTotal hireDate gender'
  ).lean();
  if (!user) throw new LeaveInputError('Không tìm thấy người dùng.');
  const usedByUser = await usedDaysByUser(year);
  return buildBalance(user, usedByUser.get(username));
}

export async function decideLeaveRequest(
  id: string,
  decision: 'approved' | 'rejected',
  admin: { username: string },
  rejectReason?: string
) {
  const record = await LeaveRequestModel.findById(id);
  if (!record) throw new LeaveInputError('Không tìm thấy đơn nghỉ phép.');
  if (record.status !== 'pending') {
    throw new LeaveInputError('Đơn nghỉ phép này đã được xử lý.');
  }
  record.status = decision;
  record.approvedBy = admin.username;
  record.approvedAt = new Date();
  if (decision === 'rejected') record.rejectReason = (rejectReason ?? '').trim();
  await record.save();

  void sendZaloText(formatDecisionNotification(record)).catch((err) => {
    console.error('[leave] Failed to notify Zalo group:', err);
  });
  logAudit(
    admin.username,
    decision === 'approved' ? 'leave_approve' : 'leave_reject',
    `${record.employeeName} · ${LEAVE_TYPE_LABEL.get(record.type) ?? record.type} · ${formatRange(record)}`
  );

  return record;
}

export async function deleteLeaveRequest(id: string, auth: { username: string; role: string }) {
  const record = await LeaveRequestModel.findById(id);
  if (!record) return false;
  const isOwner = record.username === auth.username;
  if (auth.role !== 'admin') {
    if (!isOwner) throw new LeaveInputError('Không có quyền xóa bản ghi này.');
    if (record.status !== 'pending') {
      throw new LeaveInputError('Chỉ có thể hủy đơn đang chờ duyệt.');
    }
  }
  await record.deleteOne();
  logAudit(auth.username, 'leave_cancel', `${record.employeeName} · ${LEAVE_TYPE_LABEL.get(record.type) ?? record.type} · ${formatRange(record)}`);
  return true;
}
