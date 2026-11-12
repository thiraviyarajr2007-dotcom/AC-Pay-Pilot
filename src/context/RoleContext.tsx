import React, { createContext, useContext, useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppRoute, DataSource, UserRole } from '../types';
import {
  auth,
  onAuthStateChanged,
  onSnapshot,
  db,
  FirebaseUser,
  ensureFirestoreUserProfile,
  updateFirestoreUserProfile,
  signInWithGooglePopup,
  signInWithFacebookPopup,
  signInWithEmailPassword,
  signUpWithEmailPassword,
  signOutFirebase,
  testFirestoreConnection,
  FirestoreUserProfile,
} from '../firebase';
import { doc } from 'firebase/firestore';
import { authenticatedFetch, ApiFetchOptions } from '../services/apiClient';

export type AuthStatus =
  | 'loading'
  | 'unauthenticated'
  | 'authenticated-profile-loading'
  | 'ready'
  | 'error';

export interface RoleProfile {
  role: UserRole;
  label: string;
  shortLabel: string;
  userName: string;
  userTitle: string;
  userEmail: string;
  avatarInitials: string;
  homeRoute: AppRoute;
  workspaceName: string;
  accentChipLabel: string;
  accentChipClass: string;
  accentSoftClass: string;
  accentDotClass: string;
  roleIcon: string;
}

export interface DemoTourStep {
  stepNumber: number;
  title: string;
  shortTitle: string;
  description: string;
  route: string;
  role: UserRole;
  nextStepLabel: string;
}

export const ROLE_PROFILES: Record<UserRole, RoleProfile> = {
  customer: {
    role: 'customer',
    label: 'Customer',
    shortLabel: 'Customer',
    userName: 'Priya Patel',
    userTitle: 'Enterprise Procurement Buyer',
    userEmail: 'priya.patel@apexcloud.io',
    avatarInitials: 'PP',
    homeRoute: '/customer/discover',
    workspaceName: 'Customer Buyer Portal',
    accentChipLabel: 'Buyer Workspace • Customer',
    accentChipClass: 'bg-teal-700 text-white border-teal-800',
    accentSoftClass: 'bg-teal-50 text-teal-900 border-teal-300',
    accentDotClass: 'bg-teal-500',
    roleIcon: 'shopping_bag',
  },
  seller: {
    role: 'seller',
    label: 'Seller',
    shortLabel: 'Seller',
    userName: 'Aarav Sharma',
    userTitle: 'Merchant Operations Lead',
    userEmail: 'aarav.sharma@techpilot.in',
    avatarInitials: 'AS',
    homeRoute: '/seller/dashboard',
    workspaceName: 'Seller Merchant Studio',
    accentChipLabel: 'Merchant Studio • Seller',
    accentChipClass: 'bg-[#004ac6] text-white border-blue-800',
    accentSoftClass: 'bg-blue-50 text-blue-900 border-blue-300',
    accentDotClass: 'bg-blue-600',
    roleIcon: 'storefront',
  },
  finance: {
    role: 'finance',
    label: 'Finance',
    shortLabel: 'Finance',
    userName: 'Rohan Deshmukh',
    userTitle: 'Finance & Tax Controller',
    userEmail: 'rohan.deshmukh@techpilot.in',
    avatarInitials: 'RD',
    homeRoute: '/finance/ledger',
    workspaceName: 'Finance & GST Audit Desk',
    accentChipLabel: 'Controller Desk • Finance',
    accentChipClass: 'bg-purple-800 text-white border-purple-900',
    accentSoftClass: 'bg-purple-50 text-purple-900 border-purple-300',
    accentDotClass: 'bg-purple-600',
    roleIcon: 'account_balance',
  },
  business_head: {
    role: 'business_head',
    label: 'Business Head',
    shortLabel: 'Business Head',
    userName: 'Vikramaditya Rao',
    userTitle: 'VP & Business Head',
    userEmail: 'vikram.rao@techpilot.in',
    avatarInitials: 'VR',
    homeRoute: '/executive',
    workspaceName: 'Executive Command Center',
    accentChipLabel: 'Executive Command • Business Head',
    accentChipClass: 'bg-slate-900 text-amber-300 border-slate-700',
    accentSoftClass: 'bg-slate-100 text-slate-900 border-slate-400',
    accentDotClass: 'bg-amber-500',
    roleIcon: 'monitoring',
  },
};

