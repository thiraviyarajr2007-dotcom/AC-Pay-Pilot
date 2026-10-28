# AC PayPilot — Bug Fix Log & Root-Cause Remediation History

**Date:** 2026-10-28  
**Project:** AC PayPilot (`PayPilot-AI-—-Autonomous-Commerce-&-Intelligent-Escrow-Platform`)  
**Standard:** Strict Root-Cause Remediation, Zero UI Degradation, Full Evidence-Based Retesting  

---

## Priority Reference
- **P0**: Critical Security, Financial Integrity, Authoritative Price/Escrow Integrity
- **P1**: Application Launch, Core Route/Workflow Blockers, Compilation/Build Blockers
- **P2**: Business Logic, Integration Contract Discrepancies, Subsystem Communication
- **P3**: Reliability, Usability Edge Cases, Process Leaks, Resource Cleanups
- **P4**: Minor Non-Breaking Warnings, Aesthetic Consistency Checks

---

## Defect Fix Index

### [BF-001] Windows CMD Path Ampersand Execution Crash
- **Priority:** **P1** (Application Build & Test Blocker)
- **Status:** **Resolved & Verified**
- **Symptom:**
  Running `npm test`, `npm start`, or `npm run lint` immediately crashed with:
  ```
  '-Intelligent-Escrow-Platform\node_modules\.bin\' is not recognized as an internal or external command,
  operable program or batch file.
  ```
- **Root Cause:**
  The parent directory contains an ampersand: `.../projects/PayPilot-AI-—-Autonomous-Commerce-&-Intelligent-Escrow-Platform`. On Windows, npm generates `.cmd` wrappers that initialize `%dp0%` with unquoted tokens (`SET dp0=%~dp0`). `cmd.exe` interprets `&` as a command separator, splitting the string and executing `-Intelligent-Escrow-Platform...` as an independent command.
- **Corrective Action:**
  Modified `package.json` scripts to invoke the runtime binaries via `node node_modules/...` directly, bypassing the broken `.cmd` wrappers:
  ```json
  "start": "node node_modules/tsx/dist/cli.mjs server.ts",
  "test": "node node_modules/tsx/dist/cli.mjs --test src/utils/finance.test.ts src/test/securityAndSingleSource.test.ts",
  "lint": "node node_modules/typescript/bin/tsc --noEmit",
  "build": "node node_modules/vite/bin/vite.js build"
  ```
- **Files Modified:** `package.json`
- **Regression Test Added:** Executed `npm run lint`, `npm test`, `npm run build` from root PowerShell.
- **Retest Result:** All three commands run cleanly without path syntax errors.
- **Residual Limitations:** None.

---

### [BF-002] ESM Start Script File-Extension Resolution Failure
- **Priority:** **P1** (Server Runtime Blocker)
- **Status:** **Resolved & Verified**
- **Symptom:**
  Running `npm start` caused Node to crash with:
  ```
  Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../src/server/paymentEngine' imported from .../server.ts
  ```
- **Root Cause:**
  `package.json` had `"start": "node server.ts"`. In Node ESM mode (`"type": "module"`), relative imports in TypeScript source files that omit file extensions cannot be resolved by standard Node without an ESM loader.
- **Corrective Action:**
  Pointed the `"start"` script to tsx CLI: `"start": "node node_modules/tsx/dist/cli.mjs server.ts"`.
- **Files Modified:** `package.json`
- **Regression Test Added:** Ran `npm start` and polled `http://localhost:3000/health`.
- **Retest Result:** Express server launches and listens on `http://0.0.0.0:3000`.
- **Residual Limitations:** None.

---

### [BF-003] TypeScript Compilation Errors in App.tsx & PayPalCheckoutModal.tsx
- **Priority:** **P1** (Type System Integrity)
- **Status:** **Resolved & Verified**
- **Symptom:**
  `npm run lint` failed with 3 distinct TypeScript compiler errors:
  1. `src/App.tsx(447,33): error TS2339: Property 'productId' does not exist on type 'StoreOrderItem'`.
  2. `src/App.tsx(453,25): error TS2339: Property 'trackingNumber' does not exist on type 'StorefrontOrder'`.
  3. `src/components/modals/PayPalCheckoutModal.tsx(131,13): error TS2353: Object literal may only specify known properties, and 'feeMinor' does not exist in type 'ServerOrderSummary'`.
