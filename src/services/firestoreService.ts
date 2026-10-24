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
        uid: profile.uid,
        email: profile.email,
        displayName: profile.storeName,
        role: profile.role,
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
 * Saves a product to Firestore products collection.
 */
export async function saveProductToFirestore(product: FirestoreProduct): Promise<boolean> {
  const path = `products/${product.id}`;
  try {
    await setDoc(doc(db, 'products', product.id), product);
    return true;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
    return false;
  }
}

/**
 * Deletes a product from Firestore.
 */
export async function deleteProductFromFirestore(productId: string): Promise<boolean> {
  const path = `products/${productId}`;
  try {
    await deleteDoc(doc(db, 'products', productId));
    return true;
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
    return false;
  }
}

/**
 * Fetches all products from Firestore, with fallback.
 */
export async function fetchProductsFromFirestore(): Promise<FirestoreProduct[]> {
  const path = 'products';
  try {
    const snap = await getDocs(collection(db, path));
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
 * Subscribes to live products collection updates.
 */
export function subscribeToProducts(
  onUpdate: (products: FirestoreProduct[]) => void,
  onError?: (err: unknown) => void
): () => void {
  const path = 'products';
  try {
    return onSnapshot(
      collection(db, path),
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
 * Saves an invoice to Firestore.
 */
export async function saveInvoiceToFirestore(invoice: FirestoreInvoice): Promise<boolean> {
  const path = `invoices/${invoice.id}`;
  try {
    await setDoc(doc(db, 'invoices', invoice.id), invoice);
    return true;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
    return false;
  }
}

/**
 * Fetches invoices from Firestore.
 */
export async function fetchInvoicesFromFirestore(): Promise<FirestoreInvoice[]> {
  const path = 'invoices';
  try {
    const snap = await getDocs(collection(db, path));
    const list: FirestoreInvoice[] = [];
    snap.forEach((d) => list.push(d.data() as FirestoreInvoice));
    return list;
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
    return [];
  }
}

/**
 * Records an escrow audit event in Firestore append-only collection.
 */
export async function recordEscrowEventInFirestore(
  event: FirestoreEscrowEvent
): Promise<boolean> {
  const path = `escrowEvents/${event.id}`;
  try {
    await setDoc(doc(db, 'escrowEvents', event.id), event);
    return true;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
    return false;
  }
}
