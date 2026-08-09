import { describe, expect, it } from 'vitest';
import { canAccessProperty, canPerformAction } from '../../src/domain/authorization.js';

describe('authorization domain', () => {
  it('allows admin to access any property', () => {
    expect(canAccessProperty({ role: 'ADMIN' }, 'sachi-ojima')).toBe(true);
  });

  it('allows host to access assigned property only', () => {
    expect(canAccessProperty({ role: 'HOST', assignedPropertyIds: ['sachi-ojima'] }, 'sachi-ojima')).toBe(true);
    expect(canAccessProperty({ role: 'HOST', assignedPropertyIds: ['sachi-ojima'] }, 'sachi-shinjuku')).toBe(false);
  });

  it('denies guest property access but allows public reads', () => {
    expect(canAccessProperty({ role: 'GUEST' }, 'sachi-ojima')).toBe(false);
    expect(canPerformAction({ role: 'GUEST' }, 'property.read')).toBe(true);
    expect(canPerformAction({ role: 'GUEST' }, 'property.write', 'sachi-ojima')).toBe(false);
  });

  it('allows host property writes only for assigned properties with a paid plan (hostLevel >= 2)', () => {
    expect(canPerformAction({ role: 'HOST', assignedPropertyIds: ['sachi-ojima'], hostLevel: 2 }, 'property.write', 'sachi-ojima')).toBe(true);
    expect(canPerformAction({ role: 'HOST', assignedPropertyIds: ['sachi-ojima'], hostLevel: 2 }, 'property.write', 'sachi-shinjuku')).toBe(false);
    expect(canPerformAction({ role: 'HOST', assignedPropertyIds: ['sachi-ojima'], hostLevel: 2 }, 'property.assignHost', 'sachi-ojima')).toBe(false);
  });

  it('denies property writes for an assigned host without a paid plan', () => {
    expect(canPerformAction({ role: 'HOST', assignedPropertyIds: ['sachi-ojima'] }, 'property.write', 'sachi-ojima')).toBe(false);
    expect(canPerformAction({ role: 'HOST', assignedPropertyIds: ['sachi-ojima'], hostLevel: 1 }, 'property.write', 'sachi-ojima')).toBe(false);
  });

  it('requires explicit blog editor permission for non-admin blog writes', () => {
    expect(canPerformAction({ role: 'HOST', canEditBlog: false }, 'blog.write')).toBe(false);
    expect(canPerformAction({ role: 'HOST', canEditBlog: true }, 'blog.write')).toBe(true);
    expect(canPerformAction({ role: 'GUEST', canEditBlog: true }, 'blog.write')).toBe(true);
  });
});
