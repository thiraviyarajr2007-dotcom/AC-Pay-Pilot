# AC PayPilot — Verification & Architecture Status (`STATUS.md`)

## 0. Audit Summary (Before vs After Backend, Payment, 3D/AR & Gemini Upgrade)

### What Was Previously Mocked / Missing (Audit Findings)
1. **AI Endpoints**: Previously, screens showed static `AISuggestionCard` text without server-side `@google/genai` routes, function calling, rate limiting, or structured JSON schemas.
2. **Invoice GST Validation**: Previously, InvoiceIQ displayed static line items without deterministic 15-character GSTIN regex validation or Place-of-Supply (`CGST/SGST` vs `IGST`) verification in code.
3. **3D / AR Viewer**: Previously, `ProductDetailARScreen.tsx` used CSS transforms on a 2D image instead of Google `<model-viewer>` with real binary glTF 2.0 (`.glb`) models and seller `.glb`/`.gltf`/`.usdz` upload validation.
4. **Customer Product Q&A**: Previously absent on the product detail screen.

### What Is Now Real & Verified in Code
1. **Server-Side Gemini (`src/server/geminiService.ts` + `server.ts`)**:
   - Uses `@google/genai` with model `'gemini-3.8-flash'`, structured JSON `responseSchema`, 15-second timeout (`withTimeout`), per-actor/IP sliding-window rate limiter (20 req/min), and `httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }`.
   - Every AI endpoint returns `{ source: "live" | "fallback", ... }`. When `GEMINI_API_KEY` is not set in the environment, it returns a clearly labelled `"fallback"` response and never fakes a `"live"` badge.
   - **All 7 AI Endpoints Mounted & Verified**:
     - `POST /api/copilot` (SSE streaming + JSON): Role-aware (`customer`, `seller`, `finance`, `business_head`), function calling with RBAC-enforced tools (`getInvoices`, `getOrders`, `getTransactions`, `getStock`, `getCart`, `simulateBudget`), record citations, and user-confirmable `proposal` objects (never mutates financial records or releases escrow directly).
     - `POST /api/invoice/analyze`: Runs deterministic `validateGstinFormat` and `validatePlaceOfSupplyTaxRegime` (`CGST + SGST` intra-state vs `IGST` inter-state) in code (`src/utils/finance.ts`), returning risk score, reasons, and editable message draft.
     - `POST /api/cart/optimize`: Returns priority ranking and explanation only. All money math comes from `src/utils/finance.ts`. Suggested alternatives render in a separate box (`data-testid="smartcart-separate-alternatives"`) and never mutate the cart without the user's click.
     - `POST /api/listing/generate`: Seller provides known specs + images; returns draft title, description, tags, FAQs, and `missingInfo[]`. UI renders three columns (`Provided by seller`, `Generated`, `Missing information`) and requires seller approval before publishing.
     - `POST /api/executive/insights`: Summarizes validated `computeExecutiveKpisForDateRange` analytics with supporting record citations (`ord-1`, `ord-2`, `ord-3`) and explicit `"Forecast"` labels on projections.
     - `POST /api/escrow/recommend`: AI Release Agent evaluates order/tracking/inspection evidence and returns `{ source, recommendation: "release" | "hold" | "dispute", confidence, reasons[] }` with a 1-click human confirmation button.
     - `POST /api/product/qa`: Answers customer questions strictly from stored product specifications; unknown attributes return `"not provided"`.
2. **Real `<model-viewer>` 3D / AR & Binary `.glb` Server (`src/server/glbGenerator.ts`)**:
   - Generates spec-compliant binary glTF 2.0 (`.glb`) models in memory and serves them at:
     - `GET /api/models/ceiling-fan.glb` — **AeroBreeze 1200mm BLDC Smart Ceiling Fan (`#FAN-BLDC-892`)** (main demo product)
     - `GET /api/models/badminton-racket.glb` — **Yonex Astrox 99 Pro Badminton Racket (`#SPO-YNX-99P`)**
     - `GET /api/models/workstation.glb` — **ProArt Studio Workstation (`AC-WRK-8990`)**
   - When a product has no `.glb` file (e.g., **Studio Reference ANC Headphones `#AUD-ANC-99`**), `ProductDetailARScreen.tsx` displays `"3D model unavailable"` and the 2D image gallery fallback instead of faking a 3D model from a photo.
   - Seller side (`ListingGeneratorScreen.tsx` + `POST /api/products/:sku/asset`) validates `.glb`, `.gltf`, and `.usdz` uploads (up to 25 MB) and tracks asset status (`Processing` / `Ready` / `Failed`) linked to the SKU.

