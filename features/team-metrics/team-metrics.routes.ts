import { Router } from 'express';
import multer from 'multer';
import * as liveController from './live/live.controller';
import * as officeController from './office/office.controller';
import { requireAuth } from '../../common/auth.middleware';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/\.(xlsx|xls)$/i.test(file.originalname)) cb(null, true);
    else cb(new Error('Chỉ chấp nhận file Excel (.xlsx/.xls).'));
  },
});

export const teamMetricsRouter = Router();

teamMetricsRouter.post('/team-metrics/live/upload-tiktok', requireAuth, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      res.status(400).json({ error: err.message || 'Upload lỗi.' });
      return;
    }
    void liveController.postUploadTikTok(req, res);
  });
});
teamMetricsRouter.get('/team-metrics/live/report', requireAuth, (req, res) => {
  void liveController.getReport(req, res);
});

teamMetricsRouter.post('/team-metrics/office/upload', requireAuth, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      res.status(400).json({ error: err.message || 'Upload lỗi.' });
      return;
    }
    void officeController.postUploadAttendance(req, res);
  });
});
teamMetricsRouter.get('/team-metrics/office/report', requireAuth, (req, res) => {
  void officeController.getReport(req, res);
});
