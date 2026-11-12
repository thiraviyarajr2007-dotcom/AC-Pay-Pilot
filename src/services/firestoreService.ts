import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType, auth } from '../firebase';
import { AppUserRole } from '../utils/rbac';
import { EscrowState } from '../utils/escrow';
import { CanonicalPaymentState } from '../components/ui/HonestTrustComponents';

export interface FirestoreProduct {
  id: string;
  sku: string;
  name: string;
  category: string;
  priceMinor: number;
  currency: 'INR' | 'USD';
  sellerId: string;
  stock: number;
  status: 'active' | 'draft' | 'archived';
  image?: string;
  modelUrl?: string | null;
  specs?: string[];
  dimensions?: string;
  weight?: string;
  warranty?: string;
  hsnCode?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface FirestoreMerchantProfile {
  uid: string;
  storeName: string;
  gstin: string;
  settlementAccount: string;
  ifscCode?: string;
  registeredState?: string;
  email: string;
  role: AppUserRole;
  notifications: {
    escrowRelease: boolean;
    overdueAutoChase: boolean;
    lowStockReorder: boolean;
    feeTierAlerts: boolean;
  };
  updatedAt: string;
}

export interface FirestoreInvoice {
  id: string;
  invoiceNumber: string;
  sellerId: string;
  customerId: string;
  clientName: string;
  clientGstin: string;
  placeOfSupplyCode: string;
  currency: 'INR' | 'USD';
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  invoiceStatus: 'draft' | 'issued' | 'overdue' | 'paid' | 'void';
  paymentStatus: CanonicalPaymentState;
  hsnCode?: string;
  lineItem?: string;
  auditClause?: string;
  issuedAt: string;
  dueDate: string;
  overdueDays?: number;
}

export interface FirestoreEscrowEvent {
  id: string;
  orderId: string;
  customerId?: string;
  sellerId?: string;
  fromState?: string;
  toState: EscrowState;
  actorId: string;
  actorRole: string;
  reason: string;
  timestamp: string;
}

/**
 * Persists or updates merchant profile settings in Firestore.
 */
export async function saveMerchantProfileToFirestore(
  profile: FirestoreMerchantProfile
): Promise<boolean> {
  const path = `users/${profile.uid}`;
  try {
    const userRef = doc(db, 'users', profile.uid);
    await setDoc(
      userRef,
      {
        email: profile.email,
        displayName: profile.storeName,
        storeName: profile.storeName,
        gstin: profile.gstin,
        settlementAccount: profile.settlementAccount,
        notifications: profile.notifications,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
    return true;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
    return false;
  }
}

/**
 * Reads merchant profile from Firestore users/{uid}.
 */
export async function getMerchantProfileFromFirestore(
  uid: string
): Promise<FirestoreMerchantProfile | null> {
  const path = `users/${uid}`;
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (snap.exists()) {
      const data = snap.data();
      return {
        uid,
        storeName: data.storeName || data.displayName || 'TechPilot Solutions Store (IN)',
        gstin: data.gstin || '29AABCC1234D1Z9',
        settlementAccount:
          data.settlementAccount || 'HDFC Bank Corporate •••• 9014 (IFSC: HDFC0001204)',
        email: data.email || 'seller@paypilot.in',
        role: data.role || 'seller',
        notifications: data.notifications || {
          escrowRelease: true,
          overdueAutoChase: true,
          lowStockReorder: true,
          feeTierAlerts: true,
        },
        updatedAt: data.updatedAt || new Date().toISOString(),
      };
    }
    return null;
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
    return null;
  }
}

/**
 * Saves a product to tenant-scoped Firestore businesses/{bizId}/products collection (SEC-011).
 */
export async function saveProductToFirestore(
  product: FirestoreProduct,
  bizId = 'biz-aerocool'
): Promise<boolean> {
  const path = `businesses/${bizId}/products/${product.id}`;
  try {
    await setDoc(doc(db, 'businesses', bizId, 'products', product.id), { ...product, bizId });
    return true;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
    return false;
  }
}

/**
 * Deletes a product from tenant-scoped Firestore businesses/{bizId}/products.
 */
export async function deleteProductFromFirestore(
  productId: string,
  bizId = 'biz-aerocool'
): Promise<boolean> {
  const path = `businesses/${bizId}/products/${productId}`;
  try {
    await deleteDoc(doc(db, 'businesses', bizId, 'products', productId));
    return true;
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
    return false;
  }
}

/**
 * Fetches tenant-scoped products from Firestore businesses/{bizId}/products.
 */
export async function fetchProductsFromFirestore(
  bizId = 'biz-aerocool'
): Promise<FirestoreProduct[]> {
  const path = `businesses/${bizId}/products`;
  try {
    const snap = await getDocs(collection(db, 'businesses', bizId, 'products'));
    const list: FirestoreProduct[] = [];
    snap.forEach((d) => {
      list.push(d.data() as FirestoreProduct);
    });
    return list;
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
    return [];
  }
}

/**
 * Subscribes to tenant-scoped live products collection updates.
 */
export function subscribeToProducts(
  onUpdate: (products: FirestoreProduct[]) => void,
  onError?: (err: unknown) => void,
  bizId = 'biz-aerocool'
): () => void {
  const path = `businesses/${bizId}/products`;
  try {
    return onSnapshot(
      collection(db, 'businesses', bizId, 'products'),
      (snap) => {
        const list: FirestoreProduct[] = [];
        snap.forEach((d) => list.push(d.data() as FirestoreProduct));
        onUpdate(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, path);
        onError?.(error);
      }
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
    return () => {};
  }
}

/**
 * Saves an invoice to tenant-scoped Firestore businesses/{bizId}/invoices.
 */
export async function saveInvoiceToFirestore(
  invoice: FirestoreInvoice,
  bizId = 'biz-aerocool'
): Promise<boolean> {
  const path = `businesses/${bizId}/invoices/${invoice.id}`;
  try {
    await setDoc(doc(db, 'businesses', bizId, 'invoices', invoice.id), { ...invoice, bizId });
    return true;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
    return false;
  }
}

/**
 * Fetches tenant-scoped invoices from Firestore businesses/{bizId}/invoices.
 */
export async function fetchInvoicesFromFirestore(
  bizId = 'biz-aerocool'
): Promise<FirestoreInvoice[]> {
  const path = `businesses/${bizId}/invoices`;
  try {
    const snap = await getDocs(collection(db, 'businesses', bizId, 'invoices'));
    const list: FirestoreInvoice[] = [];
    snap.forEach((d) => list.push(d.data() as FirestoreInvoice));
    return list;
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
    return [];
  }
}

/**
 * Records an escrow audit event in tenant-scoped businesses/{bizId}/escrowEvents.
 */
export async function recordEscrowEventInFirestore(
  event: FirestoreEscrowEvent,
  bizId = 'biz-aerocool'
): Promise<boolean> {
  const path = `businesses/${bizId}/escrowEvents/${event.id}`;
  try {
    await setDoc(doc(db, 'businesses', bizId, 'escrowEvents', event.id), { ...event, bizId });
    return true;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
    return false;
  }
}
