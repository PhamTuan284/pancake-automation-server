export const LEAVE_TYPES = [
  { id: 'annual', label: 'Nghỉ phép năm' },
  { id: 'vacation', label: 'Nghỉ mát' },
  { id: 'paternity', label: 'Nghỉ do vợ sinh' },
  { id: 'bereavement', label: 'Nghỉ tang' },
  { id: 'maternity', label: 'Nghỉ thai sản' },
  { id: 'marriage', label: 'Bản thân kết hôn' },
  { id: 'childMarriage', label: 'Con đẻ/con nuôi kết hôn' },
] as const;

export type LeaveType = (typeof LEAVE_TYPES)[number]['id'];

export const LEAVE_TYPE_IDS: LeaveType[] = LEAVE_TYPES.map((t) => t.id);

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

/** Years of service, used to size the "nghỉ mát" (vacation) quota. */
export function tenureYears(hireDate: Date | undefined, at: Date = new Date()): number {
  if (!hireDate) return 0;
  return Math.max(0, (at.getTime() - hireDate.getTime()) / MS_PER_YEAR);
}

/**
 * Annual quota (in days) per leave type. `annual` uses the per-user
 * `paidLeaveTotal` override instead (kept for backward compatibility), so
 * it is not resolved here.
 *
 * `paternity` (nghỉ do vợ sinh) only applies to male employees; `maternity`
 * only applies to female employees. An employee with no `gender` set gets 0
 * for both until an admin fills it in.
 */
export function leaveQuotaDays(
  type: LeaveType,
  user: { paidLeaveTotal?: number; hireDate?: Date; gender?: 'male' | 'female' }
): number {
  switch (type) {
    case 'annual':
      return user.paidLeaveTotal ?? 12;
    case 'vacation':
      return tenureYears(user.hireDate) >= 3 ? 3 : 1;
    case 'paternity':
      return user.gender === 'male' ? 5 : 0;
    case 'bereavement':
      return 3;
    case 'maternity':
      return user.gender === 'female' ? 180 : 0; // 6 months
    case 'marriage':
      return 3;
    case 'childMarriage':
      return 1;
    default:
      return 0;
  }
}