- **Root Cause:**
  Type definitions in `src/types/storefront.ts` and `src/server/paymentEngine.ts` define `sku` (not `productId`), `trackingId` (not `trackingNumber`), and `paypalFeeMinor` / `netPayoutMinor` (not `feeMinor`). Consumer components were using outdated property names.
- **Corrective Action:**
  1. In `src/App.tsx`, replaced `firstItem.productId` with `firstItem.sku` and `o.trackingNumber` with `o.trackingId`.
  2. In `src/components/modals/PayPalCheckoutModal.tsx`, aligned the fallback order summary with `ServerOrderSummary` by defining `paypalFeeMinor: 41570`, `netPayoutMinor: 2771702`, `paymentStatus: 'Authorized'`, `verifiedByServer: true`, and `escrowState: 'created'`.
- **Files Modified:** `src/App.tsx`, `src/components/modals/PayPalCheckoutModal.tsx`
- **Regression Test Added:** `node node_modules/typescript/bin/tsc --noEmit`.
- **Retest Result:** Exited with code 0 (0 errors).
- **Residual Limitations:** None.

---

### [BF-004] Test Suite Process Hang Due to Active Server Listeners & Watchers
- **Priority:** **P1** (Continuous Integration & Test Blocker)
- **Status:** **Resolved & Verified**
- **Symptom:**
  `npm test` ran indefinitely (>72 seconds) and never completed or exited the process.
- **Root Cause:**
  `server.ts` executed top-level code: `app.listen(3000)` and Vite's `createViteServer({ server: { middlewareMode: true } })` whenever the file was imported. When `src/test/securityAndSingleSource.test.ts` imported `createAppServer` from `server.ts`, Vite opened Chokidar file watchers and WebSocket servers that remained active in Node's event loop, preventing process exit.
- **Corrective Action:**
  Added an execution entrypoint guard in `server.ts`:
  ```typescript
  const isDirectEntry =
    Boolean(process.argv[1]) &&
    process.argv[1].replace(/\\/g, '/').endsWith('server.ts');

  if (isDirectEntry) {
    void startServer();
  }
  ```
  Updated `src/test/securityAndSingleSource.test.ts` to dynamically configure `NODE_ENV = 'test'` before invoking `createAppServer()`.
- **Files Modified:** `server.ts`, `src/test/securityAndSingleSource.test.ts`
- **Regression Test Added:** `npm test`.
- **Retest Result:** Process exits cleanly in under 10 seconds.
- **Residual Limitations:** None.

---

### [BF-005] Google Cloud ADC Unhandled Promise Rejection During Test Teardown
- **Priority:** **P2** (Test Stability & Teardown Flakiness)
- **Status:** **Resolved & Verified**
- **Symptom:**
  Test runs emitted the following warning and aborted Node's test runner:
  ```
  Test hook "before" generated asynchronous activity after the test ended:
  "Error: Could not load the default credentials"
  (node:14512) MetadataLookupWarning: code = ETIMEDOUT, ENOTFOUND
  ```
- **Root Cause:**
  When `firebaseAdmin.ts` initialized Firebase Admin without `GOOGLE_APPLICATION_CREDENTIALS` on a non-GCP development machine, `google-auth-library` kicked off background HTTP probes to the GCP metadata IP `169.254.169.254`. When those timed out after tests finished, an unhandled rejection was emitted. Additionally, background Firestore seeding was triggered during unit tests.
- **Corrective Action:**
  1. Provided a local credential provider with a stub token when credentials are missing:
     ```typescript
     credential: {
       getAccessToken: async () => ({
         access_token: 'local-dev-fallback-token',
         expires_in: 3600,
       }),
     }
     ```
  2. Wrapped `seedDefaultStorefrontInFirestore()` with `if (process.env.NODE_ENV !== 'test')`.
- **Files Modified:** `src/server/firebaseAdmin.ts`
- **Regression Test Added:** Ran full test suite in clean environment without `GOOGLE_APPLICATION_CREDENTIALS`.
- **Retest Result:** Zero unhandled promise rejections; tests complete in 9.8s.
- **Residual Limitations:** None.

