// Shapes the saved-theses routes send to the page. Types only, safe in the browser.
import type { ClaimState, EvidenceStatus, SourceKind } from './evidence';
import type { MetricKey, Portfolio, RiskMetric } from './risk';
import type {
  PathDecision,
  PremortemStatus,
  ThesisStatus,
  TriggerKind,
  WatchState,
} from './premortem';

export interface FailurePathDTO {
  id: string;
  ordinal: number;
  source: 'uncle' | 'user';
  condition: string;
  probability: number;
  impactPct: number;
  deadline: string;
  triggerKind: TriggerKind;
  triggerLevel: number | null;
  triggerNote: string;
  decision: PathDecision;
  decisionReason: string | null;
  modified: boolean;
  resolvedAt: string | null;
}

export interface ThesisDTO {
  id: string;
  title: string;
  content: string | null;
  symbol: string | null;
  instrumentId: string | null;
  status: ThesisStatus;
  createdAt: string;
  updatedAt: string;
  failurePaths: FailurePathDTO[];
  premortem: PremortemStatus;
  claims: ClaimDTO[];
  evidence: EvidenceStatus;
  seal: SealDTO | null;
  lock: LockDTO | null;
}

export interface LockDTO {
  id: string;
  plannedUsd: number;
  leverage: number;
  verdict: 'clear' | 'warn' | 'override';
  metrics: RiskMetric[];
  acknowledged: string[];
  overrideReason: string | null;
  lockedAt: string;
}

export interface SealDTO {
  id: string;
  direction: 'up' | 'down';
  horizonDays: number;
  userProbability: number;
  systemProbability: number;
  systemMethod: 'uncle' | 'base_rate';
  systemRationale: string | null;
  baseRate: number | null;
  instrumentId: string;
  referencePrice: number;
  sealedAt: string;
  resolvesAt: string;
  status: 'open' | 'resolved' | 'unresolvable';
  outcome: boolean | null;
  resolvedPrice: number | null;
  resolvedAt: string | null;
  userBrier: number | null;
  systemBrier: number | null;
}

export interface ClaimDTO {
  id: string;
  key: string;
  origin: 'system' | 'user';
  label: string;
  /** Null when the claim is withheld for insufficient evidence. */
  valueText: string | null;
  state: ClaimState;
  sourceKind: SourceKind;
  sourceLabel: string;
  sourceUrl: string | null;
  observedAt: string | null;
  fetchedAt: string;
  marketClosed: boolean;
  note: string | null;
  /** When the app read the source page and found the figure on it. */
  verifiedAt: string | null;
  /** The stretch of the page around the figure. */
  excerpt: string | null;
  acknowledged: boolean;
}

export interface WatchAlertDTO {
  thesisId: string;
  thesisTitle: string;
  pathId: string;
  condition: string;
  state: WatchState;
  message: string;
  price: number | null;
  priceAsOf: string | null;
}

export interface CalibrationEntryDTO {
  thesisId: string;
  title: string;
  symbol: string | null;
  direction: 'up' | 'down';
  horizonDays: number;
  userProbability: number;
  systemProbability: number;
  sealedAt: string;
  resolvesAt: string;
  status: 'open' | 'resolved' | 'unresolvable';
  outcome: boolean | null;
  userBrier: number | null;
  systemBrier: number | null;
}

export interface CalibrationDTO {
  calibration: {
    resolved: number;
    userMeanBrier: number | null;
    systemMeanBrier: number | null;
    better: 'you' | 'uncle' | null;
    hitRate: number | null;
    userMeanProbability: number | null;
    systemMeanProbability: number | null;
  };
  entries: CalibrationEntryDTO[];
}

export interface RiskReportDTO {
  metrics: RiskMetric[];
  verdict: 'clear' | 'warn' | 'block';
  needsAck: MetricKey[];
  hasBlock: boolean;
  measuredAt: string;
}

export type PortfolioDTO = Portfolio;
