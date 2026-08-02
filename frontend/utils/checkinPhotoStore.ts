// Persists captured ID-evidence photos (data: URIs) in IndexedDB, keyed by
// guest id, so an in-progress check-in draft can be restored after a reload
// without losing the photo. localStorage (where the rest of the draft lives)
// is unsuitable for this — a handful of photos can easily exceed its ~5MB
// quota — but IndexedDB has no such practical limit for this use case.
const DB_NAME = 'sachihouse-checkin';
const DB_VERSION = 1;
const STORE_NAME = 'photos';

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

const keyFor = (propertyId: string, guestId: string): string => `${propertyId}:${guestId}`;

export async function saveCheckInPhoto(propertyId: string, guestId: string, dataUri: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(dataUri, keyFor(propertyId, guestId));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Best-effort — losing the persisted copy just means the guest may need
    // to re-upload after a reload, same as before this existed.
  } finally {
    db.close();
  }
}

export async function getCheckInPhoto(propertyId: string, guestId: string): Promise<string | null> {
  const db = await openDb();
  if (!db) return null;
  try {
    return await new Promise<string | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(keyFor(propertyId, guestId));
      request.onsuccess = () => resolve((request.result as string | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  } finally {
    db.close();
  }
}

export async function deleteCheckInPhoto(propertyId: string, guestId: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(keyFor(propertyId, guestId));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore — worst case a stray photo lingers until the browser evicts it.
  } finally {
    db.close();
  }
}

// Clears every photo saved for this property — called once a check-in
// actually submits or the draft is explicitly discarded, so ID photos never
// linger on-device longer than the active session needs them.
export async function clearCheckInPhotos(propertyId: string, guestIds: string[]): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      for (const guestId of guestIds) {
        store.delete(keyFor(propertyId, guestId));
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore.
  } finally {
    db.close();
  }
}
