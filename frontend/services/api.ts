export interface ApiUser {
  id: number;
  name: string;
  email: string;
  role: 'ADMIN' | 'HOST' | 'GUEST';
  canEditBlog: boolean;
  archivedAt?: number | null;
  assignedPropertyIds: string[];
  hostLevel: 1 | 2 | 3 | 4 | null;
  lastSeenAt?: number | null;
}

export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly body?: unknown) {
    super(message);
  }
}

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001/api';
const TOKEN_KEY = 'sachihouse_api_token';
const USER_KEY = 'sachihouse_api_user';

export function getStoredToken(): string | null {
  return window.localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): ApiUser | null {
  const raw = window.localStorage.getItem(USER_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ApiUser>;
    if (typeof parsed.id !== 'number' || typeof parsed.email !== 'string' || typeof parsed.role !== 'string') {
      return null;
    }

    return {
      id: parsed.id,
      name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name : parsed.email.split('@')[0],
      email: parsed.email,
      role: parsed.role as ApiUser['role'],
      canEditBlog: Boolean(parsed.canEditBlog),
      archivedAt: typeof parsed.archivedAt === 'number' ? parsed.archivedAt : null,
      assignedPropertyIds: Array.isArray(parsed.assignedPropertyIds) ? parsed.assignedPropertyIds : [],
      hostLevel: ([1, 2, 3, 4] as (number | null)[]).includes(parsed.hostLevel as number) ? (parsed.hostLevel as 1 | 2 | 3 | 4) : null,
    };
  } catch {
    return null;
  }
}

export function storeSession(token: string, user: ApiUser): void {
  window.localStorage.setItem(TOKEN_KEY, token);
  window.localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession(): void {
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }

  const token = getStoredToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const rawText = await response.text();
  let body: unknown;
  if (rawText) {
    try {
      body = JSON.parse(rawText);
    } catch {
      body = rawText;
    }
  }

  if (!response.ok) {
    const message = typeof body === 'object' && body && 'error' in body ? String((body as { error: string }).error) : `Request failed: ${response.status}`;
    throw new ApiError(message, response.status, body);
  }

  // Guard against misconfigured API base URL returning HTML/text with 200 status.
  if (!body || typeof body === 'string') {
    throw new ApiError('API returned unexpected response format. Verify VITE_API_BASE_URL points to backend /api.', response.status, body);
  }

  return body as T;
}
