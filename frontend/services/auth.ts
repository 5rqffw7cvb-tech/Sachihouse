import { apiRequest, ApiUser, clearSession, getStoredUser, storeSession } from './api';

let currentUser: ApiUser | null = getStoredUser();
const subscribers = new Set<(user: ApiUser | null) => void>();

const emit = () => {
  subscribers.forEach((callback) => callback(currentUser));
};

const syncSession = async () => {
  try {
    const response = await apiRequest<{ user: ApiUser }>('/auth/me');
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

export const login = async (email: string, password: string): Promise<boolean> => {
  if (!email || !password) {
    return false;
  }

  try {
    const response = await apiRequest<{ token: string; user: ApiUser }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    storeSession(response.token, response.user);
    currentUser = response.user;
    emit();
    return true;
  } catch (error) {
    console.error('Auth Error:', error);
    return false;
  }
};

export const logout = async (): Promise<void> => {
  currentUser = null;
  clearSession();
  emit();
};
