export type EscrowState =
  | 'created'
  | 'funded'
  | 'in_delivery'
  | 'released'
  | 'disputed'
  | 'refunded';

export type EscrowActorRole = 'customer' | 'seller' | 'finance' | 'business_head' | 'system';

export interface EscrowEventRecord {
  id: string;
  orderId: string;
  fromState: EscrowState | null;
  toState: EscrowState;
  actorId: string;
  actorRole: EscrowActorRole;
  reason: string;
  timestamp: string;
}

/**
 * Architectural rationale for PayPal Orders v2 + Application-Level Escrow:
 *
 * PayPal Orders v2 supports `intent: "AUTHORIZE"` and `intent: "CAPTURE"`.
 * - Under PayPal's documentation for `intent=AUTHORIZE`:
 *   1. An authorization is valid for a maximum honor period of 29 days.
 *   2. Funds are only guaranteed by the card network during the 3-day (72-hour) honor period.
 *   3. Reauthorizations can only be performed within the 29-day window, and card holds often drop after 3–7 days.
 * - Because physical B2B/B2C hardware & appliance orders in AC PayPilot require manufacturing/dispatch,
 *   multi-day courier transit, and buyer delivery inspection (typically 5–14 days), relying on
 *   `intent=AUTHORIZE` risks authorization expiry before delivery inspection completes.
 * - Therefore, AC PayPilot uses `intent=CAPTURE` at checkout into the platform settlement account
 *   and tracks the hold in our application-level escrow ledger (`created -> funded -> in_delivery -> released | disputed | refunded`).
 */
export const ESCROW_ARCHITECTURE_DECISION = {
  chosenPaypalIntent: 'CAPTURE' as const,
  authorizeHonorPeriodDays: 3,
  authorizeExpirationDays: 29,
  summary:
    'Capture at checkout (intent=CAPTURE) with application-level ledger hold. PayPal AUTHORIZE only guarantees funds for 3 days (expires at 29 days), which is too short for 5–14 day physical hardware shipping and buyer inspection.',
};

/**
 * Strict transition graph for the application-level escrow state machine:
 * created -> funded -> in_delivery -> released | disputed | refunded
 */
export const ALLOWED_ESCROW_TRANSITIONS: Readonly<Record<EscrowState, readonly EscrowState[]>> = {
  created: ['funded', 'refunded'],
  funded: ['in_delivery', 'disputed', 'refunded'],
  in_delivery: ['released', 'disputed', 'refunded'],
  disputed: ['released', 'refunded'],
  released: [],
  refunded: [],
};

/**
 * Roles permitted to trigger each target state.
 * Note: 'funded' is triggered by server-verified PayPal capture ('system' or 'finance').
 * Release, Dispute, and Refund require an explicit click by an authorized human role (never AI).
 */
export const ALLOWED_ROLES_FOR_TRANSITION: Readonly<Record<EscrowState, readonly EscrowActorRole[]>> = {
  created: ['customer', 'seller', 'system'],
  funded: ['system', 'finance'],
  in_delivery: ['seller', 'finance'],
  released: ['customer', 'finance'],
  disputed: ['customer', 'seller', 'finance'],
  refunded: ['finance', 'seller'],
};

export interface EscrowTransitionRequest {
  orderId: string;
  currentState: EscrowState;
  nextState: EscrowState;
  actorId: string;
  actorRole: EscrowActorRole;
  reason: string;
  isAiAutomated?: boolean;
  timestamp?: string;
}

export interface EscrowTransitionResult {
  ok: boolean;
  nextState: EscrowState;
  event?: EscrowEventRecord;
  error?: string;
  code?:
    | 'AI_DIRECT_MUTATION_FORBIDDEN'
    | 'INVALID_STATE_TRANSITION'
    | 'UNAUTHORIZED_ROLE_FOR_TRANSITION'
    | 'MISSING_REASON_OR_ACTOR';
}

export function canTransitionEscrow(fromState: EscrowState, toState: EscrowState): boolean {
  const allowed = ALLOWED_ESCROW_TRANSITIONS[fromState];
  return Array.isArray(allowed) && allowed.includes(toState);
}