---

### [BF-006] SmartCart AI Schema Contract Mismatch & HTTP 400 Validation Errors
- **Priority:** **P1** (Core Customer Workflow Failure)
- **Status:** **Resolved & Verified**
- **Symptom:**
  Navigating to `/customer/cart` triggered a background call to `POST /api/cart/optimize`, which failed with HTTP 400 `VALIDATION_ERROR`:
  ```json
  {
    "ok": false,
    "error": "Invalid cart optimization payload",
    "issues": [
      { "message": "Invalid input: expected string, received undefined", "path": ["items", 0, "name"] },
      { "message": "Invalid input: expected number, received undefined", "path": ["items", 0, "price"] }
    ]
  }
  ```
- **Root Cause:**
  `SmartCartScreen.tsx` submits `{ budgetInr: number, items: [{ sku: string, quantity: number }] }` and expects a response adhering to the `CartOptimizationResult` interface (`budgetMinor`, `cartSubtotalMinor`, `cartTaxMinor`, `cartTotalMinor`, `withinBudget`, `rankedItems`, `suggestedAlternatives`, `whyThis`).
  However, `geminiService.ts` strictly required `name` and `price` on every item, only accepted `budgetCeiling`, and returned an incompatible data shape (`financeMetrics`, `rankings`).
- **Corrective Action:**
  1. Updated `CartOptimizeRequestSchema` in `src/server/geminiService.ts` to allow `budgetInr`, `budgetMinor`, and optional item properties.
  2. In `optimizeCartWithGemini`, resolved missing attributes (`name`, `category`, `specs`, `price`) from `CATALOG_PRODUCTS` using the provided SKU.
  3. Computed authoritative minor unit metrics (`cartSubtotalMinor`, `cartTaxMinor`, `cartTotalMinor`, `budgetMinor`, `withinBudget`) via integer math.
  4. Formatted `suggestedAlternatives` to include `replacesSku`, `alternativeSku`, `alternativeName`, `estimatedSavingMinor`, and `autoAdded: false`.
  5. Formatted return payload to contain both the full `CartOptimizationResult` expected by `SmartCartScreen.tsx` and legacy keys expected by existing callers.
- **Files Modified:** `src/server/geminiService.ts`
- **Regression Test Added:** Added automated test in `src/utils/finance.test.ts` verifying budget calculation, ranked items labels, and suggested alternatives contract.
- **Retest Result:**
  - Automated test passes (`✔ optimizeCartWithGemini... (8.7ms)`).
  - Live call to `POST /api/cart/optimize` returns HTTP 200 with real Gemini AI rankings (`source: 'live'`).
  - Browser E2E verification confirmed Ranked Purchase Stack and Lower-Cost Alternatives render without error.
- **Residual Limitations:** None.

---

### [BF-007] Client-Side Synthetic Fallback & False Payment Success Manufacturing
- **Priority:** **P0** (Critical Financial & Payment Security)
- **Status:** **Resolved & Verified**
- **Symptom:**
  When `/api/paypal/create-order` or `/api/paypal/capture-order` failed due to network errors, invalid currency, or server exceptions:
  - `PayPalCheckoutModal.tsx` constructed a synthetic client-side order with hardcoded `verifiedByServer: true` and `paymentStatus: 'Authorized'`.
  - On capture failure, it synthesized a successful `paymentStatus: 'Captured'` result with `serverConfirmed: true` and `feesFromProvider: true`.
  - `CheckoutResultScreen.tsx` fell back to `'ord-1'` and displayed "Payment Confirmed" even when the order was unverified or failed.
- **Root Cause:**
  Overly permissive client-side fallback error handlers designed for local prototyping were active in production paths, falsely presenting unverified orders as confirmed transactions.
- **Corrective Action:**
  1. In `src/components/modals/PayPalCheckoutModal.tsx`:
     - Removed `fallbackOrder` creation on `create-order` failure; sets explicit `serverError`, keeps `serverOrder: null`, and presents clear retry/cancel actions.
     - Removed synthetic capture fallback on `capture-order` failure; sets `serverError`, preserves `serverConfirmed: false`, and preserves retry capability.
  2. In `src/components/screens/CheckoutResultScreen.tsx`:
     - Removed fallback to `'ord-1'`; handles missing `orderId` safely.
     - Updated heading logic: displays "Payment Confirmed" **strictly** when `verifiedByServer === true` and `paymentStatus === 'Captured'`. Displays "Payment Pending Bank Confirmation" or "Payment Failed or Declined" honestly otherwise.
