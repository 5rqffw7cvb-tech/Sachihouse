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

  it('allows host property writes only for assigned properties', () => {
    expect(canPerformAction({ role: 'HOST', assignedPropertyIds: ['sachi-ojima'] }, 'property.write', 'sachi-ojima')).toBe(true);
    expect(canPerformAction({ role: 'HOST', assignedPropertyIds: ['sachi-ojima'] }, 'property.write', 'sachi-shinjuku')).toBe(false);
    expect(canPerformAction({ role: 'HOST', assignedPropertyIds: ['sachi-ojima'] }, 'property.assignHost', 'sachi-ojima')).toBe(false);
  });
});
