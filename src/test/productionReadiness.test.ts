import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

process.env.NODE_ENV = 'test';

let server: http.Server;
let baseUrl: string;
let resolveServerPortFn: (rawPort?: string) => number;

before(async () => {
  const mod = await import('../../server');
  resolveServerPortFn = mod.resolveServerPort;
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

async function waitForHttpOk(url: string, timeoutMs = 30000): Promise<Response> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      return res;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error(`Timed out waiting for ${url}: ${String(lastErr)}`);
}

async function stopChildProcess(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || child.killed) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // Ignore kill error
      }
      resolve();
    }, 2000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    if (process.platform === 'win32' && child.pid) {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
      });
      killer.unref();
    } else {
      child.kill('SIGTERM');
    }
  });
}

// ============================================================================
// ACP-RUNTIME-002: PORT Handling & Startup Smoke Tests
// ============================================================================

test('ACP-RUNTIME-002: resolveServerPort defaults to 3000, honors valid ports, and rejects invalid values', () => {
  assert.equal(resolveServerPortFn(undefined), 3000);
  assert.equal(resolveServerPortFn(''), 3000);
  assert.equal(resolveServerPortFn('  '), 3000);
  assert.equal(resolveServerPortFn('4173'), 4173);
  assert.equal(resolveServerPortFn('8080'), 8080);

  for (const invalid of ['0', '-1', '65536', 'abc', '3.14']) {
    assert.throws(
      () => resolveServerPortFn(invalid),
      /Invalid PORT/,
      `Port '${invalid}' must throw clearly`
    );
  }
});

test('ACP-RUNTIME-002: Subprocess startup honors PORT=4173 and fails cleanly on invalid PORT', async () => {
  // 1. Invalid PORT must fail non-zero immediately without hanging
  const badExit = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
    const badProc = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'server.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: 'not-a-port',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    badProc.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    badProc.once('exit', (code) => resolve({ code, stderr }));
  });
  assert.notEqual(badExit.code, 0, 'Invalid PORT must exit with non-zero code');
  assert.match(badExit.stderr, /Invalid PORT/);

  // 2. Valid non-default PORT=4173 must bind and serve /health/live + /api/config + /customer/discover
  const proc = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'server.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      DEMO_MODE: 'false',
      PORT: '4173',
      GOOGLE_APPLICATION_CREDENTIALS: '',
      FIREBASE_SERVICE_ACCOUNT: '',
      FIREBASE_SERVICE_ACCOUNT_JSON: '',
      GOOGLE_APPLICATION_CREDENTIALS_JSON: '',
      K_SERVICE: '',
      GAE_SERVICE: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    const liveRes = await waitForHttpOk('http://127.0.0.1:4173/health/live');
    assert.equal(liveRes.status, 200);
    const liveJson = (await liveRes.json()) as any;
    assert.equal(liveJson.ok, true);
    assert.equal(liveJson.status, 'live');

    // In production volatile mode (no Admin creds), readiness MUST return 503
    const readyRes = await fetch('http://127.0.0.1:4173/health/ready');
    assert.equal(readyRes.status, 503);
    const readyJson = (await readyRes.json()) as any;
    assert.equal(readyJson.ok, false);
    assert.equal(readyJson.code, 'PERSISTENCE_UNAVAILABLE');

    const cfgRes = await fetch('http://127.0.0.1:4173/api/config');
    assert.equal(cfgRes.status, 200);
    const cfgJson = (await cfgRes.json()) as any;
    assert.equal(cfgJson.ok, true);

    if (fs.existsSync(path.join(process.cwd(), 'dist', 'index.html'))) {
      const spaRes = await fetch('http://127.0.0.1:4173/customer/discover');
      assert.equal(spaRes.status, 200);
      assert.match(spaRes.headers.get('content-type') || '', /text\/html/);
      const html = await spaRes.text();
      assert.match(html, /<div id="root"><\/div>/i);
    }
  } finally {
    await stopChildProcess(proc);
  }
});

// ============================================================================
// ACP-OPS-007: Liveness/Readiness Separation & Volatile Mutation Blocking
// ============================================================================

