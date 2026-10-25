// The Failure Table rules. Pure functions with no imports, so the browser, the
// routes and the tests all run exactly the same checks.

export const THESIS_STATUSES = [
  'draft',
  'failures_resolved',
  'evidence_reviewed',
  'sealed',
  'locked',
] as const;
export type ThesisStatus = (typeof THESIS_STATUSES)[number];

export const FAILURE_PATH_MIN = 3;
export const FAILURE_PATH_MAX = 5;
/** A premortem where nearly everything is rejected is not a premortem. */
export const MIN_KEPT_PATHS = 2;
export const MIN_REJECT_REASON = 10;
const MIN_CONDITION = 20;
const MAX_CONDITION = 400;
const MIN_NOTE = 5;
const MAX_NOTE = 200;
const MAX_DEADLINE_DAYS = 365 * 5;
/** A price within this share of its trigger level counts as approaching. */
export const APPROACH_BAND = 0.05;
const DATE_WARNING_DAYS = 7;
const DAY_MS = 86_400_000;

export type TriggerKind = 'price_below' | 'price_above' | 'date' | 'manual';
export const TRIGGER_KINDS: readonly TriggerKind[] = [
  'price_below',
  'price_above',
  'date',
  'manual',
];
export const isPriceTrigger = (kind: TriggerKind) =>
  kind === 'price_below' || kind === 'price_above';

export type PathDecision = 'pending' | 'accepted' | 'modified' | 'rejected';

export interface FailurePathFields {
  /** What would prove the thesis wrong. Must name a measurable threshold. */
  condition: string;
  /** Chance the path happens before the deadline, strictly between 0 and 1. */
  probability: number;
  /** Estimated loss as a percent of the portfolio, above 0 and up to 100. */
  impactPct: number;
  /** ISO timestamp the path must happen by. */
  deadline: string;
  triggerKind: TriggerKind;
  /** Price level for price triggers. */
  triggerLevel: number | null;
  /** What to watch, in words. */
  triggerNote: string;
}

export type Validation<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

export interface ValidationContext {
  now: Date;
  /** Price triggers need a Bitget instrument to watch. */
  hasInstrument: boolean;
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** Check one failure path. Never trusts the caller: used on Uncle's output and on the person's edits alike. */
export function validateFailurePath(
  input: unknown,
  ctx: ValidationContext,
): Validation<FailurePathFields> {
  const errors: string[] = [];
  if (typeof input !== 'object' || input === null)
    return { ok: false, errors: ['A failure path must be an object.'] };
  const raw = input as Record<string, unknown>;

  const condition = typeof raw.condition === 'string' ? raw.condition.trim() : '';
  if (condition.length < MIN_CONDITION || condition.length > MAX_CONDITION)
    errors.push(
      `The failing condition needs ${MIN_CONDITION} to ${MAX_CONDITION} characters.`,
    );
  else if (!/\d/.test(condition))
    errors.push(
      'The failing condition must name a measurable number, such as a price, a percent or a date.',
    );

  const probability = raw.probability;
  if (!isFiniteNumber(probability) || probability <= 0 || probability >= 1)
    errors.push('Probability must be above 0 and below 1.');

  const impactPct = raw.impactPct;
  if (!isFiniteNumber(impactPct) || impactPct <= 0 || impactPct > 100)
    errors.push('Impact must be above 0 and at most 100 percent of the portfolio.');

  let deadline = '';
  const deadlineMs =
    typeof raw.deadline === 'string' ? Date.parse(raw.deadline) : NaN;
  if (!Number.isFinite(deadlineMs)) errors.push('The deadline must be a valid date.');
  else if (deadlineMs <= ctx.now.getTime())
    errors.push('The deadline must be in the future.');
  else if (deadlineMs - ctx.now.getTime() > MAX_DEADLINE_DAYS * DAY_MS)
    errors.push('The deadline is more than five years away.');
  else deadline = new Date(deadlineMs).toISOString();

  const kind = raw.triggerKind;
  const triggerKind = TRIGGER_KINDS.includes(kind as TriggerKind)
    ? (kind as TriggerKind)
    : null;
  if (!triggerKind)
    errors.push('The monitoring trigger must be price_below, price_above, date or manual.');

  let triggerLevel: number | null = null;
  if (triggerKind && isPriceTrigger(triggerKind)) {
    if (!ctx.hasInstrument)
      errors.push('Price triggers need a stock the Bitget catalog knows.');
    if (!isFiniteNumber(raw.triggerLevel) || raw.triggerLevel <= 0)
      errors.push('A price trigger needs a price level above 0.');
    else triggerLevel = raw.triggerLevel;
  }

  const note = typeof raw.triggerNote === 'string' ? raw.triggerNote.trim() : '';
  if (note.length < MIN_NOTE || note.length > MAX_NOTE)
    errors.push(`Describe the trigger in ${MIN_NOTE} to ${MAX_NOTE} characters.`);

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      condition,
      probability: probability as number,
      impactPct: impactPct as number,
      deadline,
      triggerKind: triggerKind as TriggerKind,
      triggerLevel,
      triggerNote: note,
    },
  };
}

