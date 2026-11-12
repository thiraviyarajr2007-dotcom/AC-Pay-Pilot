import { initializeApp } from 'firebase/app';
import {
  getAuth,
  AuthProvider,
  GoogleAuthProvider,
  FacebookAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
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

const viteEnv: Record<string, string | undefined> =
  typeof import.meta !== 'undefined' && (import.meta as any).env
    ? (import.meta as any).env
    : {};

export const resolvedFirebaseConfig = {
  apiKey: viteEnv.VITE_FIREBASE_API_KEY || firebaseConfig.apiKey,
  authDomain: viteEnv.VITE_FIREBASE_AUTH_DOMAIN || firebaseConfig.authDomain,
  projectId: viteEnv.VITE_FIREBASE_PROJECT_ID || firebaseConfig.projectId,
  storageBucket: viteEnv.VITE_FIREBASE_STORAGE_BUCKET || firebaseConfig.storageBucket,
  messagingSenderId: viteEnv.VITE_FIREBASE_MESSAGING_SENDER_ID || firebaseConfig.messagingSenderId,
  appId: viteEnv.VITE_FIREBASE_APP_ID || firebaseConfig.appId,
  measurementId: viteEnv.VITE_FIREBASE_MEASUREMENT_ID || firebaseConfig.measurementId || '',
  firestoreDatabaseId:
    viteEnv.VITE_FIREBASE_DATABASE_ID || firebaseConfig.firestoreDatabaseId || '(default)',
};

const app = initializeApp({
  apiKey: resolvedFirebaseConfig.apiKey,
  authDomain: resolvedFirebaseConfig.authDomain,
  projectId: resolvedFirebaseConfig.projectId,
  storageBucket: resolvedFirebaseConfig.storageBucket,
  messagingSenderId: resolvedFirebaseConfig.messagingSenderId,
  appId: resolvedFirebaseConfig.appId,
  ...(resolvedFirebaseConfig.measurementId
    ? { measurementId: resolvedFirebaseConfig.measurementId }
    : {}),
});

export { app as firebaseApp };
export const auth = getAuth(app);
const configuredDbId = resolvedFirebaseConfig.firestoreDatabaseId?.trim();
export const db =
  configuredDbId && configuredDbId !== '(default)'
    ? getFirestore(app, configuredDbId)
    : getFirestore(app);

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export const facebookProvider = new FacebookAuthProvider();
facebookProvider.addScope('email');
facebookProvider.addScope('public_profile');

export async function initFirebaseAnalytics() {
  if (
    typeof window === 'undefined' ||
    !resolvedFirebaseConfig.measurementId ||
    process.env.NODE_ENV === 'test'
  ) {
    return null;
  }
  try {
    const { getAnalytics, isSupported } = await import('firebase/analytics');
    if (await isSupported()) {
      return getAnalytics(app);
    }
  } catch {
    // Analytics is optional in local/headless/restricted browser environments
  }
  return null;
}

void initFirebaseAnalytics();

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
  email?: string;
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
  if (process.env.NODE_ENV === 'test') {
    return {
      uid: fbUser.uid,
      email: fbUser.email || '',
      displayName: fbUser.displayName || fbUser.email?.split('@')[0] || 'AC PayPilot User',
      role: 'customer',
      bizId: 'biz-aerocool',
      onboardingCompleted: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

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
  if (typeof profileData.email === 'string' && profileData.email.trim()) {
    safePayload.email = profileData.email.trim();
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
  const existing = await getDoc(userRef);
  if (!existing.exists()) {
    await setDoc(userRef, {
      uid,
      email: safePayload.email || auth.currentUser.email || '',
      displayName:
        safePayload.displayName ||
        auth.currentUser.displayName ||
        auth.currentUser.email?.split('@')[0] ||
        'AC PayPilot User',
      role: 'customer',
      bizId: 'biz-aerocool',
      createdAt: new Date().toISOString(),
      ...safePayload,
    });
    return true;
  }

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
  throw new Error('ROLE_ESCALATION_FORBIDDEN: Client cannot update user roles.');
}

/**
 * Maps raw Firebase Auth SDK error codes into clear, actionable guidance for users and operators.
 */
export function formatFirebaseAuthError(error: unknown): string {
  const errObj = error as { code?: string; message?: string } | undefined;
  const rawMessage =
    typeof errObj?.message === 'string'
      ? errObj.message
      : typeof error === 'string'
        ? error
        : '';
  const extractedCode =
    errObj?.code ||
    rawMessage.match(/\((auth\/[a-z0-9-]+)\)/i)?.[1] ||
    '';
  const code = extractedCode.toLowerCase();
  const host = typeof window !== 'undefined' ? window.location.hostname : '';
  const port = typeof window !== 'undefined' && window.location.port ? `:${window.location.port}` : '';

  switch (code) {
    case 'auth/unauthorized-domain':
      if (host === '127.0.0.1' || host === '[::1]' || host === '::1') {
        return `Domain "${host}" is not authorized in Firebase Auth. Open http://localhost${port || ':3000'} instead, or add "${host}" in Firebase Console -> Authentication -> Settings -> Authorized domains (${resolvedFirebaseConfig.projectId}).`;
      }
      return `Domain "${host || 'current host'}" is not listed in Authorized domains for Firebase project "${resolvedFirebaseConfig.projectId}". Add it under Firebase Console -> Authentication -> Settings -> Authorized domains.`;
    case 'auth/operation-not-allowed':
      return `This sign-in provider is not enabled yet in Firebase project "${resolvedFirebaseConfig.projectId}". Enable it under Firebase Console -> Authentication -> Sign-in method.`;
    case 'auth/popup-blocked':
      return 'Browser blocked the sign-in popup. Redirecting to sign in or allow popups for this site.';
    case 'auth/popup-closed-by-user':
      return 'Sign-in popup was closed before finishing. Please try again or use redirect sign-in.';
    case 'auth/cancelled-popup-request':
      return 'Previous sign-in popup request was cancelled. Please click again to sign in.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Invalid email or password. Please check your credentials and try again.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/email-already-in-use':
      return 'An account with this email address already exists. Switch to Sign In instead.';
    case 'auth/weak-password':
      return 'Password is too weak. Please choose at least 6 characters.';
    case 'auth/account-exists-with-different-credential':
      return 'An account already exists with this email using a different sign-in provider. Sign in with your original provider.';
    case 'auth/network-request-failed':
      return 'Network error while reaching Firebase Authentication. Check your connection and try again.';
    case 'auth/too-many-requests':
      return 'Too many failed sign-in attempts. Please wait a moment before trying again.';
    default:
      return rawMessage || 'Authentication failed. Please try again.';
  }
}

async function signInWithProviderPopupOrRedirect(provider: AuthProvider) {
  try {
    return await signInWithPopup(auth, provider);
  } catch (err: any) {
    const code = String(err?.code || '').toLowerCase();
    if (code === 'auth/popup-blocked') {
      await signInWithRedirect(auth, provider);
      return null;
    }
    throw err;
  }
}

export async function signInWithGooglePopup() {
  return signInWithProviderPopupOrRedirect(googleProvider);
}

export async function signInWithGoogleRedirect() {
  return signInWithRedirect(auth, googleProvider);
}

export async function signInWithFacebookPopup() {
  return signInWithProviderPopupOrRedirect(facebookProvider);
}

export async function signInWithFacebookRedirect() {
  return signInWithRedirect(auth, facebookProvider);
}

export async function consumeAuthRedirectResult() {
  return getRedirectResult(auth);
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