- **Files Modified:** `src/components/modals/PayPalCheckoutModal.tsx`, `src/components/screens/CheckoutResultScreen.tsx`
- **Regression Test Added:** Verified in client flow and integration tests proving that failed API responses never produce verified capture status.
- **Retest Result:** Verified UI honestly displays error state and permits safe retry.

---

### [BF-008] Payment Provider Silent Capture Fall-Through & Missing Invariant Validation
- **Priority:** **P0** (Payment Provider Integrity & Invariant Safety)
- **Status:** **Resolved & Verified**
- **Symptom:**
  - When real PayPal credentials failed or returned HTTP errors (such as HTTP 422 `CURRENCY_NOT_SUPPORTED`), `createPayPalSandboxAdapter()` fell through to synthetic `COMPLETED` capture in standard runtime.
  - Hardcoded 3.49% + ₹12 fee estimates were claimed as provider-confirmed fees (`feesFromProvider: true`) even when the provider returned no breakdown.
  - Discrepancies between requested currency/amount and captured currency/amount were not verified.
- **Root Cause:**
  Payment provider adapter lacked strict fail-closed enforcement and capture invariant verification.
- **Corrective Action:**
  1. In `src/server/paymentEngine.ts`:
     - Production mode strictly throws `PAYPAL_CONFIG_ERROR` if credentials are missing or invalid; never synthesizes orders.
     - Real API calls throw explicit `PAYPAL_ORDER_CREATION_FAILED` and `PAYPAL_CAPTURE_FAILED` on HTTP/network errors.
     - Implemented invariant validation in `captureOrder`: verifies `currency` matches expected currency, verifies minor-unit captured value matches `expectedTotalMinor` within tolerance, and verifies status is strictly `COMPLETED`.
     - When provider omits fee breakdown, sets `feesFromProvider: false` and `paypalFeeMinor: null` rather than fabricating estimates.
     - In `ServerPaymentLedger.captureOrder`, wrapped provider calls in try/catch to record `order.paymentStatus = 'Failed'` and prevent escrow state transition to `funded` on provider error.
- **Files Modified:** `src/server/paymentEngine.ts`
- **Regression Test Added:** Added automated tests in `src/utils/finance.test.ts` for production mode missing credentials, currency mismatch, amount mismatch, simulation outcomes (`PENDING`, `TIMEOUT`, `CANCELLED`), and fee omission.
- **Retest Result:** All automated fail-closed tests pass cleanly.

---

### [BF-009] PayPal Webhook Signature Verification Bypasses & Event Handling Invariants
- **Priority:** **P0** (Webhook Authenticity & Escrow Mutation Guard)
- **Status:** **Resolved & Verified**
- **Symptom:**
  - `server.ts` accepted sample signature string `SAMPLE_HMAC_SHA256_TRANSMISSION_SIGNATURE_PAYPAL` in non-test flows.
  - Certificate URL check merely verified that the string included `.paypal.com` anywhere without validating HTTPS protocol or hostname boundaries.
  - Webhook delivery for an unverified/unknown order ID or an order with conflicting amounts could mutate order and escrow state.
- **Root Cause:**
  Insecure bypasses and lack of domain validation allowed forged or unauthenticated webhook events to pass verification.
- **Corrective Action:**
  1. In `server.ts`:
     - Removed production sample signature acceptance; isolated test signatures strictly behind `process.env.NODE_ENV === 'test'`.
     - Enforced URL parsing: requires `https:` protocol and hostname ending with `.paypal.com`.
     - Validates order existence in `businesses/{bizId}/orders` or `ServerPaymentLedger`; rejects unknown orders with HTTP 404 `ORDER_NOT_FOUND`.
     - Validates currency and minor unit amount against authoritative order record; rejects mismatches with HTTP 400.
     - Added safe guards with `canTransitionEscrow` to prevent out-of-order or duplicate webhook events from causing invalid escrow transitions or crashing the server.
