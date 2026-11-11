import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  where,
} from 'firebase/firestore';
import {
  db,
  auth,
  handleFirestoreError,
  OperationType,
  onAuthStateChanged,
  FirebaseUser,
} from '../firebase';
import { authenticatedFetch } from './apiClient';
import {
  BusinessProfile,
  StorefrontConfig,
  StoreProduct,
  StorefrontOrder,
} from '../types/storefront';
import {
  getDefaultStorefrontConfig,
  SEED_STORE_PRODUCTS,
} from '../data/templateDefaults';

export const DEFAULT_BIZ_ID = 'biz-aerocool';
export const DEFAULT_SLUG = 'aerocool';

export const INITIAL_DEFAULT_BUSINESS: BusinessProfile = {
  id: DEFAULT_BIZ_ID,
  ownerUid: 'owner-default-1',
  name: 'AeroCool Dynamics',
  slug: DEFAULT_SLUG,
  category: 'Smart Hardware & Audio',
  tagline: 'Autonomous Precision Engineering & Escrow Protected Commerce',
  logoUrl:
    'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=200&auto=format&fit=crop&q=80',
  contact: {
    email: 'support@aerocool.in',
    phone: '+91 80 4920 1888',
    address: 'Embassy TechVillage, Outer Ring Rd, Bellandur, Bengaluru, Karnataka 560103',
    whatsappNumber: '+919876543210',
  },
  currency: 'INR',
  taxGstNumber: '29ABCDE1234F1Z5',
  paypalConnected: true,
  paypalEmail: 'merchant@aerocool.in',
  paypalClientId: 'sb-merchant-acpaypilot-live',
  shippingPolicy:
    'Standard express dispatch within 24 hours. Transit window 2-4 business days across India with live GPS courier tracking.',
  returnPolicy:
    '7-day no-questions-asked return window. Funds remain locked in PayPal escrow until package return verification.',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  roleMembers: {
    'owner-default-1': 'owner',
  },
};

/**
 * Initializes default store if database does not yet have it.
 */
export async function ensureDefaultStoreExists(): Promise<void> {
  try {
    const bizRef = doc(db, 'businesses', DEFAULT_BIZ_ID);
    const snap = await getDoc(bizRef);
    if (!snap.exists()) {
      await setDoc(bizRef, INITIAL_DEFAULT_BUSINESS);

      // Save initial config
      const config = getDefaultStorefrontConfig(
        DEFAULT_BIZ_ID,
        INITIAL_DEFAULT_BUSINESS.name,
        INITIAL_DEFAULT_BUSINESS.category
      );
      await setDoc(doc(db, 'businesses', DEFAULT_BIZ_ID, 'storefrontConfig', 'current'), config);

      // Seed initial products
      for (const prod of SEED_STORE_PRODUCTS) {
        await setDoc(doc(db, 'businesses', DEFAULT_BIZ_ID, 'products', prod.id), prod);
      }

      // Map domain slug
      await setDoc(doc(db, 'domains', DEFAULT_SLUG), {
        domain: `${DEFAULT_SLUG}.acpaypilot.app`,
        bizId: DEFAULT_BIZ_ID,
        slug: DEFAULT_SLUG,
        status: 'ssl_issued',
        verifiedAt: new Date().toISOString(),
      });
    }
  } catch (err) {
    console.warn('Could not auto-seed default store in Firestore; falling back gracefully:', err);
  }
}

/**
 * Subscribes to real-time Business profile.
 */
export function subscribeBusiness(
  bizId: string,
  onData: (business: BusinessProfile) => void,
  onError?: (err: Error) => void
): () => void {
  const path = `businesses/${bizId}`;
  const bizRef = doc(db, 'businesses', bizId);

  return onSnapshot(
    bizRef,
    (snap) => {
      if (snap.exists()) {
        onData(snap.data() as BusinessProfile);
      } else if (bizId === DEFAULT_BIZ_ID) {
        onData(INITIAL_DEFAULT_BUSINESS);
      } else {
        const u = auth.currentUser;
        const name = u?.displayName ? `${u.displayName}'s Store` : 'My Merchant Store';
        const slug = u?.email
          ? u.email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '')
          : bizId.replace('biz-', '');
        onData({
          ...INITIAL_DEFAULT_BUSINESS,
          id: bizId,
          name,
          slug,
          ownerUid: u?.uid || 'user',
          tagline: 'Autonomous B2B Commerce & Escrow Protected Store',
          contact: {
            ...INITIAL_DEFAULT_BUSINESS.contact,
            email: u?.email || 'merchant@paypilot.app',
          },
        });
      }
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, path);
      if (onError) onError(error);
    }
  );
}

