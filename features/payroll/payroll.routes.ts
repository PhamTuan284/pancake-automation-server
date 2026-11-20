import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { requireAuth } from '../../common/auth.middleware';
import { ensureMongoConnected } from '../../common/mongo';
import { UserModel } from '../../common/models/userModel';
import {
  downloadEmployees,
  downloadPeriod,
  getEmployees,
  getMeta,
  getPeriodDetail,
  getPeriods,
  postEmployee,
  postImportApply,
  postImportInputs,
  postImportPreview,
  postLock,
  postPeriod,
  postRefreshSettings,
  postUnlock,
  putEmployee,
  putEntries,
  putSettings,
  removeEmployee,
  removePeriod,
} from './payroll.controller';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

function excelUpload(req: Request, res: Response, next: NextFunction): void {
  upload.single('file')(req, res, (err) => {
    if (err) {
      res.status(400).json({ ok: false, error: err.message || 'Upload lỗi' });
      return;
    }
    next();
  });
}

/**
 * Salaries are sensitive: admins plus active accounts in the Accountant
 * department (the accountant enters the month's figures and exports the
 * workbook). The department isn't in the JWT, so it is read from the user.
 */
function requirePayrollAccess(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if (req.auth?.role === 'admin') {
      next();
      return;
    }
    ensureMongoConnected()
      .then(() => UserModel.findById(req.auth!.userId).lean())
      .then((user) => {
        if (user?.isActive && user.department === 'Accountant') next();
        else res.status(403).json({ ok: false, error: 'Chỉ admin hoặc kế toán được xem bảng lương.' });
      })
      .catch(() => res.status(403).json({ ok: false, error: 'Không kiểm tra được quyền truy cập.' }));
  });
}

export const payrollRouter = Router();

payrollRouter.get('/payroll/meta', requirePayrollAccess, getMeta);
payrollRouter.put('/payroll/settings', requirePayrollAccess, putSettings);

payrollRouter.get('/payroll/employees', requirePayrollAccess, getEmployees);
payrollRouter.get('/payroll/employees/export', requirePayrollAccess, downloadEmployees);
payrollRouter.post('/payroll/employees', requirePayrollAccess, postEmployee);
payrollRouter.put('/payroll/employees/:code', requirePayrollAccess, putEmployee);
payrollRouter.delete('/payroll/employees/:code', requirePayrollAccess, removeEmployee);

payrollRouter.post('/payroll/import/preview', requirePayrollAccess, excelUpload, postImportPreview);
payrollRouter.post('/payroll/import/apply', requirePayrollAccess, excelUpload, postImportApply);

payrollRouter.get('/payroll/periods', requirePayrollAccess, getPeriods);
payrollRouter.post('/payroll/periods', requirePayrollAccess, postPeriod);
payrollRouter.get('/payroll/periods/:month', requirePayrollAccess, getPeriodDetail);
payrollRouter.delete('/payroll/periods/:month', requirePayrollAccess, removePeriod);
payrollRouter.put('/payroll/periods/:month/entries', requirePayrollAccess, putEntries);
payrollRouter.post('/payroll/periods/:month/inputs', requirePayrollAccess, excelUpload, postImportInputs);
payrollRouter.post('/payroll/periods/:month/refresh-settings', requirePayrollAccess, postRefreshSettings);
payrollRouter.post('/payroll/periods/:month/lock', requirePayrollAccess, postLock);
payrollRouter.post('/payroll/periods/:month/unlock', requirePayrollAccess, postUnlock);
payrollRouter.get('/payroll/periods/:month/export', requirePayrollAccess, downloadPeriod);