- **Files Modified:** `server.ts`
- **Regression Test Added:** Added automated tests in `src/test/securityAndSingleSource.test.ts` for unsigned requests (400), unknown orders (404), currency mismatch (400), amount mismatch (400), unsupported event types (200 ignored), forged signatures (401), non-PayPal cert URLs (401), and deduplication (200 duplicate ignored).
- **Retest Result:** All 8 webhook security tests pass with 100% success.

---

### [BF-010] Payment Route Authentication & Role Authorization Enforcement
- **Priority:** **P0** (Access Control & Cross-User Security)
- **Status:** **Resolved & Verified**
- **Symptom:**
  - Unauthenticated callers could potentially specify arbitrary `customerId` values in `POST /api/paypal/create-order`.
  - `POST /api/paypal/capture-order/:id` did not enforce customer ownership, allowing customer A to capture an order belonging to customer B.
  - Customers could attempt privileged refund operations on `/api/paypal/refund-order/:id`.
  - Sellers could attempt self-release of escrow funds on `/api/orders/:id/escrow-transition`.
- **Root Cause:**
  Payment endpoints lacked strict token validation and server-enforced identity binding.
- **Corrective Action:**
  1. In `server.ts`:
     - `POST /api/paypal/create-order`: Unauthenticated requests generate a unique, unforgeable guest UID (`guest-...`). Authenticated requests strictly force `customerId: actor.uid`, ignoring any caller-supplied body overrides.
     - `POST /api/paypal/capture-order/:id`: Requires valid Bearer authentication via `requireAuth(req, res)`. Strictly binds `actorId: actor.uid` and `actorRole: actor.role`. Validates that caller is either the owning customer or finance officer (`actor.role === 'customer' && order.customerId === actor.uid`).
     - `POST /api/paypal/refund-order/:id`: Restricts refunds strictly to `seller`, `finance`, or `business_head` personas; rejects customer role with HTTP 403.
     - `POST /api/orders/:id/escrow-transition`: Rejects seller self-release (`nextState === 'released'`) with HTTP 403 `UNAUTHORIZED_ROLE_FOR_TRANSITION`.
- **Files Modified:** `server.ts`
- **Regression Test Added:** Added automated tests in `src/test/securityAndSingleSource.test.ts` verifying create-order UID enforcement, guest UID generation, unauthenticated capture rejection (401), cross-user capture rejection (403), customer refund rejection (403), and seller self-release rejection (403).
- **Retest Result:** All 6 payment authorization tests pass cleanly.

---

### [BF-011] Firebase Canonical Project & Database Configuration Realignment
- **Priority:** **P1** (Configuration & Storage Architecture Alignment)
- **Status:** **Resolved & Documented**
- **Symptom:**
  Previous deployment documentation incorrectly stated that the project used `paypilot-e3a1f` and `(default)` database, while the repository configuration files specify `ai-studio-applet-webapp-4bdcd` and custom database `ai-studio-paypilotaiautono-5cf5c897-94de-4d92-83f5-3c2d5e3761dd`.
- **Root Cause:**
  Unverified assumptions in previous audit documentation conflicted with canonical `firebase-applet-config.json`.
- **Corrective Action:**
  1. Verified that both Client SDK (`src/firebase.ts`) and Admin SDK (`src/server/firebaseAdmin.ts`) consume `firebase-applet-config.json` directly.
  2. Confirmed canonical project ID is `ai-studio-applet-webapp-4bdcd` and custom database ID is `ai-studio-paypilotaiautono-5cf5c897-94de-4d92-83f5-3c2d5e3761dd`.
  3. Added explicit documentation clarifying that `performFirestoreHealthCheck()` tests live Cloud Firestore REST write/read/delete latency on `_health` using the web API key, but Admin SDK gRPC writes require `GOOGLE_APPLICATION_CREDENTIALS` and gracefully use partitioned in-memory storage fallback in local development/test environments.
- **Files Modified:** `AUDIT_REPORT.md`, `DEPLOYMENT_READINESS.md`, `TEST_RESULTS.md`
- **Retest Result:** Config alignment verified by automated test in `src/test/securityAndSingleSource.test.ts` (`FIREBASE_PROJECT_ID` and `FIRESTORE_DATABASE_ID` match).

