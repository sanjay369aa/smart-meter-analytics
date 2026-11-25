import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import type { FirebaseDatasetRecord, FirebaseUserSettings } from '../types/smartMeter';
import { db } from './config';
import { handleFirestoreError, OperationType } from './errors';
import {
  generateDatasetId,
  reassembleCsvChunks,
  sanitizeDatasetFilename,
  splitCsvIntoChunks,
  validateDatasetWrite,
  validateUserSettingsWrite,
} from './validation';

function timestampToIso(value: unknown): string | null {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return null;
}

export async function archiveDatasetToFirestore(
  uid: string,
  params: {
    rawFilename?: string;
    csvContent: string;
    recordCount: number;
    totalEnergyKwh: number;
    dateRangeStart: string | null;
    dateRangeEnd: string | null;
  }
): Promise<FirebaseDatasetRecord> {
  const datasetId = generateDatasetId();
  const filename = sanitizeDatasetFilename(params.rawFilename);
  const chunks = splitCsvIntoChunks(params.csvContent);
  const sizeBytes = new TextEncoder().encode(params.csvContent).length;

  const validated = validateDatasetWrite({
    ownerId: uid,
    filename,
    recordCount: params.recordCount,
    sizeBytes,
    chunkCount: chunks.length,
    totalEnergyKwh: params.totalEnergyKwh,
    dateRangeStart: params.dateRangeStart ?? '',
    dateRangeEnd: params.dateRangeEnd ?? '',
  });

  const datasetPath = `datasets/${datasetId}`;
  try {
    const batch = writeBatch(db);
    const datasetRef = doc(db, 'datasets', datasetId);
    const nowServer = serverTimestamp();

    batch.set(datasetRef, {
      ...validated,
      createdAt: nowServer,
      updatedAt: nowServer,
    });

    chunks.forEach((csvChunk, index) => {
      const chunkRef = doc(db, 'datasets', datasetId, 'chunks', `chunk_${index}`);
      batch.set(chunkRef, {
        ownerId: uid,
        datasetId,
        chunkIndex: index,
        csvContent: csvChunk,
        createdAt: nowServer,
      });
    });

    await batch.commit();

    const nowIso = new Date().toISOString();
    return {
      id: datasetId,
      ...validated,
      createdAtIso: nowIso,
      updatedAtIso: nowIso,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, datasetPath);
  }
}

export function subscribeUserDatasets(
  uid: string,
  onData: (datasets: FirebaseDatasetRecord[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const q = query(collection(db, 'datasets'), where('ownerId', '==', uid));
  return onSnapshot(
    q,
    (snapshot) => {
      const items: FirebaseDatasetRecord[] = snapshot.docs.map((docSnap) => {
        const d = docSnap.data();
        return {
          id: docSnap.id,
          ownerId: String(d.ownerId ?? ''),
          filename: String(d.filename ?? ''),
          recordCount: Number(d.recordCount ?? 0),
          sizeBytes: Number(d.sizeBytes ?? 0),
          chunkCount: Number(d.chunkCount ?? 1),
          totalEnergyKwh: Number(d.totalEnergyKwh ?? 0),
          dateRangeStart: String(d.dateRangeStart ?? ''),
          dateRangeEnd: String(d.dateRangeEnd ?? ''),
          createdAtIso: timestampToIso(d.createdAt),
          updatedAtIso: timestampToIso(d.updatedAt),
        };
      });

      // Client-side sort avoids requiring a custom composite index on (ownerId, createdAt)
      items.sort((a, b) => (b.createdAtIso ?? '').localeCompare(a.createdAtIso ?? ''));
      onData(items);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, 'datasets');
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export async function fetchDatasetCsvFromFirestore(
  uid: string,
  datasetId: string,
  expectedChunkCount?: number
): Promise<string> {
  const chunksPath = `datasets/${datasetId}/chunks`;
  try {
    const q = query(
      collection(db, 'datasets', datasetId, 'chunks'),
      where('ownerId', '==', uid),
      where('datasetId', '==', datasetId)
    );
    const snapshot = await getDocs(q);
    const chunks = snapshot.docs.map((docSnap) => {
      const d = docSnap.data();
      return {
        chunkIndex: Number(d.chunkIndex ?? 0),
        csvContent: String(d.csvContent ?? ''),
      };
    });
    return reassembleCsvChunks(chunks, expectedChunkCount);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, chunksPath);
  }
}

export async function renameDatasetInFirestore(
  datasetId: string,
  newFilename: string
): Promise<string> {
  const sanitized = sanitizeDatasetFilename(newFilename);
  const path = `datasets/${datasetId}`;
  try {
    await updateDoc(doc(db, 'datasets', datasetId), {
      filename: sanitized,
      updatedAt: serverTimestamp(),
    });
    return sanitized;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteDatasetFromFirestore(uid: string, datasetId: string): Promise<void> {
  const path = `datasets/${datasetId}`;
  try {
    const q = query(
      collection(db, 'datasets', datasetId, 'chunks'),
      where('ownerId', '==', uid),
      where('datasetId', '==', datasetId)
    );
    const snapshot = await getDocs(q);
    const batch = writeBatch(db);
    snapshot.docs.forEach((docSnap) => {
      batch.delete(docSnap.ref);
    });
    batch.delete(doc(db, 'datasets', datasetId));
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function loadUserSettingsFromFirestore(
  uid: string
): Promise<FirebaseUserSettings | null> {
  const path = `userSettings/${uid}`;
  try {
    const snap = await getDoc(doc(db, 'userSettings', uid));
    if (!snap.exists()) return null;
    const d = snap.data();
    const horizonRaw = Number(d.defaultHorizon ?? 24);
    const defaultHorizon: 12 | 24 | 48 = horizonRaw === 12 || horizonRaw === 48 ? horizonRaw : 24;
    return {
      arimaP: Number(d.arimaP ?? 3),
      arimaD: Number(d.arimaD ?? 1),
      arimaQ: Number(d.arimaQ ?? 1),
      defaultHorizon,
      updatedAtIso: timestampToIso(d.updatedAt),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function saveUserSettingsToFirestore(
  uid: string,
  settings: { arimaP: number; arimaD: number; arimaQ: number; defaultHorizon: number }
): Promise<FirebaseUserSettings> {
  const validated = validateUserSettingsWrite({
    ownerId: uid,
    ...settings,
  });
  const path = `userSettings/${uid}`;
  try {
    const ref = doc(db, 'userSettings', uid);
    const existing = await getDoc(ref);
    if (existing.exists()) {
      await updateDoc(ref, {
        arimaP: validated.arimaP,
        arimaD: validated.arimaD,
        arimaQ: validated.arimaQ,
        defaultHorizon: validated.defaultHorizon,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        ...validated,
        updatedAt: serverTimestamp(),
      });
    }
    return {
      arimaP: validated.arimaP,
      arimaD: validated.arimaD,
      arimaQ: validated.arimaQ,
      defaultHorizon: validated.defaultHorizon,
      updatedAtIso: new Date().toISOString(),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}
