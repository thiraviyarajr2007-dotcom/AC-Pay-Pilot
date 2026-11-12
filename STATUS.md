# AC PayPilot — Current Engineering & Audit Remediation Status

**Last Verified:** 2026-11-12  
**Verification Scope:** Local Node/TypeScript runtime (`http://127.0.0.1:3000`), production Vite build (`dist/`), Firebase Firestore Security Rules Emulator, Headless Chrome E2E (`puppeteer-core`), and TestSprite CLI v0.15.0 cloud tunnel checks.  
**Live Deployment Note:** Re-deployment to remote Vercel production is separate from local workspace verification; live production parity requires pushing these commits and re-running live smoke checks against the deployed origin.

---

## 1. Automated Quality Gate Summary (Post-Final-Edit)

| Gate | Command | Result | Key Metrics / Notes |
|---|---|---|---|
| **TypeScript Lint** | `npm run lint` | **PASS** (exit 0) | `tsc --noEmit` — 0 type/compile errors |
| **Production Build** | `npm run build` | **PASS** (exit 0) | Vite v8.3.5, `1040 modules transformed`, built in `3.12s` |
| **Bundle Budgets** | `npm run check:bundle` | **PASS** (exit 0) | Entry JS `index-D62x647T.js`: `133.73 kB` raw / `37.32 kB` gzip (`136.93 kB` Vite base) |
| **Unit & Integration Tests + Coverage** | `npm run test:coverage` | **PASS** (`103/103`) | `0` failed, `0` skipped; `74.89%` lines, `57.49%` branches, `66.67%` functions (`89328.78ms`) |
| **Firestore Security Rules** | `npm run test:rules` | **PASS** (`5/5`) | `0` failed via `firebase emulators:exec --only firestore` (`16773.04ms`) |
| **Production Dependencies** | `npm audit --omit=dev` | **PASS** | `found 0 vulnerabilities` |

---

## 2. Browser, UI/UX, and External Verification Summary

| Suite / Tool | Scope | Observed Result | Caveats / Honest Notes |
|---|---|---|---|
| **Headless Chrome Regression & Responsive Suite** (`verify-fixes-chrome.cjs`) | RoleRouteGuard, `/login`, `/s/aerocool`, SmartCart -> PayPal modal, Orders -> Invoice, 24 viewport checks (`320px`, `375px`, `768px`, `1280px`) | **32/32 PASS**, `0` console/page errors | Executed post-final-edit against `http://127.0.0.1:3000` (`overflow=false`) |
| **Headless Chrome Multi-Persona E2E** (`run-human-tests.cjs`) | Personas A–E + `TC-SEC-001` + `TC-UI-010` 3D/AR Spatial Product screen | **18/18 PASS**, `0` console errors | Executed post-final-edit against `http://127.0.0.1:3000` |
| **TestSprite CLI v0.15.0** — `de8b142f-1b3b-453a-af49-3e5307e69454` | Public Storefront Cart, Accessible Checkout & Validation (`/s/aerocool`) | **PASS (8/8)** (run `745a2463-b3d1-4000-aedd-8f9dc71dea5c`) | Executed post-final-edit over tunnel to `127.0.0.1:3000` |
| **TestSprite CLI v0.15.0** — `0550ec49-7d32-44b8-b8d4-4250e545e0a3` | Customer Discover, SmartCart & Login / Guard Flows | **PASS (5/5)** (run `fd829c90-e3d2-44e5-80cb-00027121f542`) | Executed post-final-edit over tunnel to `127.0.0.1:3000` |
| **TestSprite CLI v0.15.0** — `75fb4a14-fd05-4772-b653-dcc207035de2` | 3D Spatial Twin & Model Inspection (`/api/models/fan-bldc-892`, stage + fallback controls) | **PASS (4/4)** (run `a539664c-b615-4dc0-871d-972964efa2d5`) | Executed post-final-edit after adding WebGL context fallback & `<model-viewer>` fallback |
| **TestSprite CLI v0.15.0** — `efe5b15a-dd0c-4601-af5f-61cd0fa9f059` | PayPal Sandbox Checkout Flow | **BLOCKED (8/9)** (run `5f64c5e8-97ab-4a6d-bcbd-58a7df964f44`) | Cart (`₹43,487`) loaded; Firebase Console Email/Password sign-in returned `auth/operation-not-allowed`, blocking live authenticated PayPal flow |
| **TestSprite CLI v0.15.0** — `5aa13959-2f03-4284-8148-8b7f219ef417` | Legacy Oct 30 Storefront & Role Route Guard Plan | **FAIL** (run `22f6d09d-243e-445b-b431-071be1917635`) | Local `.env` enables `VITE_DEMO_MODE=true`, so unauthenticated sessions start in demo-switcher customer mode and render `"Access restricted"` + `"Switch Demo Role"` rather than `"Sign In to Continue"`; production (`VITE_DEMO_MODE` unset) enforces `"Sign In to Continue"` |
| **1,000-Request Stress Burst** (legacy external script) | Rapid single-IP HTTP burst across 1,000 assertions (`19s`) | **339/1000 PASS**, **661 FAIL** (`HTTP 429`) | Expected protection: `apiLimiter` in `server.ts` enforces `HTTP 429 RATE_LIMIT_EXCEEDED` on rapid bursts from one IP |

---

## 3. Route Access & Hardening Matrix

| Route / Endpoint | Access Policy | Verified Behavior |
|---|---|---|
| `/s/:slug` | Public storefront | Sanitized merchant projection (`contact` + `supportEmail` included; `ownerUid`, `paypalEmail`, `taxGstNumber`, `roleMembers` redacted); explicit `type="button"`, accessible labels, inline alert validation |
| `/login` | Public sign-in | Accessible email/password/toggle UI + redirect parameter preservation |
| `/checkout/success`, `/checkout/cancel` | Public callback routes | Server-verified order status / guest capture token required on backend API calls |
| `/customer/discover`, `/customer/cart`, `/customer/orders*` | Guarded (`customer`, `business_head`) | SmartCart initializes and persists across reloads; Customer persona suppresses seller-only AI/escrow calls (0 spurious `403` network errors); 3D viewers degrade cleanly via interactive spatial fallback without WebGL |
| `/executive`, `GET /api/executive/kpis` | Guarded (`business_head`, `finance`) | Returns scoped KPI aggregation (`200`), or `401`/`403` for unauthorized actors |
| `/seller/*`, `/finance/*` | Guarded by role | Enforced client-side via `RoleRouteGuard` (`Sign In to Continue` in live/unauthenticated mode) and server-side via Firebase ID token + Firestore user profile role |

---

## 4. Explicitly Unverified / Out-of-Scope Items

1. **Physical Mobile Camera AR:** Live camera-feed plane detection and mobile WebXR headset sessions require a physical ARCore/ARKit mobile device and were not executed in headless browser automation.
2. **Firebase Auth Email/Password Provider in Live Project:** TestSprite `efe5b15a` encountered `Firebase: Error (auth/operation-not-allowed)` against the configured Firebase project; Email/Password sign-in provider enablement is external Firebase Console configuration.
3. **Remote Vercel Production Deployment:** Current pass results reflect local runtime, Firestore Emulator, and local-tunneled TestSprite runs against this workspace; live deployment checks on Vercel must be re-run after pushing changes and verifying environment variables.
