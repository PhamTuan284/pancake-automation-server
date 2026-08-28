const GRAPH_API_VERSION = 'v21.0';

export class FacebookConfigError extends Error {}

function getConfig() {
  const pageId = process.env.FB_PAGE_ID?.trim();
  const accessToken = process.env.FB_PAGE_ACCESS_TOKEN?.trim();
  if (!pageId || !accessToken) {
    throw new FacebookConfigError('Thiếu FB_PAGE_ID hoặc FB_PAGE_ACCESS_TOKEN trong biến môi trường.');
  }
  return { pageId, accessToken };
}

export type FbLiveVideo = {
  id: string;
  status?: string;
  title?: string;
  description?: string;
  creation_time?: string;
  broadcast_start_time?: string;
  permalink_url?: string;
  live_views?: number;
  video?: { id?: string; length?: number; picture?: string };
};

const FIELDS = [
  'id',
  'status',
  'title',
  'description',
  'creation_time',
  'broadcast_start_time',
  'permalink_url',
  'live_views',
  'video{id,length,picture}',
].join(',');

export async function fetchLiveVideos(): Promise<FbLiveVideo[]> {
  const { pageId, accessToken } = getConfig();
  const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/${pageId}/live_videos`);
  url.searchParams.set('fields', FIELDS);
  url.searchParams.set('access_token', accessToken);

  const res = await fetch(url);
  const data = (await res.json()) as { data?: FbLiveVideo[]; error?: { message: string } };
  if (!res.ok || data.error) {
    throw new Error(data.error?.message ?? `Facebook API trả về lỗi HTTP ${res.status}`);
  }
  return data.data ?? [];
}
