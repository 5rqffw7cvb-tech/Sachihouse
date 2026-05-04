import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../../src/store/memoryStore.js';

describe('check-in retention cleanup', () => {
  it('deletes submissions older than the cutoff timestamp', async () => {
    const store = new MemoryStore();
    await store.init();

    const created = await store.createCheckInSubmission({
      propertyId: 'main',
      checkInDate: '2026-06-20',
      checkOutDate: '2026-06-22',
      guests: [
        {
          id: 'guest_cleanup',
          fullName: 'Cleanup Guest',
          birthYear: 1990,
          nationality: 'JP',
          address: 'Tokyo',
          gender: 'UNSPECIFIED',
          occupation: 'TRAVELER',
          documentType: 'passport',
          documentNumber: 'P12345',
          evidenceUrl: 'data:image/jpeg;base64,AAAA',
          evidenceMimeType: 'image/jpeg',
          ocrText: 'sample',
          estimated: {},
          confidence: {},
        },
      ],
      consent: {
        accepted: true,
        acceptedAt: Date.now(),
        retentionDays: 7,
        noticeVersion: 'v1',
      },
      audit: {
        submittedAt: Date.now(),
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
      },
    });

    const deleted = await store.deleteExpiredCheckInSubmissions(created.createdAt + 1);
    const remaining = await store.listCheckInSubmissions();

    expect(deleted).toHaveLength(1);
    expect(deleted[0].id).toBe(created.id);
    expect(remaining).toHaveLength(0);
  });
});