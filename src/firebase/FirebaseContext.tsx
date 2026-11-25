import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import type { FirebaseDatasetRecord } from '../types/smartMeter';
import { auth, FIREBASE_PROJECT_INFO, googleProvider, testConnection } from './config';
import { formatUserFriendlyFirestoreError } from './errors';
import { subscribeUserDatasets } from './storageService';

interface FirebaseContextValue {
  user: User | null;
  authReady: boolean;
  firestoreConnected: boolean;
  connectionWarning: string | null;
  datasets: FirebaseDatasetRecord[];
  datasetsLoading: boolean;
  datasetsError: string | null;
  authBusy: boolean;
  authError: string | null;
  projectInfo: typeof FIREBASE_PROJECT_INFO;
  signInWithGoogle: () => Promise<void>;
  signOutUser: () => Promise<void>;
  clearAuthError: () => void;
}

const FirebaseContext = createContext<FirebaseContextValue | null>(null);

export function FirebaseProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [firestoreConnected, setFirestoreConnected] = useState(true);
  const [connectionWarning, setConnectionWarning] = useState<string | null>(null);
  const [datasets, setDatasets] = useState<FirebaseDatasetRecord[]>([]);
  const [datasetsLoading, setDatasetsLoading] = useState(false);
  const [datasetsError, setDatasetsError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    testConnection().then(({ connected, error }) => {
      if (!active) return;
      setFirestoreConnected(connected);
      setConnectionWarning(error);
    });

    const unsubAuth = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
    });

    return () => {
      active = false;
      unsubAuth();
    };
  }, []);

  useEffect(() => {
    if (!authReady) return;
    if (!user) {
      setDatasets([]);
      setDatasetsLoading(false);
      setDatasetsError(null);
      return;
    }

    setDatasetsLoading(true);
    setDatasetsError(null);
    const unsub = subscribeUserDatasets(
      user.uid,
      (items) => {
        setDatasets(items);
        setDatasetsLoading(false);
        setDatasetsError(null);
      },
      (err) => {
        setDatasetsLoading(false);
        setDatasetsError(formatUserFriendlyFirestoreError(err));
      }
    );

    return () => unsub();
  }, [authReady, user]);

  const signInWithGoogle = useCallback(async () => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Google sign-in failed.';
      if (!msg.includes('popup-closed-by-user')) {
        setAuthError(msg);
      }
    } finally {
      setAuthBusy(false);
    }
  }, []);

  const signOutUser = useCallback(async () => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      await signOut(auth);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Sign-out failed.');
    } finally {
      setAuthBusy(false);
    }
  }, []);

  const clearAuthError = useCallback(() => setAuthError(null), []);

  return (
    <FirebaseContext.Provider
      value={{
        user,
        authReady,
        firestoreConnected,
        connectionWarning,
        datasets,
        datasetsLoading,
        datasetsError,
        authBusy,
        authError,
        projectInfo: FIREBASE_PROJECT_INFO,
        signInWithGoogle,
        signOutUser,
        clearAuthError,
      }}
    >
      {children}
    </FirebaseContext.Provider>
  );
}

export function useFirebase(): FirebaseContextValue {
  const ctx = useContext(FirebaseContext);
  if (!ctx) {
    throw new Error('useFirebase must be used inside a FirebaseProvider.');
  }
  return ctx;
}
