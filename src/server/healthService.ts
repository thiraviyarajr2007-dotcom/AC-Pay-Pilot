import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI } from '@google/genai';
import { getGlbBufferForModelKey } from './glbGenerator';

export interface HealthCheckItem {
  name: string;
  category: 'database' | 'paypal' | 'gemini' | 'storage';
  status: 'healthy' | 'degraded' | 'error';
  latencyMs: number;
  message: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

export interface SystemHealthReport {
  ok: boolean;
  status: 'healthy' | 'degraded' | 'error';
  persistenceMode: 'firestore-admin' | 'memory-volatile';
  serverTime: string;
  nodeVersion: string;
  uptimeSeconds: number;
  checks: HealthCheckItem[];
}

/**
 * Checks PayPal Sandbox OAuth2 token generation if credentials exist,
 * or verifies Sandbox API reachable.
 */
async function checkPayPalSandboxHealth(): Promise<HealthCheckItem> {
  const start = Date.now();
  const clientId = process.env.PAYPAL_CLIENT_ID || '';
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET || '';

  const hasCredentials =
    Boolean(clientId && clientSecret) &&
    clientId !== 'MY_PAYPAL_CLIENT_ID' &&
    clientSecret !== 'MY_PAYPAL_CLIENT_SECRET';

  if (!hasCredentials) {
    return {
      name: 'PayPal Sandbox Orders v2',
      category: 'paypal',
      status: 'degraded',
      latencyMs: Date.now() - start,
      message: 'Sandbox deterministic fallback active (Set PAYPAL_CLIENT_ID & PAYPAL_CLIENT_SECRET for connected PayPal API calls)',
      details: {
        mode: 'fallback',
        fallbackMode: 'sandbox_deterministic',
        clientIdConfigured: Boolean(clientId),
        secretConfigured: Boolean(clientSecret),
      },
      timestamp: new Date().toISOString(),
    };
  }

  try {
    const paypalBaseUrl =
      process.env.PAYPAL_ENV === 'live'
        ? 'https://api-m.paypal.com'
        : 'https://api-m.sandbox.paypal.com';
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(`${paypalBaseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const latencyMs = Date.now() - start;
    if (res.ok) {
      return {
        name: 'PayPal Sandbox Orders v2',
        category: 'paypal',
        status: 'healthy',
        latencyMs,
        message: 'Successfully generated PayPal Sandbox OAuth2 token (REST API connected)',
        details: {
          httpStatus: res.status,
          endpoint: 'https://api-m.sandbox.paypal.com',
          mode: 'live_sandbox_rest',
        },
        timestamp: new Date().toISOString(),
      };
    }

    return {
      name: 'PayPal Sandbox Orders v2',
      category: 'paypal',
      status: 'degraded',
      latencyMs,
      message: `PayPal OAuth returned HTTP ${res.status}. Verify PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.`,
      details: {
        httpStatus: res.status,
      },
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    return {
      name: 'PayPal Sandbox Orders v2',
      category: 'paypal',
      status: 'degraded',
      latencyMs: Date.now() - start,
      message: `Could not reach PayPal Sandbox API: ${err instanceof Error ? err.message : String(err)}`,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Pings Google Gemini API using @google/genai SDK (15s timeout).
 */
async function checkGeminiHealth(): Promise<HealthCheckItem> {
  const start = Date.now();
  const rawKey = process.env.GEMINI_API_KEY || '';
  const hasKey =
    Boolean(rawKey) &&
    rawKey !== 'MY_GEMINI_API_KEY' &&
    process.env.NODE_ENV !== 'test';

  if (!hasKey) {
    return {
      name: 'Gemini AI Engine (gemini-3.8-flash)',
      category: 'gemini',
      status: 'degraded',
      latencyMs: Date.now() - start,
      message: 'Deterministic fallback mode active. Set GEMINI_API_KEY to enable Live AI generation.',
      details: {
        mode: 'fallback',
        hasKey: false,
        model: 'gemini-3.8-flash',
      },
      timestamp: new Date().toISOString(),
    };
  }

  try {
    const ai = new GoogleGenAI({
      apiKey: rawKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build-health',
        },
      },
    });

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Gemini ping timed out after 8s')), 8000)
    );

    const callPromise = ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: 'Respond with the single word: PONG',
    });

    const response = await Promise.race([callPromise, timeoutPromise]);
    const latencyMs = Date.now() - start;
    const text = response.text ? response.text.trim() : '';

    return {
      name: 'Gemini AI Engine (gemini-3.8-flash)',
      category: 'gemini',
      status: 'healthy',
      latencyMs,
      message: `Live Gemini API operational. Received response (${text.slice(0, 20)}).`,
      details: {
        hasKey: true,
        model: 'gemini-3.8-flash',
      },
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    return {
      name: 'Gemini AI Engine (gemini-3.8-flash)',
      category: 'gemini',
      status: 'degraded',
      latencyMs: Date.now() - start,
      message: `Gemini live call error: ${err instanceof Error ? err.message : String(err)}. Falling back to deterministic schemas.`,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Checks in-memory glTF 2.0 binary asset generator & 3D model serving.
 */
function checkStorageAnd3DHealth(): HealthCheckItem {
  const start = Date.now();
  try {
    const fanGlb = getGlbBufferForModelKey('ceiling-fan.glb');
    const racketGlb = getGlbBufferForModelKey('badminton-racket.glb');

    const fanValid = fanGlb && fanGlb.length > 500 && fanGlb.readUInt32LE(0) === 0x46546c67;
    const racketValid = racketGlb && racketGlb.length > 500 && racketGlb.readUInt32LE(0) === 0x46546c67;

    const latencyMs = Date.now() - start;

    if (fanValid && racketValid) {
      return {
        name: '3D/AR Spatial Twin Engine & Model Storage',
        category: 'storage',
        status: 'healthy',
        latencyMs,
        message: `Binary glTF 2.0 generator verified. Fan (.glb: ${fanGlb.length} bytes) and Racket (.glb: ${racketGlb.length} bytes) ready for <model-viewer>.`,
        details: {
          fanBytes: fanGlb.length,
          racketBytes: racketGlb.length,
          magicHeader: '0x46546C67 (glTF)',
        },
        timestamp: new Date().toISOString(),
      };
    }

    return {
      name: '3D/AR Spatial Twin Engine & Model Storage',
      category: 'storage',
      status: 'error',
      latencyMs,
      message: 'Generated glTF buffer failed binary validation check.',
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    return {
      name: '3D/AR Spatial Twin Engine & Model Storage',
      category: 'storage',
      status: 'error',
      latencyMs: Date.now() - start,
      message: `3D asset generation error: ${err instanceof Error ? err.message : String(err)}`,
      timestamp: new Date().toISOString(),
    };
  }
}

import {
  performFirestoreHealthCheck,
  FIREBASE_PROJECT_ID,
  FIRESTORE_DATABASE_ID,
  getPersistenceMode,
} from './firebaseAdmin';

/**
 * Checks Firestore database connection & persistence with real write+read+delete latency.
 */
async function checkDatabaseHealth(): Promise<HealthCheckItem> {
  const result = await performFirestoreHealthCheck();
  const projectId = FIREBASE_PROJECT_ID;
  const dbId = FIRESTORE_DATABASE_ID;

  if (result.ok) {
    return {
      name: 'Cloud Firestore Database',
      category: 'database',
      status: 'healthy',
      latencyMs: result.latencyMs,
      message: `Live round-trip write+read+delete verified on collection '_health' (doc: ${result.docId}) in ${result.latencyMs}ms. Project: '${projectId}', Database: '${dbId}'.`,
      details: {
        projectId,
        databaseId: dbId,
        livePingTest: 'SUCCESS',
        docId: result.docId,
        latencyMs: result.latencyMs,
      },
      timestamp: new Date().toISOString(),
    };
  }

  return {
    name: 'Cloud Firestore Database',
    category: 'database',
    status: 'degraded',
    latencyMs: result.latencyMs,
    message: `Firestore round-trip ping error: ${result.error || 'Connection failed'}. Project: '${projectId}', Database: '${dbId}'.`,
    details: {
      projectId,
      databaseId: dbId,
      error: result.error,
      latencyMs: result.latencyMs,
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Performs non-mutating system status summary for public /health & /api/health checks (BE-03/BE-04).
 * Does not execute Firestore writes on unauthenticated requests.
 */
export async function runSystemStatusSummary(): Promise<SystemHealthReport> {
  const persistenceMode = getPersistenceMode();
  const isProdNonDemo = process.env.NODE_ENV === 'production' && process.env.DEMO_MODE !== 'true';
  const rawPaypalId = process.env.PAYPAL_CLIENT_ID || '';
  const rawPaypalSecret = process.env.PAYPAL_CLIENT_SECRET || '';
  const hasPaypalCreds =
    Boolean(rawPaypalId && rawPaypalSecret) &&
    rawPaypalId !== 'MY_PAYPAL_CLIENT_ID' &&
    rawPaypalSecret !== 'MY_PAYPAL_CLIENT_SECRET';
  const rawGeminiKey = process.env.GEMINI_API_KEY || '';
  const hasGeminiKey = Boolean(rawGeminiKey) && rawGeminiKey !== 'MY_GEMINI_API_KEY';

  const now = new Date().toISOString();
  const dbCheck: HealthCheckItem = {
    name: 'Cloud Firestore Database',
    category: 'database',
    status: persistenceMode === 'firestore-admin' ? 'healthy' : isProdNonDemo ? 'error' : 'degraded',
    latencyMs: 0,
    message:
      persistenceMode === 'firestore-admin'
        ? `Firestore Admin SDK configured for project '${FIREBASE_PROJECT_ID}', db '${FIRESTORE_DATABASE_ID}'.`
        : 'Operating in local memory-volatile mode without Admin credentials.',
    details: {
      projectId: FIREBASE_PROJECT_ID,
      databaseId: FIRESTORE_DATABASE_ID,
      persistenceMode,
      mode: persistenceMode === 'firestore-admin' ? 'connected' : 'fallback',
    },
    timestamp: now,
  };

  const paypalCheck: HealthCheckItem = {
    name: 'PayPal Orders v2',
    category: 'paypal',
    status: hasPaypalCreds ? 'healthy' : 'degraded',
    latencyMs: 0,
    message: hasPaypalCreds
      ? 'PayPal API credentials configured.'
      : 'PayPal Sandbox deterministic fallback active.',
    details: {
      mode: hasPaypalCreds ? 'configured' : 'fallback',
      env: process.env.PAYPAL_ENV === 'live' ? 'live' : 'sandbox',
    },
    timestamp: now,
  };

  const geminiCheck: HealthCheckItem = {
    name: 'Gemini AI Engine',
    category: 'gemini',
    status: hasGeminiKey ? 'healthy' : 'degraded',
    latencyMs: 0,
    message: hasGeminiKey
      ? 'Gemini API key configured.'
      : 'Deterministic AI fallback mode active.',
    details: {
      mode: hasGeminiKey ? 'configured' : 'fallback',
    },
    timestamp: now,
  };

  const storageCheck = checkStorageAnd3DHealth();
  const checks = [dbCheck, paypalCheck, geminiCheck, storageCheck];
  const hasError = checks.some((c) => c.status === 'error');
  const hasDegraded = checks.some((c) => c.status === 'degraded');

  return {
    ok: !hasError,
    status: hasError ? 'error' : hasDegraded ? 'degraded' : 'healthy',
    persistenceMode,
    serverTime: now,
    nodeVersion: process.version,
    uptimeSeconds: Math.floor(process.uptime()),
    checks,
  };
}

/**
 * Performs all full active diagnostics (authenticated system-check & test verification).
 */
export async function runFullSystemDiagnostic(): Promise<SystemHealthReport> {
  const [dbCheck, paypalCheck, geminiCheck] = await Promise.all([
    checkDatabaseHealth(),
    checkPayPalSandboxHealth(),
    checkGeminiHealth(),
  ]);
  const storageCheck = checkStorageAnd3DHealth();

  const checks = [dbCheck, paypalCheck, geminiCheck, storageCheck];
  const hasError = checks.some((c) => c.status === 'error');
  const hasDegraded = checks.some((c) => c.status === 'degraded');
  const persistenceMode = getPersistenceMode();

  return {
    ok: !hasError,
    status: hasError ? 'error' : hasDegraded ? 'degraded' : 'healthy',
    persistenceMode,
    serverTime: new Date().toISOString(),
    nodeVersion: process.version,
    uptimeSeconds: Math.floor(process.uptime()),
    checks,
  };
}
