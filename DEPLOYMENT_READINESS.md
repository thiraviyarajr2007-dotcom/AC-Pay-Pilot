# AC PayPilot — Production Deployment Readiness Assessment

**Assessment Date:** 2026-11-12  
**Workspace Status:** Remediated & Verified Locally (Remote Vercel Redeploy Pending Git Push & Env Confirmation)  
**Target Runtime:** Node.js `>=24.12.0 <25.0.0`, Vercel (`vercel.json` + `api/index.ts`), Firebase Firestore Enterprise Edition, PayPal REST APIs, Google Gemini API.

---

## 1. Local & Emulator Verification Verdict (Post-Final-Edit)

All local build, security rules, static analysis, bundle budget, Chrome E2E, and automated test gates passed on the latest codebase:

| Gate | Status | Verified Result |
|---|---|---|
| TypeScript (`npm run lint`) | **PASS** | 0 errors |
| Vite Build (`npm run build`) | **PASS** | 1040 modules built cleanly (`3.12s`) |
| Bundle Budgets (`npm run check:bundle`) | **PASS** | Entry chunk `133.73 kB` raw / `37.32 kB` gzip (`All bundle size and entry preload budgets passed`) |
| Automated Tests + Coverage (`npm run test:coverage`) | **PASS** | **103/103** tests passed (`0` failed, `0` skipped); `74.89%` lines / `57.49%` branches / `66.67%` functions |
| Firestore Rules Emulator (`npm run test:rules`) | **PASS** | **5/5** tests passed (`ACP-SEC-003`..`006`, `SEC-009/010/011`) |
| Dependency Security (`npm audit --omit=dev`) | **PASS** | `0` known production vulnerabilities |
| Local Chrome Verification Suites | **PASS** | **32/32** regression/viewport checks + **18/18** multi-persona E2E checks (`0` console errors) |
| TestSprite CLI v0.15.0 (Tunnel) | **3 PASS / 1 BLOCKED / 1 FAIL** | Storefront checkout (`de8b142f` 8/8), Customer Cart/Guard (`0550ec49` 5/5), and 3D Spatial Twin (`75fb4a14` 4/4) **PASSED** post-edit; `efe5b15a` blocked by external Firebase `auth/operation-not-allowed`; legacy Oct 30 plan (`5aa13959`) failed against local `.env` `VITE_DEMO_MODE=true` demo banner |

---

## 2. Production Configuration & Fail-Closed Guarantees

1. **Startup Fail-Closed Validation (`src/server/configValidator.ts`):**
   - Production refuses to start with volatile in-memory storage fallback (`persistenceCheckMiddleware` returns `503 PERSISTENCE_UNAVAILABLE` if Firestore persistence is unavailable).
   - `ENABLE_TEST_WEBHOOK_BYPASS` is strictly forbidden outside `NODE_ENV=test`.
   - Spoofed `x-actor-*` headers without verified Firebase ID tokens are rejected (`401`).
2. **Health Probes (`src/server/healthService.ts` & `server.ts`):**
   - `GET /health/live`: `200` liveness response without mutating Firestore.
   - `GET /health` / `GET /api/health` / `GET /health/ready`: Honestly reports `degraded` or `503` when persistence/integrations are unhealthy instead of masking fallbacks as `healthy`.
   - `POST /api/health/system-check`: Protected by Firebase Auth (`401`/`403` when unauthorized).
3. **API Rate Limiting, Security Headers & Storefront Privacy:**
   - Global security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Strict-Transport-Security`, CSP/CORS allowlist) and `apiLimiter` (`429 RATE_LIMIT_EXCEEDED`) enforced in `server.ts`.
   - `/s/:slug` uses `sanitizePublicBusinessProfile()` (`contact` sanitized for display; `ownerUid`, `paypalEmail`, `taxGstNumber`, `roleMembers` redacted).
   - `GET /api/executive/kpis` & `POST /api/executive/kpis` enforce `business_head` | `finance` RBAC (`403` otherwise).

---

## 3. Mandatory Pre-Go-Live Production Checklist (Remote Vercel)

Before promoting the remote deployment to live traffic:

- [ ] **Push & Trigger Remote Vercel Deployment:** Push the latest local commits so Vercel builds `api/index.ts` and `dist/`.
- [ ] **Confirm Production Environment Variables in Vercel:**
  - Ensure `NODE_ENV=production` and `VITE_DEMO_MODE` is **unset/false** (so unauthenticated users see `"Not Signed In"` header & `"Sign In to Continue"` on guarded routes rather than Demo Sandbox).
  - Verify Email/Password sign-in (and OAuth providers) are enabled in the target Firebase Auth Console.
  - Verify `FIREBASE_SERVICE_ACCOUNT_JSON` (or valid ADC), `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_ENV=sandbox|live`, `PAYPAL_WEBHOOK_ID`, and `GEMINI_API_KEY`.
  - Verify `ALLOWED_ORIGINS` matches your canonical production domain(s).
- [ ] **Deploy Updated Firestore Rules & Indexes:**
  - Run `firebase deploy --only firestore:rules,firestore:indexes` against the target Firebase project (`project_id` verified).
- [ ] **Verify Live Deployment Post-Deploy:**
  - Check `GET https://<deployed-host>/health/live` -> `200`
  - Check `GET https://<deployed-host>/health/ready` -> `200`
  - Check `GET https://<deployed-host>/robots.txt` & `/sitemap.xml` -> served directly (not caught by SPA rewrite)
  - Check `GET https://<deployed-host>/s/aerocool` -> `200` with sanitized merchant contact info
  - Check `POST https://<deployed-host>/api/orders/create` (tampered total rejected; verified minor-unit total & idempotency enforced)
- [ ] **Physical Device Validation (Out-of-Scope Locally):** Confirm mobile WebXR / ARCore / ARKit camera preview and end-to-end live PayPal checkout login on a real device.