/**
 * Subscribes to real-time Storefront Configuration.
 */
export function subscribeStorefrontConfig(
  bizId: string,
  onData: (config: StorefrontConfig) => void,
  onError?: (err: Error) => void
): () => void {
  const path = `businesses/${bizId}/storefrontConfig/current`;
  const configRef = doc(db, 'businesses', bizId, 'storefrontConfig', 'current');

  return onSnapshot(
    configRef,
    (snap) => {
      if (snap.exists()) {
        onData(snap.data() as StorefrontConfig);
      } else {
        const defaultConfig = getDefaultStorefrontConfig(
          bizId,
          INITIAL_DEFAULT_BUSINESS.name,
          INITIAL_DEFAULT_BUSINESS.category
        );
        onData(defaultConfig);
      }
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, path);
      if (onError) onError(error);
    }
  );
}

/**
 * Subscribes to real-time Products list for a merchant.
 */
export function subscribeStoreProducts(
  bizId: string,
  onData: (products: StoreProduct[]) => void,
  onError?: (err: Error) => void
): () => void {
  const path = `businesses/${bizId}/products`;
  const prodsRef = collection(db, 'businesses', bizId, 'products');

  return onSnapshot(
    prodsRef,
    (snap) => {
      const items: StoreProduct[] = [];
      snap.forEach((d) => {
        items.push({ id: d.id, ...(d.data() as Omit<StoreProduct, 'id'>) });
      });
      if (items.length === 0) {
        onData(bizId === DEFAULT_BIZ_ID ? SEED_STORE_PRODUCTS : []);
      } else {
        onData(items);
      }
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
      if (onError) onError(error);
    }
  );
}

/**
 * Subscribes to real-time Orders stream for a merchant (Storefront -> Portal).
 * Adheres strictly to Firebase guidelines: only attaches onSnapshot when authenticated.
 */
export function subscribeStoreOrders(
  bizId: string,
  onData: (orders: StorefrontOrder[]) => void,
  onError?: (err: Error) => void
): () => void {
  let unsubSnapshot: (() => void) | null = null;
  const path = `businesses/${bizId}/orders`;

  const attachListener = () => {
    if (unsubSnapshot) {
      unsubSnapshot();
      unsubSnapshot = null;
    }

    // Defensive check: Only attach onSnapshot listener if user is authenticated
    if (!auth.currentUser) {
      onData([]);
      return;
    }

    try {
      const ordersRef = collection(db, 'businesses', bizId, 'orders');
      unsubSnapshot = onSnapshot(
        ordersRef,
        (snap) => {
          const items: StorefrontOrder[] = [];
          snap.forEach((d) => {
            items.push({ id: d.id, ...(d.data() as Omit<StorefrontOrder, 'id'>) });
          });
          // Sort newest first
          items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          onData(items);
        },
        (error) => {
          // If auth was signed out, do not treat as an unhandled error
          if (auth.currentUser) {
            handleFirestoreError(error, OperationType.LIST, path);
          }
          if (onError) onError(error);
        }
      );
    } catch (err: any) {
      if (auth.currentUser) {
        handleFirestoreError(err, OperationType.LIST, path);
      }
      if (onError) onError(err);
    }
  };

  // Attach immediately if user is already authenticated
  if (auth.currentUser) {
    attachListener();
  } else {
    // Deliver empty initial list immediately for unauthenticated sessions
    onData([]);
  }

  // Listen for auth state transitions so when user signs in, live snapshot attaches
  const unsubAuth = onAuthStateChanged(auth, (user: FirebaseUser | null) => {
    if (user) {
      attachListener();
    } else {
      if (unsubSnapshot) {
        unsubSnapshot();
        unsubSnapshot = null;
      }
      onData([]);
    }
  });

  return () => {
    unsubAuth();
    if (unsubSnapshot) {
      unsubSnapshot();
      unsubSnapshot = null;
    }
  };
}

/**
 * Saves or updates business profile.
 */
