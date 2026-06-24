import path from 'path';
import express from 'express';
import cors from 'cors';
import { mountRoutes } from './common/mountRoutes';

export function createApp(): express.Express {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  // Serve temp images generated for Zalo photo sends
  app.use('/temp-images', express.static(path.join(process.cwd(), 'public', 'temp-images')));
  mountRoutes(app);
  return app;
}
