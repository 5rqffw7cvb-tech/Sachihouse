import { apiRequest, ApiUser, clearSession, getStoredUser, storeSession, storeToken } from './api';

export interface LoginResult {
  success: boolean;
  error?: string;
}

let currentUser: ApiUser | null = getStoredUser();
const subscribers = new Set<(user: ApiUser | null) => void>();

const emit = () => {
  subscribers.forEach((callback) => callback(currentUser));
};

const syncSession = async () => {
  try {
    const response = await apiRequest<{ user: ApiUser; token?: string }>('/auth/me');
    // A remembered session the server slid forward. Store it before anything
    // else can fire a request with the token it is replacing.
    if (response.token) {
      storeToken(response.token);
    }
    currentUser = response.user;
    emit();
  } catch {
    currentUser = null;
    clearSession();
    emit();
  }
};

if (currentUser) {
  void syncSession();
}

export const subscribeToAuth = async (callback: (user: ApiUser | null) => void) => {
  subscribers.add(callback);
  callback(currentUser);
  return () => {
    subscribers.delete(callback);
  };
};

export const checkAuth = (): boolean => !!currentUser;

export const getCurrentUser = (): ApiUser | null => currentUser;

export const login = async (
  email: string,
  password: string,
  turnstileToken: string,
  /** Ask for a long, self-renewing session. The host phone app sets this; the
   *  browser console leaves it off and keeps the short one. */
  remember = false,
): Promise<LoginResult> => {
  if (!email || !password) {
    return { success: false, error: 'Email and password are required.' };
  }

  try {
    const response = await apiRequest<{ token: string; user: ApiUser }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email,
        password,
        turnstileToken,
        remember,
      }),
    });
    storeSession(response.token, response.user);
    currentUser = response.user;
    emit();
    return { success: true };
  } catch (error) {
    console.error('Auth Error:', error);
    const message = error instanceof Error ? error.message : 'Login failed.';
    return { success: false, error: message };
  }
};

export const register = async (
  name: string,
  email: string,
  password: string,
  turnstileToken: string,
): Promise<LoginResult> => {
  if (!name || !email || !password) {
    return { success: false, error: 'Name, email and password are required.' };
  }

  try {
    const response = await apiRequest<{ token: string; user: ApiUser }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name,
        email,
        password,
        turnstileToken,
      }),
    });
    storeSession(response.token, response.user);
    currentUser = response.user;
    emit();
    return { success: true };
  } catch (error) {
    console.error('Auth Error:', error);
    const message = error instanceof Error ? error.message : 'Registration failed.';
    return { success: false, error: message };
  }
};

export const logout = async (): Promise<void> => {
  currentUser = null;
  clearSession();
  emit();
};