test('ACP-OPS-007: /health/live stays 200 while /health/ready returns 503 in volatile production and 200 when configured', async () => {
  const origEnv = process.env.NODE_ENV;
  const origDemo = process.env.DEMO_MODE;
  const origKService = process.env.K_SERVICE;
  const origGac = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const origInline = process.env.FIREBASE_SERVICE_ACCOUNT;

  try {
    process.env.NODE_ENV = 'production';
    delete process.env.DEMO_MODE;
    delete process.env.K_SERVICE;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.FIREBASE_SERVICE_ACCOUNT;

    const liveRes = await fetch(`${baseUrl}/health/live`);
    assert.equal(liveRes.status, 200);
    assert.equal(((await liveRes.json()) as any).status, 'live');

    const apiLiveRes = await fetch(`${baseUrl}/api/health/live`);
    assert.equal(apiLiveRes.status, 200);

    const readyFailRes = await fetch(`${baseUrl}/health/ready`);
    assert.equal(readyFailRes.status, 503);
    const readyFailBody = (await readyFailRes.json()) as any;
    assert.equal(readyFailBody.ok, false);
    assert.equal(readyFailBody.persistenceMode, 'memory-volatile');
    assert.equal(readyFailBody.code, 'PERSISTENCE_UNAVAILABLE');

    const apiReadyFailRes = await fetch(`${baseUrl}/api/health/ready`);
    assert.equal(apiReadyFailRes.status, 503);

    // Configured production runtime (e.g. Cloud Run ADC) switches readiness to 200 firestore-admin
    process.env.K_SERVICE = 'ac-paypilot-prod';
    const readyOkRes = await fetch(`${baseUrl}/health/ready`);
    assert.equal(readyOkRes.status, 200);
    const readyOkBody = (await readyOkRes.json()) as any;
    assert.equal(readyOkBody.ok, true);
    assert.equal(readyOkBody.status, 'ready');
    assert.equal(readyOkBody.persistenceMode, 'firestore-admin');
  } finally {
    process.env.NODE_ENV = origEnv;
    if (origDemo !== undefined) process.env.DEMO_MODE = origDemo;
    else delete process.env.DEMO_MODE;
    if (origKService !== undefined) process.env.K_SERVICE = origKService;
    else delete process.env.K_SERVICE;
    if (origGac !== undefined) process.env.GOOGLE_APPLICATION_CREDENTIALS = origGac;
    else delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (origInline !== undefined) process.env.FIREBASE_SERVICE_ACCOUNT = origInline;
    else delete process.env.FIREBASE_SERVICE_ACCOUNT;
  }
});

test('ACP-OPS-007: ALL durable mutation routes fail closed with 503 PERSISTENCE_UNAVAILABLE in volatile production mode', async () => {
  const origEnv = process.env.NODE_ENV;
  const origDemo = process.env.DEMO_MODE;
  const origKService = process.env.K_SERVICE;
  const origGac = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const origInline = process.env.FIREBASE_SERVICE_ACCOUNT;

  try {
    process.env.NODE_ENV = 'production';
    delete process.env.DEMO_MODE;
    delete process.env.K_SERVICE;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.FIREBASE_SERVICE_ACCOUNT;

    const mutationRoutes: Array<{ method: string; path: string; body?: any }> = [
      { method: 'POST', path: '/api/paypal/create-order', body: {} },
      { method: 'POST', path: '/api/paypal/capture-order/ord-1', body: {} },
      { method: 'POST', path: '/api/paypal/cancel-order/ord-1', body: {} },
      { method: 'POST', path: '/api/paypal/refund-order/ord-1', body: {} },
      { method: 'POST', path: '/api/orders/ord-1/escrow-transition', body: {} },
      { method: 'POST', path: '/api/orders/notify', body: {} },
      { method: 'POST', path: '/api/products', body: {} },
      { method: 'DELETE', path: '/api/products/FAN-BLDC-892' },
      { method: 'POST', path: '/api/products/FAN-BLDC-892/asset', body: {} },
      { method: 'POST', path: '/api/merchants/profile', body: {} },
      { method: 'PATCH', path: '/api/users/profile', body: {} },
      { method: 'POST', path: '/api/paypal/webhook', body: {} },
      { method: 'POST', path: '/api/storefront/orders', body: {} },
      { method: 'POST', path: '/api/storefront/orders/ord-1/escrow-status', body: {} },
    ];

    for (const route of mutationRoutes) {
      const res = await fetch(`${baseUrl}${route.path}`, {
        method: route.method,
        headers: { 'Content-Type': 'application/json' },
        ...(route.body !== undefined ? { body: JSON.stringify(route.body) } : {}),
      });
      assert.equal(
        res.status,
        503,
        `${route.method} ${route.path} must return 503 PERSISTENCE_UNAVAILABLE in volatile production mode`
      );
      const data = (await res.json()) as any;
      assert.equal(data.ok, false);
      assert.equal(data.code, 'PERSISTENCE_UNAVAILABLE');
    }
  } finally {
    process.env.NODE_ENV = origEnv;
    if (origDemo !== undefined) process.env.DEMO_MODE = origDemo;
    else delete process.env.DEMO_MODE;
    if (origKService !== undefined) process.env.K_SERVICE = origKService;
    else delete process.env.K_SERVICE;
    if (origGac !== undefined) process.env.GOOGLE_APPLICATION_CREDENTIALS = origGac;
    else delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (origInline !== undefined) process.env.FIREBASE_SERVICE_ACCOUNT = origInline;
    else delete process.env.FIREBASE_SERVICE_ACCOUNT;
  }
});

