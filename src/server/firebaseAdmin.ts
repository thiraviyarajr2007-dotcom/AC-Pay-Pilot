import fs from 'node:fs';
import crypto from 'node:crypto';
import { cert, initializeApp, getApps, App } from 'firebase-admin/app';
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

const INLINE_SERVICE_ACCOUNT_ENV_VARS = [
  'FIREBASE_SERVICE_ACCOUNT',
  'FIREBASE_SERVICE_ACCOUNT_JSON',
  'GOOGLE_APPLICATION_CREDENTIALS_JSON',
] as const;

function parseInlineServiceAccount(): Record<string, any> | null {
  for (const envName of INLINE_SERVICE_ACCOUNT_ENV_VARS) {
    const raw = process.env[envName];
    if (!raw || raw.trim() === '') continue;
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.client_email && parsed?.private_key) {
        return parsed;
      }
    } catch {
      // Invalid JSON in one variable should not mask a valid later variable.
    }
  }
  return null;
}

export function hasInlineServiceAccountCredentials(): boolean {
  return Boolean(parseInlineServiceAccount());
}

let adminApp: App;
let adminAuth: Auth;
let adminDb: Firestore;

export class PersistenceError extends Error {
  code: string;
  statusCode: number;
  details?: any;
  constructor(message: string, code = 'DURABLE_WRITE_FAILED', statusCode = 500, details?: any) {
    super(message);
    this.name = 'PersistenceError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

let forceDurablePersistence = false;
let simulatedFirestoreError: Error | null = null;

export function setForceDurablePersistence(force: boolean) {
  forceDurablePersistence = force;
}

export function setSimulatedFirestoreError(err: Error | null) {
  simulatedFirestoreError = err;
}

export function isDurablePersistenceRequired(): boolean {
  if (forceDurablePersistence) return true;
  return process.env.NODE_ENV === 'production' && process.env.DEMO_MODE !== 'true';
}

export function getPersistenceMode(): 'firestore-admin' | 'memory-volatile' {
  if (hasInlineServiceAccountCredentials()) {
    return 'firestore-admin';
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    try {
      if (!fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
        return 'memory-volatile';
      }
    } catch {
      return 'memory-volatile';
    }
    return 'firestore-admin';
  }
  const hasGcpService =
    Boolean(process.env.K_SERVICE) ||
    Boolean(process.env.GAE_SERVICE);
  return hasGcpService ? 'firestore-admin' : 'memory-volatile';
}

export function getAdminApp(): App {
  if (!adminApp) {
    const existingApps = getApps();
    if (existingApps.length > 0) {
      adminApp = existingApps[0];
    } else {
      const inlineCredential = parseInlineServiceAccount();
      if (inlineCredential) {
        adminApp = initializeApp({
          projectId: FIREBASE_PROJECT_ID,
          credential: cert(inlineCredential),
        });
      } else {
        const mode = getPersistenceMode();
        if (mode === 'memory-volatile') {
          // Prevents unhandled GoogleAuth metadata probe crashes when running outside GCP without valid service account
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
      let role: AppUserRole = 'customer';
      let uid = 'mock-user-1';
      let bizId = DEFAULT_BIZ_ID;

      const match = token.match(
        /^(?:mock|demo)-token-(customer|seller|finance|business_head)-(.*?)-(biz-[a-zA-Z0-9_-]+|[a-zA-Z0-9_]+)$/
      );
      if (match) {
        role = match[1] as AppUserRole;
        uid = match[2];
        bizId = match[3];
      } else {
        const parts = token.split('-');
        role = (parts[2] as AppUserRole) || 'customer';
        uid = parts[3] || 'mock-user-1';
        bizId = parts.slice(4).join('-') || DEFAULT_BIZ_ID;
      }
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
  // Ensure default products are always available in local store alongside custom products
  for (const item of SEED_STORE_PRODUCTS) {
    if (!localStore.has(item.id)) {
      localStore.set(item.id, { ...item, bizId });
    }
  }
  return Array.from(localStore.values());
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
  const localStore = getTenantStore(tenantProductsStore, bizId);
  let resolvedProdId = productData.id;
  if (!resolvedProdId && productData.sku) {
    const clean = productData.sku.replace(/^#/, '');
    for (const [key, prod] of localStore.entries()) {
      if (prod.sku?.replace(/^#/, '') === clean || prod.id === clean) {
        resolvedProdId = key;
        break;
      }
    }
  }
  const prodId = resolvedProdId || `prod-${Date.now()}`;
  const now = new Date().toISOString();
  const record = {
    ...productData,
    id: prodId,
    bizId,
    updatedAt: now,
  };
  if (!record.createdAt) record.createdAt = now;

  // Deduplicate any stale entries with the same SKU under different keys in tenant store
  if (productData.sku) {
    const clean = productData.sku.replace(/^#/, '');
    for (const [key, prod] of localStore.entries()) {
      if ((prod.sku?.replace(/^#/, '') === clean || prod.id === clean) && key !== prodId) {
        localStore.delete(key);
      }
    }
  }

  const durableRequired = isDurablePersistenceRequired();

  try {
    if (simulatedFirestoreError && durableRequired) {
      throw simulatedFirestoreError;
    }
    const db = getAdminDb();
    await db
      .collection('businesses')
      .doc(bizId)
      .collection('products')
      .doc(prodId)
      .set(record, { merge: true });

    getTenantStore(tenantProductsStore, bizId).set(prodId, record);
    return record;
  } catch (err: any) {
    if (durableRequired) {
      throw new PersistenceError(
        `Durable product write failed for ${prodId}: ${err.message || 'Write failed'}`,
        'DURABLE_WRITE_FAILED',
        500
      );
    }
    getTenantStore(tenantProductsStore, bizId).set(prodId, record);
    return record;
  }
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

  const durableRequired = isDurablePersistenceRequired();

  try {
    if (simulatedFirestoreError && durableRequired) {
      throw simulatedFirestoreError;
    }
    const db = getAdminDb();
    const prodRef = db.collection('businesses').doc(bizId).collection('products');
    const snap = await prodRef.where('sku', 'in', [cleanSku, `#${cleanSku}`]).get();
    for (const doc of snap.docs) {
      await doc.ref.delete();
    }
    if (foundKey) {
      localStore.delete(foundKey);
    }
    return Boolean(foundKey || !snap.empty);
  } catch (err: any) {
    if (durableRequired) {
      throw new PersistenceError(
        `Durable product deletion failed for ${cleanSku}: ${err.message || 'Delete failed'}`,
        'DURABLE_WRITE_FAILED',
        500
      );
    }
    if (foundKey) {
      localStore.delete(foundKey);
    }
    return Boolean(foundKey);
  }
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
 * Fails closed in production if durable write fails.
 */
export async function saveOrderForBiz(bizId: string, orderData: any): Promise<any> {
  const orderId = orderData.id || `ord-${Date.now()}`;
  const record = {
    ...orderData,
    id: orderId,
    bizId,
    updatedAt: new Date().toISOString(),
  };

  const durableRequired = isDurablePersistenceRequired();

  try {
    if (simulatedFirestoreError && durableRequired) {
      throw simulatedFirestoreError;
    }
    const db = getAdminDb();
    await db
      .collection('businesses')
      .doc(bizId)
      .collection('orders')
      .doc(orderId)
      .set(record, { merge: true });

    getTenantStore(tenantOrdersStore, bizId).set(orderId, record);
    return record;
  } catch (err: any) {
    if (durableRequired) {
      throw new PersistenceError(
        `Durable Firestore order write failed for order ${orderId}: ${err.message || 'Write failed'}`,
        'DURABLE_WRITE_FAILED',
        500
      );
    }
    getTenantStore(tenantOrdersStore, bizId).set(orderId, record);
    return record;
  }
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
 * Fails closed in production if durable write fails.
 */
export async function savePaymentForBiz(bizId: string, paymentData: any): Promise<any> {
  const paymentId = paymentData.id || `pay-${Date.now()}`;
  const record = {
    ...paymentData,
    id: paymentId,
    bizId,
    createdAt: paymentData.createdAt || new Date().toISOString(),
  };

  const durableRequired = isDurablePersistenceRequired();

  try {
    if (simulatedFirestoreError && durableRequired) {
      throw simulatedFirestoreError;
    }
    const db = getAdminDb();
    await db
      .collection('businesses')
      .doc(bizId)
      .collection('payments')
      .doc(paymentId)
      .set(record, { merge: true });

    getTenantStore(tenantPaymentsStore, bizId).set(paymentId, record);
    return record;
  } catch (err: any) {
    if (durableRequired) {
      throw new PersistenceError(
        `Durable Firestore payment write failed for payment ${paymentId}: ${err.message || 'Write failed'}`,
        'DURABLE_WRITE_FAILED',
        500
      );
    }
    getTenantStore(tenantPaymentsStore, bizId).set(paymentId, record);
    return record;
  }
}

/**
 * Records an escrow state transition event in businesses/{bizId}/escrowEvents/{eventId}.
 * Fails closed in production if durable write fails.
 */
export async function recordEscrowEventForBiz(bizId: string, eventData: any): Promise<any> {
  const eventId = eventData.id || `esc-evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const record = {
    ...eventData,
    id: eventId,
    bizId,
    timestamp: eventData.timestamp || new Date().toISOString(),
  };

  const durableRequired = isDurablePersistenceRequired();

  try {
    if (simulatedFirestoreError && durableRequired) {
      throw simulatedFirestoreError;
    }
    const db = getAdminDb();
    await db
      .collection('businesses')
      .doc(bizId)
      .collection('escrowEvents')
      .doc(eventId)
      .set(record);

    getTenantStore(tenantEscrowEventsStore, bizId).set(eventId, record);
    return record;
  } catch (err: any) {
    if (durableRequired) {
      throw new PersistenceError(
        `Durable Firestore escrow event write failed for ${eventId}: ${err.message || 'Write failed'}`,
        'DURABLE_WRITE_FAILED',
        500
      );
    }
    getTenantStore(tenantEscrowEventsStore, bizId).set(eventId, record);
    return record;
  }
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

  const durableRequired = isDurablePersistenceRequired();

  try {
    if (simulatedFirestoreError && durableRequired) {
      throw simulatedFirestoreError;
    }
    const db = getAdminDb();
    await db.collection('businesses').doc(bizId).set(updated, { merge: true });
    tenantBizStore.set(bizId, updated);
    return updated;
  } catch (err: any) {
    if (durableRequired) {
      throw new PersistenceError(
        `Durable merchant profile update failed for ${bizId}: ${err.message || 'Write failed'}`,
        'DURABLE_WRITE_FAILED',
        500
      );
    }
    tenantBizStore.set(bizId, updated);
    return updated;
  }
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
    // 1. Live Firestore Write (with transient network retry)
    let writeRes: Response | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        writeRes = await fetch(url, {
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
        if (writeRes && writeRes.ok) break;
      } catch (netErr: any) {
        if (attempt === 1) throw netErr;
        await new Promise((r) => setTimeout(r, 400));
      }
    }
    const writeData = (await writeRes?.json().catch(() => ({}))) as any;
    if (!writeRes?.ok || !writeData?.fields?.ping) {
      throw new Error(writeData?.error?.message || 'Firestore write failed');
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

  const durableRequired = isDurablePersistenceRequired();

  try {
    if (simulatedFirestoreError && durableRequired) {
      throw simulatedFirestoreError;
    }
    const db = getAdminDb();
    await db.collection('users').doc(uid).set(merged, { merge: true });
    tenantUsersStore.set(uid, merged);
    return merged;
  } catch (err: any) {
    if (durableRequired) {
      throw new PersistenceError(
        `Durable user profile write failed for ${uid}: ${err.message || 'Write failed'}`,
        'DURABLE_WRITE_FAILED',
        500
      );
    }
    tenantUsersStore.set(uid, merged);
    return merged;
  }
}

// ============================================================================
// Durable Webhook Deduplication & Event Store
// ============================================================================

const tenantWebhookStore = new Map<string, any>();

export async function isWebhookEventProcessed(eventId: string): Promise<boolean> {
  try {
    const db = getAdminDb();
    const doc = await db.collection('processedWebhooks').doc(eventId).get();
    if (doc.exists) return true;
  } catch {
    // In local/demo mode, fall back to memory store
  }
  return tenantWebhookStore.has(eventId);
}

export async function recordWebhookEvent(eventId: string, eventData: any): Promise<void> {
  const durableRequired = isDurablePersistenceRequired();

  try {
    if (simulatedFirestoreError && durableRequired) {
      throw simulatedFirestoreError;
    }
    const db = getAdminDb();
    await db.collection('processedWebhooks').doc(eventId).set({
      eventId,
      ...eventData,
      processedAt: new Date().toISOString(),
    });
    tenantWebhookStore.set(eventId, eventData);
  } catch (err: any) {
    if (durableRequired) {
      throw new PersistenceError(
        `Failed to durably record webhook event ${eventId}: ${err.message || 'Write failed'}`,
        'DURABLE_WRITE_FAILED',
        500
      );
    }
    tenantWebhookStore.set(eventId, eventData);
  }
}

// ============================================================================
// Durable Atomic Capture Lock & Guest Token Consumption
// ============================================================================

export async function atomicLockOrderForCapture(
  bizId: string,
  orderId: string,
  idempotencyKey: string,
  candidateGuestToken?: string
): Promise<{ ok: boolean; order?: any; reason?: string; statusCode?: number; alreadyCaptured?: boolean }> {
  const durableRequired = isDurablePersistenceRequired();

  if (simulatedFirestoreError && durableRequired) {
    throw simulatedFirestoreError;
  }

  try {
    const db = getAdminDb();
    const orderRef = db.collection('businesses').doc(bizId).collection('orders').doc(orderId);

    return await db.runTransaction(async (transaction) => {
      const snap = await transaction.get(orderRef);
      if (!snap.exists) {
        return { ok: false, reason: `Order '${orderId}' was not found.`, statusCode: 404 };
      }

      const order = snap.data()!;

      // If already captured, allow idempotent return
      if (order.paymentStatus === 'Captured') {
        return { ok: true, order, alreadyCaptured: true };
      }

      // If cancelled, reject capture immediately
      if (order.paymentStatus === 'Cancelled') {
        return { ok: false, reason: 'Cannot capture payment on an order that has been cancelled.', statusCode: 400 };
      }

      // If guest checkout, validate token
      if (order.isGuestCheckout) {
        if (!candidateGuestToken) {
          return { ok: false, reason: 'Guest checkout requires a valid guest capture token.', statusCode: 401 };
        }

        if (order.guestTokenUsed) {
          return { ok: false, reason: 'Guest capture token has already been used and is invalidated.', statusCode: 403 };
        }

        if (order.guestExpiresAt && new Date(order.guestExpiresAt).getTime() < Date.now()) {
          return { ok: false, reason: 'Guest capture token has expired.', statusCode: 403 };
        }

        if (!order.guestCaptureTokenHash) {
          return { ok: false, reason: 'Order has no guest capture token hash configured.', statusCode: 403 };
        }

        // Constant-time hash comparison
        const candidateHash = crypto.createHash('sha256').update(candidateGuestToken.trim()).digest('hex');
        const storedBuf = Buffer.from(order.guestCaptureTokenHash, 'hex');
        const candidateBuf = Buffer.from(candidateHash, 'hex');

        if (storedBuf.length !== candidateBuf.length || !crypto.timingSafeEqual(storedBuf, candidateBuf)) {
          return { ok: false, reason: 'Invalid guest capture token for this order.', statusCode: 403 };
        }
      }

      // Prevent concurrent duplicate capture with different idempotency key
      if (order.captureInProgress && order.captureLockKey !== idempotencyKey) {
        return {
          ok: false,
          reason: 'A capture operation is already in progress for this order with a different idempotency key.',
          statusCode: 409,
        };
      }

      // Atomically acquire capture lock
      const updates: Record<string, any> = {
        captureInProgress: true,
        captureLockKey: idempotencyKey,
        updatedAt: new Date().toISOString(),
      };
      if (order.isGuestCheckout) {
        updates.guestTokenUsed = true;
      }

      transaction.update(orderRef, updates);

      return {
        ok: true,
        order: { ...order, ...updates },
      };
    });
  } catch (err: any) {
    if (durableRequired) {
      throw new PersistenceError(
        `Atomic transaction failed for capture lock on order ${orderId}: ${err.message || 'Transaction error'}`,
        'TRANSACTION_FAILED',
        500
      );
    }

    // In local/demo/test mode without durable DB: handled safely by in-memory ledger
    return { ok: true };
  }
}

export async function atomicConsumeGuestTokenAndLockOrder(
  bizId: string,
  orderId: string,
  candidateToken: string,
  idempotencyKey: string
): Promise<{ ok: boolean; order?: any; reason?: string; statusCode?: number }> {
  return atomicLockOrderForCapture(bizId, orderId, idempotencyKey, candidateToken);
}

