import { fetchPancakeOpenApi } from './pancakeWebhook';
import type { InvoiceShopKey } from '../../pancake-einvoice/invoiceShops';

export type EmployeeProductivityRow = {
  rank: number;
  employeeId: string;
  employeeName: string;
  orderCount: number;
  totalRevenue: number;
  avgOrderValue: number;
  cancelledCount: number;
};

export type EmployeeProductivityResult = {
  windowDays: number;
  from: string;
  to: string;
  totalOrders: number;
  rows: EmployeeProductivityRow[];
};

export type EmployeeRole = 'seller' | 'care' | 'creator';

function trimString(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeDays(days?: unknown): number {
  const n = Number(days);
  if (!Number.isInteger(n) || n <= 0) return 30;
  return Math.min(n, 90);
}

function normalizeRole(role?: unknown): EmployeeRole {
  const r = trimString(role);
  if (r === 'care' || r === 'creator') return r;
  return 'seller';
}

function extractOrderRows(data: unknown): Record<string, unknown>[] {
  if (!data) return [];
  if (Array.isArray(data)) {
    return data.filter(
      (x): x is Record<string, unknown> =>
        x !== null && typeof x === 'object' && !Array.isArray(x)
    );
  }
  if (typeof data !== 'object') return [];
  const obj = data as Record<string, unknown>;
  for (const key of ['orders', 'data', 'items', 'results', 'list']) {
    const v = obj[key];
    if (Array.isArray(v)) return extractOrderRows(v);
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const nested = extractOrderRows(v);
      if (nested.length > 0) return nested;
    }
  }
  return [];
}

function detectLastPage(
  data: unknown,
  currentPage: number,
  pageSize: number,
  rowCount: number
): number {
  if (rowCount < pageSize) return currentPage;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return currentPage;
  const obj = data as Record<string, unknown>;

  function tryMeta(o: Record<string, unknown>): number | null {
    for (const metaKey of ['meta', 'pagination']) {
      const m = o[metaKey];
      if (!m || typeof m !== 'object' || Array.isArray(m)) continue;
      const meta = m as Record<string, unknown>;
      const lp = Number(
        meta.last_page ?? meta.num_pages ?? meta.total_pages ?? meta.pages
      );
      if (Number.isInteger(lp) && lp > 0) return lp;
      const inner = meta.pagination;
      if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
        const ip = inner as Record<string, unknown>;
        const ilp = Number(ip.last_page ?? ip.num_pages ?? ip.total_pages);
        if (Number.isInteger(ilp) && ilp > 0) return ilp;
      }
    }
    return null;
  }

  const fromTop = tryMeta(obj);
  if (fromTop !== null) return fromTop;
  const nested = obj.data;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    const fromData = tryMeta(nested as Record<string, unknown>);
    if (fromData !== null) return fromData;
  }
  return Number.MAX_SAFE_INTEGER;
}

async function fetchOrdersPaginated(
  baseQuery: URLSearchParams,
  shopKey: InvoiceShopKey,
  options: { pageSize?: number; maxPages?: number } = {}
): Promise<Record<string, unknown>[]> {
  const { pageSize = 100, maxPages = 20 } = options;
  const all: Record<string, unknown>[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const q = new URLSearchParams(baseQuery);
    q.set('page_number', String(page));
    q.set('page_size', String(pageSize));
    const data = await fetchPancakeOpenApi('/orders', q, shopKey);
    const rows = extractOrderRows(data);
    all.push(...rows);
    console.log(
      `[emp-productivity] orders page=${page} got=${rows.length} total=${all.length}`
    );
    const lastPage = detectLastPage(data, page, pageSize, rows.length);
    if (rows.length === 0 || page >= lastPage) break;
  }

  return all;
}

function extractStaff(
  order: Record<string, unknown>,
  role: EmployeeRole
): { id: string; name: string } | null {
  const key =
    role === 'care'
      ? 'assigning_care'
      : role === 'creator'
        ? 'creator'
        : 'assigning_seller';
  const staff = order[key];
  if (!staff || typeof staff !== 'object' || Array.isArray(staff)) return null;
  const s = staff as Record<string, unknown>;
  const id = trimString(s.id ?? s.fb_id);
  const name = trimString(s.name);
  if (!id && !name) return null;
  return { id: id || name, name: name || id };
}

function isCancelled(order: Record<string, unknown>): boolean {
  const status = Number(order.status);
  // 8 = returned, 9 = cancelled
  return status === 8 || status === 9;
}

export async function computeEmployeeProductivity(options?: {
  days?: unknown;
  shopKey?: InvoiceShopKey;
  role?: unknown;
}): Promise<EmployeeProductivityResult> {
  const windowDays = normalizeDays(options?.days);
  const role = normalizeRole(options?.role);
  const to = new Date();
  const from = new Date(to.getTime() - windowDays * 24 * 60 * 60 * 1000);

  const q = new URLSearchParams();
  q.set('startDateTime', String(Math.floor(from.getTime() / 1000)));
  q.set('endDateTime', String(Math.floor(to.getTime() / 1000)));
  q.set('updateStatus', 'inserted_at');

  const orders = await fetchOrdersPaginated(q, options?.shopKey ?? 'meit');

  type AccEntry = {
    name: string;
    orderCount: number;
    totalRevenue: number;
    cancelledCount: number;
  };
  const acc = new Map<string, AccEntry>();

  for (const order of orders) {
    const staff = extractStaff(order, role);
    if (!staff) continue;

    const entry: AccEntry = acc.get(staff.id) ?? {
      name: staff.name,
      orderCount: 0,
      totalRevenue: 0,
      cancelledCount: 0,
    };

    entry.orderCount += 1;
    if (isCancelled(order)) {
      entry.cancelledCount += 1;
    } else {
      const revenue = Number(order.total_price ?? 0);
      if (Number.isFinite(revenue) && revenue > 0) {
        entry.totalRevenue += revenue;
      }
    }

    acc.set(staff.id, entry);
  }

  const rows: EmployeeProductivityRow[] = [...acc.entries()]
    .map(([employeeId, e]) => {
      const activeCount = e.orderCount - e.cancelledCount;
      return {
        rank: 0,
        employeeId,
        employeeName: e.name,
        orderCount: e.orderCount,
        totalRevenue: Math.round(e.totalRevenue),
        avgOrderValue:
          activeCount > 0 ? Math.round(e.totalRevenue / activeCount) : 0,
        cancelledCount: e.cancelledCount,
      };
    })
    .sort(
      (a, b) =>
        b.orderCount - a.orderCount || b.totalRevenue - a.totalRevenue
    );

  rows.forEach((row, i) => {
    row.rank = i + 1;
  });

  return {
    windowDays,
    from: from.toISOString(),
    to: to.toISOString(),
    totalOrders: orders.length,
    rows,
  };
}
