import test, { before, after, beforeEach } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

let testEnv: RulesTestEnvironment;

before(async () => {
  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  const [host, portStr] = emulatorHost.split(':');
  const port = Number(portStr || 8080);

  testEnv = await initializeTestEnvironment({
    projectId: 'demo-ac-paypilot-rules-audit',
    firestore: {
      rules: fs.readFileSync(path.join(process.cwd(), 'firestore.rules'), 'utf8'),
      host,
      port,
    },
  });
});

after(async () => {
  if (testEnv) {
    await testEnv.cleanup();
  }
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

async function seedTenantsAndActors() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();

    await setDoc(doc(db, 'businesses', 'biz-aerocool'), {
      id: 'biz-aerocool',
      ownerUid: 'owner-aerocool',
      name: 'AeroCool Dynamics',
    });

    await setDoc(doc(db, 'businesses', 'biz-alpha'), {
      id: 'biz-alpha',
      ownerUid: 'owner-alpha',
      name: 'Alpha Merchant',
    });

    await setDoc(doc(db, 'businesses', 'biz-beta'), {
      id: 'biz-beta',
      ownerUid: 'owner-beta',
      name: 'Beta Merchant',
    });

    await setDoc(doc(db, 'users', 'seller-alpha'), {
      uid: 'seller-alpha',
      email: 'seller@alpha.in',
      displayName: 'Alpha Seller',
      role: 'seller',
      bizId: 'biz-alpha',
    });

    await setDoc(doc(db, 'users', 'seller-beta'), {
      uid: 'seller-beta',
      email: 'seller@beta.in',
      displayName: 'Beta Seller',
      role: 'seller',
      bizId: 'biz-beta',
    });

    await setDoc(doc(db, 'users', 'finance-beta'), {
      uid: 'finance-beta',
      email: 'finance@beta.in',
      displayName: 'Beta Finance',
      role: 'finance',
      bizId: 'biz-beta',
    });

    await setDoc(doc(db, 'users', 'bh-beta'), {
      uid: 'bh-beta',
      email: 'head@beta.in',
      displayName: 'Beta Head',
      role: 'business_head',
      bizId: 'biz-beta',
    });

    await setDoc(doc(db, 'users', 'cust-alpha-1'), {
      uid: 'cust-alpha-1',
      email: 'buyer1@alpha.in',
      displayName: 'Alpha Buyer 1',
      role: 'customer',
      bizId: 'biz-alpha',
    });

    await setDoc(doc(db, 'businesses', 'biz-alpha', 'orders', 'ord-a1'), {
      id: 'ord-a1',
      bizId: 'biz-alpha',
      customerId: 'cust-alpha-1',
      customerEmail: 'buyer1@alpha.in',
      totalMinor: 9900,
      currency: 'USD',
      escrowState: 'funded',
    });

    await setDoc(doc(db, 'businesses', 'biz-alpha', 'orders', 'ord-a2'), {
      id: 'ord-a2',
      bizId: 'biz-alpha',
      customerId: 'cust-alpha-2',
      customerEmail: 'buyer2@alpha.in',
      totalMinor: 19900,
      currency: 'USD',
      escrowState: 'funded',
    });

    await setDoc(doc(db, 'businesses', 'biz-alpha', 'payments', 'pay-a1'), {
      id: 'pay-a1',
      bizId: 'biz-alpha',
      orderId: 'ord-a1',
      grossMinor: 9900,
      currency: 'USD',
    });

    await setDoc(doc(db, 'businesses', 'biz-alpha', 'escrowEvents', 'evt-a1'), {
      id: 'evt-a1',
      bizId: 'biz-alpha',
      orderId: 'ord-a1',
      toState: 'funded',
      actorId: 'system',
    });

    await setDoc(doc(db, 'orders', 'top-ord-a1'), {
      id: 'top-ord-a1',
      bizId: 'biz-alpha',
      customerId: 'cust-alpha-1',
      sellerId: 'seller-alpha',
      totalMinor: 9900,
      currency: 'USD',
    });

    await setDoc(doc(db, 'escrowEvents', 'top-evt-a1'), {
      id: 'top-evt-a1',
      bizId: 'biz-alpha',
      orderId: 'ord-a1',
      customerId: 'cust-alpha-1',
      sellerId: 'seller-alpha',
      toState: 'funded',
      actorId: 'system',
    });
  });
}

