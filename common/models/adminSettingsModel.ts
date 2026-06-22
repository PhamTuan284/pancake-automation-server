import mongoose from 'mongoose';

export type TabAccessLevel = 'guest' | 'user' | 'admin';

export type AdminSettingsDoc = {
  /** Minimum role required to see each tab. Unset keys default to 'guest' (everyone). */
  tabAccess: Map<string, TabAccessLevel>;
  botEnabled: {
    telegram: boolean;
    zalo: boolean;
  };
};

const adminSettingsSchema = new mongoose.Schema<AdminSettingsDoc>(
  {
    tabAccess: {
      type: Map,
      of: { type: String, enum: ['guest', 'user', 'admin'] },
      default: () => new Map(),
    },
    botEnabled: {
      telegram: { type: Boolean, default: true },
      zalo: { type: Boolean, default: true },
    },
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
      tabAccess: new Map(),
      botEnabled: { telegram: true, zalo: true },
    });
  }
  return settings;
}
