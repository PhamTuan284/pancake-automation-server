import express from 'express';
import {
  getSalaryDefaultsController,
  postSalaryCalculateController,
} from './salary.controller';

export const salaryRouter = express.Router();

salaryRouter.get('/salary/defaults', (req, res) => {
  getSalaryDefaultsController(req, res);
});

salaryRouter.post('/salary/calculate', (req, res) => {
  postSalaryCalculateController(req, res);
});