// ============================================================================
// ACP-SEC-003: Role Self-Escalation & Tenant Identity Immutability
// ============================================================================

test('ACP-SEC-003: Rejects self-escalation on user create & update, while allowing safe profile edits', async () => {
  await seedTenantsAndActors();

  const newCustomerDb = testEnv.authenticatedContext('new-cust-1').firestore();

  // Attacker cannot self-create with elevated roles or foreign bizId / activeBizId
  for (const forbiddenRole of ['seller', 'finance', 'business_head']) {
    await assertFails(
      setDoc(doc(newCustomerDb, 'users', 'new-cust-1'), {
        uid: 'new-cust-1',
        email: 'new@test.in',
        displayName: 'Attacker',
        role: forbiddenRole,
      })
    );
  }

  await assertFails(
    setDoc(doc(newCustomerDb, 'users', 'new-cust-1'), {
      uid: 'new-cust-1',
      email: 'new@test.in',
      displayName: 'Tenant Spoofer',
      role: 'customer',
      bizId: 'biz-alpha',
    })
  );

  await assertFails(
    setDoc(doc(newCustomerDb, 'users', 'new-cust-1'), {
      uid: 'new-cust-1',
      email: 'new@test.in',
      displayName: 'ActiveBiz Spoofer',
      role: 'customer',
      activeBizId: 'biz-alpha',
    })
  );

  // Legitimate lowest-privilege customer profile creation (no activeBizId) succeeds
  await assertSucceeds(
    setDoc(doc(newCustomerDb, 'users', 'new-cust-1'), {
      uid: 'new-cust-1',
      email: 'new@test.in',
      displayName: 'Legit Customer',
      role: 'customer',
      bizId: 'biz-aerocool',
    })
  );

  // Legitimate safe profile field update succeeds even when activeBizId is absent
  await assertSucceeds(
    updateDoc(doc(newCustomerDb, 'users', 'new-cust-1'), {
      displayName: 'Legit Customer Updated',
      phone: '+919999999999',
      onboardingCompleted: true,
    })
  );

  // Escalating role, uid, bizId, activeBizId, or isVerified fails closed
  for (const escalatedPatch of [
    { role: 'seller' },
    { role: 'finance' },
    { role: 'business_head' },
    { bizId: 'biz-beta' },
    { activeBizId: 'biz-alpha' },
    { uid: 'someone-else' },
    { isVerified: true },
  ]) {
    await assertFails(updateDoc(doc(newCustomerDb, 'users', 'new-cust-1'), escalatedPatch));
  }

  // Updating another user's document always fails
  await assertFails(
    updateDoc(doc(newCustomerDb, 'users', 'cust-alpha-1'), { displayName: 'Hacked' })
  );
});

// ============================================================================
// ACP-SEC-004: Forged Order Prevention (Nested & Top-Level)
// ============================================================================

