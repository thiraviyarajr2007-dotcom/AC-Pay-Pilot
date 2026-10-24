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
import { db, auth, handleFirestoreError, OperationType } from '../firebase';
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
      } else {
        onData(INITIAL_DEFAULT_BUSINESS);
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
        onData(SEED_STORE_PRODUCTS);
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
 */
export function subscribeStoreOrders(
  bizId: string,
  onData: (orders: StorefrontOrder[]) => void,
  onError?: (err: Error) => void
): () => void {
  const path = `businesses/${bizId}/orders`;
  const ordersRef = collection(db, 'businesses', bizId, 'orders');

  return onSnapshot(
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
      handleFirestoreError(error, OperationType.LIST, path);
      if (onError) onError(error);
    }
  );
}

/**
 * Saves or updates business profile.
 */
export async function saveBusinessProfile(
  bizId: string,
  data: Partial<BusinessProfile>
): Promise<void> {
  const path = `businesses/${bizId}`;
  try {
    const bizRef = doc(db, 'businesses', bizId);
    const snap = await getDoc(bizRef);
    const payload = {
      ...data,
      updatedAt: new Date().toISOString(),
    };
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
      await setDoc(doc(db, 'domains', data.slug.toLowerCase()), {
        domain: `${data.slug.toLowerCase()}.acpaypilot.app`,
        bizId,
        slug: data.slug.toLowerCase(),
        status: 'ssl_issued',
        verifiedAt: new Date().toISOString(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
    throw error;
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
  try {
    const configRef = doc(db, 'businesses', bizId, 'storefrontConfig', 'current');
    const updated: StorefrontConfig = {
      ...config,
      isPublished: publish ? true : config.isPublished,
      lastPublishedAt: publish ? new Date().toISOString() : config.lastPublishedAt,
      version: config.version + 1,
    };
    await setDoc(configRef, updated);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
    throw error;
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

/**
 * Places a customer order from the public storefront.
 * Instantaneously synchronizes with the Seller Portal via Firestore!
 */
export async function createStorefrontOrder(
  bizId: string,
  orderData: Omit<StorefrontOrder, 'id' | 'createdAt' | 'timeline'>
): Promise<StorefrontOrder> {
  const orderId = `ord-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const path = `businesses/${bizId}/orders/${orderId}`;
  try {
    const newOrder: StorefrontOrder = {
      ...orderData,
      id: orderId,
      createdAt: new Date().toISOString(),
      timeline: [
        {
          step: 'escrow_locked',
          label: 'Payment Verified & Secured in Escrow',
          timestamp: new Date().toISOString(),
          completed: true,
          current: true,
        },
        {
          step: 'packed',
          label: 'Merchant Processing & Packing',
          timestamp: '',
          completed: false,
        },
        {
          step: 'in_transit',
          label: 'Shipped via BlueDart Express Air',
          timestamp: '',
          completed: false,
        },
        {
          step: 'released',
          label: 'Delivery Verified & Escrow Released',
          timestamp: '',
          completed: false,
        },
      ],
    };

    await setDoc(doc(db, 'businesses', bizId, 'orders', orderId), newOrder);
    return newOrder;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
    throw error;
  }
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
  const path = `businesses/${bizId}/orders/${orderId}`;
  try {
    const orderRef = doc(db, 'businesses', bizId, 'orders', orderId);
    const snap = await getDoc(orderRef);
    if (!snap.exists()) return;

    const currentOrder = snap.data() as StorefrontOrder;
    const nowIso = new Date().toISOString();

    const updatedTimeline = currentOrder.timeline.map((item) => {
      if (newEscrowStatus === 'In Transit' && item.step === 'in_transit') {
        return { ...item, completed: true, timestamp: nowIso, current: true };
      }
      if (newEscrowStatus === 'Delivered — Escrow Released' && item.step === 'released') {
        return { ...item, completed: true, timestamp: nowIso, current: true };
      }
      return item;
    });

    await updateDoc(orderRef, {
      escrowStatus: newEscrowStatus,
      timeline: updatedTimeline,
      ...(reason ? { updateReason: reason } : {}),
      updatedAt: nowIso,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
    throw error;
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
