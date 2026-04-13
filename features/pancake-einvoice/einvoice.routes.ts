import express from 'express';
import multer from 'multer';
import * as einvoiceController from './einvoice.controller';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/\.(xlsx|xls)$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('Chỉ chấp nhận file .xlsx hoặc .xls'));
    }
  },
});

/** Routes for UI tab: Pancake · Hóa đơn điện tử */
export const einvoiceRouter = express.Router();

einvoiceRouter.get('/invoice-data', (req, res) => {
  void einvoiceController.getInvoiceData(req, res);
});

einvoiceRouter.put('/invoice-data', (req, res) => {
  void einvoiceController.putInvoiceData(req, res);
});

einvoiceRouter.get('/invoice-excel-template', (req, res) => {
  einvoiceController.getInvoiceExcelTemplate(req, res);
});

einvoiceRouter.post('/upload-invoice-excel', (req, res) => {
  upload.single('file')(req, res, (multerErr) => {
    if (multerErr) {
      res.status(400).json({ error: multerErr.message || 'Upload lỗi' });
      return;
    }
    void einvoiceController.postUploadInvoiceExcel(req, res);
  });
});

einvoiceRouter.post('/run-einvoice-automation', (req, res) => {
  void einvoiceController.postRunEinvoiceAutomation(req, res);
});