export function isRoleAllowedForEscrowTransition(
  toState: EscrowState,
  role: EscrowActorRole
): boolean {
  const allowedRoles = ALLOWED_ROLES_FOR_TRANSITION[toState];
  return Array.isArray(allowedRoles) && allowedRoles.includes(role);
}

/**
 * Validates and executes an escrow state transition, returning an immutable EscrowEventRecord.
 * Enforces:
 * 1. AI cannot directly mutate escrow state (must be an explicit human/system action).
 * 2. Actor ID and non-empty reason are required.
 * 3. State transition must follow `created -> funded -> in_delivery -> released | disputed | refunded`.
 * 4. Actor role must be authorized for the target state.
 */
export function transitionEscrowState(req: EscrowTransitionRequest): EscrowTransitionResult {
  if (req.isAiAutomated) {
    return {
      ok: false,
      nextState: req.currentState,
      code: 'AI_DIRECT_MUTATION_FORBIDDEN',
      error: 'AI may only recommend escrow actions. Release, Dispute, and Refund require an authorized user click.',
    };
  }

  if (!req.actorId || !req.actorId.trim() || !req.reason || !req.reason.trim()) {
    return {
      ok: false,
      nextState: req.currentState,
      code: 'MISSING_REASON_OR_ACTOR',
      error: 'Every escrow transition requires a valid actorId and non-empty reason.',
    };
  }

  if (!canTransitionEscrow(req.currentState, req.nextState)) {
    return {
      ok: false,
      nextState: req.currentState,
      code: 'INVALID_STATE_TRANSITION',
      error: `Invalid escrow transition from '${req.currentState}' to '${req.nextState}'. Allowed: [${ALLOWED_ESCROW_TRANSITIONS[req.currentState].join(', ') || 'none (terminal)'}].`,
    };
  }

  if (!isRoleAllowedForEscrowTransition(req.nextState, req.actorRole)) {
    return {
      ok: false,
      nextState: req.currentState,
      code: 'UNAUTHORIZED_ROLE_FOR_TRANSITION',
      error: `Role '${req.actorRole}' is not authorized to transition escrow to '${req.nextState}'.`,
    };
  }

  const timestamp = req.timestamp || new Date().toISOString();
  const event: EscrowEventRecord = {
    id: `esc-evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    orderId: req.orderId,
    fromState: req.currentState,
    toState: req.nextState,
    actorId: req.actorId.trim(),
    actorRole: req.actorRole,
    reason: req.reason.trim(),
    timestamp,
  };

  return {
    ok: true,
    nextState: req.nextState,
    event,
  };
}

/**
 * Maps legacy human-readable UI strings to canonical EscrowState values.
 */
export function normalizeEscrowState(rawStatus?: string): EscrowState {
  if (!rawStatus) return 'created';
  const lower = rawStatus.toLowerCase();
  if (lower === 'created' || lower.includes('pending')) return 'created';
  if (lower === 'funded' || lower.includes('locked') || lower.includes('funded')) return 'funded';
  if (lower === 'in_delivery' || lower.includes('transit') || lower.includes('shipped')) return 'in_delivery';
  if (lower === 'released' || lower.includes('released') || lower.includes('delivered')) return 'released';
  if (lower === 'disputed' || lower.includes('dispute')) return 'disputed';
  if (lower === 'refunded' || lower.includes('refund')) return 'refunded';
  return 'funded';
}

/**
 * Formats canonical EscrowState into a clear UI label.
 */
export function formatEscrowStateLabel(state: EscrowState): string {
  switch (state) {
    case 'created':
      return 'Created (Awaiting Funding)';
    case 'funded':
      return 'Funded (Held in Escrow)';
    case 'in_delivery':
      return 'In Delivery (Carrier Transit)';
    case 'released':
      return 'Released to Seller';
    case 'disputed':
      return 'Disputed (Under Review)';
    case 'refunded':
      return 'Refunded to Buyer';
  }
}
