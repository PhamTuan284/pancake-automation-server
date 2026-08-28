import { Router } from 'express';
import { getLiveVideos } from './facebook.controller';
import { requireAuth } from '../../common/auth.middleware';

export const facebookRouter = Router();

facebookRouter.get('/facebook/live-videos', requireAuth, (req, res) => {
  void getLiveVideos(req, res);
});
