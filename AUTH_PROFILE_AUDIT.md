# AC PayPilot — Comprehensive Authentication, Profile & Security Audit

**Date:** 2026-10-28  
**Auditor:** Senior Full-Stack & Payment Security Engineer  
**Codebase:** `AC-Pay-Pilot` (`PayPilot-AI-—-Autonomous-Commerce-&-Intelligent-Escrow-Platform`)  
**Phase:** Phase 0 — Full-Spectrum Diagnostic Audit (No Code Changes)

---

## Executive Summary

A comprehensive architectural and security audit of the AC PayPilot platform was conducted, analyzing the end-to-end authentication lifecycle, user profile state management, persona/tenant derivation boundaries, Firestore security rules, PayPal checkout flows, and persistence models.

The audit identified **16 distinct defects** categorized across:
- **P0 (Critical Security & Integrity):** 6 faults including arbitrary client-side role self-escalation via Firestore rules and SDK calls, synthetic user fabrication on authentication failure, payment capture route blocking unauthenticated guests with HTTP 401, unverified currency rejection (`INR`), and volatile in-memory fallback masking missing production credentials.
- **P1 (High Functional & Sync Vulnerabilities):** 6 faults including profile/role race conditions in route guards, multi-listener leaks, missing Firestore live snapshot synchronization, and missing production webhook boot assertions.
- **P2 (Medium Hygiene & Operational Gaps):** 4 faults including stale cache retention upon logout, unanchored documentation claims, and unvalidated environment variable boot sequences.

---

## Detailed Fault Matrix

