import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

export const app = initializeApp(firebaseConfig);

// Always bind explicitly to the provisioned Firestore database ID
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export const FIREBASE_PROJECT_INFO = {
  projectId: firebaseConfig.projectId,
  firestoreDatabaseId: firebaseConfig.firestoreDatabaseId,
  authDomain: firebaseConfig.authDomain,
} as const;

export async function testConnection(): Promise<{ connected: boolean; error: string | null }> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return { connected: true, error: null };
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      const msg = 'Please check your Firebase configuration — Firestore client appears offline.';
      console.error(msg);
      return { connected: false, error: msg };
    }
    // Permission denied or not-found still proves the Firestore server is reachable
    return { connected: true, error: null };
  }
}
