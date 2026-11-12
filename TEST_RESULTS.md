# AC PayPilot — Verification & Test Execution Results

**Report Date:** 2026-11-12  
**Test Methodology:** Direct local command execution (`npm run lint`, `npm run build`, `npm run check:bundle`, `npm run test:coverage`, `npm run test:rules`, `npm audit --omit=dev`), local Chrome E2E/responsive automation against `http://127.0.0.1:3000`, and TestSprite CLI v0.15.0 cloud tunnel execution.  
**Reproducible Raw Logs:** See `docs/evidence/LINT_EXECUTION_EVIDENCE.txt`, `docs/evidence/BUILD_EXECUTION_EVIDENCE.txt`, and `docs/evidence/TEST_EXECUTION_EVIDENCE.txt`.

---

## 1. Core Test & Build Matrix (Post-Final-Edit)

| Check | Command | Passed | Failed | Skipped | Notes |
|---|---|---:|---:|---:|---|
| TypeScript Type Check | `npm run lint` | Pass | 0 | 0 | `tsc --noEmit` exit code `0` |
| Production Build | `npm run build` | Pass | 0 | 0 | Vite v8.3.5 (`1040 modules`, `3.12s`) |
| Bundle Budget Enforcer | `npm run check:bundle` | Pass | 0 | 0 | `index-D62x647T.js`: `133.73 kB` raw (`37.32 kB` gzip); `PublicStorefrontApp-CQ7mIjrT.js`: `47.81 kB` raw |
| Node Automated Suite + Coverage | `npm run test:coverage` | **103** | **0** | **0** | Duration `89328.78ms`; **74.89%** lines, **57.49%** branches, **66.67%** functions (thresholds: 65 / 50 / 55) |
| Firestore Rules Emulator Suite | `npm run test:rules` | **5** | **0** | **0** | `firebase emulators:exec --only firestore`, duration `16773.04ms` (`ACP-SEC-003`..`006`, `SEC-009/010/011`) |
| Production Dependency Audit | `npm audit --omit=dev` | Pass | 0 | 0 | `found 0 vulnerabilities` |

### Covered Suites inside `npm run test:coverage`
- `src/utils/finance.test.ts` — Minor-unit INR/USD math, GSTIN/CGST/SGST/IGST math, PayPal fee omission honesty, escrow state machine invariants, server payment engine concurrency & reconciliation, binary `.glb` validation, RBAC policy.
- `src/test/securityAndSingleSource.test.ts` — Spoofed `x-actor-*` header rejection (`401`), Bearer token resolution, role enforcement (`403`), atomic idempotent create/capture, guest token reuse/expiration/cross-order forgery (`403`), PayPal webhook signature/currency/amount validation, fail-closed config validation.
- `src/test/financialIntegrityAndConcurrency.test.ts` — Authoritative server catalog lookup overrides stale static prices, partial capture rejection, capture ID reuse prevention (`409`), in-flight capture race lock (`409`), cross-tenant escrow/refund denial (`403`), `502 PAYMENT_CAPTURED_RECONCILIATION_REQUIRED`.
- `src/test/productionReadiness.test.ts` — Server port resolution, health probes (`/health/live`, `/health`, `/health/ready` fail-closed `503`), volatile production write lock (`503 PERSISTENCE_UNAVAILABLE`), Vercel adapter parity, bundle split check.
- `src/test/auditHardening.test.ts` — `SEC-001` SSE tenant/auth isolation, `SEC-012` AI/Q&A guards, `SEC-013` CORS/security headers, `SEC-015` & `FE-007` asset/product checks, `BE-03/04/05`, `FE-005` & `SEC-005` storefront order creation & escrow hardening, `PERF-02/04` & `QA-003` SEO/cache/chunk budgets, `BE-06` & `FE-008` sanitized `storefront.contact` and `GET /api/executive/kpis` RBAC.

---

## 2. Headless Chrome Browser E2E & Viewport Verification (Post-Final-Edit)

Executed locally against live server `http://127.0.0.1:3000`:
- **32-Check Regression & Responsive Suite:** **32/32 PASSED, 0 FAILED**, `consoleErrors=0`, `pageErrors=0`.
  - Covered: `RoleRouteGuard` on `/seller/dashboard`, `/login` inputs, `/s/aerocool` button `type="button"` attributes (`buttonCount=13, missingType=0`), absence of fabricated pre-checkout badges, accessible checkout modal + inline validation alert, `/customer/discover` -> `/customer/cart` (`Proceed to PayPal Checkout (₹51,986)`) -> `PayPalCheckoutModal`, `/customer/orders` -> `INV-2026-089` & `INV-1001` invoices, and **24 responsive layout checks** across `320x568`, `375x667`, `768x1024`, and `1280x800` on 6 core routes (`overflow=false`).
