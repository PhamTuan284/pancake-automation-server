/**
 * Payroll domain types, shared by the engine, the Excel importer/exporter and
 * the service. Employee codes (MT001, CTV001…) are the same codes used in the
 * monthly payroll workbook so the two stay in sync.
 */

export const PAYROLL_TEAMS = ['Live', 'Media', 'Marketing', 'Sale', 'Kho', 'Kế toán', 'Mẫu'] as const;
export type PayrollTeam = (typeof PAYROLL_TEAMS)[number];

/** `hdld` = signed labour contract (insurance + progressive PIT); `ctv` = collaborator (10% withholding). */
export type ContractType = 'hdld' | 'ctv';

/**
 * Which column of the "LƯƠNG Txx" sheet an amount lands in:
 * position = Lương vị trí, performance = Lương hiệu quả, bonus = Thưởng,
 * meal = Tiền ăn ca, ot = Tiền OT/làm đêm.
 */
export const PAY_GROUPS = ['position', 'performance', 'bonus', 'meal', 'ot'] as const;
export type PayGroup = (typeof PAY_GROUPS)[number];

type ComponentBase = { id: string; label: string };

export type PayComponent =
  /**
   * quantity metric × unit rate (công, video, giờ OT, ngày quay, ăn ca…), capped at `max` when set
   * (e.g. lương theo công = MIN(công × 219.231, 5.700.000)).
   */
  | (ComponentBase & { kind: 'qty_rate'; metric: string; rate: number; max?: number; group: PayGroup; taxExempt?: boolean })
  /** flat monthly amount (lương cứng, phí dịch vụ cố định) */
  | (ComponentBase & { kind: 'fixed'; amount: number; group: PayGroup; taxExempt?: boolean })
  /** metric × pct × weight, paid only when metric > threshold (if set) */
  | (ComponentBase & {
      kind: 'percent';
      metric: string;
      pct: number;
      weight?: number;
      threshold?: number;
      group: PayGroup;
    })
  /** baseAmount covers the first includedQty units, each unit above is paid overRate */
  | (ComponentBase & {
      kind: 'kpi_base';
      metric: string;
      baseAmount: number;
      includedQty: number;
      overRate: number;
      group: PayGroup;
    })
  /**
   * Livestream hours. Reads metrics liveHours / nightHours / sundayHours /
   * holidayHours. For HĐLĐ, `standardAmount` (usually the insurance base) is
   * the "lương vị trí" and covers standardAmount / rate hours; the rest is
   * paid at `rate`. Night hours (ca tối quá 2h) are paid rate × nightMultiplier,
   * Sunday hours get a sundayBonusPct top-up, holiday hours rate × holidayMultiplier.
   */
  | (ComponentBase & { kind: 'live_hours'; rate: number; standardAmount?: number });

export type PayComponentKind = PayComponent['kind'];

export type PayrollEmployee = {
  code: string;
  fullName: string;
  team: string;
  position: string;
  contractType: ContractType;
  /** Mức đóng bảo hiểm; 0 = không tham gia bảo hiểm. */
  insuranceBase: number;
  taxCode: string;
  idNumber: string;
  dependents: number;
  /** Optional link to a MeiT Tools login. */
  username: string;
  /** Free-text "cách tính lương" kept from the workbook. */
  payNote: string;
  components: PayComponent[];
  isActive: boolean;
};

export type PayrollEntry = {
  code: string;
  metrics: Record<string, number>;
  /** Thưởng (taxable). */
  bonus: number;
  /** Tạm ứng, subtracted from net. */
  advance: number;
  /** Bù trừ kỳ trước, added to net (negative to deduct). */
  carryOver: number;
  note: string;
  /**
   * Thuế TNCN entered by hand for this month (e.g. "trả ngoài", no withholding);
   * null/undefined = computed. Put the reason in `note`.
   */
  pitOverride?: number | null;
};

export type InsuranceRates = { bhxh: number; bhyt: number; bhtn: number; union: number };

export type PitBracket = { upTo: number | null; rate: number };

export type PayrollSettings = {
  insurance: { employee: InsuranceRates; company: InsuranceRates };
  pit: {
    personalDeduction: number;
    dependentDeduction: number;
    brackets: PitBracket[];
    /** Collaborators are withheld ctvRate when taxable income ≥ ctvThreshold. */
    ctvThreshold: number;
    ctvRate: number;
  };
  live: { nightMultiplier: number; sundayBonusPct: number; holidayMultiplier: number };
};

