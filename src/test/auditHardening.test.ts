import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { evaluateDistBundleBudgets } from '../../scripts/check-bundle-budget.mjs';

process.env.NODE_ENV = 'test';

let server: http.Server;
let baseUrl: string;

const SELLER_TOKEN = 'mock-token-seller-auditSeller1-biz-aerocool';
const CUSTOMER_TOKEN = 'mock-token-customer-auditCust1-biz-aerocool';
const FINANCE_TOKEN = 'mock-token-finance-auditFin1-biz-aerocool';

before(async () => {
  const mod = await import('../../server');
  const app = await mod.createAppServer();
  server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as any;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

test('SEC-001: /api/orders/stream rejects unauthenticated and spoofed requests with 401', async () => {
  const unauthRes = await fetch(`${baseUrl}/api/orders/stream`);
  assert.equal(unauthRes.status, 401);

  const spoofRes = await fetch(`${baseUrl}/api/orders/stream`, {
    headers: {
      'x-actor-uid': 'attacker-1',
      'x-actor-role': 'seller',
    },
  });
  assert.equal(spoofRes.status, 401);
});

test('SEC-012: AI and multimodal endpoints enforce authentication, role restrictions, and public Q&A validation', async () => {
  const authAiEndpoints = [
    '/api/ai/transcribe',
    '/api/ai/image',
    '/api/ai/video',
    '/api/ai/chat',
    '/api/listing/generate',
    '/api/invoice/analyze',
    '/api/escrow/recommend',
    '/api/copilot',
    '/api/executive/insights',
    '/api/ai/generate-storefront',
    '/api/ai/design-assistant',
  ];

  for (const ep of authAiEndpoints) {
    const res = await fetch(`${baseUrl}${ep}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 401, `Expected 401 on unauthenticated POST ${ep}`);
  }

  // Public customer AI routes validate strictly & run under IP/optional-actor quota
  for (const pubEp of ['/api/product/qa', '/api/cart/optimize']) {
    const res = await fetch(`${baseUrl}${pubEp}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400, `Expected 400 VALIDATION_ERROR on empty POST ${pubEp}`);
  }

  const qaRes = await fetch(`${baseUrl}/api/product/qa`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sku: '#FAN-BLDC-892',
      question: 'Does this support Matter or waterproof underwater IP68 rating?',
    }),
  });
  assert.equal(qaRes.status, 200);
  const qaJson = (await qaRes.json()) as any;
  assert.equal(typeof qaJson.answer, 'string');
  assert.ok(['live', 'fallback'].includes(qaJson.source));

  const customerRestricted = [
    '/api/listing/generate',
    '/api/invoice/analyze',
    '/api/escrow/recommend',
    '/api/ai/generate-storefront',
  ];
  for (const ep of customerRestricted) {
    const res = await fetch(`${baseUrl}${ep}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CUSTOMER_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 403, `Expected 403 for customer role on POST ${ep}`);
  }
});

test('SEC-013: Global security headers, X-Request-Id, Cache-Control, and CORS allowlist are enforced', async () => {
  const res = await fetch(`${baseUrl}/api/config`);
  assert.equal(res.status, 200);
  assert.ok(res.headers.get('x-request-id'));
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.equal(res.headers.get('cache-control'), 'no-store');

  const evilCorsRes = await fetch(`${baseUrl}/api/config`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://evil-attacker.example.com',
      'Access-Control-Request-Method': 'POST',
    },
  });
  assert.equal(evilCorsRes.status, 403);
  assert.equal(evilCorsRes.headers.get('access-control-allow-origin'), null);
});

test('SEC-015 & FE-007: Product CRUD & 3D asset upload enforce role, SKU existence, and valid prices', async () => {
  const sku = 'AUDIT-FAN-8499';
  const unauthAsset = await fetch(`${baseUrl}/api/products/${sku}/asset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: 'fan.glb', sizeBytes: 1024 }),
  });
  assert.equal(unauthAsset.status, 401);

  const missingSkuAsset = await fetch(`${baseUrl}/api/products/NON-EXISTENT-SKU-999/asset`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SELLER_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fileName: 'fan.glb', sizeBytes: 1024 }),
  });
  assert.equal(missingSkuAsset.status, 404);

  const createRes = await fetch(`${baseUrl}/api/products`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SELLER_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sku,
      name: 'Audit Certified BLDC Fan',
      category: 'Smart Ceiling Fans',
      price: 8499,
      stock: 40,
    }),
  });
  assert.ok([200, 201].includes(createRes.status), `Expected 200/201, got ${createRes.status}`);
  const created = (await createRes.json()) as any;
  assert.equal(created.ok, true);
  assert.equal(created.product.price, 8499);

  const validAssetRes = await fetch(`${baseUrl}/api/products/${sku}/asset`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SELLER_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fileName: 'audit-fan.glb', sizeBytes: 4096 }),
  });
  assert.equal(validAssetRes.status, 200);

  const invalidAssetRes = await fetch(`${baseUrl}/api/products/${sku}/asset`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SELLER_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fileName: 'malware.exe', sizeBytes: 4096 }),
  });
  assert.equal(invalidAssetRes.status, 400);

  const delRes = await fetch(`${baseUrl}/api/products/${sku}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${SELLER_TOKEN}` },
  });
  assert.equal(delRes.status, 200);
});

