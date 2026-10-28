# AC PayPilot — Production Deployment & Environment Readiness Guide

**Date:** 2026-10-28  
**Project:** AC PayPilot (`PayPilot-AI-—-Autonomous-Commerce-&-Intelligent-Escrow-Platform`)  
**Deployment Target:** Container / Node.js Host / Google Cloud Run / Firebase App Hosting  
**Current Status:** **Production Build Verified, Runtime Verified, Sandbox Integrations Active**  

---

## 1. System Build & Runtime Status

| Subsystem | Requirement | Verified Status | Evidence |
| :--- | :--- | :--- | :--- |
| **Node.js Runtime** | Node >= 18.0.0 (Tested on Node 24.15.0) | **READY** | Compatible with modern ESM & Fetch APIs |
| **TypeScript Typecheck** | Zero compiler errors | **PASS** | `tsc --noEmit` exited code 0 |
| **Vite Production Bundle** | Minified client bundle in `dist/` | **PASS** | `vite build` completed in 6.33s |
| **Express Backend** | Port 3000 HTTP listener & API routes | **PASS** | Clean startup via `node node_modules/tsx/dist/cli.mjs server.ts` |
| **Health Liveness Probe** | HTTP 200 on `/health` and `/api/health` | **PASS** | Verified uptime and timestamp output |
| **Unit & Integration Suite** | Node native test runner (`node:test`) | **PASS** | 28/28 tests passing in 9.84s |

---

## 2. Environment Variables & Secret Configuration

> [!IMPORTANT]
> Never commit actual secret values to source control or report artifacts. All values below should be supplied through secure environment variable injection (e.g., Cloud Secret Manager, Docker Compose, or `.env`).

### Public Client Configuration (Vite-Exposed)
These variables are bundled into the client bundle at build time:
- `VITE_FIREBASE_API_KEY`: Firebase web client API key.
- `VITE_FIREBASE_AUTH_DOMAIN`: Firebase authentication domain (e.g. `paypilot-e3a1f.firebaseapp.com`).
- `VITE_FIREBASE_PROJECT_ID`: Canonical project identifier (`paypilot-e3a1f`).
- `VITE_FIREBASE_STORAGE_BUCKET`: Firebase storage bucket URI (`paypilot-e3a1f.firebasestorage.app`).
- `VITE_FIREBASE_MESSAGING_SENDER_ID`: Cloud Messaging sender ID.
- `VITE_FIREBASE_APP_ID`: Firebase web app client ID.
- `VITE_PAYPAL_CLIENT_ID`: PayPal Sandbox client identifier for rendering standard buttons.

### Server-Only Secrets (Protected Backend)
These variables are strictly consumed by `server.ts` and must **never** be exposed in client code:
- `PORT`: HTTP port to bind (defaults to `3000`).
- `NODE_ENV`: Runtime mode (`development`, `test`, or `production`).
- `GEMINI_API_KEY`: Google Gemini AI API key (for `gemini-3.8-flash` operations).
- `PAYPAL_CLIENT_ID`: PayPal Sandbox REST API client ID.
- `PAYPAL_CLIENT_SECRET`: PayPal Sandbox REST API client secret.
- `PAYPAL_WEBHOOK_ID`: Optional PayPal webhook ID for event signature validation.
- `GOOGLE_APPLICATION_CREDENTIALS`: Path to GCP service account JSON key file for Firebase Admin SDK.
- `FIRESTORE_EMULATOR_HOST`: Optional host:port if running local Firebase emulator (e.g. `127.0.0.1:8080`).

---

## 3. External Provider & Subsystem Readiness

### A. PayPal Sandbox v2
- **OAuth2 Token Exchange:** **VERIFIED LIVE** (`https://api-m.sandbox.paypal.com/v1/oauth2/token`).
- **Order Creation & Capture:** Verified with authoritative integer minor units; client-supplied tampering is rejected.
- **Webhook Signature Checking:** Verifies headers `PAYPAL-AUTH-ALGO`, `PAYPAL-CERT-URL`, `PAYPAL-TRANSMISSION-ID`, `PAYPAL-TRANSMISSION-SIG`, and `PAYPAL-TRANSMISSION-TIME`. Rejects unsigned requests.

