import { parseScheduleWorkbook, type ScheduleSlot } from './schedule.parser';
import { parseTikTokReport } from './tiktok.parser';
import { fetchLiveVideos } from '../../facebook/facebook.service';
import { downloadScheduleXlsx } from '../../drive/drive.service';
import { LiveAttendanceModel } from '../../../common/models/liveAttendanceModel';
import { getAdminSettings } from '../../../common/models/adminSettingsModel';

// Matching tolerances validated by hand against real Aug 2026 data (see
// project notes): a session further than this from its nominal slot start
// is treated as unrelated content rather than force-matched with a
// misleading lateness figure.
const MAX_LATE_MINUTES = 150;
const MAX_EARLY_MINUTES = 60;

type RawSession = {
  platform: 'tiktok' | 'facebook';
  sessionId: string;
  start: Date;
  end: Date;
};

function minutesOfDayVn(date: Date): number {
  return (
    Number(date.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', hour12: false })) * 60 +
    Number(date.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh', minute: '2-digit' }))
  );
}

function dateIsoVn(date: Date): string {
  return date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
}

export type LiveComputeSummary = {
  matched: number;
  noSchedule: number;
  unmatched: number;
  parsedTabs: { tab: string; weekStart: string }[];
  skippedTabs: { tab: string; reason: string }[];
};

async function fetchFacebookSessions(): Promise<RawSession[]> {
  const videos = await fetchLiveVideos();
  const sessions: RawSession[] = [];
  for (const v of videos) {
    if (!v.broadcast_start_time || !v.video?.length) continue; // still live / no recorded duration yet
    const start = new Date(v.broadcast_start_time);
    if (Number.isNaN(start.getTime())) continue;
    const end = new Date(start.getTime() + v.video.length * 1000);
    sessions.push({ platform: 'facebook', sessionId: v.id, start, end });
  }
  return sessions;
}

/**
 * Uploads + parses a TikTok performance report, combines it with the current
 * Facebook live sessions and the Drive schedule, matches each real session to
 * its nominal shift slot, and upserts the computed lateness/duration results.
 * `referenceDateIso` anchors the schedule tab-name year (see schedule.parser).
 */
export async function computeLiveAttendance(
  tikTokFileBuffer: Buffer,
  referenceDateIso: string
): Promise<LiveComputeSummary> {
  const settings = await getAdminSettings();
  const scheduleBuffer = await downloadScheduleXlsx();
  const { slots, parsedTabs, skippedTabs } = parseScheduleWorkbook(scheduleBuffer, referenceDateIso);

  const tikTokSessions = parseTikTokReport(tikTokFileBuffer);
  const facebookSessions = await fetchFacebookSessions();
  const allSessions: RawSession[] = [...tikTokSessions, ...facebookSessions];

  let matched = 0;
  let noSchedule = 0;
  let unmatched = 0;

  for (const session of allSessions) {
    const dateIso = dateIsoVn(session.start);
    const daySlots = slots.filter((s) => s.date === dateIso && s.platform === session.platform);
    if (!daySlots.length) {
      noSchedule++;
      continue;
    }

    const startMinutesLocal = minutesOfDayVn(session.start);
    let best: ScheduleSlot | null = null;
    for (const s of daySlots) {
      const delta = startMinutesLocal - s.startMinutes;
      if (delta >= -MAX_EARLY_MINUTES && delta <= MAX_LATE_MINUTES) {
        if (!best || Math.abs(delta) < Math.abs(startMinutesLocal - best.startMinutes)) {
          best = s;
        }
      }
    }
    if (!best) {
      unmatched++;
      continue;
    }

    const durationMinutes = (session.end.getTime() - session.start.getTime()) / 60000;
    const lateMinutes = Math.max(0, Math.round(startMinutesLocal - best.startMinutes));

    await LiveAttendanceModel.findOneAndUpdate(
      { platform: session.platform, sessionId: session.sessionId },
      {
        platform: session.platform,
        sessionId: session.sessionId,
        date: dateIso,
        employeeNames: best.employees,
        scheduledSlotLabel: best.label,
        scheduledStart: `${String(Math.floor(best.startMinutes / 60)).padStart(2, '0')}:${String(
          best.startMinutes % 60
        ).padStart(2, '0')}`,
        actualStart: session.start,
        actualEnd: session.end,
        durationMinutes,
        lateMinutes,
        underMinDuration: durationMinutes < settings.liveMinSessionMinutes,
      },
      { upsert: true, new: true }
    );
    matched++;
  }

  return { matched, noSchedule, unmatched, parsedTabs, skippedTabs };
}

export type EmployeeLiveReport = {
  employeeName: string;
  totalHours: number;
  sessionCount: number;
  lateCount: number;
  underMinDurationCount: number;
  byPlatform: Record<'tiktok' | 'facebook', number>;
};

export async function getLiveAttendanceReport(from: string, to: string): Promise<EmployeeLiveReport[]> {
  const records = await LiveAttendanceModel.find({ date: { $gte: from, $lte: to } }).lean();
  const byEmployee = new Map<string, EmployeeLiveReport>();

  for (const r of records) {
    for (const name of r.employeeNames) {
      let bucket = byEmployee.get(name);
      if (!bucket) {
        bucket = {
          employeeName: name,
          totalHours: 0,
          sessionCount: 0,
          lateCount: 0,
          underMinDurationCount: 0,
          byPlatform: { tiktok: 0, facebook: 0 },
        };
        byEmployee.set(name, bucket);
      }
      bucket.totalHours += r.durationMinutes / 60;
      bucket.byPlatform[r.platform] += r.durationMinutes / 60;
      bucket.sessionCount += 1;
      if (r.lateMinutes > 0) bucket.lateCount += 1;
      if (r.underMinDuration) bucket.underMinDurationCount += 1;
    }
  }

  return [...byEmployee.values()]
    .map((b) => ({
      ...b,
      totalHours: Math.round(b.totalHours * 10) / 10,
      byPlatform: {
        tiktok: Math.round(b.byPlatform.tiktok * 10) / 10,
        facebook: Math.round(b.byPlatform.facebook * 10) / 10,
      },
    }))
    .sort((a, b) => b.totalHours - a.totalHours);
}
