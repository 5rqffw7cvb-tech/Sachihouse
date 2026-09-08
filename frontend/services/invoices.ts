import { apiRequest } from './api';
import {
  HostInvoiceSettings,
  Invoice,
  InvoiceCandidate,
  InvoiceLineItem,
  InvoiceSourceKind,
  InvoiceTaxCategory,
} from '../types';

/**
 * Qualified-invoice (適格請求書) API, host level 4 only.
 *
 * Everything here is refused with 403 below that level, so callers should gate
 * the UI on hasAccess(user, 'finance') rather than showing a button that ends
 * in an error toast.
 */

export interface InvoiceSettingsResponse {
  settings: HostInvoiceSettings | null;
  /** False when no invoice bucket is configured — the host's download is then
   *  the only copy, and the UI has to say so. */
  archiveConfigured: boolean;
  /** The bucket the server resolved, shown so "did my env var take effect?" is
   *  answerable from the screen rather than from deployment variables. */
  archiveBucket: string | null;
}

export async function getInvoiceSettings(): Promise<InvoiceSettingsResponse> {
  return apiRequest<InvoiceSettingsResponse>('/invoice-settings');
}

export interface SaveInvoiceSettingsPayload {
  registrationNumber: string;
  issuerName: string;
  issuerAddress: string;
  issuerPhone?: string;
  issuerEmail?: string;
  bankInfo?: string;
  invoicePrefix?: string;
  roundingMode?: HostInvoiceSettings['roundingMode'];
  defaultTaxCategory?: InvoiceTaxCategory;
  defaultNotes?: string;
}

export async function saveInvoiceSettings(
  payload: SaveInvoiceSettingsPayload,
): Promise<InvoiceSettingsResponse> {
  return apiRequest<InvoiceSettingsResponse>('/invoice-settings', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export interface InvoiceStayFilters {
  propertyId?: string;
  fromDate?: string;
  toDate?: string;
}

/** Every stay the host could invoice — OTA imports included, not just ours. */
export async function listInvoiceStays(filters?: InvoiceStayFilters): Promise<InvoiceCandidate[]> {
  const query = new URLSearchParams();
  if (filters?.propertyId) query.set('propertyId', filters.propertyId);
  if (filters?.fromDate) query.set('fromDate', filters.fromDate);
  if (filters?.toDate) query.set('toDate', filters.toDate);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  const res = await apiRequest<{ stays: InvoiceCandidate[] }>(`/invoices/stays${suffix}`);
  return res.stays;
}

export interface CreateInvoicePayload {
  propertyId: string;
  sourceKind: InvoiceSourceKind;
  sourceId?: string;
  sourceLabel?: string;
  checkInDate: string;
  checkOutDate: string;
  customerName: string;
  customerAddress?: string;
  customerEmail?: string;
  customerPhone?: string;
  customerSource: 'checkin' | 'booking' | 'manual';
  checkInSubmissionId?: string;
  issueDate?: string;
  currency?: string;
  lineItems: Array<Omit<InvoiceLineItem, 'id'>>;
  notes?: string;
  /** Set only after the host confirms they really do want a second invoice
   *  for a stay that already has one. */
  allowDuplicate?: boolean;
}

export async function createInvoice(
  payload: CreateInvoicePayload,
): Promise<{ invoice: Invoice; archiveConfigured: boolean }> {
  return apiRequest<{ invoice: Invoice; archiveConfigured: boolean }>('/invoices', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export interface InvoiceListFilters {
  propertyId?: string;
  fromDate?: string;
  toDate?: string;
  status?: 'issued' | 'void';
}

export async function listInvoices(filters?: InvoiceListFilters): Promise<Invoice[]> {
  const query = new URLSearchParams();
  if (filters?.propertyId) query.set('propertyId', filters.propertyId);
  if (filters?.fromDate) query.set('fromDate', filters.fromDate);
  if (filters?.toDate) query.set('toDate', filters.toDate);
  if (filters?.status) query.set('status', filters.status);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  const res = await apiRequest<{ invoices: Invoice[] }>(`/invoices${suffix}`);
  return res.invoices;
}

export async function getInvoice(id: string): Promise<Invoice> {
  const res = await apiRequest<{ invoice: Invoice }>(`/invoices/${id}`);
  return res.invoice;
}

/** Archives an already-rendered PDF into the invoice bucket. */
export async function archiveInvoicePdf(id: string, pdfBase64: string): Promise<Invoice> {
  const res = await apiRequest<{ invoice: Invoice }>(`/invoices/${id}/pdf`, {
    method: 'POST',
    body: JSON.stringify({ pdfBase64 }),
  });
  return res.invoice;
}

/**
 * Removes an invoice and its number outright. Administrators only, and only the
 * newest number an issuer has taken — the server refuses the rest with a 409 so
 * the sequence can never be left with a gap. Void is the remedy for those.
 */
export interface DeleteInvoiceResponse {
  deleted: true;
  /** False when the bucket refused — a retention policy, most often. The
   *  invoice is gone either way, so the caller has to surface this or the file
   *  is left behind with nobody aware of it. */
  fileRemoved: boolean;
  fileError?: string;
}

export async function deleteInvoice(id: string): Promise<DeleteInvoiceResponse> {
  return apiRequest<DeleteInvoiceResponse>(`/invoices/${id}`, { method: 'DELETE' });
}

export async function voidInvoice(id: string, reason: string): Promise<Invoice> {
  const res = await apiRequest<{ invoice: Invoice }>(`/invoices/${id}/void`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
  return res.invoice;
}
