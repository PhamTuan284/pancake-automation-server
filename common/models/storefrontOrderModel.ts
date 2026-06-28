import mongoose, { Schema } from 'mongoose';

export interface StorefrontOrderItem {
  productId: string;
  productName: string;
  variantId?: string;
  variantName?: string;
  quantity: number;
  price: number;
  image?: string;
}

export interface StorefrontOrderCustomer {
  name: string;
  phone: string;
  email?: string;
  address: string;
  city: string;
  district?: string;
  ward?: string;
  note?: string;
}

export interface StorefrontOrderDocument extends mongoose.Document {
  orderNumber: string;
  status: 'pending' | 'confirmed' | 'processing' | 'shipped' | 'delivered' | 'cancelled';
  customer: StorefrontOrderCustomer;
  items: StorefrontOrderItem[];
  subtotal: number;
  shippingFee: number;
  total: number;
  paymentMethod: 'cod';
  shopKey: string;
  pancakeOrderId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const orderItemSchema = new Schema<StorefrontOrderItem>(
  {
    productId: { type: String, required: true },
    productName: { type: String, required: true },
    variantId: String,
    variantName: String,
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true, min: 0 },
    image: String,
  },
  { _id: false }
);

const customerSchema = new Schema<StorefrontOrderCustomer>(
  {
    name: { type: String, required: true },
    phone: { type: String, required: true },
    email: String,
    address: { type: String, required: true },
    city: { type: String, required: true },
    district: String,
    ward: String,
    note: String,
  },
  { _id: false }
);

const storefrontOrderSchema = new Schema<StorefrontOrderDocument>(
  {
    orderNumber: { type: String, required: true, unique: true, index: true },
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'],
      default: 'pending',
    },
    customer: { type: customerSchema, required: true },
    items: { type: [orderItemSchema], required: true },
    subtotal: { type: Number, required: true, min: 0 },
    shippingFee: { type: Number, required: true, min: 0, default: 0 },
    total: { type: Number, required: true, min: 0 },
    paymentMethod: { type: String, enum: ['cod'], default: 'cod' },
    shopKey: { type: String, required: true, default: 'meit' },
    pancakeOrderId: String,
  },
  { timestamps: true }
);

export const StorefrontOrder = mongoose.model<StorefrontOrderDocument>(
  'StorefrontOrder',
  storefrontOrderSchema
);