/** Pull the path objects out of a model reply, tolerating code fences and prose around the JSON. */
export function extractPathObjects(text: string): unknown[] {
  const stripped = text.replace(/```(?:json)?/gi, '').trim();
  const candidates: string[] = [stripped];
  const first = stripped.indexOf('{');
  const last = stripped.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(stripped.slice(first, last + 1));
  const firstArr = stripped.indexOf('[');
  const lastArr = stripped.lastIndexOf(']');
  if (firstArr >= 0 && lastArr > firstArr)
    candidates.push(stripped.slice(firstArr, lastArr + 1));
  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (Array.isArray(parsed)) return parsed;
      if (
        parsed &&
        typeof parsed === 'object' &&
        Array.isArray((parsed as { paths?: unknown }).paths)
      )
        return (parsed as { paths: unknown[] }).paths;
    } catch {
      /* try the next candidate */
    }
  }
  return [];
}

/** Model replies flatten the trigger into an object; fold it into the stored field names. */
export function normalizeModelPath(item: unknown): unknown {
  if (typeof item !== 'object' || item === null) return item;
  const raw = item as Record<string, unknown>;
  const trigger =
    typeof raw.trigger === 'object' && raw.trigger !== null
      ? (raw.trigger as Record<string, unknown>)
      : {};
  return {
    condition: raw.condition,
    probability: raw.probability,
    impactPct: raw.impactPct ?? raw.impact_pct,
    deadline: raw.deadline,
    triggerKind: raw.triggerKind ?? trigger.kind,
    triggerLevel: raw.triggerLevel ?? trigger.level ?? null,
    triggerNote: raw.triggerNote ?? trigger.note,
  };
}

/** Keep only the valid paths from a model reply, at most `limit`, and report what was dropped. */
export function parseModelPaths(
  text: string,
  ctx: ValidationContext,
  limit = FAILURE_PATH_MAX,
): { paths: FailurePathFields[]; dropped: string[][] } {
  const paths: FailurePathFields[] = [];
  const dropped: string[][] = [];
  for (const item of extractPathObjects(text)) {
    const result = validateFailurePath(normalizeModelPath(item), ctx);
    if (result.ok) {
      if (paths.length < limit) paths.push(result.value);
    } else dropped.push(result.errors);
  }
  return { paths, dropped };
}

export interface StoredPathState {
  decision: PathDecision;
}

export interface PremortemStatus {
  complete: boolean;
  total: number;
  pending: number;
  accepted: number;
  modified: number;
  rejected: number;
  /** Plain-language reasons the thesis cannot move on. Empty when complete. */
  blockers: string[];
}

/** The gate: every path decided, between 3 and 5 paths, and enough of them kept. */
export function premortemStatus(paths: StoredPathState[]): PremortemStatus {
  const count = (d: PathDecision) => paths.filter((p) => p.decision === d).length;
  const total = paths.length;
  const pending = count('pending');
  const accepted = count('accepted');
  const modified = count('modified');
  const rejected = count('rejected');
  const blockers: string[] = [];
  if (total < FAILURE_PATH_MIN)
    blockers.push(
      `The Failure Table needs at least ${FAILURE_PATH_MIN} paths; there ${total === 1 ? 'is' : 'are'} ${total}.`,
    );
  if (total > FAILURE_PATH_MAX)
    blockers.push(`The Failure Table holds at most ${FAILURE_PATH_MAX} paths.`);
  if (pending > 0)
    blockers.push(
      `${pending} path${pending === 1 ? ' is' : 's are'} still waiting for Accept, Modify or Reject.`,
    );
  if (pending === 0 && total >= FAILURE_PATH_MIN && accepted + modified < MIN_KEPT_PATHS)
    blockers.push(
      `Keep at least ${MIN_KEPT_PATHS} paths. Rejecting almost everything leaves no premortem.`,
    );
  return {
    complete: blockers.length === 0,
    total,
    pending,
    accepted,
    modified,
    rejected,
    blockers,
  };
}

export type DecisionRequest =
  | { action: 'accept' }
  | { action: 'modify'; edits: Partial<FailurePathFields> }
  | { action: 'reject'; reason: string };

export type DecisionResult =
  | {
      ok: true;
      decision: PathDecision;
      reason: string | null;
      /** Replacement field values, set only when the person modified the path. */
      fields: FailurePathFields | null;
    }
  | { ok: false; errors: string[] };

const FIELD_KEYS: (keyof FailurePathFields)[] = [
  'condition',
  'probability',
  'impactPct',
  'deadline',
  'triggerKind',
  'triggerLevel',
  'triggerNote',
];

/** Work out what a person's Accept, Modify or Reject does to a path. */
export function applyDecision(
  current: FailurePathFields,
  request: DecisionRequest,
  ctx: ValidationContext,
): DecisionResult {
  if (request.action === 'accept') {
    // An accepted path must still be valid today: a deadline that passed while the person thought about it is not.
    const check = validateFailurePath(current, ctx);
    if (!check.ok) return { ok: false, errors: check.errors };
    return { ok: true, decision: 'accepted', reason: null, fields: null };
  }
  if (request.action === 'reject') {
    const reason = typeof request.reason === 'string' ? request.reason.trim() : '';
    if (reason.length < MIN_REJECT_REASON)
      return {
        ok: false,
        errors: [
          `Say why you reject this path, in at least ${MIN_REJECT_REASON} characters.`,
        ],
      };
    return { ok: true, decision: 'rejected', reason, fields: null };
  }
  if (request.action === 'modify') {
    const edits = request.edits ?? {};
    const merged: Record<string, unknown> = { ...current };
    let changed = false;
    for (const key of FIELD_KEYS) {
      if (!(key in edits)) continue;
      const next = (edits as Record<string, unknown>)[key];
      if (next === undefined) continue;
      if (next !== merged[key]) changed = true;
      merged[key] = next;
    }
    if (!changed)
      return {
        ok: false,
        errors: ['Change at least one field to modify a path, or accept it as written.'],
      };
    const check = validateFailurePath(merged, ctx);
    if (!check.ok) return { ok: false, errors: check.errors };
    return { ok: true, decision: 'modified', reason: null, fields: check.value };
  }
  return { ok: false, errors: ['Unknown decision.'] };
}

export type AdvanceResult =
  | { ok: true; to: ThesisStatus }
  | { ok: false; code: 'blocked' | 'not_available' | 'out_of_order'; reasons: string[] };

/**
 * Whether a thesis may move from one status to another. Statuses move one step
 * at a time. Three gates exist today: the Failure Table (draft to
 * failures_resolved), the Evidence Shelf (failures_resolved to
 * evidence_reviewed) and the Probability Seal, which has its own route because
 * it needs your forecast (evidence_reviewed to sealed), and the Balance Scale,
 * which has its own route because it needs your position (sealed to locked).
 */
export function canAdvance(
  from: ThesisStatus,
  to: ThesisStatus,
  paths: StoredPathState[],
  evidence?: { complete: boolean; blockers: string[] },
): AdvanceResult {
  const fromIndex = THESIS_STATUSES.indexOf(from);
  const toIndex = THESIS_STATUSES.indexOf(to);
  if (toIndex !== fromIndex + 1)
    return {
      ok: false,
      code: 'out_of_order',
      reasons: [`A thesis cannot go from ${from} to ${to}. Stages run in order.`],
    };
  if (to === 'failures_resolved') {
    const status = premortemStatus(paths);
    if (!status.complete)
      return { ok: false, code: 'blocked', reasons: status.blockers };
    return { ok: true, to };
  }
  if (to === 'evidence_reviewed') {
    if (!evidence || !evidence.complete)
      return {
        ok: false,
        code: 'blocked',
        reasons: evidence?.blockers.length
          ? evidence.blockers
          : ['The Evidence Shelf has no evidence yet.'],
      };
    return { ok: true, to };
  }
  if (to === 'locked')
    return {
      ok: false,
      code: 'blocked',
      reasons: ['Serve it through the Balance Scale: state the position size and read the risk.'],
    };
  if (to === 'sealed')
    return {
      ok: false,
      code: 'blocked',
      reasons: [
        'Seal it with the Probability Seal: state a direction, a probability and a horizon.',
      ],
    };
  return {
    ok: false,
    code: 'not_available',
    reasons: [`The ${to.replace('_', ' ')} stage is not open yet.`],
  };
}

/** Can the failure paths still be edited? Once the Failure Table is signed off they are frozen. */
export const pathsEditable = (status: ThesisStatus) => status === 'draft';

export type WatchState =
  | 'clear'
  | 'approaching'
  | 'breached'
  | 'expired'
  | 'unmonitored';

export interface WatchResult {
  state: WatchState;
  /** One plain sentence for the person. */
  message: string;
}

/**
 * Compare a path with the latest price and the clock. Breached beats expired
 * beats approaching. A path that needs a price but has none, or that is a
 * manual trigger, is reported as unmonitored rather than guessed at.
 */
export function evaluateTrigger(
  path: Pick<
    FailurePathFields,
    'triggerKind' | 'triggerLevel' | 'deadline' | 'triggerNote'
  >,
  price: number | null,
  now: Date,
): WatchResult {
  const deadlineMs = Date.parse(path.deadline);
  if (isPriceTrigger(path.triggerKind) && path.triggerLevel !== null && price !== null) {
    const level = path.triggerLevel;
    if (path.triggerKind === 'price_below') {
      if (price <= level)
        return { state: 'breached', message: `Price ${price} is at or below the ${level} trigger.` };
      if (price <= level * (1 + APPROACH_BAND) && deadlineMs > now.getTime())
        return { state: 'approaching', message: `Price ${price} is within ${APPROACH_BAND * 100}% of the ${level} trigger.` };
    } else {
      if (price >= level)
        return { state: 'breached', message: `Price ${price} is at or above the ${level} trigger.` };
      if (price >= level * (1 - APPROACH_BAND) && deadlineMs > now.getTime())
        return { state: 'approaching', message: `Price ${price} is within ${APPROACH_BAND * 100}% of the ${level} trigger.` };
    }
  }
  if (Number.isFinite(deadlineMs)) {
    if (deadlineMs <= now.getTime())
      return { state: 'expired', message: 'The deadline has passed without this path being confirmed.' };
    if (path.triggerKind === 'date' && deadlineMs - now.getTime() <= DATE_WARNING_DAYS * DAY_MS)
      return { state: 'approaching', message: `The deadline is within ${DATE_WARNING_DAYS} days.` };
  }
  if (path.triggerKind === 'manual')
    return { state: 'unmonitored', message: 'This trigger is manual. Check it yourself.' };
  if (isPriceTrigger(path.triggerKind) && price === null)
    return { state: 'unmonitored', message: 'No price is available to check this trigger.' };
  return { state: 'clear', message: 'Not triggered.' };
}