- **18-Scenario Multi-Persona Chrome E2E:** **18/18 PASSED (100%)**, `Console Errors: 0`.
  - Covered: Personas A/B/C/D/E including Seller Dashboard KPIs, Storefront Builder, Listing Generator, Orders & Escrow, InvoiceIQ, Transactions, Fee Audit Modal, Customer Discover, 3D/AR Spatial View, SmartCart, PayPal Checkout Modal, `TC-SEC-001` unauthenticated route guard, `/checkout/cancel`, `/health`, 404 fallback, tablet (`768px`) & mobile (`375px`) overflow checks.

---

## 3. TestSprite CLI v0.15.0 Results (Cloud Tunnel to `127.0.0.1:3000`)

TestSprite CLI (`@testsprite/testsprite-cli v0.15.0`) artifacts are stored strictly outside this repository. All core suites below (except legacy `5aa13959`) executed after the final source edit:

| Test ID | Test Name | Status | Run ID | Details |
|---|---|---|---|---|
| `de8b142f-1b3b-453a-af49-3e5307e69454` | Public Storefront Cart, Accessible Checkout & Validation | **PASS (8/8)** | `745a2463-b3d1-4000-aedd-8f9dc71dea5c` | Storefront load, add-to-cart, cart drawer checkout modal, inline validation error alert |
| `0550ec49-7d32-44b8-b8d4-4250e545e0a3` | Customer Discover, SmartCart & Login / Guard Flows | **PASS (5/5)** | `fd829c90-e3d2-44e5-80cb-00027121f542` | `/login` inputs, `/customer/cart` itemized totals + non-zero PayPal button, `/seller/dashboard` guard |
| `75fb4a14-fd05-4772-b653-dcc207035de2` | 3D Spatial Twin & Model Inspection | **PASS (4/4)** | `a539664c-b615-4dc0-871d-972964efa2d5` | `/api/models/fan-bldc-892` glTF stream (`6380` bytes), 3D/WebXR stage, headless WebGL fallback & responsive controls |
| `efe5b15a-dd0c-4601-af5f-61cd0fa9f059` | PayPal Sandbox Checkout Flow | **BLOCKED (8/9)** | `5f64c5e8-97ab-4a6d-bcbd-58a7df964f44` | SmartCart loaded (`₹43,487`), but Firebase Auth Email/Password sign-in returned `auth/operation-not-allowed`, blocking live authenticated PayPal interaction |
| `5aa13959-2f03-4284-8148-8b7f219ef417` | AC PayPilot Storefront & Role Route Guard (Oct 30 Plan) | **FAIL** | `22f6d09d-243e-445b-b431-071be1917635` | Local `.env` sets `VITE_DEMO_MODE=true`, so visiting `/` starts in demo-switcher customer mode and shows `"Access restricted"` + `"Switch Demo Role"` on `/seller/dashboard` rather than `"Sign In to Continue"` (enforced when `VITE_DEMO_MODE` is unset/production); Oct 30 plan also expected home navbar after navigation |

### Synthetic High-Rate Stress Script Observation
A legacy 1,000-test rapid HTTP stress script executed against `http://127.0.0.1:3000` from a single IP completed **339/1000** checks cleanly and rejected **661/1000** burst requests with **`HTTP 429 RATE_LIMIT_EXCEEDED`** (`apiLimiter` operating as intended).

---

## 4. Blocked / Unverified Scenarios

- **Physical Mobile Camera AR & WebXR Headset Sessions:** Blocked without physical camera/WebXR hardware; desktop/fallback flows verified via automated tests, Chrome inspections, and TestSprite `75fb4a14`.
- **Authenticated Firebase Email/Password & Live PayPal Sandbox Account Capture:** Server PayPal adapters and webhooks are covered by deterministic unit/integration tests; interactive TestSprite browser checkout (`efe5b15a`) was blocked by Firebase project `auth/operation-not-allowed`.
- **Remote Production Origin (`ac-pay-pilot.vercel.app`):** Not re-deployed during this local remediation pass; remote parity requires pushing changes and verifying deployed health endpoints.
