import { getAbnormalOrderConfig } from './abnormalOrderConfig';
import { getProductPriceConfigMap, type ProductPriceConfig } from './productPriceConfig';
import { sendZaloText } from './zalo-bot.service';

type VariationField = { name?: string; value?: string };

type OrderItem = {
  variation_info?: {
    name?: string;
    fields?: VariationField[];
    retail_price?: number;
    display_id?: string;
    product_display_id?: string;
  };
  discount_each_product?: number;
  quantity?: number;
};

type AdvancedPlatformFee = Record<string, number>;

type OrderPayload = {
  id?: string;
  total_price?: number;
  total_price_after_sub_discount?: number;
  fee_marketplace?: number;
  advanced_platform_fee?: AdvancedPlatformFee | null;
  items?: OrderItem[];
  order_link?: string;
  order_sources_name?: string;
  bill_full_name?: string;
  inserted_at?: string;
};

const WHOLESALE_CUSTOMER_NAME = 'sỉ thái ngân';
const PLATFORM_SOURCES = new Set(['shopee', 'tiktok']);
const OFF_PLATFORM_SOURCES = new Set(['zalo', 'facebook']);

type PriceChannel = 'platform' | 'off-platform' | 'wholesale' | null;

function classifyPriceChannel(order: OrderPayload): PriceChannel {
  const source = (order.order_sources_name ?? '').trim().toLowerCase();
  const buyer = (order.bill_full_name ?? '').trim().toLowerCase();
  if (source === 'zalo' && buyer === WHOLESALE_CUSTOMER_NAME) return 'wholesale';
  if (PLATFORM_SOURCES.has(source)) return 'platform';
  if (OFF_PLATFORM_SOURCES.has(source)) return 'off-platform';
  return null;
}

/** So sánh giá bán thực tế và giá nhập của từng sản phẩm trong đơn với bảng giá cấu hình. */
export function checkPriceRuleViolations(
  order: OrderPayload,
  priceMap: Map<string, ProductPriceConfig>
): string[] {
  const reasons: string[] = [];
  const items = order.items ?? [];
  const channel = classifyPriceChannel(order);

  let totalCost = 0;
  let hasCostData = false;

  for (const item of items) {
    const productCode = item.variation_info?.product_display_id;
    if (!productCode) continue;
    const cfg = priceMap.get(productCode);
    if (!cfg) continue;

    const qty = Number(item.quantity ?? 1) || 1;
    const retail = Number(item.variation_info?.retail_price ?? 0);
    const discount = Number(item.discount_each_product ?? 0);
    const unitPrice = retail - discount / qty;
    const itemName = item.variation_info?.name ?? productCode;

    if (cfg.costPrice > 0) {
      totalCost += cfg.costPrice * qty;
      hasCostData = true;
    }

    if (channel === 'platform' && cfg.platformPrice > 0 && unitPrice < cfg.platformPrice) {
      reasons.push(
        `🚫 "${itemName}" bán ${fmtMoney(unitPrice)} thấp hơn giá bán trên sàn ${fmtMoney(cfg.platformPrice)}`
      );
    } else if (channel === 'off-platform' && cfg.offPlatformPrice > 0 && unitPrice < cfg.offPlatformPrice) {
      reasons.push(
        `🚫 "${itemName}" bán ${fmtMoney(unitPrice)} thấp hơn giá bán ngoài sàn ${fmtMoney(cfg.offPlatformPrice)}`
      );
    } else if (channel === 'wholesale' && cfg.wholesalePrice > 0 && unitPrice < cfg.wholesalePrice) {
      reasons.push(
        `🚫 "${itemName}" bán ${fmtMoney(unitPrice)} thấp hơn giá sỉ ${fmtMoney(cfg.wholesalePrice)}`
      );
    }
  }

  const revenue = Number(order.total_price_after_sub_discount ?? 0);
  if (hasCostData && revenue > 0 && revenue < totalCost) {
    reasons.push(
      `🚫 Doanh thu nhận về ${fmtMoney(revenue)} thấp hơn tổng giá nhập ${fmtMoney(totalCost)}`
    );
  }

  return reasons;
}

function fmtMoney(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.') + 'đ';
}