export const DEFAULT_PAYROLL_SETTINGS: PayrollSettings = {
  insurance: {
    employee: { bhxh: 0.08, bhyt: 0.015, bhtn: 0.01, union: 0 },
    company: { bhxh: 0.175, bhyt: 0.03, bhtn: 0.01, union: 0 },
  },
  pit: {
    personalDeduction: 15_500_000,
    dependentDeduction: 6_200_000,
    brackets: [
      { upTo: 10_000_000, rate: 0.05 },
      { upTo: 30_000_000, rate: 0.1 },
      { upTo: 60_000_000, rate: 0.2 },
      { upTo: 100_000_000, rate: 0.3 },
      { upTo: null, rate: 0.35 },
    ],
    ctvThreshold: 5_000_000,
    ctvRate: 0.1,
  },
  live: { nightMultiplier: 1.3, sundayBonusPct: 0.25, holidayMultiplier: 3 },
};

export type PayLine = {
  componentId: string;
  label: string;
  group: PayGroup;
  qty?: number;
  rate?: number;
  amount: number;
  taxExempt: boolean;
};

export type InsuranceAmounts = InsuranceRates & { total: number };

export type Payslip = {
  code: string;
  fullName: string;
  team: string;
  contractType: ContractType;
  lines: PayLine[];
  groups: Record<PayGroup, number>;
  gross: number;
  taxExempt: number;
  taxableIncome: number;
  insuranceEmployee: InsuranceAmounts;
  insuranceCompany: InsuranceAmounts;
  pit: {
    method: 'progressive' | 'withholding';
    deductions: number;
    assessable: number;
    amount: number;
    /** True when `amount` came from the entry's pitOverride instead of the formula. */
    overridden?: boolean;
  };
  carryOver: number;
  advance: number;
  net: number;
};

/** Human labels for the metrics components read; unknown keys fall back to the component label. */
export const METRIC_LABELS: Record<string, string> = {
  workDays: 'Số công',
  liveHours: 'Giờ live (không gồm lễ)',
  nightHours: 'Giờ live đêm (ca tối quá 2h)',
  sundayHours: 'Giờ live chủ nhật',
  holidayHours: 'Giờ live ngày lễ',
  otHours: 'Giờ OT',
  holidayOtHours: 'Giờ làm ngày lễ',
  videos: 'Số video',
  videosOT: 'Số video OT',
  shootDays: 'Số ngày quay',
  revenueFB: 'Doanh thu FB',
  revenueShopee: 'Doanh thu Shopee',
  revenueTiktok: 'Doanh thu kết chuyển TikTok',
  revenueTiktokLive: 'Doanh thu live TikTok',
  revenueShopeeLive: 'Doanh thu live Shopee',
  revenueVideoChannel: 'Doanh thu kênh video',
  revenueLiveChannel: 'Doanh thu live kênh riêng',
  revenueCompany: 'Doanh thu tổng (sàn)',
  mediaVideoFull: 'Video quay + dựng',
  mediaShootOrEdit: 'Chỉ quay/dựng/chụp look',
  mediaScript: 'Kịch bản/banner',
  mediaOutdoorDays: 'Ngày quay outdoor',
  mediaVideoOver: 'Video vượt KPI',
  mediaShootOrEditExtra: 'Chỉ quay/dựng (thêm)',
  mediaSatellite: 'Quay kênh vệ tinh',
  mediaScriptExtra: 'Kịch bản (thêm)',
  mediaHolidayShoot: 'Quay ngày lễ',
  mediaPhotoPost: 'Chụp - hậu kỳ',
  mediaPhotoEdit: 'Chụp/hậu kỳ ảnh',
};

export const LIVE_METRICS = ['liveHours', 'nightHours', 'sundayHours', 'holidayHours'] as const;

/** Metric keys a component reads, in display order. */
export function componentMetrics(component: PayComponent): string[] {
  switch (component.kind) {
    case 'qty_rate':
    case 'percent':
    case 'kpi_base':
      return [component.metric];
    case 'live_hours':
      return [...LIVE_METRICS];
    case 'fixed':
      return [];
  }
}

export function metricLabel(key: string, fallback?: string): string {
  return METRIC_LABELS[key] ?? fallback ?? key;
}
