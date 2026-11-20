import type { Request, Response } from 'express';
import { ensureMongoConnected } from '../../common/mongo';
import {
  PayrollInputError,
  PayrollNotFoundError,
  applyWorkbookImport,
  createPeriod,
  deleteEmployee,
  deletePeriod,
  exportEmployees,
  exportPeriod,
  getPeriod,
  getSettings,
  importInputSheet,
  listEmployees,
  listPeriods,
  lockPeriod,
  previewWorkbookImport,
  refreshPeriodSettings,
  saveEmployee,
  saveEntries,
  unlockPeriod,
  updateSettings,
} from './payroll.service';
import { PAYROLL_TEAMS, METRIC_LABELS } from './payroll.types';

function sendError(res: Response, err: unknown, fallback: string, tag: string): void {
  if (err instanceof PayrollInputError) {
    res.status(400).json({ ok: false, error: err.message });
    return;
  }
  if (err instanceof PayrollNotFoundError) {
    res.status(404).json({ ok: false, error: err.message });
    return;
  }
  console.error(`[payroll/${tag}]`, err);
  res.status(500).json({ ok: false, error: err instanceof Error ? err.message : fallback });
}

type Handler = (req: Request, res: Response) => Promise<void>;

/** Shared wrapper: connect Mongo, run, wrap result as `{ ok: true, ...payload }`, map errors to HTTP codes. */
function handler(tag: string, fallback: string, run: (req: Request) => Promise<Record<string, unknown>>): Handler {
  return async (req, res) => {
    try {
      await ensureMongoConnected();
      res.json({ ok: true, ...(await run(req)) });
    } catch (err) {
      sendError(res, err, fallback, tag);
    }
  };
}

function fileHandler(tag: string, fallback: string, run: (req: Request) => Promise<{ buffer: Buffer; filename: string }>): Handler {
  return async (req, res) => {
    try {
      await ensureMongoConnected();
      const { buffer, filename } = await run(req);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
      // Cross-origin in dev/prod (UI and API on different hosts): let the browser read the file name.
      res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
      res.send(buffer);
    } catch (err) {
      sendError(res, err, fallback, tag);
    }
  };
}

const body = (req: Request) => (req.body || {}) as Record<string, unknown>;

function uploaded(req: Request): Buffer {
  const file = (req as Request & { file?: { buffer: Buffer } }).file;
  if (!file?.buffer?.length) throw new PayrollInputError('Chưa chọn file Excel.');
  return file.buffer;
}

export const getMeta = handler('meta', 'Không thể tải cấu hình.', async () => ({
  teams: PAYROLL_TEAMS,
  metricLabels: METRIC_LABELS,
  settings: await getSettings(),
}));

export const putSettings = handler('settings', 'Không thể lưu cài đặt.', async (req) => ({
  settings: await updateSettings(req.auth!, body(req).settings),
}));

export const getEmployees = handler('employees', 'Không thể tải danh sách nhân viên.', async () => ({
  employees: await listEmployees(),
}));

export const postEmployee = handler('employee-create', 'Không thể thêm nhân viên.', async (req) => ({
  employee: await saveEmployee(req.auth!, null, body(req)),
}));

export const putEmployee = handler('employee-update', 'Không thể lưu nhân viên.', async (req) => ({
  employee: await saveEmployee(req.auth!, req.params.code, body(req)),
}));

export const removeEmployee = handler('employee-delete', 'Không thể xóa nhân viên.', async (req) => {
  await deleteEmployee(req.auth!, req.params.code);
  return {};
});

export const getPeriods = handler('periods', 'Không thể tải kỳ lương.', async () => ({ periods: await listPeriods() }));

export const getPeriodDetail = handler('period', 'Không thể tải kỳ lương.', async (req) => ({
  period: await getPeriod(req.params.month),
}));

export const postPeriod = handler('period-create', 'Không thể tạo kỳ lương.', async (req) => ({
  period: await createPeriod(req.auth!, body(req).month),
}));

export const removePeriod = handler('period-delete', 'Không thể xóa kỳ lương.', async (req) => {
  await deletePeriod(req.auth!, req.params.month);
  return {};
});

export const putEntries = handler('entries', 'Không thể lưu số liệu.', async (req) => ({
  period: await saveEntries(req.auth!, req.params.month, body(req).entries),
}));

export const postRefreshSettings = handler('period-settings', 'Không thể áp cài đặt.', async (req) => ({
  period: await refreshPeriodSettings(req.auth!, req.params.month),
}));

export const postLock = handler('lock', 'Không thể chốt kỳ lương.', async (req) => ({
  period: await lockPeriod(req.auth!, req.params.month),
}));

export const postUnlock = handler('unlock', 'Không thể mở chốt kỳ lương.', async (req) => ({
  period: await unlockPeriod(req.auth!, req.params.month),
}));

export const postImportPreview = handler('import-preview', 'Không đọc được file Excel.', async (req) => ({
  preview: await previewWorkbookImport(uploaded(req)),
}));

export const postImportApply = handler('import-apply', 'Không thể import file Excel.', async (req) => ({
  result: await applyWorkbookImport(req.auth!, uploaded(req), { withEntries: body(req).withEntries !== 'false' }),
}));

export const postImportInputs = handler('import-inputs', 'Không thể import số liệu.', async (req) => ({
  period: await importInputSheet(req.auth!, req.params.month, uploaded(req)),
}));

export const downloadPeriod = fileHandler('export-period', 'Không thể xuất Excel.', async (req) => {
  const [yyyy, mm] = req.params.month.split('-');
  return { buffer: await exportPeriod(req.params.month), filename: `BẢNG LƯƠNG_${mm}${yyyy}.xlsx` };
});

export const downloadEmployees = fileHandler('export-employees', 'Không thể xuất Excel.', async () => ({
  buffer: await exportEmployees(),
  filename: 'Thông tin lao động.xlsx',
}));