test('ACP-SEC-004: Denies unauthenticated and client-forged orders in both nested and top-level collections', async () => {
  await seedTenantsAndActors();

  const anonDb = testEnv.unauthenticatedContext().firestore();
  const custDb = testEnv.authenticatedContext('cust-alpha-1').firestore();
  const sellerAlphaDb = testEnv.authenticatedContext('seller-alpha').firestore();

  // Nested businesses/{bizId}/orders/{orderId}
  await assertFails(
    setDoc(doc(anonDb, 'businesses', 'biz-alpha', 'orders', 'forged-anon'), {
      total: 1,
      totalMinor: 100,
    })
  );
  await assertFails(
    setDoc(doc(custDb, 'businesses', 'biz-alpha', 'orders', 'forged-cust'), {
      customerId: 'cust-alpha-1',
      totalMinor: 1,
      currency: 'USD',
    })
  );
  await assertFails(
    updateDoc(doc(custDb, 'businesses', 'biz-alpha', 'orders', 'ord-a1'), { totalMinor: 1 })
  );
  await assertFails(deleteDoc(doc(sellerAlphaDb, 'businesses', 'biz-alpha', 'orders', 'ord-a1')));
  await assertFails(
    setDoc(doc(sellerAlphaDb, 'businesses', 'biz-alpha', 'orders', 'forged-seller'), {
      totalMinor: 0,
      currency: 'USD',
    })
  );

  // Top-level orders/{orderId}
  await assertFails(
    setDoc(doc(custDb, 'orders', 'forged-top-1'), {
      customerId: 'cust-alpha-1',
      totalMinor: 1,
      currency: 'USD',
    })
  );
  await assertFails(updateDoc(doc(custDb, 'orders', 'top-ord-a1'), { totalMinor: 1 }));
});

// ============================================================================
// ACP-SEC-005: Strict Tenant & Customer Read Isolation
// ============================================================================

test('ACP-SEC-005: Enforces cross-tenant read isolation and blocks customers from listing all business orders', async () => {
  await seedTenantsAndActors();

  const sellerAlphaDb = testEnv.authenticatedContext('seller-alpha').firestore();
  const sellerBetaDb = testEnv.authenticatedContext('seller-beta').firestore();
  const financeBetaDb = testEnv.authenticatedContext('finance-beta').firestore();
  const bhBetaDb = testEnv.authenticatedContext('bh-beta').firestore();
  const custAlpha1Db = testEnv.authenticatedContext('cust-alpha-1').firestore();
  const unverifiedEmailSpooferDb = testEnv
    .authenticatedContext('random-uid', { email: 'buyer2@alpha.in', email_verified: false })
    .firestore();

  // Same-tenant seller CAN list/get their own business records
  await assertSucceeds(getDocs(collection(sellerAlphaDb, 'businesses', 'biz-alpha', 'orders')));
  await assertSucceeds(getDoc(doc(sellerAlphaDb, 'businesses', 'biz-alpha', 'payments', 'pay-a1')));
  await assertSucceeds(getDoc(doc(sellerAlphaDb, 'businesses', 'biz-alpha', 'escrowEvents', 'evt-a1')));

  // Cross-tenant seller, finance, and business_head MUST be denied
  for (const crossTenantDb of [sellerBetaDb, financeBetaDb, bhBetaDb]) {
    await assertFails(getDocs(collection(crossTenantDb, 'businesses', 'biz-alpha', 'orders')));
    await assertFails(getDoc(doc(crossTenantDb, 'businesses', 'biz-alpha', 'orders', 'ord-a1')));
    await assertFails(getDoc(doc(crossTenantDb, 'businesses', 'biz-alpha', 'payments', 'pay-a1')));
    await assertFails(getDoc(doc(crossTenantDb, 'businesses', 'biz-alpha', 'escrowEvents', 'evt-a1')));
    await assertFails(getDoc(doc(crossTenantDb, 'orders', 'top-ord-a1')));
    await assertFails(getDoc(doc(crossTenantDb, 'escrowEvents', 'top-evt-a1')));
  }

  // Customer belonging to biz-alpha CANNOT list all orders or read another customer's order
  await assertFails(getDocs(collection(custAlpha1Db, 'businesses', 'biz-alpha', 'orders')));
  await assertFails(getDoc(doc(custAlpha1Db, 'businesses', 'biz-alpha', 'orders', 'ord-a2')));
  await assertFails(getDoc(doc(custAlpha1Db, 'businesses', 'biz-alpha', 'payments', 'pay-a1')));

  // Customer CAN get their own individual order
  await assertSucceeds(getDoc(doc(custAlpha1Db, 'businesses', 'biz-alpha', 'orders', 'ord-a1')));

  // Unverified email claim CANNOT read another customer's order by matching customerEmail
  await assertFails(
    getDoc(doc(unverifiedEmailSpooferDb, 'businesses', 'biz-alpha', 'orders', 'ord-a2'))
  );
});