| Fault ID | Category | File & Line | Root Cause | Severity | Reproduction Steps | Impact |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **AUD-01** | **Auth Lifecycle / Synthetic Fallback** | `src/context/RoleContext.tsx`: 393–404, 420–431, 444–457 | Catches authentication errors during Google/Facebook/Email login and creates synthetic client-side sessions (`mockFbUser`, `emailUser`, `newUser`) with fake UIDs instead of failing closed. | **P0** | 1. Attempt email login with incorrect password or block OAuth popup.<br>2. Observe context creating `usr-<random>` local session and logging into UI.<br>3. Make backend API calls which fail with 401. | Fabricates authentication success; leaves app in broken, half-authenticated state. Violates fail-closed security. |
| **AUD-02** | **Role Escalation (Client & Rules)** | `firestore.rules`: 146–157; `src/firebase.ts`: 163–188; `src/context/RoleContext.tsx`: 353–356 | `firestore.rules` allows `isOwner(userId)` to update `role` to any valid role (`finance`, `business_head`, `seller`). `updateFirestoreUserRole()` directly invokes `setDoc()` with user-supplied role. `RoleContext.setRole()` syncs UI role directly to Firestore. | **P0** | 1. Sign in as `customer`.<br>2. Call `setRole('finance')` or update `users/{uid}` with `{ role: 'finance' }`.<br>3. Firestore rules grant full finance read/write access across all collections. | Any authenticated user can self-escalate to `finance` or `business_head`, gaining full access to payments, invoices, refunds, and business orders. |
| **AUD-03** | **Guest Checkout Capture 401 Block** | `server.ts`: 388–390; `src/server/paymentEngine.ts`: 61–74 | `POST /api/paypal/create-order` allows unauthenticated checkout and issues an unforgeable guest UID (`guest-...`), but `POST /api/paypal/capture-order/:id` requires `requireAuth(req, res)` (Bearer token). | **P0** | 1. Place order as guest on storefront.<br>2. Create order succeeds (201).<br>3. Trigger capture order.<br>4. Server returns HTTP 401 `MISSING_AUTH_TOKEN`. | Unauthenticated guest buyers can NEVER complete checkout; guest capture always fails with 401. |
| **AUD-04** | **PayPal Sandbox Currency Failure (INR)** | `src/components/modals/PayPalCheckoutModal.tsx`: 112; `src/server/paymentEngine.ts`: 21–35, 326–345 | Storefront catalog prices are denominated in INR, and checkout modal requests `currency: 'INR'`. PayPal Sandbox Orders v2 API strictly rejects direct INR orders (HTTP 422 `CURRENCY_NOT_SUPPORTED`). Server fails closed with 400. | **P0** | 1. Open PayPal checkout modal.<br>2. Modal executes `POST /api/paypal/create-order` with `currency: 'INR'`.<br>3. PayPal rejects INR, server returns 400 `ORDER_CREATION_FAILED`. | Legitimate sandbox checkout cannot complete for catalog products without conversion to supported currency (USD). |
| **AUD-05** | **Volatile Memory Persistence Silent Fallback** | `src/server/firebaseAdmin.ts`: 267–308; `src/server/healthService.ts`: 234–280 | When `GOOGLE_APPLICATION_CREDENTIALS` is absent, Admin SDK gRPC calls fail and the server silently redirects all product, order, payment, and escrow mutations into in-memory Maps (`tenantOrdersStore`, etc.) without failing or warning. | **P0** | 1. Start server without service account credentials.<br>2. Process orders and payments.<br>3. Restart server process.<br>4. All orders, payments, and escrow audit records disappear. | Data loss in production; creates illusion of persistent database storage while running purely in volatile RAM. |
| **AUD-06** | **Missing Production Webhook Boot Guard** | `server.ts`: 1558–1580 | Server permits booting in production even if `PAYPAL_WEBHOOK_ID`, `PAYPAL_CLIENT_ID`, or `PAYPAL_CLIENT_SECRET` are missing. No startup assertion guarantees test signature bypass is unreachable when `NODE_ENV !== 'test'`. | **P0** | 1. Run server with `NODE_ENV=production` and missing `PAYPAL_WEBHOOK_ID`.<br>2. Server starts silently.<br>3. Webhook endpoint returns false/500 or fails closed after receiving events. | Silent misconfiguration in production deployment; failure to fail fast at boot. |
| **AUD-07** | **Auth State Race Condition in Route Guard** | `src/components/RoleRouteGuard.tsx`: 17–23; `src/context/RoleContext.tsx`: 249–262 | `RoleRouteGuard` immediately evaluates `allowedRoles.includes(role)` against default `demoRole` ('seller') before Firebase Auth finishes resolving `onAuthStateChanged` and Firestore profile doc. | **P1** | 1. Refresh browser on `/customer/cart` while signed in as `customer`.<br>2. Context initializes with `role: 'seller'`.<br>3. Route guard immediately flashes `Access Restricted` or redirects before profile is loaded. | Visual flicker, jarring redirects, and potential unauthorized screen exposure before authentication state stabilizes. |
| **AUD-08** | **Lack of Real-Time Profile Snapshot Listener** | `src/context/RoleContext.tsx`: 285–307 | `RoleContext` fetches user profile exactly once during `onAuthStateChanged` via `getDoc()`. It does not attach an `onSnapshot` listener to `users/{uid}`. | **P1** | 1. User signs in on Tab A.<br>2. Admin or backend modifies user profile or role.<br>3. Tab A continues displaying stale role and profile indefinitely until page reload. | Role/profile updates do not reflect reactively; cross-tab edits remain out of sync. |
| **AUD-09** | **Multi-Tab Listener Leaks & Duplicate Auth Subscriptions** | `src/services/storefrontService.ts`: 273–285, 573–580 | `subscribeStoreOrders()` and `subscribeLiveOrderNotifications()` create their own isolated `onAuthStateChanged` listeners. Each component mount registers redundant listeners without centralized lifecycle management. | **P1** | 1. Mount and unmount storefront components repeatedly.<br>2. Multiple auth listeners remain registered on Firebase Auth instance. | Memory leaks, redundant network snapshot listeners, and unnecessary Firestore read billings. |
| **AUD-10** | **Untrusted Header & Missing Bearer Token on Client Calls** | `src/context/RoleContext.tsx`: 510–526; `src/components/modals/PayPalCheckoutModal.tsx`: 109, 224 | Client uses `getActorHeaders()` which passes `x-actor-uid`, `x-actor-role`, `x-actor-email`, with hardcoded mock fallbacks (`cust-demo-1`, `seller-demo-1`). Client never attaches `Authorization: Bearer <token>` via `getIdToken()`. | **P1** | 1. User signs in with real Firebase account.<br>2. User invokes checkout or seller API.<br>3. Client sends `x-actor-*` headers instead of `Bearer <token>`.<br>4. Server rejects with 401. | Real authenticated sessions fail server-side token authentication; forces server to rely on insecure header spoofing or demo mode. |
| **AUD-11** | **Tenant bizId Divergence Between Client and Server** | `src/context/RoleContext.tsx`: 313–318; `src/server/firebaseAdmin.ts`: 158–172 | Client derives `activeBizId` as `biz-${firebaseUser.uid}` in live mode, whereas server derives `bizId` from `users/{uid}` doc defaulting to `biz-aerocool`. | **P1** | 1. Logged-in user loads seller products.<br>2. Client requests `businesses/biz-<uid>/products`.<br>3. Server persists products to `businesses/biz-aerocool/products`. | Multi-tenant isolation divergence: client cannot see products/orders saved by server. |
| **AUD-12** | **Incomplete Logout Cleanup** | `src/context/RoleContext.tsx`: 498–508 | `signOutUser()` resets local React state but fails to clear `localStorage` keys (`paypilot_active_role`, `ac_user_profile_*`, `paypilot_data_source`, storefront caches), cart state, or active order notifications. User is not redirected to `/login`. | **P1** | 1. Sign in as seller, open dashboard.<br>2. Click Sign Out.<br>3. UI resets state but remains on `/seller/dashboard`.<br>4. LocalStorage still contains cached profile data. | Information leakage on shared computers; lingering stale UI data after logout. |
| **AUD-13** | **Unrestricted Multi-Tenant Firestore Rules for Businesses** | `firestore.rules`: 60–108 | `match /businesses/{bizId}/orders/{orderId}` allows public create (`allow create: if request.resource.data.total is int;`). Products and storefront configs rely on `resource.data.ownerUid == request.auth.uid`, which causes `PERMISSION_DENIED` when sellers attempt to manage default tenant stores. | **P1** | 1. Sign in as seller.<br>2. Try to update default storefront config for `biz-aerocool`.<br>3. Firestore rules evaluate `ownerUid == request.auth.uid` and reject with permission-denied. | Sellers cannot configure standard merchant storefront without ownership mismatch. |
| **AUD-14** | **Unvalidated Startup Configuration Sequence** | `server.ts`: 164–200, 2260–2274 | Server startup does not validate environment variables (`PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `GOOGLE_APPLICATION_CREDENTIALS`, `GEMINI_API_KEY`) against defined schema before listening. | **P2** | 1. Start server with empty or malformed `.env`.<br>2. Server starts up without complaint and fails later on first request. | Violates fail-fast principle for production services. |
| **AUD-15** | **Documentation Discrepancies & Unsubstantiated Claims** | `AUDIT_REPORT.md`: 184–187; `DEPLOYMENT_READINESS.md`: 12–25 | Documents claim "No commits were pushed" (which is now false), and refer to "8 browser journeys" and "6 live API checks" without linked command output logs or evidence artifacts. | **P2** | 1. Inspect git log: remote branches and commits have been pushed.<br>2. Search docs for evidence files: missing specific run traces. | Erosion of audit truth and compliance documentation credibility. |
| **AUD-16** | **Demo Mode Fallback Active by Default** | `src/context/RoleContext.tsx`: 256, 274 | Platform defaults to `dataSource: 'demo'` and `demoRole: 'seller'` without requiring an explicit `VITE_DEMO_MODE=true` environment flag. | **P2** | 1. Open application without any environment configuration.<br>2. Application boots in demo mode with full seller controls active. | Production environments could accidentally run in demo mode if unconfigured. |

---

## Detailed Tracing by Requirement

### 1. Auth Lifecycle & Race Conditions
- **Current Flow:**
  1. `App.tsx` wraps routes with `RoleProvider` and `RoleRouteGuard`.
  2. `RoleContext` state initializes `demoRole = 'seller'`, `firebaseRole = 'customer'`, `authLoading = true`.
  3. `onAuthStateChanged(auth, callback)` is registered.
  4. While Firebase SDK initializes indexedDB and fetches auth state, components render. `RoleRouteGuard` executes line 21: `if (allowedRoles.includes(role))` where `role = demoRole ('seller')`.
  5. When `fbUser` arrives, `ensureFirestoreUserProfile` is called asynchronously.
  6. If profile exists, it updates state and sets `authLoading = false`.
  7. If profile creation fails, synthetic fallbacks (`mockFbUser`, `emailUser`) are generated.
- **Root Defect:** No unified state machine (`loading` | `unauthenticated` | `authenticated-profile-loading` | `ready` | `error`). Routes render before profile readiness.

### 2. Profile Source of Truth
- **Divergence Identified:**
  - Firebase Auth User: contains `uid`, `email`, `displayName`.
  - Firestore `users/{uid}`: contains `role`, `displayName`, `onboardingCompleted`, etc.
  - Client Local State: `RoleContext` maintains separate `demoRole`, `firebaseRole`, and `userProfile`.
  - Client `localStorage`: stores `ac_user_profile_${uid}` as an uncoordinated fallback.
  - Server Memory Store: `firebaseAdmin.ts` maintains volatile Maps (`tenantProductsStore`, `tenantOrdersStore`).
- **Resolution Required:** Consolidate into ONE single source of truth: Firestore `users/{uid}` synchronized via `onSnapshot` with atomic set-with-merge creation.

### 3. Role / bizId / Persona Derivation
- **Client vs Server:**
  - Client currently allows user to select role from dropdown and persist it directly to Firestore via client SDK `updateFirestoreUserRole()`.
  - Server in `firebaseAdmin.ts` properly verifies Bearer ID tokens and queries Firestore `users/{uid}` to derive `role` and `bizId`.
  - Defect: Server's `DEFAULT_BIZ_ID` is `biz-aerocool`, while client computes `biz-${firebaseUser.uid}`. Furthermore, `server.ts` still trusts `x-actor-*` headers when `process.env.DEMO_MODE === 'true'`.

### 4. Sync & Multi-Tab Issues
- Stale profile after update: Client calls `updateFirestoreUserProfile` but never listens to updates with `onSnapshot`. Another tab updating the profile does not trigger re-render.
- Multi-tab inconsistency: Tab A logging out leaves Tab B in an inconsistent state because logout does not broadcast or clear local shared caches.
- Listener leaks: `storefrontService.ts` registers multiple `onAuthStateChanged` listeners across various subscription functions.

### 5. Firestore Rules Analysis (Without Rule Changes)
- **Vulnerabilities in `firestore.rules`:**
  - Lines 146–157: `allow update: if isOwner(userId) && isValidRole(request.resource.data.role);`
    - **CRITICAL:** Allows any authenticated user to set their role to `finance` or `business_head`.
    - Helper functions `isFinance()` (line 35) and `isBusinessHead()` (line 39) depend directly on `getUserRole()` which reads `users/{userId}.role`.
    - Therefore, any user can gain total administrative control over payments, invoices, refunds, and business orders by issuing a client-side Firestore update.
  - Lines 72–76: `businesses/{bizId}/products/{productId}` only allows writes if `get(.../businesses/$(bizId)).data.ownerUid == request.auth.uid`. A seller registered under `biz-aerocool` cannot create or edit products because `ownerUid` is `owner-default-1`.
  - Lines 133–135: `match /_health/{docId} { allow read, write: if true; }` permits anonymous unauthenticated writes to the health ping collection.
- **Action Required for User:**
  - We must enforce role immutability on the server. In our final report, we will provide the exact hardened `firestore.rules` snippet that the user must deploy manually via the Firebase Console or CLI.

### 6. Mock / Demo Fallbacks
- `RoleContext.tsx` lines 393–404 (`mockFbUser`), 420–431 (`emailUser`), 444–457 (`newUser`).
- `RoleContext.tsx` lines 510–526 (`cust-demo-1`, `seller-demo-1` mock actor headers).
- `src/server/firebaseAdmin.ts` lines 267–308 (silent in-memory store fallback when Google Cloud credentials are missing).

---

## Phase 1 & Phase 2 Action Plan

1. **Phase 1: Auth & Profile Overhaul**
   - Implement unified `AuthProfileProvider` with discrete states: `loading | unauthenticated | authenticated-profile-loading | ready | error`.
   - Gate all protected routes in `RoleRouteGuard` so UI renders a clean loading state until status is `ready`.
   - Use atomic `setDoc(..., { merge: true })` with default role `customer` (never `finance` or `business_head`).
   - Subscribe to `users/{uid}` via `onSnapshot` with clean unsubscribe on logout and unmount.
   - Enforce server-side role and bizId immutability. Remove `updateFirestoreUserRole` client write capability.
   - Attach fresh Firebase ID tokens to all client API requests with automatic 401 retry on forced token refresh.
   - Clear all caches, listeners, and storage on logout, and redirect to `/login`.
   - Remove all synthetic user fabrications; fail closed on authentication errors.
   - Gate demo mode behind `VITE_DEMO_MODE=true` (off by default).

2. **Phase 2: Payment Gaps & Server Hardening**
   - Implement single-use cryptographic guest capture tokens (`crypto.randomBytes(32)` hashed with SHA-256) returned on `create-order` for guest checkout.
   - Update `capture-order/:id` to accept either valid Bearer ownership or constant-time verified guest capture token.
   - Establish USD as authoritative payment currency. Convert catalog INR prices using configurable rate (`INR_TO_USD_EXCHANGE_RATE`), displaying "Charged in USD" honestly while preserving 400 rejection for unsupported direct currencies.
   - Detect missing `GOOGLE_APPLICATION_CREDENTIALS` at boot: log loud warning in dev, fail fast / refuse payment routes in production. Expose `/api/health` with `persistenceMode: "firestore-admin" | "memory-volatile"`.
   - Add production startup config validator verifying `PAYPAL_WEBHOOK_ID`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, and assert test-signature bypass is unreachable.

3. **Phase 3: Hygiene & Documentation**
   - Validate `.env` and `.gitignore`.
   - Provide comprehensive `.env.example`.
   - Correct all inaccurate documentation claims in `AUDIT_REPORT.md` and attach real execution traces in `docs/evidence/`.
   - Update `BUG_FIX_LOG.md` (BF-012 onward), `TEST_RESULTS.md`, and `DEPLOYMENT_READINESS.md`.
