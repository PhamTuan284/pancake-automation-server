import express from 'express';
import cors from 'cors';
import { mountRoutes } from './common/mountRoutes';

export function createApp(): express.Express {
  const app = express();
  app.use(cors());
  app.use(express.json());
  mountRoutes(app);
  return app;
}
