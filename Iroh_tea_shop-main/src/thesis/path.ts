// The Path of Discipline: the order a thesis must walk, derived from its saved
// status. Pure, so the page and the tests read the same path. The server is
// what enforces the order; this only describes it.

export type PathStatus =
  | 'draft'
  | 'failures_resolved'
  | 'evidence_reviewed'
  | 'sealed'
  | 'locked';

export type StopId = 'thesis' | 'failures' | 'evidence' | 'seal' | 'balance';
export type StopState = 'done' | 'current' | 'ahead';

export interface Stop {
  id: StopId;
  label: string;
  /** What you do there, in a few words. */
  does: string;
  /** The status a thesis has once this stop is finished. */
  doneWhen: PathStatus;
}

export const PATH_STOPS: readonly Stop[] = [
  { id: 'thesis', label: 'Thesis Table', does: 'State the idea', doneWhen: 'draft' },
  { id: 'failures', label: 'Failure Table', does: 'Name how it fails', doneWhen: 'failures_resolved' },
  { id: 'evidence', label: 'Evidence Shelf', does: 'Bind every figure to a source', doneWhen: 'evidence_reviewed' },
  { id: 'seal', label: 'Probability Seal', does: 'Commit to a probability', doneWhen: 'sealed' },
  { id: 'balance', label: 'Balance Scale', does: 'Read the portfolio risk', doneWhen: 'locked' },
];

const ORDER: PathStatus[] = [
  'draft',
  'failures_resolved',
  'evidence_reviewed',
  'sealed',
  'locked',
];

export interface StopView extends Stop {
  number: number;
  state: StopState;
  /** Why it cannot be opened yet. Null when it can. */
  blockedBy: string | null;
}

export interface PathView {
  stops: StopView[];
  /** Index of the stop you are standing at, or -1 when the thesis is served. */
  currentIndex: number;
  completed: number;
  total: number;
  served: boolean;
}

export function pathProgress(status: PathStatus): PathView {
  const at = ORDER.indexOf(status);
  // The Thesis Table is finished the moment the thesis exists. Every other stop
  // is finished once the status it produces has been reached.
  const isFinished = (stop: Stop, index: number) =>
    index === 0 || ORDER.indexOf(stop.doneWhen) <= at;
  const firstOpen = PATH_STOPS.findIndex((stop, index) => !isFinished(stop, index));
  const stops: StopView[] = PATH_STOPS.map((stop, index) => {
    const finished = isFinished(stop, index);
    const state: StopState = finished ? 'done' : index === firstOpen ? 'current' : 'ahead';
    return {
      ...stop,
      number: index + 1,
      state,
      blockedBy:
        state === 'ahead' ? `Finish the ${PATH_STOPS[index - 1].label} first.` : null,
    };
  });
  const completed = stops.filter((s) => s.state === 'done').length;
  return {
    stops,
    currentIndex: stops.findIndex((s) => s.state === 'current'),
    completed,
    total: stops.length,
    served: status === 'locked',
  };
}

/** A stop can be opened when it is done (to read it) or is the current one. Never when it is ahead. */
export function canOpenStop(status: PathStatus, id: StopId): boolean {
  const stop = pathProgress(status).stops.find((s) => s.id === id);
  return stop !== undefined && stop.state !== 'ahead';
}

/** One line for a list: where this thesis stands. */
export function pathSummary(status: PathStatus): string {
  const view = pathProgress(status);
  if (view.served) return 'Served';
  const current = view.stops[view.currentIndex];
  return `Stop ${current.number} of ${view.total}: ${current.label}`;
}