export const DEMO_TOUR_STEPS: DemoTourStep[] = [
  {
    stepNumber: 1,
    title: 'Step 1 of 7: Seller Uploads Fan & AI Drafts Listing',
    shortTitle: 'Seller Listing Studio',
    description:
      'Seller uploads the 3D .glb asset for AeroBreeze Ceiling Fan (#FAN-BLDC-892), runs POST /api/listing/generate (3 columns: Provided, Generated, Missing), and approves the listing.',
    route: '/seller/products',
    role: 'seller',
    nextStepLabel: 'Customer 3D/AR View →',
  },
  {
    stepNumber: 2,
    title: 'Step 2 of 7: Customer Opens <model-viewer> 3D / AR & Q&A',
    shortTitle: 'Customer 3D/AR',
    description:
      'Customer inspects the real binary glTF 2.0 ceiling fan in <model-viewer>, tests click-to-start AR camera consent, and asks grounded Product Q&A.',
    route: '/customer/product/FAN-BLDC-892',
    role: 'customer',
    nextStepLabel: 'SmartCart Optimizer →',
  },
  {
    stepNumber: 3,
    title: 'Step 3 of 7: SmartCart Prioritises via POST /api/cart/optimize',
    shortTitle: 'SmartCart',
    description:
      'SmartCart ranks line items against the INR budget ceiling using finance.ts minor-unit math while keeping AI suggested alternatives in a separate approval section.',
    route: '/customer/cart',
    role: 'customer',
    nextStepLabel: 'PayPal Sandbox Checkout →',
  },
  {
    stepNumber: 4,
    title: 'Step 4 of 7: PayPal Sandbox Orders v2 Checkout',
    shortTitle: 'Checkout',
    description:
      'Create and capture an idempotent PayPal Sandbox order computed strictly on the server in integer minor units (paise/cents).',
    route: '/customer/cart?modal=checkout',
    role: 'customer',
    nextStepLabel: 'Seller Order & Escrow →',
  },
  {
    stepNumber: 5,
    title: 'Step 5 of 7: Seller Sees Order & AI Escrow Release Agent',
    shortTitle: 'Seller Order',
    description:
      'Seller inspects the captured order, reviews POST /api/escrow/recommend evidence, and clicks to transition escrow.',
    route: '/seller/orders',
    role: 'seller',
    nextStepLabel: 'Finance Linked Payment →',
  },
  {
    stepNumber: 6,
    title: 'Step 6 of 7: Finance Sees Linked Payment & GST Audit',
    shortTitle: 'Finance Ledger',
    description:
      'Finance Controller verifies the linked payment settlement, provider fee availability, and GST schedule.',
    route: '/finance/ledger',
    role: 'finance',
    nextStepLabel: 'Business Head KPIs →',
  },
  {
    stepNumber: 7,
    title: 'Step 7 of 7: Business Head Sees Updated KPIs & Forecasts',
    shortTitle: 'Business Head KPIs',
    description:
      'Business Head reviews date-range GMV, baseline comparisons, and POST /api/executive/insights with record citations and explicit Forecast badges.',
    route: '/executive',
    role: 'business_head',
    nextStepLabel: 'Complete 3-Min Demo ✓',
  },
];

export function isRoleReadOnlyOnPath(role: UserRole, pathname: string): boolean {
  if (role !== 'business_head') return false;
  if (pathname === '/' || pathname === '/executive' || pathname === '/assistant') {
    return false;
  }
  return true;
}