---

## 1. Routes & Role Access Matrix

| Route | Screen | Allowed Roles | Unauthorised Behaviour |
| :--- | :--- | :--- | :--- |
| `/` | Role Home Redirect | `customer`, `seller`, `finance`, `business_head` | Redirects to active role's `homeRoute` |
| `/customer/discover` | Customer Catalog | `customer`, `business_head` (read-only) | Shows `AccessRestrictedScreen` with button back to role home |
| `/customer/product/:id` | `<model-viewer>` 3D/AR & Grounded Q&A | `customer`, `seller`, `business_head` (read-only) | Shows `AccessRestrictedScreen` |
| `/customer/cart` | SmartCart & `POST /api/cart/optimize` | `customer`, `business_head` (read-only) | Shows `AccessRestrictedScreen` |
| `/customer/orders` | Customer Orders & Escrow Tracker | `customer`, `business_head` (read-only) | Shows `AccessRestrictedScreen` |
| `/checkout/success` | Server-Verified Checkout Success | `customer`, `seller`, `finance`, `business_head` | Reads order status from `GET /api/orders/:id` |
| `/checkout/cancel` | Server-Verified Checkout Cancel / Retry | `customer`, `seller`, `finance`, `business_head` | Reads order status from `GET /api/orders/:id` |
| `/seller/dashboard` | Seller Dashboard | `seller`, `business_head` (read-only) | Shows `AccessRestrictedScreen` |
| `/seller/products` | 3D Asset Upload & AI Listing Studio | `seller`, `business_head` (read-only) | Shows `AccessRestrictedScreen` |
| `/seller/orders` | Seller Orders & AI Escrow Release Agent | `seller`, `business_head` (read-only) | Shows `AccessRestrictedScreen` |
| `/seller/inventory` | Inventory & Stock Alerts | `seller`, `business_head` (read-only) | Shows `AccessRestrictedScreen` |
| `/seller/invoices` | InvoiceIQ (`POST /api/invoice/analyze`) | `seller`, `finance`, `business_head` (read-only) | Shows `AccessRestrictedScreen` |
| `/finance/ledger` | Finance Settlement Ledger | `finance`, `seller`, `business_head` (read-only) | Shows `AccessRestrictedScreen` |
| `/finance/invoices` | Finance GST & Place-of-Supply Audit | `finance`, `business_head` (read-only) | Shows `AccessRestrictedScreen` |
| `/finance/reconciliation` | Escrow & Fee Reconciliation | `finance`, `business_head` (read-only) | Shows `AccessRestrictedScreen` |
| `/finance/reports` | Financial Reports & CSV Export | `finance`, `business_head` (read-only) | Shows `AccessRestrictedScreen` |
| `/executive` | Executive Command Center & AI Insights | `business_head` | Shows `AccessRestrictedScreen` |
| `/assistant` | Streaming Role-Aware Gemini Copilot | `customer`, `seller`, `finance`, `business_head` | Scopes tool calls to caller's RBAC permissions |

---

## 2. Which AR Parts Cannot Be Verified in This Environment & Manual Phone Test Steps

### What Was Verified in This Environment
- Binary glTF 2.0 (`.glb`) header magic (`0x46546C67`, version `2`) and valid JSON/BIN chunk alignment for `ceiling-fan.glb` and `badminton-racket.glb`.
- `<model-viewer>` WebGL 3D rendering, camera orbit rotation, zoom in/out, view reset, loading overlay, and `"3D model unavailable"` 2D gallery fallback when `glbUrl` is `null`.
- Click-to-start AR camera permission consent dialog and graceful `"AR unsupported on this device"` detection on desktop/headless browsers.
- Seller `.glb`/`.gltf`/`.usdz` upload validation (rejecting invalid extensions or files > 25 MB).

