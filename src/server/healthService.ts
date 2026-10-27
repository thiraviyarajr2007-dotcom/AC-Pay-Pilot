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
      status: 'healthy',
      latencyMs: Date.now() - start,
      message: 'Sandbox deterministic engine active (Set PAYPAL_CLIENT_ID & PAYPAL_CLIENT_SECRET in .env for live PayPal API calls)',
      details: {
        mode: 'sandbox_deterministic',
        clientIdConfigured: Boolean(clientId),
        secretConfigured: Boolean(clientSecret),
      },
      timestamp: new Date().toISOString(),
    };
  }

  try {
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch('https://api-m.sandbox.paypal.com/v1/oauth2/token', {
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
      status: 'healthy',
      latencyMs: Date.now() - start,
      message: 'Deterministic fallback mode active. Add GEMINI_API_KEY to .env to enable Live AI generation.',
      details: {
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
} from './firebaseAdmin';

/**
 * Checks Firestore database connection & persistence with real write+read+delete latency.
 */
async function checkDatabaseHealth(): Promise<HealthCheckItem> {
  const result = await performFirestoreHealthCheck();
  const projectId = FIREBASE_PROJECT_ID; // "ai-studio-applet-webapp-4bdcd"
  const dbId = FIRESTORE_DATABASE_ID; // "ai-studio-paypilotaiautono-5cf5c897-94de-4d92-83f5-3c2d5e3761dd"

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
 * Performs all health diagnostics and generates a unified report.
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

  return {
    ok: !hasError,
    status: hasError ? 'error' : hasDegraded ? 'degraded' : 'healthy',
    serverTime: new Date().toISOString(),
    nodeVersion: process.version,
    uptimeSeconds: Math.floor(process.uptime()),
    checks,
  };
}