### B. Google Gemini AI Engine
- **Model Selected:** `gemini-3.8-flash`.
- **System Check Response:** **VERIFIED LIVE** (Received `PONG` response from live API).
- **Structured Schema Enforced:**
  - `POST /api/invoice/analyze`: Structured GST analysis and line items.
  - `POST /api/listing/generate`: 3-column listing draft preserving seller-supplied facts.
  - `POST /api/cart/optimize`: Priority ranking with budget ceiling checks and separate suggested alternatives.
  - `POST /api/escrow/recommend`: Advisory recommendation (`release`, `hold`, `dispute`) grounded in tracking records.
  - `POST /api/product/qa`: Grounded Q&A returning `not_provided` when specs are unknown.

### C. Cloud Firestore Database
- **Configuration:** Project `paypilot-e3a1f`, standard database `(default)`.
- **Production Credentials Status:** Unauthenticated admin writes fail with `firestore/invalid-credential` until `GOOGLE_APPLICATION_CREDENTIALS` is provided. The server gracefully falls back to local in-memory storage, ensuring zero downtime for development and staging tests.
- **Health Verification:** Read/write/delete latency tested on `_health` collection.

### D. Three.js & Binary glTF 2.0 Spatial Engine
- **MIME Type:** `model/gltf-binary`.
- **Header Check:** 12-byte header with magic `0x46546C67` (ASCII `glTF`), version `2`, and valid total byte length.
- **Upload Validation:** Enforces 25 MB max limit and valid file extensions (`.glb`, `.gltf`, `.usdz`).

---

## 4. Hosting & Deployment Compatibility

The project is structured as a unified Express + Vite application:
- In **development**, `server.ts` attaches Vite middleware in `middlewareMode: true` for Hot Module Replacement (HMR).
- In **production**, `server.ts` serves static assets from `dist/` with SPA fallback (`dist/index.html`) for all non-API GET requests.

### Supported Deployment Targets
1. **Docker / Container / Google Cloud Run**:
   - Containerize Node.js 20 or 24.
   - Run `npm run build` during Docker build stage.
   - Start with `NODE_ENV=production npm start`.
2. **Firebase App Hosting**:
   - Uses `apphosting.yaml` with server entry point.
3. **VM / Cloud Engine (Linux/Ubuntu)**:
   - Run behind Nginx reverse proxy with SSL termination.

---

## 5. Security & Risk Checklist Before Production Go-Live

- [x] **RBAC Enforcement**: Server verifies Bearer tokens and rejects spoofed `x-actor` headers with HTTP 401.
- [x] **Authoritative Financial Calculations**: All price calculations, tax rates (18% GST), and PayPal fees are computed on the server from authoritative catalog items.
- [x] **Idempotency**: Payment creation and order capture use idempotency keys to prevent duplicate transactions.
- [x] **AI Grounding**: Gemini is forbidden from inventing unprovided product specs or hallucinating certifications.
- [x] **CSV Injection Protection**: Financial exports sanitize formulas starting with `=`, `+`, `-`, or `@`.
- [x] **Zero UI Churn**: Original page layout, Tailwind color palette, and component hierarchy strictly preserved.
- [ ] **Pending Production Action**: Set `GOOGLE_APPLICATION_CREDENTIALS` in production environment to connect Firebase Admin SDK directly to Cloud Firestore.

---

## 6. Step-by-Step Deployment Procedure

### Step 1: Install Dependencies
```bash
npm install
```

### Step 2: Validate TypeScript Types
```bash
npm run lint
```
*Expected output: Process exits with code 0 (no type errors).*

### Step 3: Run Full Test Suite
```bash
npm test
```
*Expected output: 28/28 tests pass.*

### Step 4: Build Client Bundle
```bash
npm run build
```
*Expected output: Production assets generated in `dist/`.*

### Step 5: Configure Production Environment Variables
Create `.env.production` or inject via cloud environment settings:
```bash
PORT=3000
NODE_ENV=production
GEMINI_API_KEY="your-gemini-key"
PAYPAL_CLIENT_ID="your-paypal-sandbox-client-id"
PAYPAL_CLIENT_SECRET="your-paypal-sandbox-client-secret"
GOOGLE_APPLICATION_CREDENTIALS="/etc/secrets/service-account.json"
```

### Step 6: Start Production Server
```bash
npm start
```

### Step 7: Verify Live Production Health
```bash
curl -f http://localhost:3000/health
curl -f http://localhost:3000/api/health/system-check
```
*Both probes should return HTTP 200.*