function fmtDate(isoStr?: string): string {
  if (!isoStr) return '—';
  try {
    const vnD = new Date(new Date(isoStr).getTime() + 7 * 3_600_000);
    const dd = String(vnD.getUTCDate()).padStart(2, '0');
    const mm = String(vnD.getUTCMonth() + 1).padStart(2, '0');
    const yyyy = vnD.getUTCFullYear();
    const hh = String(vnD.getUTCHours()).padStart(2, '0');
    const min = String(vnD.getUTCMinutes()).padStart(2, '0');
    return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
  } catch {
    return isoStr;
  }
}

function sumApf(apf: AdvancedPlatformFee | null | undefined): number {
  if (!apf) return 0;
  return Object.values(apf).reduce((s, v) => s + (Number(v) || 0), 0);
}

function describeApf(apf: AdvancedPlatformFee | null | undefined): string {
  if (!apf || Object.keys(apf).length === 0) return '0đ';
  const parts = Object.entries(apf).map(([k, v]) => {
    const label = k === 'marketplace_voucher' ? 'voucher sàn' : k;
    return `${fmtMoney(Number(v) || 0)} (${label})`;
  });
  return parts.join(', ');
}

function getItemAttrs(fields?: VariationField[]): string {
  if (!fields?.length) return '';
  const size = fields.find((f) => /size|kích/i.test(f.name ?? ''))?.value ?? '';
  const color = fields.find((f) => /màu/i.test(f.name ?? ''))?.value ?? '';
  return [size, color].filter(Boolean).join('/');
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

export function formatAbnormalOrderMessage(
  order: OrderPayload,
  thresholdPct: number,
  priceReasons: string[] = []
): string {
  const totalPrice = Number(order.total_price ?? 0);
  const afterDiscount = Number(order.total_price_after_sub_discount ?? 0);
  const feeMarket = Number(order.fee_marketplace ?? 0);
  const apfTotal = sumApf(order.advanced_platform_fee);
  const items = order.items ?? [];

  const totalItemDiscount = items.reduce(
    (sum, it) => sum + (Number(it.discount_each_product) || 0), 0
  );
  const netSellerDiscount = totalItemDiscount - apfTotal;
  const pct = totalPrice > 0 ? Math.round((afterDiscount / totalPrice) * 1000) / 10 : 0;

  const SEP = '━━━━━━━━━━━━━━━━━━━━━━━';
  const DIV = '  ─────────────────────';

  const lines: string[] = [
    '⚠️ CẢNH BÁO ĐƠN HÀNG BẤT THƯỜNG',
    SEP,
    `🛍 Nguồn: ${order.order_sources_name ?? '—'}`,
    `📅 ${fmtDate(order.inserted_at)}`,
  ];

  if (order.order_link) lines.push(`🔗 ${order.order_link}`);

  if (priceReasons.length > 0) {
    lines.push('', SEP, '💲 Vi phạm bảng giá:', ...priceReasons);
  }

  lines.push(
    '',
    `💰 Giá gốc:          ${fmtMoney(totalPrice)}`,
    `💸 Sau chiết khấu:   ${fmtMoney(afterDiscount)}`,
    `📉 Tỷ lệ:            ${pct}%  ← ngưỡng cảnh báo < ${thresholdPct}%`,
    '',
    SEP,
    '🧮 Cách tính giá sau chiết khấu:',
    `  Giá gốc:           + ${fmtMoney(totalPrice)}`,
    `  Chiết khấu thực:   - ${fmtMoney(netSellerDiscount)}`,
    `    (Giảm SP ${fmtMoney(totalItemDiscount)} − Sàn trợ giá ${fmtMoney(apfTotal)})`,
    `  Phí sàn:           - ${fmtMoney(feeMarket)}`,
    DIV,
    `  Kết quả:             ${fmtMoney(afterDiscount)}`,
    '',
    SEP,
    '📋 Chi tiết phí & chiết khấu:',
    `  Phí sàn (fee_marketplace):        ${fmtMoney(feeMarket)}`,
    `  Sàn trợ giá (advanced_fee):       ${describeApf(order.advanced_platform_fee)}`,
    `  Giảm giá sản phẩm (tổng):        ${fmtMoney(totalItemDiscount)}`,
    `  Chiết khấu thực người bán chịu:   ${fmtMoney(netSellerDiscount)}`,
  );

  if (items.length > 0) {
    lines.push('', SEP, `🛒 Sản phẩm (${items.length}):`);
    items.forEach((item, i) => {
      const info = item.variation_info;
      const name = truncate(info?.name ?? '(không rõ)', 70);
      const attrs = getItemAttrs(info?.fields);
      const qty = Number(item.quantity ?? 1);
      const price = Number(info?.retail_price ?? 0);
      const discount = Number(item.discount_each_product ?? 0);

      let row = `${i + 1}. ${name}`;
      if (attrs) row += ` (${attrs})`;
      if (qty > 1) row += ` x${qty}`;
      lines.push(row);

      const details: string[] = [];
      if (price > 0) details.push(`Giá: ${fmtMoney(price)}`);
      if (discount > 0) details.push(`Giảm: ${fmtMoney(discount)}`);
      if (details.length > 0) lines.push(`   ${details.join('  |  ')}`);
    });
  }

  return lines.join('\n');
}

const MOCK_ORDER: OrderPayload = {
  id: 'mock-001',
  total_price: 850000,
  total_price_after_sub_discount: 366995,
  fee_marketplace: 33005,
  advanced_platform_fee: { marketplace_voucher: 30000 },
  items: [
    {
      variation_info: {
        name: 'A0385 - SET LEN HÀN MEIT – Effortless Elegance',
        fields: [
          { name: 'Size', value: 'M' },
          { name: 'Màu sắc', value: 'Đen' },
        ],
        retail_price: 850000,
        display_id: 'A0385MDEN',
        product_display_id: 'A0385',
      },
      discount_each_product: 480000,
      quantity: 1,
    },
    {
      variation_info: {
        name: 'Hộp đựng cao cấp MEIT CLUB',
        retail_price: 0,
      },
      discount_each_product: 0,
      quantity: 1,
    },
  ],
  order_link: 'https://pos.pages.fm/shop/1021314908/order?order_id=mock-001',
  order_sources_name: 'Tiktok',
  inserted_at: new Date().toISOString(),
};

// Dedup: one alert per order ID within 10 minutes
const DEDUP_TTL_MS = 10 * 60 * 1000;
const alertedOrders = new Map<string, number>(); // orderId → sentAt timestamp

function isRecentlyAlerted(orderId: string): boolean {
  const ts = alertedOrders.get(orderId);
  if (ts === undefined) return false;
  if (Date.now() - ts > DEDUP_TTL_MS) {
    alertedOrders.delete(orderId);
    return false;
  }
  return true;
}

function markAlerted(orderId: string): void {
  alertedOrders.set(orderId, Date.now());
  // Prune stale entries if the map grows large
  if (alertedOrders.size > 500) {
    const cutoff = Date.now() - DEDUP_TTL_MS;
    for (const [id, ts] of alertedOrders) {
      if (ts < cutoff) alertedOrders.delete(id);
    }
  }
}

export async function sendMockAbnormalOrderAlert(): Promise<{ ok: boolean; error?: string; text?: string }> {
  const config = await getAbnormalOrderConfig();
  const text = formatAbnormalOrderMessage(MOCK_ORDER, config.thresholdPct);
  const result = await sendZaloText(text);
  return { ...result, text };
}

export async function checkAndSendAbnormalOrderAlert(payload: unknown): Promise<void> {
  const order = payload as OrderPayload;
  const orderId = String(order.id ?? '').trim();
  const totalPrice = Number(order.total_price ?? 0);
  const afterDiscount = Number(order.total_price_after_sub_discount ?? 0);

  if (totalPrice <= 0) return;

  if (orderId && isRecentlyAlerted(orderId)) {
    console.log(`[abnormal-order] Bỏ qua trùng lặp id=${orderId}`);
    return;
  }

  const config = await getAbnormalOrderConfig();
  if (!config.enabled) return;

  const priceMap = await getProductPriceConfigMap();
  const priceReasons = priceMap.size > 0 ? checkPriceRuleViolations(order, priceMap) : [];

  const pct = (afterDiscount / totalPrice) * 100;
  const pctTriggered = pct < config.thresholdPct;

  if (!pctTriggered && priceReasons.length === 0) return;

  if (orderId) markAlerted(orderId);

  const text = formatAbnormalOrderMessage(order, config.thresholdPct, priceReasons);
  const result = await sendZaloText(text);
  if (!result.ok) {
    console.error(`[abnormal-order] Lỗi gửi cảnh báo Zalo: ${result.error ?? ''}`);
  } else {
    console.log(
      `[abnormal-order] Cảnh báo đã gửi — id=${orderId || '?'} tỷ lệ=${pct.toFixed(1)}%`
    );
  }
}
