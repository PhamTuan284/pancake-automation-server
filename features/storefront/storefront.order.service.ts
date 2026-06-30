import { connectMongo } from '../../common/mongo';
import { StorefrontOrder } from '../../common/models/storefrontOrderModel';
import type {
  StorefrontOrderCustomer,
  StorefrontOrderItem,
} from '../../common/models/storefrontOrderModel';
import { postPancakeOpenApi } from '../pancake-webhook/lib/pancakeWebhook';
import type { InvoiceShopKey } from '../pancake-einvoice/invoiceShops';

export interface CreateOrderInput {
  customer: StorefrontOrderCustomer;
  items: StorefrontOrderItem[];
  shopKey?: InvoiceShopKey;
}

function generateOrderNumber(): string {
  const now = new Date();
  const y = now.getFullYear().toString().slice(-2);
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const rand = Math.floor(Math.random() * 9000) + 1000;
  return `MT${y}${m}${d}-${rand}`;
}

function buildPancakeOrderPayload(
  customer: StorefrontOrderCustomer,
  items: StorefrontOrderItem[]
) {
  const shippingAddress = [customer.ward, customer.district, customer.city]
    .filter(Boolean)
    .join(', ');
  const fullAddress = customer.address
    ? `${customer.address}, ${shippingAddress}`
    : shippingAddress;

  // Pancake Open API field names (confirmed from API response schema)
  return {
    bill_full_name: customer.name,
    bill_phone_number: customer.phone,
    bill_email: customer.email ?? null,
    shipping_address: fullAddress,
    note: customer.note ?? '',
    payment_method: 'cod',
    order_details: items.map((item) => ({
      product_id: item.productId,
      variation_id: item.variantId ?? item.productId,
      quantity: item.quantity,
      price: item.price,
      retail_price: item.price,
    })),
    // Some Pancake API versions use "items" instead of "order_details"
    items: items.map((item) => ({
      product_id: item.productId,
      variation_id: item.variantId ?? item.productId,
      quantity: item.quantity,
      price: item.price,
      retail_price: item.price,
    })),
  };
}

export async function createStorefrontOrder(input: CreateOrderInput) {
  const shopKey = input.shopKey ?? 'meit';
  const subtotal = input.items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );
  const shippingFee = 0;
  const total = subtotal + shippingFee;

  await connectMongo();

  let pancakeOrderId: string | undefined;
  try {
    const pancakePayload = buildPancakeOrderPayload(input.customer, input.items);
    console.log('[storefront order] Sending to Pancake:', JSON.stringify(pancakePayload, null, 2));
    const pancakeResponse = postPancakeOpenApi('/orders', pancakePayload, shopKey) as Promise<Record<string, unknown>>;
    const result = await pancakeResponse.catch((err: unknown) => {
      console.warn('[storefront order] Pancake order push failed (non-fatal):', err);
      return null;
    });
    console.log('[storefront order] Pancake response:', JSON.stringify(result, null, 2));
    if (result && typeof result === 'object') {
      const orderId =
        (result as Record<string, unknown>).id ??
        (result as Record<string, unknown>).order_id ??
        ((result as Record<string, unknown>).order as Record<string, unknown> | undefined)?.id;
      if (orderId) pancakeOrderId = String(orderId);
    }
  } catch (err) {
    console.warn('[storefront order] Pancake order push failed (non-fatal):', err);
  }

  const orderNumber = generateOrderNumber();
  const order = await StorefrontOrder.create({
    orderNumber,
    status: 'pending',
    customer: input.customer,
    items: input.items,
    subtotal,
    shippingFee,
    total,
    paymentMethod: 'cod',
    shopKey,
    pancakeOrderId,
  });

  return order;
}

export async function getStorefrontOrderById(id: string) {
  await connectMongo();
  return StorefrontOrder.findOne({
    $or: [{ _id: id.match(/^[0-9a-f]{24}$/) ? id : undefined }, { orderNumber: id }],
  }).exec();
}
