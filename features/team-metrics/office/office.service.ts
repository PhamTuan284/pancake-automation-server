import { UserModel } from '../../../common/models/userModel';
import { LeaveRequestModel } from '../../../common/models/leaveRequestModel';
import { OfficeAttendanceModel } from '../../../common/models/officeAttendanceModel';
import { getAdminSettings, type OfficeWorkHours } from '../../../common/models/adminSettingsModel';

export class AttendanceParserNotConfiguredError extends Error {}

export type RawPunch = {
  employeeName: string;
  date: string; // "YYYY-MM-DD"
  checkIn?: string; // "HH:mm"
  checkOut?: string; // "HH:mm"
};

/**
 * TODO: implement once a sample export from the office time-clock machine is
 * available — column layout (name/employee-code, date, check-in/check-out)
 * is unknown until then. Everything downstream (matching, computing lateness,
 * persisting, reporting) is already wired up to this interface.
 */
export function parseAttendanceExcel(_buffer: Buffer): RawPunch[] {
  throw new AttendanceParserNotConfiguredError(
    'Chưa cấu hình định dạng file chấm công máy — cần 1 file mẫu để xác định đúng cột trước khi bật tính năng này.'
  );
}

function toMinutes(hhmm: string): number | null {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export type OfficeComputeSummary = {
  computed: number;
  unmatchedNames: string[];
};

export async function computeOfficeAttendance(buffer: Buffer): Promise<OfficeComputeSummary> {
  const punches = parseAttendanceExcel(buffer);
  const settings = await getAdminSettings();
  const users = await UserModel.find({ isActive: true }, 'username fullName').lean();
  const byName = new Map(users.map((u) => [u.fullName.trim().toLowerCase(), u]));

  let computed = 0;
  const unmatchedNames = new Set<string>();

  for (const punch of punches) {
    const user = byName.get(punch.employeeName.trim().toLowerCase());
    if (!user) {
      unmatchedNames.add(punch.employeeName);
      continue;
    }

    const exception = await LeaveRequestModel.findOne({
      username: user.username,
      type: 'customHours',
      status: 'approved',
      startDate: new Date(punch.date),
    }).lean();

    const effective: OfficeWorkHours = exception?.checkInTime && exception?.checkOutTime
      ? { checkIn: exception.checkInTime, checkOut: exception.checkOutTime, graceMinutes: settings.officeWorkHours.graceMinutes }
      : settings.officeWorkHours;

    const standardIn = toMinutes(effective.checkIn);
    const standardOut = toMinutes(effective.checkOut);
    const actualIn = punch.checkIn ? toMinutes(punch.checkIn) : null;
    const actualOut = punch.checkOut ? toMinutes(punch.checkOut) : null;

    const lateMinutes =
      actualIn !== null && standardIn !== null
        ? Math.max(0, actualIn - standardIn - effective.graceMinutes)
        : 0;
    const earlyLeaveMinutes =
      actualOut !== null && standardOut !== null
        ? Math.max(0, standardOut - actualOut - effective.graceMinutes)
        : 0;

    await OfficeAttendanceModel.findOneAndUpdate(
      { username: user.username, date: punch.date },
      {
        username: user.username,
        employeeName: user.fullName,
        date: punch.date,
        checkIn: punch.checkIn,
        checkOut: punch.checkOut,
        lateMinutes,
        earlyLeaveMinutes,
        matchedException: exception
          ? { leaveRequestId: String(exception._id), checkInTime: exception.checkInTime, checkOutTime: exception.checkOutTime }
          : undefined,
      },
      { upsert: true, new: true }
    );
    computed++;
  }

  return { computed, unmatchedNames: [...unmatchedNames] };
}

export type EmployeeOfficeReport = {
  employeeName: string;
  daysRecorded: number;
  lateCount: number;
  totalLateMinutes: number;
  earlyLeaveCount: number;
  totalEarlyLeaveMinutes: number;
};

export async function getOfficeAttendanceReport(from: string, to: string): Promise<EmployeeOfficeReport[]> {
  const records = await OfficeAttendanceModel.find({ date: { $gte: from, $lte: to } }).lean();
  const byEmployee = new Map<string, EmployeeOfficeReport>();

  for (const r of records) {
    let bucket = byEmployee.get(r.username);
    if (!bucket) {
      bucket = {
        employeeName: r.employeeName,
        daysRecorded: 0,
        lateCount: 0,
        totalLateMinutes: 0,
        earlyLeaveCount: 0,
        totalEarlyLeaveMinutes: 0,
      };
      byEmployee.set(r.username, bucket);
    }
    bucket.daysRecorded += 1;
    if (r.lateMinutes > 0) {
      bucket.lateCount += 1;
      bucket.totalLateMinutes += r.lateMinutes;
    }
    if (r.earlyLeaveMinutes > 0) {
      bucket.earlyLeaveCount += 1;
      bucket.totalEarlyLeaveMinutes += r.earlyLeaveMinutes;
    }
  }

  return [...byEmployee.values()].sort((a, b) => b.totalLateMinutes - a.totalLateMinutes);
}
