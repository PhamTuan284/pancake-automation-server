import type { Request, Response } from 'express';
import { fetchLiveVideos, FacebookConfigError } from './facebook.service';

export async function getLiveVideos(_req: Request, res: Response) {
  try {
    const videos = await fetchLiveVideos();
    res.json({ videos });
  } catch (err) {
    if (err instanceof FacebookConfigError) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.status(502).json({ error: err instanceof Error ? err.message : 'Lỗi không xác định.' });
  }
}