### What Cannot Be Verified in a Headless / Desktop Container
- Native mobile hardware **WebXR Plane Detection** (real-world ceiling/floor surface tracking via phone camera).
- Native Android **Google Scene Viewer** intent handoff and iOS **Apple Quick Look (`.usdz`)** AR camera overlay.
- Physical OS-level camera permission prompt on iOS Safari / Android Chrome.

### Manual Test Steps on a Physical Phone (Android / iOS)
1. Open the deployed/tunneled HTTPS URL on **Android Chrome** (ARCore supported device) or **iOS Safari** (iOS 15+).
2. Navigate to `/customer/product/FAN-BLDC-892` (**AeroBreeze 1200mm BLDC Smart Ceiling Fan**) or `/customer/product/SPO-YNX-99P` (**Yonex Astrox 99 Pro Badminton Racket**).
3. Drag with one finger on the `<model-viewer>` canvas to orbit 360° and pinch with two fingers to zoom.
4. Tap **"Launch AR Room View"**, read the camera-permission explanation modal, and tap **"Allow Camera & Start AR"**.
5. Grant camera access when prompted by Android/iOS, point the phone camera at a well-lit floor/ceiling surface, and verify 1:1 scale placement.

---

## 3. Verification Results & Manual Credentials Setup

### Automated Verification Executed
- **Product Rename (`"PayPilot AI"` / `"PayPilot"` → `"AC PayPilot"`)**: Verified across `package.json` (`"name": "ac-paypilot"`), `index.html`, `metadata.json`, `Header.tsx`, `Sidebar.tsx`, `CopilotModal.tsx` (`"Ask AC PayPilot Copilot"` & `"AC PayPilot Autonomous Copilot"`), `AssistantScreen.tsx`, `FeeAuditModal.tsx`, `CheckoutResultScreen.tsx`, `DashboardScreen.tsx`, `OrdersScreen.tsx`, `FinancialReportsScreen.tsx`, `TransactionsScreen.tsx`, `ReconciliationScreen.tsx`, `src/firebase.ts`, `README.md`, and `STATUS.md` while keeping `"PayPal"` unchanged.
- **`npm run lint` (`tsc --noEmit`)**: **PASS** (0 TypeScript errors).
- **`npm test` (`tsx --test src/utils/finance.test.ts`)**: **PASS** (13/13 test suites passing: minor-unit math, invoice vs payment status separation, budget simulation, authoritative server order pricing, PayPal provider fee extraction, Executive KPI date-range baseline check, escrow state machine transitions & AI mutation block, idempotent PayPal create/capture, RBAC across all 4 roles, deterministic GSTIN + Place-of-Supply validation, binary `.glb` header & upload validation, and Gemini Copilot RBAC tools + Product Q&A `"not provided"` check).
- **`npm run build` (`vite build`)**: **PASS** (clean production bundle in `dist/`).

### Manual Environment Variables Needed for Live External Providers (`.env.example`)
- **`GEMINI_API_KEY`**: Set in server environment to switch all 7 AI endpoints from `{ source: "fallback" }` to `{ source: "live" }` (`gemini-3.8-flash`).
- **`PAYPAL_CLIENT_ID` & `PAYPAL_CLIENT_SECRET`**: Set PayPal Developer Sandbox REST credentials to switch `/api/paypal/create-order` and `/api/paypal/capture-order/:id` from deterministic sandbox fallback to live PayPal Sandbox REST API calls.
- **Firebase Authentication (Google Sign-In)**: Firebase project `gen-lang-client-0516608088` and Firestore database `(default)` are provisioned (`firebase-applet-config.json` + `firestore.rules`). Enable Google Sign-In provider in the Firebase Console if testing live OAuth popups outside demo mode.
