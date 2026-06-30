import { Role } from '../types/domain.js';

export interface PermissionContext {
  role: Role;
  canEditBlog?: boolean;
  assignedPropertyIds?: string[];
  hostLevel?: 1 | 2 | 3 | 4 | null;
}

export type PermissionAction =
  | 'property.read'
  | 'property.write'
  | 'property.delete'
  | 'property.assignHost'
  | 'blog.read'
  | 'blog.write';

export function canAccessProperty(context: PermissionContext, propertyId: string): boolean {
  if (context.role === 'ADMIN') {
    return true;
  }
  if (context.role === 'HOST') {
    return (context.assignedPropertyIds ?? []).includes(propertyId);
  }
  return false;
}

export function canPerformAction(
  context: PermissionContext,
  action: PermissionAction,
  propertyId?: string,
): boolean {
  if (action === 'blog.read') {
    return true;
  }

  if (context.role === 'ADMIN') {
    return true;
  }

  if (context.role === 'HOST') {
    if (action === 'blog.write') {
      return Boolean(context.canEditBlog);
    }
    if ((action === 'property.read' || action === 'property.delete') && propertyId) {
      return canAccessProperty(context, propertyId);
    }
    if (action === 'property.write' && propertyId) {
      return canAccessProperty(context, propertyId) && (context.hostLevel ?? 1) >= 2;
    }
    return false;
  }

  if (action === 'blog.write') {
    return Boolean(context.canEditBlog);
  }

  return action === 'property.read';
}
