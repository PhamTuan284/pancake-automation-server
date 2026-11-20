import mongoose from 'mongoose';
import type {
  PayrollEmployee,
  PayrollEntry,
  PayrollSettings,
  Payslip,
} from '../../features/payroll/payroll.types';

/**
 * Payroll collections. Employees are keyed by the workbook's employee code
 * (MT001, CTV001…). A period holds one month's inputs; once locked it also
 * keeps a snapshot of the employees, settings and computed payslips so later
 * edits to rates never rewrite a paid month.
 */

export type PayrollEmployeeDoc = PayrollEmployee & { createdAt: Date; updatedAt: Date };

const payrollEmployeeSchema = new mongoose.Schema<PayrollEmployeeDoc>(
  {
    code: { type: String, required: true, unique: true, trim: true, uppercase: true },
    fullName: { type: String, default: '', trim: true },
    team: { type: String, default: '', trim: true },
    position: { type: String, default: '', trim: true },
    contractType: { type: String, enum: ['hdld', 'ctv'], default: 'ctv' },
    insuranceBase: { type: Number, default: 0, min: 0 },
    taxCode: { type: String, default: '', trim: true },
    idNumber: { type: String, default: '', trim: true },
    dependents: { type: Number, default: 0, min: 0 },
    username: { type: String, default: '', trim: true },
    payNote: { type: String, default: '' },
    components: { type: mongoose.Schema.Types.Mixed, default: () => [] },
    isActive: { type: Boolean, default: true },
  },
  { collection: 'payroll_employees', timestamps: true }
);

export const PayrollEmployeeModel = mongoose.model<PayrollEmployeeDoc>('PayrollEmployee', payrollEmployeeSchema);

export type PayrollPeriodStatus = 'draft' | 'locked';

export type PayrollPeriodDoc = {
  /** "YYYY-MM" */
  month: string;
  status: PayrollPeriodStatus;
  entries: PayrollEntry[];
  settings: PayrollSettings;
  /** Filled on lock. */
  employeesSnapshot: PayrollEmployee[];
  payslips: Payslip[];
  lockedAt?: Date;
  lockedBy?: string;
  createdAt: Date;
  updatedAt: Date;
};

const payrollPeriodSchema = new mongoose.Schema<PayrollPeriodDoc>(
  {
    month: { type: String, required: true, unique: true, match: /^\d{4}-\d{2}$/ },
    status: { type: String, enum: ['draft', 'locked'], default: 'draft' },
    entries: { type: mongoose.Schema.Types.Mixed, default: () => [] },
    settings: { type: mongoose.Schema.Types.Mixed, required: true },
    employeesSnapshot: { type: mongoose.Schema.Types.Mixed, default: () => [] },
    payslips: { type: mongoose.Schema.Types.Mixed, default: () => [] },
    lockedAt: { type: Date },
    lockedBy: { type: String },
  },
  { collection: 'payroll_periods', timestamps: true, minimize: false }
);

export const PayrollPeriodModel = mongoose.model<PayrollPeriodDoc>('PayrollPeriod', payrollPeriodSchema);

type PayrollSettingsDoc = { key: string; settings: PayrollSettings };

const payrollSettingsSchema = new mongoose.Schema<PayrollSettingsDoc>(
  {
    key: { type: String, required: true, unique: true },
    settings: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { collection: 'payroll_settings', minimize: false }
);

export const PayrollSettingsModel = mongoose.model<PayrollSettingsDoc>('PayrollSettings', payrollSettingsSchema);
