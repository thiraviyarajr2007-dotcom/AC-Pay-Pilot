import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  FacebookAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
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
export const facebookProvider = new FacebookAuthProvider();
facebookProvider.addScope('email');
facebookProvider.addScope('public_profile');

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
  gender?: 'Male' | 'Female' | 'Non-binary' | 'Prefer not to say';
  age?: number;
  phone?: string;
  countryCode?: string;
  onboardingCompleted?: boolean;
  createdAt: string;
  updatedAt?: string;
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
      onboardingCompleted: false,
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
      onboardingCompleted: false,
      createdAt: new Date().toISOString(),
    };
  }
}

export async function updateFirestoreUserProfile(
  uid: string,
  profileData: Partial<FirestoreUserProfile>
): Promise<boolean> {
  const userRef = doc(db, 'users', uid);
  try {
    const snap = await getDoc(userRef);
    const payload = {
      ...profileData,
      updatedAt: new Date().toISOString(),
    };
    if (snap.exists()) {
      await setDoc(userRef, { ...(snap.data() as FirestoreUserProfile), ...payload });
    } else {
      await setDoc(userRef, {
        uid,
        email: auth.currentUser?.email || '',
        displayName: auth.currentUser?.displayName || 'User',
        role: 'customer',
        createdAt: new Date().toISOString(),
        ...payload,
      });
    }
    // Backup to local storage for instant retrieval
    try {
      localStorage.setItem(`ac_user_profile_${uid}`, JSON.stringify(payload));
    } catch {
      // Ignore
    }
    return true;
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${uid}`);
    try {
      localStorage.setItem(`ac_user_profile_${uid}`, JSON.stringify(profileData));
      return true;
    } catch {
      return false;
    }
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

export async function signInWithFacebookPopup() {
  return signInWithPopup(auth, facebookProvider);
}

export async function signInWithEmailPassword(email: string, pass: string) {
  return signInWithEmailAndPassword(auth, email, pass);
}

export async function signUpWithEmailPassword(email: string, pass: string) {
  return createUserWithEmailAndPassword(auth, email, pass);
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
