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
  onSnapshot,
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
  bizId?: string;
  gender?: 'Male' | 'Female' | 'Non-binary' | 'Prefer not to say';
  age?: number;
  phone?: string;
  countryCode?: string;
  onboardingCompleted?: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface UserProfileUpdateInput {
  displayName?: string;
  gender?: 'Male' | 'Female' | 'Non-binary' | 'Prefer not to say';
  age?: number;
  phone?: string;
  countryCode?: string;
  onboardingCompleted?: boolean;
}

/**
 * Idempotently and atomically creates or retrieves the Firestore profile for an authenticated user.
 * Strictly enforces lowest privilege default role ('customer'). Never assigns finance or business_head.
 */
export async function ensureFirestoreUserProfile(
  fbUser: FirebaseUser,
  _ignoredRequestedRole?: AppUserRole
): Promise<FirestoreUserProfile> {
  const userRef = doc(db, 'users', fbUser.uid);
  const snap = await getDoc(userRef);

  if (snap.exists()) {
    const existing = snap.data() as FirestoreUserProfile;
    return existing;
  }

  // Safe default lowest-privilege profile (strictly 'customer')
  const newProfile: FirestoreUserProfile = {
    uid: fbUser.uid,
    email: fbUser.email || '',
    displayName: fbUser.displayName || fbUser.email?.split('@')[0] || 'AC PayPilot User',
    role: 'customer', // Strictly customer (lowest privilege)
    bizId: 'biz-aerocool',
    onboardingCompleted: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Atomic set with merge
  await setDoc(userRef, newProfile, { merge: true });
  return newProfile;
}

/**
 * Single validated service function for client profile updates.
 * Strictly disallows changing role, bizId, or verification status.
 */
export async function updateFirestoreUserProfile(
  uid: string,
  profileData: UserProfileUpdateInput
): Promise<boolean> {
  if (!auth.currentUser || auth.currentUser.uid !== uid) {
    throw new Error('UNAUTHORIZED_PROFILE_UPDATE: Cannot update profile of another user.');
  }

  // Whitelist safe editable fields only; strictly strip role, bizId, isVerified
  const safePayload: Record<string, any> = {
    updatedAt: new Date().toISOString(),
  };

  if (typeof profileData.displayName === 'string' && profileData.displayName.trim()) {
    safePayload.displayName = profileData.displayName.trim();
  }
  if (profileData.gender && ['Male', 'Female', 'Non-binary', 'Prefer not to say'].includes(profileData.gender)) {
    safePayload.gender = profileData.gender;
  }
  if (typeof profileData.phone === 'string') {
    safePayload.phone = profileData.phone.trim();
  }
  if (typeof profileData.countryCode === 'string') {
    safePayload.countryCode = profileData.countryCode.trim();
  }
  if (typeof profileData.age === 'number' && !isNaN(profileData.age) && profileData.age >= 18 && profileData.age <= 120) {
    safePayload.age = Math.floor(profileData.age);
  }
  if (typeof profileData.onboardingCompleted === 'boolean') {
    safePayload.onboardingCompleted = profileData.onboardingCompleted;
  }

  const userRef = doc(db, 'users', uid);
  await setDoc(userRef, safePayload, { merge: true });
  return true;
}

/**
 * Client-side role escalation is strictly blocked.
 * Roles are immutable by clients and may only be provisioned by backend authority.
 */
export async function updateFirestoreUserRole(
  _uid: string,
  _role: AppUserRole
): Promise<boolean> {
  console.warn('[SECURITY] Blocked client attempt to modify user role. Roles are server-governed.');
  return false;
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

export { onAuthStateChanged, onSnapshot };
export type { FirebaseUser };
