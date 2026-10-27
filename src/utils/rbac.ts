export type AppUserRole = 'customer' | 'seller' | 'finance' | 'business_head';

export interface AuthenticatedActor {
  uid: string;
  email: string;
  role: AppUserRole;
  bizId?: string;
}

export type ResourceCollection =
  | 'users'
  | 'products'
  | 'productAssets'
  | 'inventory'
  | 'carts'
  | 'orders'
  | 'orderItems'
  | 'payments'
  | 'invoices'
  | 'invoiceItems'
  | 'refunds'
  | 'escrowEvents';

export type AccessOperation = 'read' | 'create' | 'update' | 'delete';

export interface ResourceOwnershipContext {
  ownerUid?: string;
  customerId?: string;
  sellerId?: string;
}

/**
 * Pure access-control policy evaluator used by both server routes and unit tests
 * (mirrors the exact logic in firestore.rules):
 * - customers read/write only their own carts & orders (`customerId === uid`).
 * - sellers edit only their own products/assets/inventory (`sellerId === uid`) and see only their own orders/invoices.
 * - finance reads payments, invoices, refunds, escrowEvents, orders, and creates/updates invoices/refunds/reconciliation.
 * - business_head has read-only aggregate & record access across workspaces, but cannot mutate products, carts, or payments.
 */
export function evaluateRoleAccess(
  actor: AuthenticatedActor | null,
  collection: ResourceCollection,
  operation: AccessOperation,
  ownership: ResourceOwnershipContext = {}
): { allowed: boolean; reason: string } {
  if (!actor || !actor.uid) {
    return { allowed: false, reason: 'Unauthenticated request.' };
  }

  const { uid, role } = actor;

  // Business Head: read-only access across all operational collections for KPI & executive oversight
  if (role === 'business_head') {
    if (operation === 'read') {
      return { allowed: true, reason: 'Business Head has read-only aggregate & inspection access.' };
    }
    if (collection === 'users' && ownership.ownerUid === uid && operation === 'update') {
      return { allowed: true, reason: 'Users may update their own profile.' };
    }
    return {
      allowed: false,
      reason: 'Business Head role is strictly read-only and cannot mutate operational records.',
    };
  }

  switch (collection) {
    case 'users': {
      if (operation === 'read') {
        if (ownership.ownerUid === uid || role === 'finance') {
          return { allowed: true, reason: 'Own user profile or finance audit.' };
        }
        return { allowed: false, reason: 'Cannot read another user profile.' };
      }
      if ((operation === 'create' || operation === 'update') && ownership.ownerUid === uid) {
        return { allowed: true, reason: 'User managing own profile.' };
      }
      return { allowed: false, reason: 'Cannot modify another user profile.' };
    }

    case 'products':
    case 'productAssets':
    case 'inventory': {
      if (operation === 'read') {
        return { allowed: true, reason: 'Catalog products and inventory are readable by authenticated users.' };
      }
      if (role === 'seller' && ownership.sellerId === uid) {
        return { allowed: true, reason: 'Seller owns this product/inventory record.' };
      }
      return {
        allowed: false,
        reason: 'Only the owning seller may create, update, or delete their own products, assets, and inventory.',
      };
    }

    case 'carts': {
      if (role === 'customer' && ownership.customerId === uid) {
        return { allowed: true, reason: 'Customer owns this cart.' };
      }
      return { allowed: false, reason: 'Only the owning customer can read or modify their cart.' };
    }

    case 'orders':
    case 'orderItems': {
      if (operation === 'read') {
        if (role === 'customer' && ownership.customerId === uid) {
          return { allowed: true, reason: 'Customer reading their own order.' };
        }
        if (role === 'seller' && ownership.sellerId === uid) {
          return { allowed: true, reason: 'Seller reading an order for their products.' };
        }
        if (role === 'finance') {
          return { allowed: true, reason: 'Finance reading order for ledger/reconciliation.' };
        }
        return {
          allowed: false,
          reason: `Role '${role}' cannot read orders belonging to another customer/seller.`,
        };
      }
      if (operation === 'create') {
        if (role === 'customer' && ownership.customerId === uid) {
          return { allowed: true, reason: 'Customer creating their own order.' };
        }
        return { allowed: false, reason: 'Orders can only be created for the authenticated customer.' };
      }
      if (operation === 'update') {
        if (role === 'seller' && ownership.sellerId === uid) {
          return { allowed: true, reason: 'Seller updating fulfillment status for their own order.' };
        }
        if (role === 'customer' && ownership.customerId === uid) {
          return { allowed: true, reason: 'Customer updating delivery confirmation on their own order.' };
        }
        if (role === 'finance') {
          return { allowed: true, reason: 'Finance updating settlement/escrow status.' };
        }
      }
      return { allowed: false, reason: 'Unauthorized order mutation.' };
    }

    case 'payments':
    case 'refunds': {
      if (operation === 'read') {
        if (role === 'finance') {
          return { allowed: true, reason: 'Finance has full read access to payments and refunds.' };
        }
        if (role === 'customer' && ownership.customerId === uid) {
          return { allowed: true, reason: 'Customer reading payment for their own order.' };
        }
        if (role === 'seller' && ownership.sellerId === uid) {
          return { allowed: true, reason: 'Seller reading payment for their own order.' };
        }
        return { allowed: false, reason: 'Unauthorized payment/refund read.' };
      }
      if (role === 'finance') {
        return { allowed: true, reason: 'Finance authorized to record/reconcile payments and refunds.' };
      }
      return {
        allowed: false,
        reason: 'Payments and refunds can only be written by the server or authorized finance officers.',
      };
    }

    case 'invoices':
    case 'invoiceItems': {
      if (operation === 'read') {
        if (role === 'finance') {
          return { allowed: true, reason: 'Finance reads all invoices.' };
        }
        if (role === 'seller' && ownership.sellerId === uid) {
          return { allowed: true, reason: 'Seller reading their own invoice.' };
        }
        if (role === 'customer' && ownership.customerId === uid) {
          return { allowed: true, reason: 'Customer reading invoice billed to them.' };
        }
        return { allowed: false, reason: 'Unauthorized invoice read.' };
      }
      if (operation === 'create' || operation === 'update') {
        if (role === 'seller' && ownership.sellerId === uid) {
          return { allowed: true, reason: 'Seller issuing/updating their own invoice.' };
        }
        if (role === 'finance') {
          return { allowed: true, reason: 'Finance managing invoice lifecycle.' };
        }
      }
      return { allowed: false, reason: 'Unauthorized invoice mutation.' };
    }

    case 'escrowEvents': {
      if (operation === 'read') {
        if (
          role === 'finance' ||
          (role === 'customer' && ownership.customerId === uid) ||
          (role === 'seller' && ownership.sellerId === uid)
        ) {
          return { allowed: true, reason: 'Authorized participant reading escrow audit trail.' };
        }
        return { allowed: false, reason: 'Unauthorized escrow event read.' };
      }
      if (operation === 'create') {
        if (
          role === 'finance' ||
          (role === 'customer' && ownership.customerId === uid) ||
          (role === 'seller' && ownership.sellerId === uid)
        ) {
          return { allowed: true, reason: 'Authorized participant appending escrow transition event.' };
        }
      }
      return { allowed: false, reason: 'Escrow events are append-only and cannot be modified or deleted.' };
    }
  }
}