interface RoleContextValue {
  role: UserRole;
  profile: RoleProfile;
  authStatus: AuthStatus;
  sessionPresentation: 'authenticated' | 'demo' | 'unauthenticated';
  authError: string | null;
  authSource: 'demo-switcher' | 'auth-provider';
  isAuthenticated: boolean;
  firebaseUser: FirebaseUser | null;
  userProfile: FirestoreUserProfile | null;
  authLoading: boolean;
  firestoreConnected: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithFacebook: () => Promise<void>;
  signInWithEmail: (email: string, pass: string) => Promise<void>;
  signUpWithEmail: (email: string, pass: string, targetRole?: UserRole) => Promise<void>;
  signOutUser: () => Promise<void>;
  setRole: (newRole: UserRole, navigateToHome?: boolean) => void;
  getActorHeaders: () => Record<string, string>;
  authFetch: (url: string, options?: ApiFetchOptions) => Promise<Response>;
  dataSource: DataSource;
  setDataSource: (source: DataSource) => void;
  activeBizId: string;
  isDemoMode: boolean;
  isDemoModeSupported: boolean;
  serverConfirmed: boolean;
  setServerConfirmed: (confirmed: boolean) => void;
  feesVerified: boolean;
  setFeesVerified: (verified: boolean) => void;
  lastServerOrderId: string | null;
  setLastServerOrderId: (id: string | null) => void;
  isDemoTourActive: boolean;
  demoStepIndex: number | null;
  currentDemoStep: DemoTourStep | null;
  startDemoTour: () => void;
  nextDemoStep: () => void;
  prevDemoStep: () => void;
  stopDemoTour: () => void;
  goToDemoStep: (index: number) => void;
  isProfileOnboardingPending: boolean;
  completeProfileOnboarding: (details: {
    name: string;
    gender: 'Male' | 'Female' | 'Non-binary' | 'Prefer not to say';
    phone: string;
    countryCode: string;
    age: number;
    email?: string;
  }) => Promise<void>;
  dismissProfileOnboarding: () => void;
  isAuthModalOpen: boolean;
  openAuthModal: (targetRole?: UserRole) => void;
  closeAuthModal: () => void;
}

const RoleContext = createContext<RoleContextValue | undefined>(undefined);

