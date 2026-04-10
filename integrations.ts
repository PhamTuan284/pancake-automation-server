import type { Request, Response } from 'express';

const PROBE_MS = Math.min(
  Math.max(Number(process.env.MEIT_INTEGRATIONS_PROBE_MS) || 3500, 500),
  15000
);

function trimUrl(s: string): string {
  return s.trim().replace(/\/+$/, '');
}

export function hrmPublicUrl(): string {
  const u = String(process.env.MEIT_HRM_PUBLIC_URL || '').trim();
  if (u) return trimUrl(u);
  const port = String(process.env.MEIT_HRM_PORT || '18080').trim();
  return trimUrl(`http://127.0.0.1:${port}`);
}

export function crmPublicUrl(): string {
  const u = String(process.env.MEIT_CRM_PUBLIC_URL || '').trim();
  if (u) return trimUrl(u);
  const port = String(process.env.MEIT_CRM_PORT || '18081').trim();
  return trimUrl(`http://127.0.0.1:${port}`);
}

async function probe(
  url: string
): Promise<{ reachable: boolean; httpStatus?: number; error?: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { Accept: 'text/html,*/*' },
    });
    const reachable = res.status < 500;
    return { reachable, httpStatus: res.status };
  } catch (e) {
    const error =
      e instanceof Error
        ? e.name === 'AbortError'
          ? 'timeout'
          : e.message
        : String(e);
    return { reachable: false, error };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Single bundle for MeiT UI: where integrations live + whether the API can reach them.
 * Probes run from this Node process (same machine as Docker Desktop → localhost ports).
 */
export async function handleIntegrationsGet(
  _req: Request,
  res: Response
): Promise<void> {
  const hrmUrl = hrmPublicUrl();
  const crmUrl = crmPublicUrl();
  const [hrm, crm] = await Promise.all([probe(hrmUrl), probe(crmUrl)]);
  res.json({
    composeFile: 'docker-compose.integrations.yml',
    envFileExample: 'compose.integrations.env.example',
    npmScript: 'npm run integrations:up (from monorepo root)',
    hrm: {
      product: 'Horilla',
      dockerImage: 'horilla/horilla:1.4',
      url: hrmUrl,
      reachable: hrm.reachable,
      httpStatus: hrm.httpStatus,
      error: hrm.error,
    },
    crm: {
      product: 'EspoCRM',
      dockerImage: 'espocrm/espocrm:latest',
      url: crmUrl,
      reachable: crm.reachable,
      httpStatus: crm.httpStatus,
      error: crm.error,
    },
  });
}
