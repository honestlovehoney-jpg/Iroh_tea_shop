import 'server-only';
import type { Claim, FailurePath, Lock, PrismaClient, Seal, Thesis } from '@prisma/client';
import type { Owner } from './owner';
import { evidenceStatus, type ClaimState, type SourceKind } from './evidence';
import {
  premortemStatus,
  type FailurePathFields,
  type PathDecision,
  type ThesisStatus,
  type TriggerKind,
} from './premortem';

export const NO_STORE = { 'cache-control': 'no-store' };

export type ThesisWithPaths = Thesis & {
  failurePaths: FailurePath[];
  claims: Claim[];
  seal: Seal | null;
  lock: Lock | null;
};

export function pathView(path: FailurePath) {
  return {
    id: path.id,
    ordinal: path.ordinal,
    source: path.source,
    condition: path.condition,
    probability: path.probability,
    impactPct: path.impactPct,
    deadline: path.deadline.toISOString(),
    triggerKind: path.triggerKind as TriggerKind,
    triggerLevel: path.triggerLevel,
    triggerNote: path.triggerNote,
    decision: path.decision as PathDecision,
    decisionReason: path.decisionReason,
    modified: path.originalJson !== null,
    resolvedAt: path.resolvedAt?.toISOString() ?? null,
  };
}

export function claimView(claim: Claim) {
  const insufficient = claim.state === 'insufficient';
  return {
    id: claim.id,
    key: claim.key,
    origin: claim.origin as 'system' | 'user',
    label: claim.label,
    // A red claim never leaves the server with a value.
    valueText: insufficient ? null : claim.valueText,
    state: claim.state as ClaimState,
    sourceKind: claim.sourceKind as SourceKind,
    sourceLabel: claim.sourceLabel,
    sourceUrl: claim.sourceUrl,
    observedAt: claim.observedAt?.toISOString() ?? null,
    fetchedAt: claim.fetchedAt.toISOString(),
    marketClosed: claim.marketClosed,
    note: claim.note,
    verifiedAt: claim.verifiedAt?.toISOString() ?? null,
    excerpt: claim.excerpt,
    acknowledged: claim.acknowledged,
  };
}

export const claimStates = (claims: Claim[]) =>
  claims.map((c) => ({
    state: c.state as ClaimState,
    origin: c.origin as 'system' | 'user',
    acknowledged: c.acknowledged,
    fetchedAt: c.fetchedAt.toISOString(),
  }));

export function sealView(seal: Seal) {
  return {
    id: seal.id,
    direction: seal.direction as 'up' | 'down',
    horizonDays: seal.horizonDays,
    userProbability: seal.userProbability,
    systemProbability: seal.systemProbability,
    systemMethod: seal.systemMethod as 'uncle' | 'base_rate',
    systemRationale: seal.systemRationale,
    baseRate: seal.baseRate,
    instrumentId: seal.instrumentId,
    referencePrice: seal.referencePrice,
    sealedAt: seal.sealedAt.toISOString(),
    resolvesAt: seal.resolvesAt.toISOString(),
    status: seal.status as 'open' | 'resolved' | 'unresolvable',
    outcome: seal.outcome,
    resolvedPrice: seal.resolvedPrice,
    resolvedAt: seal.resolvedAt?.toISOString() ?? null,
    userBrier: seal.userBrier,
    systemBrier: seal.systemBrier,
  };
}

export function lockView(lock: Lock) {
  const parse = <T,>(text: string, fallback: T): T => {
    try {
      return JSON.parse(text) as T;
    } catch {
      return fallback;
    }
  };
  return {
    id: lock.id,
    plannedUsd: lock.plannedUsd,
    leverage: lock.leverage,
    verdict: lock.verdict as 'clear' | 'warn' | 'override',
    metrics: parse<unknown[]>(lock.metricsJson, []),
    acknowledged: parse<string[]>(lock.acknowledgedKeys, []),
    overrideReason: lock.overrideReason,
    lockedAt: lock.lockedAt.toISOString(),
  };
}

export function thesisView(thesis: ThesisWithPaths) {
  const paths = [...thesis.failurePaths].sort((a, b) => a.ordinal - b.ordinal);
  return {
    id: thesis.id,
    title: thesis.title,
    content: thesis.content,
    symbol: thesis.symbol,
    instrumentId: thesis.instrumentId,
    status: thesis.status as ThesisStatus,
    createdAt: thesis.createdAt.toISOString(),
    updatedAt: thesis.updatedAt.toISOString(),
    failurePaths: paths.map(pathView),
    premortem: premortemStatus(
      paths.map((p) => ({ decision: p.decision as PathDecision })),
    ),
    claims: [...thesis.claims]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map(claimView),
    evidence: evidenceStatus(claimStates(thesis.claims), new Date()),
    seal: thesis.seal ? sealView(thesis.seal) : null,
    lock: thesis.lock ? lockView(thesis.lock) : null,
  };
}

export const fieldsOf = (path: FailurePath): FailurePathFields => ({
  condition: path.condition,
  probability: path.probability,
  impactPct: path.impactPct,
  deadline: path.deadline.toISOString(),
  triggerKind: path.triggerKind as TriggerKind,
  triggerLevel: path.triggerLevel,
  triggerNote: path.triggerNote,
});


/** A thesis only its owner may see. Anyone else gets null, the same as a missing id. */
export function loadOwned(db: PrismaClient, owner: Owner, thesisId: string) {
  return db.thesis.findFirst({
    where: { id: thesisId, ownerKey: owner.key },
    include: {
      failurePaths: { orderBy: { ordinal: 'asc' } },
      claims: true,
      seal: true,
      lock: true,
    },
  });
}

/** Small in-memory cap on Uncle calls per owner, so a guest cannot run up the model bill. */
const generationLog = new Map<string, number[]>();
export const GENERATIONS_PER_HOUR = 10;
/** For tests: forget earlier calls. */
export const resetGenerationLog = () => generationLog.clear();
export function allowGeneration(ownerKey: string, now = Date.now()): boolean {
  const recent = (generationLog.get(ownerKey) ?? []).filter(
    (at) => now - at < 3_600_000,
  );
  if (recent.length >= GENERATIONS_PER_HOUR) {
    generationLog.set(ownerKey, recent);
    return false;
  }
  recent.push(now);
  generationLog.set(ownerKey, recent);
  return true;
}