// ============================================================================
// ACP-DEP-001 & ACP-PERF-008: Vercel Config, Serverless Entrypoint & Bundle Budget
// ============================================================================

test('ACP-DEP-001: vercel.json and api/index.ts serverless handler serve API & health routes cleanly', async () => {
  const vercelCfg = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'vercel.json'), 'utf8')
  );
  assert.equal(vercelCfg.outputDirectory, 'dist');
  assert.ok(vercelCfg.rewrites.some((r: any) => r.source === '/api/(.*)' && r.destination === '/api/index'));
  assert.ok(vercelCfg.rewrites.some((r: any) => r.source === '/health' && r.destination === '/api/index'));
  assert.ok(vercelCfg.rewrites.some((r: any) => r.destination === '/index.html'));

  const origVercel = process.env.VERCEL;
  process.env.VERCEL = '1';
  const apiMod = await import('../../api/index');
  const handler = apiMod.default;
  const serverless = http.createServer((req, res) => {
    void handler(req, res);
  });

  try {
    await new Promise<void>((resolve) => {
      serverless.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = serverless.address() as any;
    const sUrl = `http://127.0.0.1:${addr.port}`;

    const cfgRes = await fetch(`${sUrl}/api/config`);
    assert.equal(cfgRes.status, 200);
    const cfgData = (await cfgRes.json()) as any;
    assert.equal(cfgData.ok, true);
    assert.equal(cfgData.paypalEnv, 'sandbox');

    const liveRes = await fetch(`${sUrl}/health/live`);
    assert.equal(liveRes.status, 200);
    assert.equal(((await liveRes.json()) as any).status, 'live');
  } finally {
    if (origVercel !== undefined) process.env.VERCEL = origVercel;
    else delete process.env.VERCEL;
    await new Promise<void>((resolve) => serverless.close(() => resolve()));
  }
});

test('ACP-PERF-008: Production build splits routes lazily so initial index chunk stays under 500 kB', () => {
  const distIndex = path.join(process.cwd(), 'dist', 'index.html');
  const distAssetsDir = path.join(process.cwd(), 'dist', 'assets');
  if (!fs.existsSync(distIndex) || !fs.existsSync(distAssetsDir)) {
    return;
  }

  const assets = fs.readdirSync(distAssetsDir);
  const entryChunk = assets.find((f) => /^index-.*\.js$/.test(f));
  assert.ok(entryChunk, 'Expected built entry chunk index-*.js in dist/assets');

  const entrySizeBytes = fs.statSync(path.join(distAssetsDir, entryChunk!)).size;
  assert.ok(
    entrySizeBytes < 500 * 1024,
    `Main entry chunk ${entryChunk} is ${entrySizeBytes} bytes; must stay < 500 kB after route code-splitting`
  );

  const html = fs.readFileSync(distIndex, 'utf8');
  assert.ok(!html.includes('SellerCommandCenterScreen'), 'Entry HTML must not eagerly preload SellerCommandCenterScreen');
  assert.ok(!html.includes('vendor-three'), 'Entry HTML must not eagerly preload vendor-three');
  assert.ok(!html.includes('DashboardScreen'), 'Entry HTML must not eagerly preload DashboardScreen');
});
