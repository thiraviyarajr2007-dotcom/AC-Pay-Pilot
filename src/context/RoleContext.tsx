import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppRoute, DataSource, UserRole } from '../types';
import {
  auth,
  onAuthStateChanged,
  FirebaseUser,
  ensureFirestoreUserProfile,
  updateFirestoreUserRole,
  signInWithGooglePopup,
  signOutFirebase,
  testFirestoreConnection,
} from '../firebase';

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
  authSource: 'demo-switcher' | 'auth-provider';
  isAuthenticated: boolean;
  firebaseUser: FirebaseUser | null;
  authLoading: boolean;
  firestoreConnected: boolean;
  signInWithGoogle: () => Promise<void>;
  signOutUser: () => Promise<void>;
  setRole: (newRole: UserRole, navigateToHome?: boolean) => void;
  getActorHeaders: () => Record<string, string>;
  dataSource: DataSource;
  setDataSource: (source: DataSource) => void;
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
}

const RoleContext = createContext<RoleContextValue | undefined>(undefined);

export const RoleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const navigate = useNavigate();

  const [demoRole, setDemoRoleState] = useState<UserRole>(() => {
    try {
      const saved = localStorage.getItem('paypilot_active_role') as UserRole | null;
      if (saved && ROLE_PROFILES[saved]) return saved;
    } catch {
      // ignore storage errors
    }
    return 'seller';
  });

  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [firebaseRole, setFirebaseRole] = useState<UserRole>('customer');
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [firestoreConnected, setFirestoreConnected] = useState<boolean>(false);

  const [dataSource, setDataSourceState] = useState<DataSource>(() => {
    try {
      const saved = localStorage.getItem('paypilot_data_source') as DataSource | null;
      if (saved === 'demo' || saved === 'live') return saved;
    } catch {
      // ignore storage errors
    }
    return 'demo';
  });

  const [serverConfirmed, setServerConfirmed] = useState<boolean>(false);
  const [feesVerified, setFeesVerified] = useState<boolean>(false);
  const [lastServerOrderId, setLastServerOrderId] = useState<string | null>('ord-1');
  const [demoStepIndex, setDemoStepIndex] = useState<number | null>(null);

  useEffect(() => {
    testFirestoreConnection().then((ok) => setFirestoreConnected(ok));

    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      setFirebaseUser(fbUser);
      if (fbUser) {
        const userDoc = await ensureFirestoreUserProfile(fbUser, demoRole);
        if (userDoc.role && ROLE_PROFILES[userDoc.role]) {
          setFirebaseRole(userDoc.role);
        }
      }
      setAuthLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // In 'live' mode with a signed-in Firebase user, role comes from Firestore users/{uid}.role.
  // In 'demo' mode, the clearly labelled "Demo role" switcher controls the role.
  const activeRole: UserRole =
    dataSource === 'live' && firebaseUser ? firebaseRole : demoRole;

  const activeProfile = useMemo<RoleProfile>(() => {
    const base = ROLE_PROFILES[activeRole];
    if (firebaseUser) {
      const displayName =
        firebaseUser.displayName || firebaseUser.email?.split('@')[0] || base.userName;
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
    return base;
  }, [activeRole, firebaseUser]);

  const setRole = (newRole: UserRole, navigateToHome = false) => {
    setDemoRoleState(newRole);
    try {
      localStorage.setItem('paypilot_active_role', newRole);
    } catch {
      // ignore
    }
    if (firebaseUser) {
      setFirebaseRole(newRole);
      void updateFirestoreUserRole(firebaseUser.uid, newRole);
    }
    if (navigateToHome) {
      navigate(ROLE_PROFILES[newRole].homeRoute);
    }
  };

  const signInWithGoogle = async () => {
    try {
      const cred = await signInWithGooglePopup();
      if (cred.user) {
        const profileDoc = await ensureFirestoreUserProfile(cred.user, activeRole);
        setFirebaseRole(profileDoc.role);
        setDataSourceState('live');
      }
    } catch (err) {
      console.error('Google Sign-In error:', err);
    }
  };

  const signOutUser = async () => {
    try {
      await signOutFirebase();
      setFirebaseUser(null);
      setDataSourceState('demo');
    } catch (err) {
      console.error('Sign-out error:', err);
    }
  };

  const getActorHeaders = (): Record<string, string> => {
    const uid =
      firebaseUser?.uid ||
      (activeRole === 'customer'
        ? 'cust-demo-1'
        : activeRole === 'seller'
        ? 'seller-demo-1'
        : activeRole === 'finance'
        ? 'finance-demo-1'
        : 'exec-demo-1');
    return {
      'Content-Type': 'application/json',
      'x-actor-uid': uid,
      'x-actor-email': activeProfile.userEmail,
      'x-actor-role': activeRole,
    };
  };

  const setDataSource = (source: DataSource) => {
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
      authSource: firebaseUser ? 'auth-provider' : 'demo-switcher',
      isAuthenticated: Boolean(firebaseUser) || dataSource === 'demo',
      firebaseUser,
      authLoading,
      firestoreConnected,
      signInWithGoogle,
      signOutUser,
      setRole,
      getActorHeaders,
      dataSource,
      setDataSource,
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
    }),
    [
      activeRole,
      activeProfile,
      firebaseUser,
      authLoading,
      firestoreConnected,
      dataSource,
      serverConfirmed,
      feesVerified,
      lastServerOrderId,
      demoStepIndex,
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
