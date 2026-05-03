import { ApiUser, apiRequest } from './api';

export type UserRole = ApiUser['role'];

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  role: UserRole;
}

export async function listUsers(): Promise<ApiUser[]> {
  const response = await apiRequest<{ users: ApiUser[] }>('/users');
  return response.users;
}

export async function createUser(input: CreateUserInput): Promise<ApiUser> {
  const response = await apiRequest<{ user: ApiUser }>('/users', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return response.user;
}

export async function updateUserRole(userId: number, role: UserRole): Promise<ApiUser> {
  const response = await apiRequest<{ user: ApiUser }>(`/users/${userId}/role`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  });
  return response.user;
}

export async function updateUserEmail(userId: number, email: string): Promise<ApiUser> {
  const response = await apiRequest<{ user: ApiUser }>(`/users/${userId}/email`, {
    method: 'PATCH',
    body: JSON.stringify({ email }),
  });
  return response.user;
}

export async function updateUserName(userId: number, name: string): Promise<ApiUser> {
  const response = await apiRequest<{ user: ApiUser }>(`/users/${userId}/name`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
  return response.user;
}

export async function resetUserPassword(userId: number, password: string): Promise<void> {
  await apiRequest(`/users/${userId}/password`, {
    method: 'PATCH',
    body: JSON.stringify({ password }),
  });
}

export async function deleteUser(userId: number): Promise<void> {
  await apiRequest(`/users/${userId}`, {
    method: 'DELETE',
  });
}

export async function assignHostToProperty(propertyId: string, hostUserId: number): Promise<void> {
  await apiRequest(`/properties/${propertyId}/hosts/${hostUserId}`, {
    method: 'POST',
  });
}

export async function unassignHostFromProperty(propertyId: string, hostUserId: number): Promise<void> {
  await apiRequest(`/properties/${propertyId}/hosts/${hostUserId}`, {
    method: 'DELETE',
  });
}
