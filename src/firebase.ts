import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  User as FirebaseUser,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  getDocFromServer,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import { AppUserRole } from './utils/rbac';

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const googleProvider = new GoogleAuthProvider();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): FirestoreErrorInfo {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path,
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  return errInfo;
}

export interface FirestoreUserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: AppUserRole;
  createdAt: string;
}

export async function ensureFirestoreUserProfile(
  fbUser: FirebaseUser,
  defaultRole: AppUserRole = 'customer'
): Promise<FirestoreUserProfile> {
  const userRef = doc(db, 'users', fbUser.uid);
  try {
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      const data = snap.data() as FirestoreUserProfile;
      return data;
    }

    const newProfile: FirestoreUserProfile = {
      uid: fbUser.uid,
      email: fbUser.email || 'user@paypilot.in',
      displayName: fbUser.displayName || fbUser.email?.split('@')[0] || 'AC PayPilot User',
      role: defaultRole,
      createdAt: new Date().toISOString(),
    };
    await setDoc(userRef, newProfile);
    return newProfile;
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `users/${fbUser.uid}`);
    return {
      uid: fbUser.uid,
      email: fbUser.email || 'user@paypilot.in',
      displayName: fbUser.displayName || 'AC PayPilot User',
      role: defaultRole,
      createdAt: new Date().toISOString(),
    };
  }
}

export async function updateFirestoreUserRole(
  uid: string,
  role: AppUserRole
): Promise<boolean> {
  if (!auth.currentUser || auth.currentUser.uid !== uid) return false;
  const userRef = doc(db, 'users', uid);
  try {
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      const existing = snap.data() as FirestoreUserProfile;
      await setDoc(userRef, { ...existing, role });
    } else {
      await setDoc(userRef, {
        uid,
        email: auth.currentUser.email || 'user@paypilot.in',
        displayName: auth.currentUser.displayName || 'AC PayPilot User',
        role,
        createdAt: new Date().toISOString(),
      });
    }
    return true;
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${uid}`);
    return false;
  }
}

export async function signInWithGooglePopup() {
  return signInWithPopup(auth, googleProvider);
}

export async function signOutFirebase() {
  return firebaseSignOut(auth);
}

export async function testFirestoreConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration. The client is offline.');
      return false;
    }
    return true;
  }
}

export { onAuthStateChanged };
export type { FirebaseUser };