export async function saveBusinessProfile(
  bizId: string,
  data: Partial<BusinessProfile>
): Promise<void> {
  const path = `businesses/${bizId}`;
  const payload = {
    ...data,
    updatedAt: new Date().toISOString(),
  };

  // Immediate local persistence fallback
  try {
    const existingRaw = typeof localStorage !== 'undefined' ? localStorage.getItem(`ac_storefront_biz_${bizId}`) : null;
    const existing = existingRaw ? JSON.parse(existingRaw) : INITIAL_DEFAULT_BUSINESS;
    const merged = { ...existing, ...payload, id: bizId };
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(`ac_storefront_biz_${bizId}`, JSON.stringify(merged));
      if (data.slug) {
        localStorage.setItem(`ac_storefront_slug_${data.slug.toLowerCase()}`, bizId);
      }
    }
  } catch {
    // Ignore storage errors
  }

  try {
    const bizRef = doc(db, 'businesses', bizId);
    const snap = await getDoc(bizRef);
    if (snap.exists()) {
      await updateDoc(bizRef, payload);
    } else {
      await setDoc(bizRef, {
        ...INITIAL_DEFAULT_BUSINESS,
        ...payload,
        id: bizId,
        ownerUid: auth.currentUser?.uid || 'anonymous-owner',
      });
    }

    // Also register domain if slug provided
    if (data.slug) {
      try {
        await setDoc(doc(db, 'domains', data.slug.toLowerCase()), {
          domain: `${data.slug.toLowerCase()}.acpaypilot.app`,
          bizId,
          slug: data.slug.toLowerCase(),
          status: 'ssl_issued',
          verifiedAt: new Date().toISOString(),
        });
      } catch (domainErr) {
        console.warn('Domain document registration in Firestore deferred, cached locally:', domainErr);
      }
    }
  } catch (error) {
    console.warn(`Firestore saveBusinessProfile (${path}) deferred to local cache:`, error);
  }
}

/**
 * Saves storefront configuration (draft or publish).
 */
export async function saveStorefrontConfig(
  bizId: string,
  config: StorefrontConfig,
  publish = false
): Promise<void> {
  const path = `businesses/${bizId}/storefrontConfig/current`;
  const updated: StorefrontConfig = {
    ...config,
    isPublished: publish ? true : config.isPublished,
    lastPublishedAt: publish ? new Date().toISOString() : config.lastPublishedAt,
    version: ((config.version || 1) + 1),
  };

  // Immediate local persistence fallback
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(`ac_storefront_cfg_${bizId}`, JSON.stringify(updated));
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('ac-storefront-updated', { detail: { bizId, config: updated } }));
    }
  } catch {
    // Ignore storage errors
  }

  try {
    const configRef = doc(db, 'businesses', bizId, 'storefrontConfig', 'current');
    await setDoc(configRef, updated);
  } catch (error) {
    console.warn(`Firestore saveStorefrontConfig (${path}) deferred to local cache:`, error);
  }
}

/**
 * Creates a new product in the merchant store.
 */