export const RoleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const navigate = useNavigate();

  // Explicit demo mode flag (OFF by default unless VITE_DEMO_MODE=true)
  const isDemoModeSupported =
    typeof import.meta !== 'undefined' &&
    import.meta.env &&
    import.meta.env.VITE_DEMO_MODE === 'true';

  const [authStatus, setAuthStatus] = useState<AuthStatus>('loading');
  const [authError, setAuthError] = useState<string | null>(null);

  const [demoRole, setDemoRoleState] = useState<UserRole>(() => {
    try {
      const saved = localStorage.getItem('paypilot_active_role') as UserRole | null;
      if (saved && ROLE_PROFILES[saved]) return saved;
    } catch {
      // ignore
    }
    return 'customer'; // safe default
  });

  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [firebaseRole, setFirebaseRole] = useState<UserRole>('customer');
  const [userProfile, setUserProfile] = useState<FirestoreUserProfile | null>(null);
  const [firestoreConnected, setFirestoreConnected] = useState<boolean>(false);
  const [isProfileOnboardingPending, setIsProfileOnboardingPending] = useState<boolean>(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);

  const [dataSource, setDataSourceState] = useState<DataSource>(() => {
    if (!isDemoModeSupported) return 'live';
    try {
      const saved = localStorage.getItem('paypilot_data_source') as DataSource | null;
      if (saved === 'demo' || saved === 'live') return saved;
    } catch {
      // ignore
    }
    return 'demo';
  });

  const [serverConfirmed, setServerConfirmed] = useState<boolean>(false);
  const [feesVerified, setFeesVerified] = useState<boolean>(false);
  const [lastServerOrderId, setLastServerOrderId] = useState<string | null>(null);
  const [demoStepIndex, setDemoStepIndex] = useState<number | null>(null);

  const unsubProfileRef = useRef<(() => void) | null>(null);
  const cachedTokenRef = useRef<string | null>(null);

  // Connection and Auth Lifecycle Listener
  useEffect(() => {
    testFirestoreConnection().then((ok) => setFirestoreConnected(ok));

    let isMounted = true;

    const unsubAuth = onAuthStateChanged(
      auth,
      async (fbUser) => {
        if (!isMounted) return;

        // Cleanup any existing Firestore profile listener
        if (unsubProfileRef.current) {
          unsubProfileRef.current();
          unsubProfileRef.current = null;
        }

        if (!fbUser) {
          cachedTokenRef.current = null;
          setFirebaseUser(null);
          setUserProfile(null);
          setFirebaseRole('customer');
          setIsProfileOnboardingPending(false);

          if (isDemoModeSupported && dataSource === 'demo') {
            setAuthStatus('ready');
          } else {
            setAuthStatus('unauthenticated');
          }
          return;
        }

        try {
          const t = await fbUser.getIdToken();
          cachedTokenRef.current = t;
        } catch {
          // Token will be refreshed on demand
        }

        setFirebaseUser(fbUser);
        setAuthStatus('authenticated-profile-loading');

        // Attach real-time snapshot listener on users/{uid} (single source of truth)
        const userDocRef = doc(db, 'users', fbUser.uid);

        unsubProfileRef.current = onSnapshot(
          userDocRef,
          async (snap) => {
            if (!isMounted) return;

            if (snap.exists()) {
              const data = snap.data() as FirestoreUserProfile;
              setUserProfile(data);
              if (data.role && ROLE_PROFILES[data.role]) {
                setFirebaseRole(data.role);
              } else {
                setFirebaseRole('customer');
              }
              if (data.onboardingCompleted === false || !data.gender || !data.phone) {
                setIsProfileOnboardingPending(true);
              } else {
                setIsProfileOnboardingPending(false);
              }
              setAuthStatus('ready');
              setAuthError(null);
            } else {
              // "Handle auth user exists but profile doc missing by creating a safe default profile with the lowest-privilege role."
              try {
                const safeProfile = await ensureFirestoreUserProfile(fbUser, 'customer');
                if (isMounted) {
                  setUserProfile(safeProfile);
                  setFirebaseRole('customer');
                  setIsProfileOnboardingPending(true);
                  setAuthStatus('ready');
                  setAuthError(null);
                }
              } catch (profileErr: any) {
                console.error('[Auth] Failed to initialize default profile:', profileErr);
                if (isMounted) {
                  setAuthStatus('error');
                  setAuthError(profileErr?.message || 'Failed to initialize user profile.');
                }
              }
            }
          },
          (snapErr) => {
            console.error('[Auth] Profile onSnapshot error:', snapErr);
            if (isMounted) {
              setAuthStatus('error');
              setAuthError(snapErr.message);
            }
          }
        );
      },
      (authErr) => {
        console.error('[Auth] onAuthStateChanged error:', authErr);
        if (isMounted) {
          setAuthStatus('error');
          setAuthError(authErr.message);
        }
      }
    );

    return () => {
      isMounted = false;
      unsubAuth();
      if (unsubProfileRef.current) {
        unsubProfileRef.current();
        unsubProfileRef.current = null;
      }
    };
  }, [isDemoModeSupported, dataSource]);

  // Derived Business ID: Synchronized with user profile or default business
  const activeBizId = useMemo(() => {
    if (firebaseUser && userProfile?.bizId) {
      return userProfile.bizId;
    }
    return 'biz-aerocool';
  }, [firebaseUser, userProfile]);

  // Role resolution: In live mode, role comes strictly from Firestore users/{uid}.role
  const activeRole: UserRole =
    dataSource === 'live' && firebaseUser ? firebaseRole : demoRole;

  const sessionPresentation: 'authenticated' | 'demo' | 'unauthenticated' = firebaseUser
    ? 'authenticated'
    : isDemoModeSupported && dataSource === 'demo'
      ? 'demo'
      : 'unauthenticated';

  const activeProfile = useMemo<RoleProfile>(() => {
    const base = ROLE_PROFILES[activeRole] || ROLE_PROFILES.customer;
    if (firebaseUser) {
      const displayName =
        userProfile?.displayName ||
        firebaseUser.displayName ||
        firebaseUser.email?.split('@')[0] ||
        base.userName;
      const initials = displayName
        .split(' ')
        .map((n) => n[0])
        .join('')
        .slice(0, 2)
        .toUpperCase();
      return {
        ...base,
        userName: displayName,
        userEmail: firebaseUser.email || base.userEmail,
        avatarInitials: initials || base.avatarInitials,
      };
    }
    if (sessionPresentation === 'unauthenticated') {
      return {
        ...base,
        userName: 'Guest Visitor',
        userTitle: 'Sign in to access portal',
        userEmail: '',
        avatarInitials: 'AC',
        workspaceName: 'AC PayPilot Public Catalog',
        accentChipLabel: 'Public Visitor',
      };
    }
    return base;
  }, [activeRole, firebaseUser, userProfile, sessionPresentation]);

  const setRole = (newRole: UserRole, navigateToHome = false) => {
    if (dataSource === 'demo' && isDemoModeSupported) {
      setDemoRoleState(newRole);
      try {
        localStorage.setItem('paypilot_active_role', newRole);
      } catch {
        // ignore
      }
      if (navigateToHome) {
        navigate(ROLE_PROFILES[newRole].homeRoute);
      }
      return;
    }
    console.warn('[SECURITY] Role changes in live mode are server-governed and cannot be mutated by client.');
  };

  const signInWithGoogle = async () => {
    setAuthError(null);
    try {
      const cred = await signInWithGooglePopup();
      if (cred.user) {
        await ensureFirestoreUserProfile(cred.user, 'customer');
        setDataSourceState('live');
      }
    } catch (err: any) {
      console.error('Google Sign-In failed:', err);
      setAuthError(err?.message || 'Google authentication failed.');
      throw err;
    }
  };

  const signInWithFacebook = async () => {
    setAuthError(null);
    try {
      const cred = await signInWithFacebookPopup();
      if (cred.user) {
        await ensureFirestoreUserProfile(cred.user, 'customer');
        setDataSourceState('live');
      }
    } catch (err: any) {
      console.error('Facebook Sign-In failed:', err);
      setAuthError(err?.message || 'Facebook authentication failed.');
      throw err;
    }
  };

  const signInWithEmail = async (email: string, pass: string) => {
    setAuthError(null);
    try {
      const cred = await signInWithEmailPassword(email, pass);
      if (cred.user) {
        await ensureFirestoreUserProfile(cred.user, 'customer');
        setDataSourceState('live');
      }
    } catch (err: any) {
      console.error('Email sign-in failed:', err);
      setAuthError(err?.message || 'Invalid email or password.');
      throw err;
    }
  };

  const signUpWithEmail = async (email: string, pass: string, _targetRole?: UserRole) => {
    setAuthError(null);
    try {
      const cred = await signUpWithEmailPassword(email, pass);
      if (cred.user) {
        await ensureFirestoreUserProfile(cred.user, 'customer');
        setDataSourceState('live');
        setIsProfileOnboardingPending(true);
      }
    } catch (err: any) {
      console.error('Email registration failed:', err);
      setAuthError(err?.message || 'Registration failed.');
      throw err;
    }
  };

  const completeProfileOnboarding = async (details: {
    name: string;
    gender: 'Male' | 'Female' | 'Non-binary' | 'Prefer not to say';
    phone: string;
    countryCode: string;
    age: number;
    email?: string;
  }) => {
    if (!firebaseUser) {
      throw new Error('Must be authenticated to complete onboarding');
    }
    const normalizedEmail = details.email?.trim() || firebaseUser.email || undefined;
    await updateFirestoreUserProfile(firebaseUser.uid, {
      displayName: details.name,
      gender: details.gender,
      phone: details.phone,
      countryCode: details.countryCode,
      age: details.age,
      ...(normalizedEmail ? { email: normalizedEmail } : {}),
      onboardingCompleted: true,
    });
    setIsProfileOnboardingPending(false);
  };

  const dismissProfileOnboarding = () => {
    setIsProfileOnboardingPending(false);
  };

  const openAuthModal = (_targetRole?: UserRole) => {
    setIsAuthModalOpen(true);
  };

  const closeAuthModal = () => {
    setIsAuthModalOpen(false);
  };

  const signOutUser = async () => {
    try {
      if (unsubProfileRef.current) {
        unsubProfileRef.current();
        unsubProfileRef.current = null;
      }
      await signOutFirebase();
      setFirebaseUser(null);
      setUserProfile(null);
      setIsProfileOnboardingPending(false);

      // Clear all caches, listeners, and storage keys tied to the user
      try {
        const keys = Object.keys(localStorage);
        for (const k of keys) {
          if (k.startsWith('paypilot_') || k.startsWith('ac_') || k.includes('profile')) {
            localStorage.removeItem(k);
          }
        }
        sessionStorage.clear();
      } catch (storageErr) {
        console.warn('Storage cleanup notice:', storageErr);
      }

      setAuthStatus('unauthenticated');
      navigate('/login');
    } catch (err) {
      console.error('Sign-out error:', err);
    }
  };

  // Authoritative actor headers attached with active session token or demo token
  const getActorHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (cachedTokenRef.current) {
      headers['Authorization'] = `Bearer ${cachedTokenRef.current}`;
    } else if (dataSource === 'demo' || isDemoModeSupported) {
      headers['Authorization'] = `Bearer demo-token-${activeRole}-demo-user-${activeRole}-${activeBizId}`;
    }
    return headers;
  };

  const setDataSource = (source: DataSource) => {
    if (!isDemoModeSupported && source === 'demo') {
      console.warn('[SECURITY] Demo mode is disabled in production environment.');
      return;
    }
    setDataSourceState(source);
    if (source === 'demo') {
      setServerConfirmed(false);
    }
    try {
      localStorage.setItem('paypilot_data_source', source);
    } catch {
      // ignore
    }
  };

  const applyDemoStep = (index: number) => {
    if (!isDemoModeSupported) return;
    const step = DEMO_TOUR_STEPS[index];
    if (!step) {
      setDemoStepIndex(null);
      return;
    }
    setDemoStepIndex(index);
    setDataSource('demo');
    setDemoRoleState(step.role);
    try {
      localStorage.setItem('paypilot_active_role', step.role);
    } catch {
      // ignore
    }
    navigate(step.route);
  };

  const startDemoTour = () => applyDemoStep(0);

  const nextDemoStep = () => {
    if (demoStepIndex === null) return;
    if (demoStepIndex + 1 < DEMO_TOUR_STEPS.length) {
      applyDemoStep(demoStepIndex + 1);
    } else {
      setDemoStepIndex(null);
    }
  };

  const prevDemoStep = () => {
    if (demoStepIndex === null || demoStepIndex <= 0) return;
    applyDemoStep(demoStepIndex - 1);
  };

  const stopDemoTour = () => setDemoStepIndex(null);

  const goToDemoStep = (index: number) => {
    if (index >= 0 && index < DEMO_TOUR_STEPS.length) {
      applyDemoStep(index);
    }
  };

  const value = useMemo<RoleContextValue>(
    () => ({
      role: activeRole,
      profile: activeProfile,
      authStatus,
      sessionPresentation,
      authError,
      authSource: firebaseUser ? 'auth-provider' : 'demo-switcher',
      isAuthenticated: Boolean(firebaseUser) || (isDemoModeSupported && dataSource === 'demo'),
      firebaseUser,
      userProfile,
      authLoading: authStatus === 'loading' || authStatus === 'authenticated-profile-loading',
      firestoreConnected,
      signInWithGoogle,
      signInWithFacebook,
      signInWithEmail,
      signUpWithEmail,
      signOutUser,
      setRole,
      getActorHeaders,
      authFetch: authenticatedFetch,
      dataSource,
      setDataSource,
      activeBizId,
      isDemoMode: dataSource === 'demo' && isDemoModeSupported,
      isDemoModeSupported,
      serverConfirmed,
      setServerConfirmed,
      feesVerified,
      setFeesVerified,
      lastServerOrderId,
      setLastServerOrderId,
      isDemoTourActive: demoStepIndex !== null,
      demoStepIndex,
      currentDemoStep: demoStepIndex !== null ? DEMO_TOUR_STEPS[demoStepIndex] : null,
      startDemoTour,
      nextDemoStep,
      prevDemoStep,
      stopDemoTour,
      goToDemoStep,
      isProfileOnboardingPending,
      completeProfileOnboarding,
      dismissProfileOnboarding,
      isAuthModalOpen,
      openAuthModal,
      closeAuthModal,
    }),
    [
      activeRole,
      activeProfile,
      authStatus,
      sessionPresentation,
      authError,
      firebaseUser,
      userProfile,
      firestoreConnected,
      dataSource,
      activeBizId,
      isDemoModeSupported,
      serverConfirmed,
      feesVerified,
      lastServerOrderId,
      demoStepIndex,
      isProfileOnboardingPending,
      isAuthModalOpen,
    ]
  );

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
};

export function useRole(): RoleContextValue {
  const ctx = useContext(RoleContext);
  if (!ctx) {
    throw new Error('useRole must be used within a RoleProvider');
  }
  return ctx;
}
