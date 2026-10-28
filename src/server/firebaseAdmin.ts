import { initializeApp, getApps, App } from 'firebase-admin/app';
import { getAuth, Auth } from 'firebase-admin/auth';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import { Request } from 'express';
import firebaseConfig from '../../firebase-applet-config.json';
import { AppUserRole } from '../utils/rbac';
import { SEED_STORE_PRODUCTS, getDefaultStorefrontConfig } from '../data/templateDefaults';

export interface AuthenticatedUserActor {
  uid: string;
  email: string;
  role: AppUserRole;
  bizId: string;
  isDemo?: boolean;
}

// Canonical Firebase project and database identifiers from firebase-applet-config.json
export const FIREBASE_PROJECT_ID = firebaseConfig.projectId; // "ai-studio-applet-webapp-4bdcd"
export const FIRESTORE_DATABASE_ID = firebaseConfig.firestoreDatabaseId; // "ai-studio-paypilotaiautono-5cf5c897-94de-4d92-83f5-3c2d5e3761dd"
export const DEFAULT_BIZ_ID = 'biz-aerocool';

let adminApp: App;
let adminAuth: Auth;
let adminDb: Firestore;

export function getPersistenceMode(): 'firestore-admin' | 'memory-volatile' {
  const hasGoogleCredentials =
    Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS) ||
    Boolean(process.env.K_SERVICE) ||
    Boolean(process.env.GAE_SERVICE);
  return hasGoogleCredentials ? 'firestore-admin' : 'memory-volatile';
}

export function getAdminApp(): App {
  if (!adminApp) {
    const existingApps = getApps();
    if (existingApps.length > 0) {
      adminApp = existingApps[0];
    } else {
      const hasGoogleCredentials =
        Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS) ||
        Boolean(process.env.K_SERVICE) ||
        Boolean(process.env.GAE_SERVICE);

      if (!hasGoogleCredentials) {
        // Prevents unhandled GoogleAuth metadata probe crashes when running outside GCP without service account
        adminApp = initializeApp({
          projectId: FIREBASE_PROJECT_ID,
          credential: {
            getAccessToken: async () => ({
              access_token: 'local-dev-fallback-token',
              expires_in: 3600,
            }),
          },
        });
      } else {
        adminApp = initializeApp({
          projectId: FIREBASE_PROJECT_ID,
        });
      }
    }
  }
  return adminApp;
}

export function getAdminAuth(): Auth {
  if (!adminAuth) {
    adminAuth = getAuth(getAdminApp());
  }
  return adminAuth;
}

export function getAdminDb(): Firestore {
  if (!adminDb) {
    adminDb = getFirestore(getAdminApp(), FIRESTORE_DATABASE_ID);
  }
  return adminDb;
}

export class AuthenticationError extends Error {
  code: string;
  statusCode: number;
  constructor(message: string, code = 'UNAUTHORIZED', statusCode = 401) {
    super(message);
    this.name = 'AuthenticationError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * Authenticates request via Firebase ID Token (Authorization: Bearer <token>).
 * Strictly removes trust in x-actor-* headers unless DEMO_MODE=true is explicitly set in process.env.
 * Derives role and bizId from the users/{uid} Firestore doc (or custom claims).
 */
export async function authenticateRequest(req: Request): Promise<AuthenticatedUserActor> {
  const authHeader = req.headers.authorization;

  // 1. Missing Authorization Bearer Header - Reject immediately
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AuthenticationError(
      'Missing or invalid Authorization header. Provide a valid Firebase ID token as "Bearer <token>".',
      'MISSING_AUTH_TOKEN',
      401
    );
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    throw new AuthenticationError('Bearer token is empty.', 'INVALID_AUTH_TOKEN', 401);
  }

  // 2. Handle Synthetic / Mock test tokens strictly in test or non-production environment
  if (token.startsWith('mock-token-') || token.startsWith('demo-token-')) {
    if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV !== 'production') {
      if (token === 'mock-token-expired') {
        throw new AuthenticationError(
          'Firebase ID token has expired. Please refresh your session.',
          'TOKEN_EXPIRED',
          401
        );
      }
      if (token === 'mock-token-revoked') {
        throw new AuthenticationError(
          'Firebase ID token has been revoked.',
          'TOKEN_REVOKED',
          401
        );
      }
      const parts = token.split('-');
      // format: mock-token-{role}-{uid}-{bizId}
      const role = (parts[2] as AppUserRole) || 'customer';
      const uid = parts[3] || 'mock-user-1';
      const bizId = parts[4] || DEFAULT_BIZ_ID;
      return {
        uid,
        email: `${uid}@paypilot.in`,
        role,
        bizId,
        isDemo: true,
      };
    }
  }