test('BE-03/04/05: /health/live stays 200, /health reports degraded fallback honestly, and system-check requires auth', async () => {
  const liveRes = await fetch(`${baseUrl}/health/live`);
  assert.equal(liveRes.status, 200);
  const liveJson = (await liveRes.json()) as any;
  assert.equal(liveJson.status, 'live');

  const sysCheckUnauth = await fetch(`${baseUrl}/api/health/system-check`);
  assert.equal(sysCheckUnauth.status, 401);

  const healthRes = await fetch(`${baseUrl}/health`);
  const healthJson = (await healthRes.json()) as any;
  assert.ok(Array.isArray(healthJson.checks));
  for (const c of healthJson.checks) {
    if (c?.details?.mode === 'fallback') {
      assert.notEqual(c.status, 'healthy', `Fallback subsystem ${c.name} must never report healthy`);
    }
  }
});

test('FE-005 & SEC-005: Public storefront create-order resolves storeSlug authoritatively and blocks direct escrow bypass', async () => {
  const createRes = await fetch(`${baseUrl}/api/paypal/create-order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idempotencyKey: `idem-storefront-${Date.now()}`,
      storeSlug: 'aerocool',
      currency: 'USD',
      items: [{ sku: '#FAN-BLDC-892', quantity: 1, clientPriceIgnored: 1 }],
      totalMinor: 1,
      clientUntrustedTotalMinor: 1,
      buyerName: 'Storefront Buyer',
      buyerEmail: 'buyer@example.com',
      shippingAddress: '100 Market St, San Francisco',
    }),
  });
  assert.equal(createRes.status, 201);
  const created = (await createRes.json()) as any;
  assert.equal(created.ok, true);
  assert.ok(created.order.totalMinor > 100, 'Authoritative catalog price must ignore tampered totalMinor=1');
  assert.ok(created.guestCaptureToken, 'Guest storefront order must issue single-use capture token');

  const unauthStorefrontMutation = await fetch(`${baseUrl}/api/storefront/orders/${created.order.id}/escrow-status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ escrowStatus: 'Delivered — Escrow Released' }),
  });
  assert.equal(unauthStorefrontMutation.status, 401);

  // Finance token still cannot bypass created -> released without funded/in_delivery
  const jumpRes = await fetch(`${baseUrl}/api/orders/${created.order.id}/escrow-transition`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${FINANCE_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      nextState: 'released',
      reason: 'Attempt invalid direct jump',
    }),
  });
  assert.equal(jumpRes.status, 400);
});

test('PERF-02, PERF-04 & QA-003: SEO files, Vercel cache headers, and all-chunk bundle budgets pass', async () => {
  const root = path.resolve(process.cwd());
  const robots = fs.readFileSync(path.join(root, 'public', 'robots.txt'), 'utf8');
  assert.match(robots, /User-agent:/);
  assert.match(robots, /Disallow:\s*\/api\//);

  const sitemap = fs.readFileSync(path.join(root, 'public', 'sitemap.xml'), 'utf8');
  assert.match(sitemap, /<urlset/);
  assert.match(sitemap, /\/customer\/discover/);

  const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  const assetHeaderRule = (vercel.headers || []).find((h: any) => String(h.source).includes('assets'));
  assert.ok(assetHeaderRule, 'vercel.json must configure long-lived cache headers for /assets');
  const ccHeader = (assetHeaderRule.headers || []).find((x: any) => x.key.toLowerCase() === 'cache-control');
  assert.match(String(ccHeader?.value || ''), /immutable/i);

  const budget = evaluateDistBundleBudgets();
  assert.equal(
    budget.ok,
    true,
    `Bundle budget check failed: ${budget.violations.join('; ')}`
  );
});

test('BE-06 & FE-008: Public storefront projection includes sanitized contact object and GET /api/executive/kpis enforces RBAC', async () => {
  const sfRes = await fetch(`${baseUrl}/api/storefront/aerocool`);
  assert.equal(sfRes.status, 200);
  const sfJson = (await sfRes.json()) as any;
  assert.equal(sfJson.ok, true);
  assert.ok(sfJson.business?.contact?.email, 'Public storefront must include public contact.email');
  assert.equal(sfJson.business?.ownerUid, undefined);
  assert.equal(sfJson.business?.paypalEmail, undefined);
  assert.equal(sfJson.business?.taxGstNumber, undefined);

  const unauthExec = await fetch(`${baseUrl}/api/executive/kpis?dateRange=30d&hasComparison=false`);
  assert.equal(unauthExec.status, 401);

  const sellerExec = await fetch(`${baseUrl}/api/executive/kpis?dateRange=30d&hasComparison=false`, {
    headers: { Authorization: `Bearer ${SELLER_TOKEN}` },
  });
  assert.equal(sellerExec.status, 403);

  const finExec = await fetch(`${baseUrl}/api/executive/kpis?dateRange=30d&hasComparison=false`, {
    headers: { Authorization: `Bearer ${FINANCE_TOKEN}` },
  });
  assert.equal(finExec.status, 200);
  const execJson = (await finExec.json()) as any;
  assert.equal(execJson.ok, true);
  assert.equal(execJson.dateRange, '30d');
  assert.equal(typeof execJson.kpis?.gmvMinor, 'number');
  assert.equal(typeof execJson.kpis?.feesFromProvider, 'boolean');
});