// ============================================================================
// ACP-SEC-006: Immutable Append-Only Escrow Audit Boundary
// ============================================================================

test('ACP-SEC-006: Denies all client writes to nested and top-level escrowEvents', async () => {
  await seedTenantsAndActors();

  const custDb = testEnv.authenticatedContext('cust-alpha-1').firestore();
  const sellerAlphaDb = testEnv.authenticatedContext('seller-alpha').firestore();

  for (const clientDb of [custDb, sellerAlphaDb]) {
    await assertFails(
      setDoc(doc(clientDb, 'escrowEvents', 'forged-evt-1'), {
        orderId: 'ord-a1',
        actorId: 'seller-alpha',
        toState: 'released',
      })
    );
    await assertFails(updateDoc(doc(clientDb, 'escrowEvents', 'top-evt-a1'), { toState: 'released' }));
    await assertFails(deleteDoc(doc(clientDb, 'escrowEvents', 'top-evt-a1')));

    await assertFails(
      setDoc(doc(clientDb, 'businesses', 'biz-alpha', 'escrowEvents', 'forged-nested-evt'), {
        orderId: 'ord-a1',
        toState: 'released',
      })
    );
    await assertFails(
      updateDoc(doc(clientDb, 'businesses', 'biz-alpha', 'escrowEvents', 'evt-a1'), {
        toState: 'released',
      })
    );
  }
});

// ============================================================================
// SEC-009 / SEC-010 / SEC-011: Hardened Rules (_health, businesses, products)
// ============================================================================

test('SEC-009 / SEC-010 / SEC-011: Locks _health, scopes businesses reads to members, and scopes root catalog collections by tenant', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, '_health', 'ping-1'), { ok: true });
    await setDoc(doc(db, 'products', 'prod-alpha-1'), {
      sellerId: 'seller-alpha',
      bizId: 'biz-alpha',
      name: 'Alpha Fan',
      priceMinor: 1000,
      currency: 'INR',
    });
  });

  await seedTenantsAndActors();

  const anonDb = testEnv.unauthenticatedContext().firestore();
  const sellerAlphaDb = testEnv.authenticatedContext('seller-alpha').firestore();
  const sellerBetaDb = testEnv.authenticatedContext('seller-beta').firestore();

  // SEC-009: _health is server Admin SDK only (denies all client reads and writes)
  await assertFails(getDoc(doc(anonDb, '_health', 'ping-1')));
  await assertFails(setDoc(doc(anonDb, '_health', 'ping-anon'), { ok: true }));
  await assertFails(setDoc(doc(sellerAlphaDb, '_health', 'ping-seller'), { ok: true }));

  // SEC-010: businesses/{bizId} parent document is member-only while public storefrontConfig remains readable
  await assertFails(getDoc(doc(anonDb, 'businesses', 'biz-alpha')));
  await assertFails(getDoc(doc(sellerBetaDb, 'businesses', 'biz-alpha')));
  await assertSucceeds(getDoc(doc(sellerAlphaDb, 'businesses', 'biz-alpha')));
  await assertSucceeds(getDoc(doc(anonDb, 'businesses', 'biz-alpha', 'storefrontConfig', 'current')));

  // SEC-011: root products reads are scoped to owning seller or business tenant members
  await assertFails(getDoc(doc(anonDb, 'products', 'prod-alpha-1')));
  await assertFails(getDoc(doc(sellerBetaDb, 'products', 'prod-alpha-1')));
  await assertSucceeds(getDoc(doc(sellerAlphaDb, 'products', 'prod-alpha-1')));
});