export async function createStoreProduct(
  bizId: string,
  product: Omit<StoreProduct, 'id'>
): Promise<StoreProduct> {
  const prodId = `prod-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
  const path = `businesses/${bizId}/products/${prodId}`;
  try {
    const newProduct: StoreProduct = {
      ...product,
      id: prodId,
      bizId,
      createdAt: new Date().toISOString(),
    };
    await setDoc(doc(db, 'businesses', bizId, 'products', prodId), newProduct);
    return newProduct;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
    throw error;
  }
}

/**
 * Updates an existing store product.
 */
export async function updateStoreProduct(
  bizId: string,
  productId: string,
  updates: Partial<StoreProduct>
): Promise<void> {
  const path = `businesses/${bizId}/products/${productId}`;
  try {
    await updateDoc(doc(db, 'businesses', bizId, 'products', productId), updates);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
    throw error;
  }
}

/**
 * Deletes a store product.
 */
export async function deleteStoreProduct(bizId: string, productId: string): Promise<void> {
  const path = `businesses/${bizId}/products/${productId}`;
  try {
    await deleteDoc(doc(db, 'businesses', bizId, 'products', productId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
    throw error;
  }
}

export interface LiveOrderNotification {
  id: string;
  bizId?: string;
  orderNumber: string;
  customerName: string;
  productSummary: string;
  totalInr: number;
  escrowStatus: string;
  createdAt: string;
  rawOrder?: StorefrontOrder;
}

const LIVE_ORDER_CHANNEL_NAME = 'ac_paypilot_live_orders';
const LIVE_ORDER_DOM_EVENT = 'ac_paypilot_new_order';

/**
 * Emits a real-time order notification across same-tab listeners, cross-tab BroadcastChannel,
 * and the Express SSE stream (/api/orders/notify -> /api/orders/stream).
 */
export function emitOrderPlacedNotification(notification: LiveOrderNotification): void {
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent(LIVE_ORDER_DOM_EVENT, { detail: notification }));
    } catch {
      // Ignore DOM event errors
    }

    if (typeof BroadcastChannel !== 'undefined') {
      try {
        const bc = new BroadcastChannel(LIVE_ORDER_CHANNEL_NAME);
        bc.postMessage(notification);
        bc.close();
      } catch {
        // Ignore BroadcastChannel errors
      }
    }

    fetch('/api/orders/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(notification),
    }).catch(() => {
      // Non-fatal if offline
    });
  }
}

/**
 * Subscribes to real-time customer order creations for the Seller Dashboard.
 * Combines:
 *  1) Firestore onSnapshot docChanges() (when authenticated)
 *  2) Cross-tab BroadcastChannel ('ac_paypilot_live_orders')
 *  3) Same-tab CustomEvent ('ac_paypilot_new_order')
 *  4) Server-Sent Events ('/api/orders/stream')
 * Deduplicates by order ID and orderNumber so each new order triggers at most once.
 */
export function subscribeNewOrderNotifications(
  bizId: string,
  onNewOrder: (notification: LiveOrderNotification) => void
): () => void {
  const seenKeys = new Set<string>();

  const deliverOnce = (notif: LiveOrderNotification) => {
    if (!notif || (!notif.id && !notif.orderNumber)) return;
    if (notif.bizId && notif.bizId !== bizId) return;
    const keyId = notif.id || notif.orderNumber;
    const keyNum = notif.orderNumber || notif.id;
    if (seenKeys.has(keyId) || seenKeys.has(keyNum)) return;
    seenKeys.add(keyId);
    seenKeys.add(keyNum);
    onNewOrder(notif);
  };

  // 1. Firestore real-time listener (authenticated sessions)
  let unsubFirestore: (() => void) | null = null;
  let initialSnapshotDone = false;

  const attachFirestore = () => {
    if (unsubFirestore || !auth.currentUser) return;
    initialSnapshotDone = false;
    try {
      unsubFirestore = onSnapshot(
        collection(db, 'businesses', bizId, 'orders'),
        (snap) => {
          if (!initialSnapshotDone) {
            snap.docs.forEach((d) => {
              seenKeys.add(d.id);
              const data = d.data() as Partial<StorefrontOrder>;
              if (data.orderNumber) seenKeys.add(data.orderNumber);
            });
            initialSnapshotDone = true;
            return;
          }

          snap.docChanges().forEach((change) => {
            if (change.type === 'added') {
              const data = change.doc.data() as StorefrontOrder;
              const firstItem = data.items?.[0]?.name || 'Storefront Item';
              const extraCount = (data.items?.length || 1) - 1;
              deliverOnce({
                id: change.doc.id,
                bizId,
                orderNumber: data.orderNumber || change.doc.id,
                customerName: data.customerName || 'Verified Buyer',
                productSummary:
                  extraCount > 0 ? `${firstItem} +${extraCount} more` : firstItem,
                totalInr: Number(data.total || 0),
                escrowStatus: data.escrowStatus || 'Escrow Locked',
                createdAt: data.createdAt || new Date().toISOString(),
                rawOrder: { ...data, id: change.doc.id },
              });
            }
          });
        },
        () => {
          // Handled silently if user signs out
        }
      );
    } catch {
      // Ignore setup errors
    }
  };

  if (auth.currentUser) {
    attachFirestore();
  }

  const unsubAuth = onAuthStateChanged(auth, (user: FirebaseUser | null) => {
    if (user) {
      attachFirestore();
    } else if (unsubFirestore) {
      unsubFirestore();
      unsubFirestore = null;
    }
  });

  // 2. Same-tab DOM CustomEvent
  const handleDomEvent = (e: Event) => {
    const customEvt = e as CustomEvent<LiveOrderNotification>;
    if (customEvt.detail) {
      deliverOnce(customEvt.detail);
    }
  };
  if (typeof window !== 'undefined') {
    window.addEventListener(LIVE_ORDER_DOM_EVENT, handleDomEvent);
  }

  // 3. Cross-tab BroadcastChannel
  let bc: BroadcastChannel | null = null;
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      bc = new BroadcastChannel(LIVE_ORDER_CHANNEL_NAME);
      bc.onmessage = (event) => {
        if (event?.data && (event.data.id || event.data.orderNumber)) {
          deliverOnce(event.data as LiveOrderNotification);
        }
      };
    } catch {
      bc = null;
    }
  }

  // 4. Server-Sent Events (/api/orders/stream)
  let es: EventSource | null = null;
  if (typeof window !== 'undefined' && typeof EventSource !== 'undefined') {
    try {
      es = new EventSource('/api/orders/stream');
      es.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          if (parsed && parsed.type !== 'connected' && (parsed.id || parsed.orderNumber)) {
            deliverOnce(parsed as LiveOrderNotification);
          }
        } catch {
          // Ignore malformed event
        }
      };
    } catch {
      es = null;
    }
  }

  return () => {
    unsubAuth();
    if (unsubFirestore) {
      unsubFirestore();
      unsubFirestore = null;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener(LIVE_ORDER_DOM_EVENT, handleDomEvent);
    }
    if (bc) {
      try {
        bc.close();
      } catch {
        // Ignore
      }
    }
    if (es) {
      try {
        es.close();
      } catch {
        // Ignore
      }
    }
  };
}

/**
 * Places a customer order from the public storefront.
 * Instantaneously synchronizes with the Seller Portal via Firestore, BroadcastChannel, and Server SSE!
 */
export async function createStorefrontOrder(
  bizId: string,
  orderData: Omit<StorefrontOrder, 'id' | 'createdAt' | 'timeline'>
): Promise<StorefrontOrder> {
  const response = await authenticatedFetch('/api/storefront/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...orderData, bizId }),
  });
  const payload = (await response.json().catch(() => ({}))) as any;
  if (!response.ok || !payload?.order) {
    throw new Error(payload?.error || 'Unable to place storefront order.');
  }

  const newOrder = payload.order as StorefrontOrder;
  const firstItem = newOrder.items?.[0]?.name || 'Storefront Order';
  const extraCount = (newOrder.items?.length || 1) - 1;
  emitOrderPlacedNotification({
    id: newOrder.id,
    bizId,
    orderNumber: newOrder.orderNumber,
    customerName: newOrder.customerName,
    productSummary: extraCount > 0 ? `${firstItem} +${extraCount} more` : firstItem,
    totalInr: newOrder.total,
    escrowStatus: newOrder.escrowStatus,
    createdAt: newOrder.createdAt,
    rawOrder: newOrder,
  });

  return newOrder;
}

/**
 * Updates an order escrow or fulfillment state (Seller Portal action).
 */
export async function updateStorefrontOrderEscrow(
  bizId: string,
  orderId: string,
  newEscrowStatus: StorefrontOrder['escrowStatus'],
  reason?: string
): Promise<void> {
  const response = await authenticatedFetch(
    `/api/storefront/orders/${encodeURIComponent(orderId)}/escrow-status`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bizId,
        escrowStatus: newEscrowStatus,
        reason,
      }),
    }
  );
  const payload = (await response.json().catch(() => ({}))) as any;
  if (!response.ok) {
    throw new Error(payload?.error || 'Unable to update storefront order status.');
  }
}

/**
 * Resolves a store slug or custom domain to its business profile and configuration.
 */
export async function resolveStoreBySlug(
  slug: string
): Promise<{ business: BusinessProfile; config: StorefrontConfig; products: StoreProduct[] } | null> {
  try {
    const cleanSlug = slug.toLowerCase().trim();
    // 1. Check domains mapping
    const domainSnap = await getDoc(doc(db, 'domains', cleanSlug));
    let bizId = DEFAULT_BIZ_ID;
    if (domainSnap.exists()) {
      bizId = domainSnap.data().bizId;
    } else {
      // Direct query on businesses collection
      const q = query(collection(db, 'businesses'), where('slug', '==', cleanSlug));
      const res = await getDocs(q);
      if (!res.empty) {
        bizId = res.docs[0].id;
      }
    }

    const [bizSnap, configSnap, prodsSnap] = await Promise.all([
      getDoc(doc(db, 'businesses', bizId)),
      getDoc(doc(db, 'businesses', bizId, 'storefrontConfig', 'current')),
      getDocs(collection(db, 'businesses', bizId, 'products')),
    ]);

    const business = bizSnap.exists()
      ? (bizSnap.data() as BusinessProfile)
      : INITIAL_DEFAULT_BUSINESS;

    const config = configSnap.exists()
      ? (configSnap.data() as StorefrontConfig)
      : getDefaultStorefrontConfig(bizId, business.name, business.category);

    const products: StoreProduct[] = [];
    prodsSnap.forEach((d) => {
      products.push({ id: d.id, ...(d.data() as Omit<StoreProduct, 'id'>) });
    });

    return {
      business,
      config,
      products: products.length > 0 ? products : SEED_STORE_PRODUCTS,
    };
  } catch (err) {
    console.warn('Error resolving store by slug:', err);
    return {
      business: INITIAL_DEFAULT_BUSINESS,
      config: getDefaultStorefrontConfig(
        DEFAULT_BIZ_ID,
        INITIAL_DEFAULT_BUSINESS.name,
        INITIAL_DEFAULT_BUSINESS.category
      ),
      products: SEED_STORE_PRODUCTS,
    };
  }
}
