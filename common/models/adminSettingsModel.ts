import mongoose from 'mongoose';

/**
 * Tab access rules: each tool id maps to the list of departments allowed to
 * see it. `'*'` means any logged-in user regardless of department. An empty
 * array means only `role: 'admin'` users (who bypass this check entirely).
 */
export type AdminSettingsDoc = {
  tabAccess: Map<string, string[]>;
  botEnabled: {
    zalo: boolean;
  };
};

export const DEFAULT_TAB_ACCESS: Record<string, string[]> = {
  'pancake-einvoice-meit': ['Accountant'],
  'pancake-einvoice-dpa': ['Accountant'],
  'pancake-webhook': [],
  leave: ['*'],
  'zalo-bot': [],
  'admin-storefront': [],
};

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
    });
  }
  return settings;
}
