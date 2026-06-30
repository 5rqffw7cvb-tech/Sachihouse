import { apiRequest } from './api';
import { BillingCycle, HostPlanCode, SubscriptionRequest, SubscriptionRequestStatus } from '../types';

export async function createSubscriptionRequest(planCode: HostPlanCode, billingCycle: BillingCycle): Promise<SubscriptionRequest> {
  const response = await apiRequest<{ request: SubscriptionRequest }>('/subscription-requests', {
    method: 'POST',
    body: JSON.stringify({ planCode, billingCycle }),
  });
  return response.request;
}

export async function listMySubscriptionRequests(): Promise<SubscriptionRequest[]> {
  const response = await apiRequest<{ requests: SubscriptionRequest[] }>('/subscription-requests/mine');
  return response.requests;
}

export async function listSubscriptionRequests(status?: SubscriptionRequestStatus): Promise<SubscriptionRequest[]> {
  const query = status ? `?status=${status}` : '';
  const response = await apiRequest<{ requests: SubscriptionRequest[] }>(`/subscription-requests${query}`);
  return response.requests;
}

export async function approveSubscriptionRequest(id: string): Promise<SubscriptionRequest> {
  const response = await apiRequest<{ request: SubscriptionRequest }>(`/subscription-requests/${id}/approve`, {
    method: 'POST',
  });
  return response.request;
}

export async function rejectSubscriptionRequest(id: string): Promise<SubscriptionRequest> {
  const response = await apiRequest<{ request: SubscriptionRequest }>(`/subscription-requests/${id}/reject`, {
    method: 'POST',
  });
  return response.request;
}