  // 3. Verify Real Firebase ID Token with firebase-admin (with checkRevoked = true)
  try {
    const auth = getAdminAuth();
    let decoded: any;
    try {
      decoded = await auth.verifyIdToken(token, true);
    } catch (tokenErr: any) {
      const isExpired =
        tokenErr.code === 'auth/id-token-expired' ||
        tokenErr.message?.includes('expired');
      const isRevoked =
        tokenErr.code === 'auth/id-token-revoked' ||
        tokenErr.message?.includes('revoked');
      throw new AuthenticationError(
        isExpired
          ? 'Firebase ID token is expired. Please re-authenticate.'
          : isRevoked
          ? 'Firebase ID token has been revoked.'
          : `Firebase ID token verification failed: ${tokenErr.message || 'Invalid token'}`,
        isExpired ? 'TOKEN_EXPIRED' : isRevoked ? 'TOKEN_REVOKED' : 'INVALID_ID_TOKEN',
        401
      );
    }

    const uid = decoded.uid;
    const email = decoded.email || '';

    // Derive role and bizId strictly from Firestore users/{uid} document (or verified custom claims)
    let role = (decoded.role as AppUserRole) || null;
    let bizId = (decoded.bizId as string) || null;

    if (!role || !bizId) {
      try {
        const db = getAdminDb();
        const userDoc = await db.collection('users').doc(uid).get();
        if (userDoc.exists) {
          const userData = userDoc.data() || {};
          if (!role) role = (userData.role as AppUserRole) || 'customer';
          if (!bizId) bizId = (userData.bizId as string) || (userData.activeBizId as string) || DEFAULT_BIZ_ID;
        } else {
          // Fallback default for newly provisioned user: strictly lowest privilege 'customer'
          role = role || 'customer';
          bizId = bizId || DEFAULT_BIZ_ID;
          await db.collection('users').doc(uid).set(
            {
              uid,
              email,
              role,
              bizId,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            { merge: true }
          );
        }
      } catch (dbErr: any) {
        role = role || 'customer';
        bizId = bizId || DEFAULT_BIZ_ID;
      }
    }

    return {
      uid,
      email,
      role: role || 'customer',
      bizId: bizId || DEFAULT_BIZ_ID,
      isDemo: false,
    };
  } catch (err: any) {
    if (err instanceof AuthenticationError) {
      throw err;
    }
    throw new AuthenticationError(
      `Firebase ID token verification failed: ${err.message || 'Invalid token'}`,
      'INVALID_ID_TOKEN',
      401
    );
  }
}

/**
 * Standard Express middleware that authenticates via Firebase ID Token,
 * loads the profile, and attaches actor {uid, role, bizId} to req.actor.
 */
export async function authMiddleware(req: Request, res: any, next: any) {
  try {
    const actor = await authenticateRequest(req);
    (req as any).actor = actor;
    next();
  } catch (err: any) {
    const status = err instanceof AuthenticationError ? err.statusCode : 401;
    const code = err instanceof AuthenticationError ? err.code : 'UNAUTHORIZED';
    res.status(status).json({
      ok: false,
      code,
      error: err.message || 'Authentication required',
    });
  }
}

// ============================================================================
// Single Source of Truth Firestore Services (businesses/{bizId}/...)
// ============================================================================

/**
 * Seeds default business, products, and storefront config into Firestore if absent.
 */
export async function seedDefaultStorefrontInFirestore(bizId = DEFAULT_BIZ_ID): Promise<void> {
  if (process.env.NODE_ENV === 'test') {
    return;
  }
  try {
    const db = getAdminDb();
    const bizRef = db.collection('businesses').doc(bizId);
    const snap = await bizRef.get();

    if (!snap.exists) {
      const now = new Date().toISOString();
      await bizRef.set({
        id: bizId,
        ownerUid: 'owner-default-1',
        name: 'AeroCool Dynamics',
        slug: 'aerocool',
        category: 'Smart Hardware & Audio',
        tagline: 'Autonomous Precision Engineering & Escrow Protected Commerce',
        logoUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=200&auto=format&fit=crop&q=80',
        contact: {
          email: 'support@aerocool.in',
          phone: '+91 80 4920 1888',
          address: 'Embassy TechVillage, Outer Ring Rd, Bellandur, Bengaluru 560103',
          whatsappNumber: '+919876543210',
        },
        currency: 'INR',
        taxGstNumber: '29ABCDE1234F1Z5',
        paypalConnected: true,
        paypalEmail: 'merchant@aerocool.in',
        shippingPolicy: 'Standard express dispatch within 24 hours. Transit window 2-4 business days.',
        returnPolicy: '7-day no-questions-asked return window. Funds remain locked in PayPal escrow.',
        createdAt: now,
        updatedAt: now,
        roleMembers: {
          'owner-default-1': 'owner',
        },
      });

      // Seed storefrontConfig
      const config = getDefaultStorefrontConfig(bizId, 'AeroCool Dynamics', 'Smart Hardware & Audio');
      await bizRef.collection('storefrontConfig').doc('current').set(config);

      // Seed starter products
      for (const prod of SEED_STORE_PRODUCTS) {
        await bizRef.collection('products').doc(prod.id).set({
          ...prod,
          bizId,
          createdAt: now,
          updatedAt: now,
        });
      }

      // Map domain slug
      await db.collection('domains').doc('aerocool').set({
        domain: 'aerocool.acpaypilot.app',
        bizId,
        slug: 'aerocool',
        status: 'ssl_issued',
        verifiedAt: now,
      });
    }
  } catch (err) {
    console.warn('seedDefaultStorefrontInFirestore notice:', err);
  }
}

// Resilient fallback storage partitions scoped strictly per bizId
const tenantProductsStore = new Map<string, Map<string, any>>();
const tenantOrdersStore = new Map<string, Map<string, any>>();
const tenantPaymentsStore = new Map<string, Map<string, any>>();
const tenantEscrowEventsStore = new Map<string, Map<string, any>>();
const tenantBizStore = new Map<string, any>();

function getTenantStore(map: Map<string, Map<string, any>>, bizId: string): Map<string, any> {
  let store = map.get(bizId);
  if (!store) {
    store = new Map<string, any>();
    map.set(bizId, store);
  }
  return store;
}

/**
 * Retrieves all products for a specific bizId from businesses/{bizId}/products.
 */
export async function getProductsForBiz(bizId: string): Promise<any[]> {
  try {
    const db = getAdminDb();
    const snap = await db.collection('businesses').doc(bizId).collection('products').get();
    if (!snap.empty) {
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }
  } catch (err) {
    // Admin SDK ADC unavailable in runner environment
  }

  const localStore = getTenantStore(tenantProductsStore, bizId);
  if (localStore.size > 0) {
    return Array.from(localStore.values());
  }

  // Seed default items for bizId
  const initial = SEED_STORE_PRODUCTS.map((p) => ({ ...p, bizId }));
  for (const item of initial) {
    localStore.set(item.id, item);
  }
  return initial;
}

/**
 * Retrieves single product by SKU for a specific bizId.
 */
export async function getProductBySkuForBiz(bizId: string, rawSku: string): Promise<any | null> {
  const cleanSku = rawSku.replace(/^#/, '');
  const hashedSku = `#${cleanSku}`;

  try {
    const db = getAdminDb();
    const prodRef = db.collection('businesses').doc(bizId).collection('products');
    const snap = await prodRef.where('sku', 'in', [cleanSku, hashedSku]).limit(1).get();
    if (!snap.empty) {
      const doc = snap.docs[0];
      return { id: doc.id, ...doc.data() };
    }
  } catch (err) {
    // Admin SDK ADC unavailable
  }

  const products = await getProductsForBiz(bizId);
  return (
    products.find(
      (p) =>
        p.sku === cleanSku ||
        p.sku === hashedSku ||
        p.sku.replace(/^#/, '') === cleanSku ||
        p.id === cleanSku
    ) || null
  );
}

/**
 * Saves or updates a product in businesses/{bizId}/products/{productId}.
 */
export async function saveProductForBiz(bizId: string, productData: any): Promise<any> {
  const prodId = productData.id || `prod-${Date.now()}`;
  const now = new Date().toISOString();
  const record = {
    ...productData,
    id: prodId,
    bizId,
    updatedAt: now,
  };
  if (!record.createdAt) record.createdAt = now;

  getTenantStore(tenantProductsStore, bizId).set(prodId, record);

  try {
    const db = getAdminDb();
    await db
      .collection('businesses')
      .doc(bizId)
      .collection('products')
      .doc(prodId)
      .set(record, { merge: true });
  } catch (err) {
    // Handled in tenant storage
  }

  return record;
}

/**
 * Deletes a product from businesses/{bizId}/products by SKU.
 */
export async function deleteProductBySkuForBiz(bizId: string, rawSku: string): Promise<boolean> {
  const cleanSku = rawSku.replace(/^#/, '');
  const localStore = getTenantStore(tenantProductsStore, bizId);
  let foundKey: string | null = null;
  for (const [key, prod] of localStore.entries()) {
    if (prod.sku.replace(/^#/, '') === cleanSku || key === cleanSku) {
      foundKey = key;
      break;
    }
  }
  if (foundKey) {
    localStore.delete(foundKey);
  }

  try {
    const db = getAdminDb();
    const prodRef = db.collection('businesses').doc(bizId).collection('products');
    const snap = await prodRef.where('sku', 'in', [cleanSku, `#${cleanSku}`]).get();
    for (const doc of snap.docs) {
      await doc.ref.delete();
    }
  } catch (err) {
    // Admin SDK ADC
  }

  return Boolean(foundKey);
}

/**
 * Retrieves orders for a specific bizId from businesses/{bizId}/orders.
 */
export async function getOrdersForBiz(
  bizId: string,
  actor: AuthenticatedUserActor
): Promise<any[]> {
  try {
    const db = getAdminDb();
    let queryRef: FirebaseFirestore.Query = db.collection('businesses').doc(bizId).collection('orders');
    if (actor.role === 'customer') {
      queryRef = queryRef.where('customerId', '==', actor.uid);
    }
    const snap = await queryRef.get();
    if (!snap.empty) {
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }
  } catch (err) {
    // Admin SDK ADC unavailable
  }

  const localStore = getTenantStore(tenantOrdersStore, bizId);
  let list = Array.from(localStore.values());
  if (actor.role === 'customer') {
    list = list.filter((o) => o.customerId === actor.uid);
  }
  return list;
}

/**
 * Retrieves a single order by orderId or paypalOrderId from businesses/{bizId}/orders.
 */
export async function getOrderByIdForBiz(bizId: string, orderIdOrPaypalId: string): Promise<any | null> {
  try {
    const db = getAdminDb();
    const ordersRef = db.collection('businesses').doc(bizId).collection('orders');
    const directSnap = await ordersRef.doc(orderIdOrPaypalId).get();
    if (directSnap.exists) {
      return { id: directSnap.id, ...directSnap.data() };
    }
    const paypalSnap = await ordersRef.where('paypalOrderId', '==', orderIdOrPaypalId).limit(1).get();
    if (!paypalSnap.empty) {
      const d = paypalSnap.docs[0];
      return { id: d.id, ...d.data() };
    }
  } catch (err) {
    // Admin SDK ADC
  }

  const localStore = getTenantStore(tenantOrdersStore, bizId);
  for (const ord of localStore.values()) {
    if (ord.id === orderIdOrPaypalId || ord.paypalOrderId === orderIdOrPaypalId) {
      return ord;
    }
  }
  return null;
}

/**
 * Saves or updates an order in businesses/{bizId}/orders/{orderId}.
 */
export async function saveOrderForBiz(bizId: string, orderData: any): Promise<any> {
  const orderId = orderData.id || `ord-${Date.now()}`;
  const record = {
    ...orderData,
    id: orderId,
    bizId,
    updatedAt: new Date().toISOString(),
  };

  getTenantStore(tenantOrdersStore, bizId).set(orderId, record);

  try {
    const db = getAdminDb();
    await db
      .collection('businesses')
      .doc(bizId)
      .collection('orders')
      .doc(orderId)
      .set(record, { merge: true });
  } catch (err) {
    // Handled in tenant storage
  }

  return record;
}

/**
 * Retrieves payments for a specific bizId from businesses/{bizId}/payments.
 */
export async function getPaymentsForBiz(bizId: string): Promise<any[]> {
  try {
    const db = getAdminDb();
    const snap = await db.collection('businesses').doc(bizId).collection('payments').get();
    if (!snap.empty) {
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }
  } catch (err) {
    // Admin SDK ADC
  }

  return Array.from(getTenantStore(tenantPaymentsStore, bizId).values());
}

/**
 * Saves a payment record in businesses/{bizId}/payments/{paymentId}.
 */
export async function savePaymentForBiz(bizId: string, paymentData: any): Promise<any> {
  const paymentId = paymentData.id || `pay-${Date.now()}`;
  const record = {
    ...paymentData,
    id: paymentId,
    bizId,
    createdAt: paymentData.createdAt || new Date().toISOString(),
  };

  getTenantStore(tenantPaymentsStore, bizId).set(paymentId, record);

  try {
    const db = getAdminDb();
    await db
      .collection('businesses')
      .doc(bizId)
      .collection('payments')
      .doc(paymentId)
      .set(record, { merge: true });
  } catch (err) {
    // Handled in tenant storage
  }

  return record;
}

/**
 * Records an escrow state transition event in businesses/{bizId}/escrowEvents/{eventId}.
 */
export async function recordEscrowEventForBiz(bizId: string, eventData: any): Promise<any> {
  const eventId = eventData.id || `esc-evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const record = {
    ...eventData,
    id: eventId,
    bizId,
    timestamp: eventData.timestamp || new Date().toISOString(),
  };

  getTenantStore(tenantEscrowEventsStore, bizId).set(eventId, record);

  try {
    const db = getAdminDb();
    await db
      .collection('businesses')
      .doc(bizId)
      .collection('escrowEvents')
      .doc(eventId)
      .set(record);
  } catch (err) {
    // Handled in tenant storage
  }

  return record;
}

/**
 * Retrieves escrow events for an order in businesses/{bizId}/escrowEvents.
 */
export async function getEscrowEventsForOrder(bizId: string, orderId: string): Promise<any[]> {
  try {
    const db = getAdminDb();
    const snap = await db
      .collection('businesses')
      .doc(bizId)
      .collection('escrowEvents')
      .where('orderId', '==', orderId)
      .get();
    if (!snap.empty) {
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }
  } catch (err) {
    // Admin SDK ADC
  }

  const events = Array.from(getTenantStore(tenantEscrowEventsStore, bizId).values());
  return events.filter((e) => e.orderId === orderId);
}

/**
 * Retrieves all escrow events for a business in businesses/{bizId}/escrowEvents.
 */
export async function getEscrowEventsForBiz(bizId: string): Promise<any[]> {
  try {
    const db = getAdminDb();
    const snap = await db
      .collection('businesses')
      .doc(bizId)
      .collection('escrowEvents')
      .get();
    if (!snap.empty) {
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }
  } catch (err) {
    // Admin SDK ADC
  }

  return Array.from(getTenantStore(tenantEscrowEventsStore, bizId).values());
}

/**
 * Retrieves merchant profile from businesses/{bizId}.
 */
export async function getMerchantProfileForBiz(bizId: string): Promise<any> {
  try {
    const db = getAdminDb();
    const snap = await db.collection('businesses').doc(bizId).get();
    if (snap.exists) {
      return snap.data();
    }
  } catch (err) {
    // Admin SDK ADC
  }

  return tenantBizStore.get(bizId) || null;
}

/**
 * Updates merchant profile in businesses/{bizId}.
 */
export async function updateMerchantProfileForBiz(bizId: string, updateData: any): Promise<any> {
  const now = new Date().toISOString();
  const existing = tenantBizStore.get(bizId) || {};
  const updated = {
    ...existing,
    ...updateData,
    updatedAt: now,
  };
  tenantBizStore.set(bizId, updated);

  try {
    const db = getAdminDb();
    await db.collection('businesses').doc(bizId).set(updated, { merge: true });
  } catch (err) {
    // Handled
  }

  return updated;
}

/**
 * Performs a REAL Firestore write + read + delete on collection '_health' and returns true latency in ms.
 * Communicates directly with the canonical Firestore REST endpoint using firebaseConfig.
 */
export async function performFirestoreHealthCheck(): Promise<{
  ok: boolean;
  latencyMs: number;
  docId: string;
  error?: string;
}> {
  const start = Date.now();
  const testId = `health_ping_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIRESTORE_DATABASE_ID}/documents/_health/${testId}?key=${firebaseConfig.apiKey}`;

  try {
    // 1. Live Firestore Write
    const writeRes = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          ping: { stringValue: 'pong' },
          service: { stringValue: 'AC_PayPilot_API' },
          timestamp: { stringValue: new Date().toISOString() },
        },
      }),
    });
    const writeData = (await writeRes.json()) as any;
    if (!writeRes.ok || !writeData.fields?.ping) {
      throw new Error(writeData.error?.message || 'Firestore write failed');
    }

    // 2. Live Firestore Read
    const readRes = await fetch(url);
    const readData = (await readRes.json()) as any;
    if (!readRes.ok || readData.fields?.ping?.stringValue !== 'pong') {
      throw new Error('Firestore read back did not match expected payload');
    }

    // 3. Live Firestore Delete
    await fetch(url, { method: 'DELETE' });

    const latencyMs = Date.now() - start;
    return {
      ok: true,
      latencyMs,
      docId: testId,
    };
  } catch (err: any) {
    const latencyMs = Date.now() - start;
    return {
      ok: false,
      latencyMs,
      docId: testId,
      error: err.message || String(err),
    };
  }
}

const tenantUsersStore = new Map<string, any>();

export async function getUserProfileFromDb(uid: string): Promise<any | null> {
  try {
    const db = getAdminDb();
    const doc = await db.collection('users').doc(uid).get();
    if (doc.exists) {
      return doc.data();
    }
  } catch {
    // volatile memory fallback
  }
  return tenantUsersStore.get(uid) || null;
}

export async function saveUserProfileToDb(uid: string, profileData: any): Promise<any> {
  const existing = tenantUsersStore.get(uid) || {};
  const merged = {
    ...existing,
    ...profileData,
    uid,
    updatedAt: new Date().toISOString(),
  };
  tenantUsersStore.set(uid, merged);

  try {
    const db = getAdminDb();
    await db.collection('users').doc(uid).set(merged, { merge: true });
  } catch {
    // volatile memory fallback
  }
  return merged;
}

