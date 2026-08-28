import mongoose from 'mongoose';

/**
 * Tab access rules: each tool id maps to the list of departments allowed to
 * see it. `'*'` means any logged-in user regardless of department. An empty
 * array means only `role: 'admin'` users (who bypass this check entirely).
 */
export type OfficeWorkHours = {
  checkIn: string; // "HH:mm"
  checkOut: string; // "HH:mm"
  graceMinutes: number;
};

export type AdminSettingsDoc = {
  tabAccess: Map<string, string[]>;
  botEnabled: {
    zalo: boolean;
  };
  officeWorkHours: OfficeWorkHours;
  liveMinSessionMinutes: number;
};

export const DEFAULT_TAB_ACCESS: Record<string, string[]> = {
  'pancake-einvoice-meit': ['Accountant'],
  'pancake-einvoice-dpa': ['Accountant'],
  'pancake-webhook': [],
  leave: ['*'],
  'zalo-bot': [],
  'admin-storefront': [],
  'team-metrics': [],
};

export const DEFAULT_OFFICE_WORK_HOURS: OfficeWorkHours = {
  checkIn: '08:30',
  checkOut: '17:30',
  graceMinutes: 15,
};

export const DEFAULT_LIVE_MIN_SESSION_MINUTES = 90;

const adminSettingsSchema = new mongoose.Schema<AdminSettingsDoc>(
  {
    tabAccess: {
      type: Map,
      of: [String],
      default: () => new Map(Object.entries(DEFAULT_TAB_ACCESS)),
    },
    botEnabled: {
      zalo: { type: Boolean, default: true },
    },
    officeWorkHours: {
      checkIn: { type: String, default: DEFAULT_OFFICE_WORK_HOURS.checkIn },
      checkOut: { type: String, default: DEFAULT_OFFICE_WORK_HOURS.checkOut },
      graceMinutes: { type: Number, default: DEFAULT_OFFICE_WORK_HOURS.graceMinutes, min: 0 },
    },
    liveMinSessionMinutes: { type: Number, default: DEFAULT_LIVE_MIN_SESSION_MINUTES, min: 0 },
  },
  { collection: 'admin_settings' }
);

export const AdminSettingsModel = mongoose.model<AdminSettingsDoc>(
  'AdminSettings',
  adminSettingsSchema
);

export async function getAdminSettings(): Promise<AdminSettingsDoc> {
  let settings = await AdminSettingsModel.findOne();
  if (!settings) {
    settings = await AdminSettingsModel.create({
      tabAccess: new Map(Object.entries(DEFAULT_TAB_ACCESS)),
      botEnabled: { zalo: true },
      officeWorkHours: DEFAULT_OFFICE_WORK_HOURS,
      liveMinSessionMinutes: DEFAULT_LIVE_MIN_SESSION_MINUTES,
    });
  }
  return settings;
}
