import { apiRequest, ApiUser, clearSession, getStoredUser, storeSession } from './api';

export interface LoginChallenge {
  challengeId: string;
  prompt: string;
  expiresInSeconds: number;
}

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

export const getLoginChallenge = async (): Promise<LoginChallenge> => {
  return apiRequest<LoginChallenge>('/auth/login-challenge');
};

export const login = async (
  email: string,
  password: string,
  challenge?: { challengeId: string; challengeAnswer: string },
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
        challengeId: challenge?.challengeId,
        challengeAnswer: challenge?.challengeAnswer,
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

export const logout = async (): Promise<void> => {
  currentUser = null;
  clearSession();
  emit();
};
