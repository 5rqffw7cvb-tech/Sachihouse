import { apiRequest } from './api';
import { Coupon } from '../types';

export type CouponInput = Omit<Coupon, 'id' | 'createdAt' | 'updatedAt'>;

export async function listCoupons(): Promise<Coupon[]> {
  const response = await apiRequest<{ coupons: Coupon[] }>('/coupons');
  return response.coupons;
}

export async function createCoupon(input: CouponInput): Promise<Coupon> {
  const response = await apiRequest<{ coupon: Coupon }>('/coupons', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return response.coupon;
}

export async function updateCoupon(id: string, input: CouponInput): Promise<Coupon> {
  const response = await apiRequest<{ coupon: Coupon }>(`/coupons/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
  return response.coupon;
}

export async function deleteCoupon(id: string): Promise<void> {
  await apiRequest(`/coupons/${id}`, { method: 'DELETE' });
}
