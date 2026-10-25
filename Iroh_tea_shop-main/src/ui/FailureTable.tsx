'use client';
import { useCallback, useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import type {
  CalibrationDTO,
  ClaimDTO,
  FailurePathDTO,
  LockDTO,
  PortfolioDTO,
  RiskReportDTO,
  SealDTO,
  ThesisDTO,
  WatchAlertDTO,
} from '../thesis/dto';
import { USER_SOURCE_KINDS } from '../thesis/evidence';
import { COIN_FLIP_BRIER } from '../thesis/seal';
import { pathProgress, pathSummary, type StopView } from '../thesis/path';
import {
  FAILURE_PATH_MAX,
  isPriceTrigger,
  type FailurePathFields,
  type TriggerKind,
} from '../thesis/premortem';
import './styles/failure-table.css';

export interface TrialSeed {
  title: string;
  content: string;
  symbols: { symbol: string; name: string }[];
}

interface Props {
  seed: TrialSeed | null;
  onSeedUsed: () => void;
  onBack: () => void;
}

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function api<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  try {
    const response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
    if (response.status === 204) return { ok: true, data: undefined as T };
    const data = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (!response.ok)
      return { ok: false, error: data.error ?? 'Something went wrong. Try again.' };
    return { ok: true, data };
  } catch {
    return { ok: false, error: 'The shop could not be reached. Check your connection.' };
  }
}

const STATUS_LABEL: Record<ThesisDTO['status'], string> = {
  draft: 'Draft',
  failures_resolved: 'Failure Table signed off',
  evidence_reviewed: 'Evidence reviewed',
  sealed: 'Sealed',
  locked: 'Served',
};

const DECISION_LABEL: Record<FailurePathDTO['decision'], string> = {
  pending: 'Waiting for you',
  accepted: 'Accepted',
  modified: 'Modified',
  rejected: 'Rejected',
};

const pct = (value: number) =>
  `${Math.round(value * 1000) / 10}%`;
const dateLabel = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

function triggerText(path: Pick<FailurePathDTO, 'triggerKind' | 'triggerLevel' | 'triggerNote'>) {
  if (path.triggerKind === 'price_below' && path.triggerLevel !== null)
    return `Price at or below ${path.triggerLevel}. ${path.triggerNote}`;
  if (path.triggerKind === 'price_above' && path.triggerLevel !== null)
    return `Price at or above ${path.triggerLevel}. ${path.triggerNote}`;
  if (path.triggerKind === 'date') return `Date check. ${path.triggerNote}`;
  return `Manual check. ${path.triggerNote}`;
}

/** Only the fields the person actually changed. The server treats an unchanged modify as a mistake. */
function changedFields(
  path: FailurePathDTO,
  fields: FailurePathFields,
): Partial<FailurePathFields> {
  const edits: Partial<FailurePathFields> = {};
  if (fields.condition.trim() !== path.condition) edits.condition = fields.condition;
  if (Math.abs(fields.probability - path.probability) > 1e-9)
    edits.probability = fields.probability;
  if (fields.impactPct !== path.impactPct) edits.impactPct = fields.impactPct;
  if (fields.deadline !== path.deadline.slice(0, 10)) edits.deadline = fields.deadline;
  if (fields.triggerKind !== path.triggerKind) edits.triggerKind = fields.triggerKind;
  if (fields.triggerLevel !== path.triggerLevel) edits.triggerLevel = fields.triggerLevel;
  if (fields.triggerNote.trim() !== path.triggerNote) edits.triggerNote = fields.triggerNote;
  return edits;
}

export function FailureTable({ seed, onSeedUsed, onBack }: Props) {
  const [theses, setTheses] = useState<ThesisDTO[] | null>(null);
  const [alerts, setAlerts] = useState<WatchAlertDTO[]>([]);
  const [ledger, setLedger] = useState<CalibrationDTO | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(seed !== null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const result = await api<{ theses: ThesisDTO[] }>('GET', '/api/saved-theses');
    if (result.ok) setTheses(result.data.theses);
    else {
      setTheses([]);
      setError(result.error);
    }
    const watch = await api<{ alerts: WatchAlertDTO[] }>('GET', '/api/saved-theses/watch');
    if (watch.ok) setAlerts(watch.data.alerts);
    const cal = await api<CalibrationDTO>('GET', '/api/saved-theses/calibration');
    if (cal.ok) setLedger(cal.data);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const replace = (thesis: ThesisDTO) =>
    setTheses((list) =>
      list ? list.map((t) => (t.id === thesis.id ? thesis : t)) : [thesis],
    );

  const open = theses?.find((t) => t.id === openId) ?? null;

  return (
    <section className="ft" aria-label="Failure Table">
      <header className="ft-head">
        <button type="button" className="ft-link" onClick={open ? () => setOpenId(null) : onBack}>
          <span aria-hidden="true">←</span> {open ? 'My theses' : 'Back to the scrolls'}
        </button>
        <h2 className="ft-title">
          {open ? open.title : <>Failure <em>Table</em></>}
        </h2>
        {!open && (
          <p className="ft-lede">
            Before a thesis can go further, name how it fails. Every path needs a
            number, a date and something to watch.
          </p>
        )}
      </header>

      {error && (
        <p className="ft-error" role="alert">
          {error}
        </p>
      )}

      {!open && alerts.length > 0 && <AlertList alerts={alerts} onOpen={setOpenId} />}

      {open ? (
        <ThesisTable
          thesis={open}
          onChange={replace}
          onDeleted={() => {
            setTheses((list) => list?.filter((t) => t.id !== open.id) ?? null);
            setOpenId(null);
          }}
        />
      ) : creating ? (
        <NewThesisForm
          seed={seed}
          onCancel={() => {
            setCreating(false);
            onSeedUsed();
          }}
          onCreated={(thesis) => {
            setTheses((list) => [thesis, ...(list ?? [])]);
            setCreating(false);
            onSeedUsed();
            setOpenId(thesis.id);
          }}
        />
      ) : (
        <ThesisList
          theses={theses}
          onOpen={setOpenId}
          onNew={() => setCreating(true)}
          ledger={ledger}
        />
      )}
    </section>
  );
}

function AlertList({
  alerts,
  onOpen,
}: {
  alerts: WatchAlertDTO[];
  onOpen: (id: string) => void;
}) {
  return (
    <aside className="ft-alerts" aria-label="Failure paths that need attention">
      <h3 className="ft-sub">Needs your attention</h3>
      <ul>
        {alerts.slice(0, 5).map((alert) => (
          <li key={alert.pathId} data-state={alert.state}>
            <button type="button" onClick={() => onOpen(alert.thesisId)}>
              <strong>{alert.thesisTitle}</strong>
              <span>{alert.condition}</span>
              <em>
                {alert.message}
                {alert.priceAsOf && alert.price !== null
                  ? ` Bitget ${alert.price}, ${new Date(alert.priceAsOf).toLocaleString()}.`
                  : ''}
              </em>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function ThesisList({
  theses,
  onOpen,
  onNew,
  ledger,
}: {
  theses: ThesisDTO[] | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  ledger: CalibrationDTO | null;
}) {
  return (
    <div className="ft-list">
      <button type="button" className="ft-btn ft-btn--primary" onClick={onNew}>
        Put a thesis on trial
      </button>
      {theses === null ? (
        <p className="ft-note" role="status">
          Loading your theses…
        </p>
      ) : theses.length === 0 ? (
        <p className="ft-note">No theses yet. Start one and name how it fails.</p>
      ) : (
        <ul className="ft-theses">
          {theses.map((thesis) => (
            <li key={thesis.id}>
              <button type="button" onClick={() => onOpen(thesis.id)}>
                <span className="ft-thesis-name">{thesis.title}</span>
                <span className="ft-chip" data-status={thesis.status}>
                  {STATUS_LABEL[thesis.status]}
                </span>
                <span className="ft-thesis-meta">
                  {pathSummary(thesis.status)} · {thesis.premortem.total} path{thesis.premortem.total === 1 ? '' : 's'}
                  {thesis.premortem.pending > 0 &&
                    ` · ${thesis.premortem.pending} waiting`}
                  {thesis.symbol && ` · ${thesis.symbol}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {ledger && ledger.entries.length > 0 && <CalibrationLedger ledger={ledger} onOpen={onOpen} />}
    </div>
  );
}

function NewThesisForm({
  seed,
  onCancel,
  onCreated,
}: {
  seed: TrialSeed | null;
  onCancel: () => void;
  onCreated: (thesis: ThesisDTO) => void;
}) {
  const id = useId();
  const [title, setTitle] = useState(seed?.title ?? '');
  const [content, setContent] = useState(seed?.content ?? '');
  const [symbol, setSymbol] = useState(seed?.symbols[0]?.symbol ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    const result = await api<{ thesis: ThesisDTO }>('POST', '/api/saved-theses', {
      title,
      content,
      symbol: symbol.trim() || undefined,
    });
    setBusy(false);
    if (result.ok) onCreated(result.data.thesis);
    else setError(result.error);
  };

  return (
    <form className="ft-form" onSubmit={submit}>
      <label htmlFor={`${id}-title`}>Title</label>
      <input
        id={`${id}-title`}
        value={title}
        maxLength={120}
        onChange={(e) => setTitle(e.target.value)}
        required
      />
      <label htmlFor={`${id}-content`}>What do you believe, and why?</label>
      <textarea
        id={`${id}-content`}
        value={content}
        rows={5}
        maxLength={2000}
        onChange={(e) => setContent(e.target.value)}
        required
      />
      <label htmlFor={`${id}-symbol`}>Main stock (optional)</label>
      {seed && seed.symbols.length > 0 ? (
        <select
          id={`${id}-symbol`}
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
        >
          {seed.symbols.map((s) => (
            <option key={s.symbol} value={s.symbol}>
              {s.symbol} · {s.name}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={`${id}-symbol`}
          value={symbol}
          maxLength={10}
          placeholder="AAPL"
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
        />
      )}
      <p className="ft-note">
        A stock Bitget lists lets price triggers be watched for you. Without one,
        triggers are dates or manual checks.
      </p>
      {error && (
        <p className="ft-error" role="alert">
          {error}
        </p>
      )}
      <div className="ft-actions">
        <button type="submit" className="ft-btn ft-btn--primary" disabled={busy}>
          {busy ? 'Starting…' : 'Start the Failure Table'}
        </button>
        <button type="button" className="ft-btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function ThesisTable({
  thesis,
  onChange,
  onDeleted,
}: {
  thesis: ThesisDTO;
  onChange: (thesis: ThesisDTO) => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const editable = thesis.status === 'draft';
  const { premortem } = thesis;

  const run = async (
    label: string,
    task: () => Promise<ApiResult<{ thesis: ThesisDTO | null }>>,
  ) => {
    setBusy(label);
    setError('');
    const result = await task();
    setBusy('');
    if (result.ok && result.data.thesis) onChange(result.data.thesis);
    else if (!result.ok) setError(result.error);
  };

  const generate = () =>
    run('generate', () =>
      api('POST', `/api/saved-theses/${thesis.id}/failure-paths/generate`),
    );
  const signOff = () =>
    run('advance', () =>
      api('POST', `/api/saved-theses/${thesis.id}/advance`, { to: 'failures_resolved' }),
    );
  const remove = async () => {
    setBusy('delete');
    const result = await api('DELETE', `/api/saved-theses/${thesis.id}`);
    setBusy('');
    if (result.ok) onDeleted();
    else setError(result.error);
  };

  const path = pathProgress(thesis.status);
  const stopOf = (id: StopView['id']) => path.stops.find((x) => x.id === id)!;

  return (
    <div className="ft-table">
      <p className="ft-thesis-body" id={`ft-stop-${thesis.id}-thesis`}>{thesis.content}</p>
      <p className="ft-chip" data-status={thesis.status}>
        {STATUS_LABEL[thesis.status]}
      </p>
      <PathRail status={thesis.status} thesisId={thesis.id} />
      {thesis.symbol && !thesis.instrumentId && (
        <p className="ft-note">
          Bitget does not list {thesis.symbol} here, so price triggers are off. Use
          date or manual triggers.
        </p>
      )}

      {error && (
        <p className="ft-error" role="alert">
          {error}
        </p>
      )}

      <Stop thesisId={thesis.id} stop={stopOf('failures')} key={`failures-${stopOf('failures').state}`}>
      <ol className="ft-paths">
        {thesis.failurePaths.map((path) => (
          <PathCard
            key={path.id}
            path={path}
            thesis={thesis}
            editable={editable}
            busy={busy !== ''}
            onChange={onChange}
          />
        ))}
      </ol>

      {editable && (
        <div className="ft-actions">
          <button
            type="button"
            className="ft-btn ft-btn--primary"
            onClick={generate}
            disabled={busy !== '' || thesis.failurePaths.length >= FAILURE_PATH_MAX}
          >
            {busy === 'generate'
              ? 'Uncle is thinking…'
              : thesis.failurePaths.length === 0
                ? 'Ask Uncle for failure paths'
                : 'Ask Uncle for more'}
          </button>
          <button
            type="button"
            className="ft-btn"
            onClick={() => setAdding((v) => !v)}
            disabled={thesis.failurePaths.length >= FAILURE_PATH_MAX}
          >
            {adding ? 'Close' : 'Write my own'}
          </button>
        </div>
      )}

      {adding && editable && (
        <PathForm
          hasInstrument={thesis.instrumentId !== null}
          submitLabel="Add path"
          onCancel={() => setAdding(false)}
          onSubmit={async (fields) => {
            const result = await api<{ path: FailurePathDTO }>(
              'POST',
              `/api/saved-theses/${thesis.id}/failure-paths`,
              fields,
            );
            if (!result.ok) return result.error;
            const fresh = await api<{ thesis: ThesisDTO }>('GET', `/api/saved-theses/${thesis.id}`);
            if (fresh.ok) onChange(fresh.data.thesis);
            setAdding(false);
            return null;
          }}
        />
      )}

      <div className="ft-gate" data-complete={premortem.complete}>
        {thesis.status === 'draft' ? (
          premortem.complete ? (
            <p>Every path is decided. You can sign off the Failure Table.</p>
          ) : (
            <>
              <p>Not ready to sign off:</p>
              <ul>
                {premortem.blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </>
          )
        ) : (
          <p>Failure Table signed off.</p>
        )}
        {thesis.status === 'draft' && (
          <button
            type="button"
            className="ft-btn ft-btn--seal"
            disabled={!premortem.complete || busy !== ''}
            onClick={signOff}
          >
            {busy === 'advance' ? 'Signing off…' : 'Sign off the Failure Table'}
          </button>
        )}
      </div>
      </Stop>

      {stopOf('evidence').state !== 'ahead' && (
        <Stop thesisId={thesis.id} stop={stopOf('evidence')} key={`evidence-${stopOf('evidence').state}`}>
          <EvidenceShelf thesis={thesis} onChange={onChange} />
        </Stop>
      )}

      {stopOf('seal').state !== 'ahead' && (
        <Stop thesisId={thesis.id} stop={stopOf('seal')} key={`seal-${stopOf('seal').state}`}>
          <SealPanel thesis={thesis} onChange={onChange} />
        </Stop>
      )}

      {stopOf('balance').state !== 'ahead' && (
        <Stop thesisId={thesis.id} stop={stopOf('balance')} key={`balance-${stopOf('balance').state}`}>
          <BalancePanel thesis={thesis} onChange={onChange} />
        </Stop>
      )}

      {path.served && (
        <p className="ft-served" role="status">
          Served. Every stop is done and this thesis is on the record.
        </p>
      )}

      {(thesis.status === 'draft' ||
        thesis.status === 'failures_resolved' ||
        thesis.status === 'evidence_reviewed') && (
        <button type="button" className="ft-link ft-link--danger" onClick={remove} disabled={busy !== ''}>
          Delete this thesis
        </button>
      )}
    </div>
  );
}

function PathCard({
  path,
  thesis,
  editable,
  busy,
  onChange,
}: {
  path: FailurePathDTO;
  thesis: ThesisDTO;
  editable: boolean;
  busy: boolean;
  onChange: (thesis: ThesisDTO) => void;
}) {
  const [mode, setMode] = useState<'view' | 'modify' | 'reject'>('view');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const reasonId = useId();
  const url = `/api/saved-theses/${thesis.id}/failure-paths/${path.id}`;

  const decide = async (body: unknown): Promise<string | null> => {
    setWorking(true);
    setError('');
    const result = await api<{ thesis: ThesisDTO | null }>('PATCH', url, body);
    setWorking(false);
    if (!result.ok) {
      setError(result.error);
      return result.error;
    }
    if (result.data.thesis) onChange(result.data.thesis);
    setMode('view');
    return null;
  };

  const removeOwn = async () => {
    setWorking(true);
    const result = await api<{ thesis: ThesisDTO | null }>('DELETE', url);
    setWorking(false);
    if (result.ok && result.data.thesis) onChange(result.data.thesis);
    else if (!result.ok) setError(result.error);
  };

  return (
    <li className="ft-path" data-decision={path.decision}>
      <div className="ft-path-top">
        <span className="ft-chip" data-decision={path.decision}>
          {DECISION_LABEL[path.decision]}
          {path.modified && path.decision === 'modified' ? ' by you' : ''}
        </span>
        <span className="ft-source">{path.source === 'uncle' ? 'Uncle' : 'You'}</span>
      </div>
      <p className="ft-condition">{path.condition}</p>
      <dl className="ft-facts">
        <div>
          <dt>Chance</dt>
          <dd>{pct(path.probability)}</dd>
        </div>
        <div>
          <dt>Loss if it happens</dt>
          <dd>{path.impactPct}% of portfolio</dd>
        </div>
        <div>
          <dt>By</dt>
          <dd>{dateLabel(path.deadline)}</dd>
        </div>
        <div className="ft-fact-wide">
          <dt>Watch</dt>
          <dd>{triggerText(path)}</dd>
        </div>
      </dl>
      {path.decision === 'rejected' && path.decisionReason && (
        <p className="ft-reason">Why rejected: {path.decisionReason}</p>
      )}

      {error && (
        <p className="ft-error" role="alert">
          {error}
        </p>
      )}

      {editable && mode === 'view' && (
        <div className="ft-actions ft-actions--tight">
          <button
            type="button"
            className="ft-btn"
            disabled={busy || working || path.decision === 'accepted'}
            onClick={() => void decide({ action: 'accept' })}
          >
            Accept
          </button>
          <button
            type="button"
            className="ft-btn"
            disabled={busy || working}
            onClick={() => setMode('modify')}
          >
            Modify
          </button>
          <button
            type="button"
            className="ft-btn"
            disabled={busy || working || path.decision === 'rejected'}
            onClick={() => setMode('reject')}
          >
            Reject
          </button>
          {path.source === 'user' && (
            <button type="button" className="ft-link ft-link--danger" disabled={busy || working} onClick={removeOwn}>
              Remove
            </button>
          )}
        </div>
      )}

      {mode === 'modify' && (
        <PathForm
          initial={path}
          hasInstrument={thesis.instrumentId !== null}
          submitLabel="Save changes"
          onCancel={() => setMode('view')}
          onSubmit={async (fields) => {
            const edits = changedFields(path, fields);
            if (Object.keys(edits).length === 0)
              return 'Change at least one field, or accept the path as written.';
            return decide({ action: 'modify', edits });
          }}
        />
      )}

      {mode === 'reject' && (
        <form
          className="ft-form"
          onSubmit={(e) => {
            e.preventDefault();
            void decide({ action: 'reject', reason });
          }}
        >
          <label htmlFor={reasonId}>Why does this path not apply?</label>
          <textarea
            id={reasonId}
            value={reason}
            rows={2}
            maxLength={300}
            onChange={(e) => setReason(e.target.value)}
            required
          />
          <div className="ft-actions ft-actions--tight">
            <button type="submit" className="ft-btn ft-btn--primary" disabled={working}>
              Reject path
            </button>
            <button type="button" className="ft-btn" onClick={() => setMode('view')}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </li>
  );
}

function PathForm({
  initial,
  hasInstrument,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: FailurePathDTO;
  hasInstrument: boolean;
  submitLabel: string;
  /** Resolves to an error message, or null on success. */
  onSubmit: (fields: FailurePathFields) => Promise<string | null>;
  onCancel: () => void;
}) {
  const id = useId();
  const [condition, setCondition] = useState(initial?.condition ?? '');
  const [probability, setProbability] = useState(
    initial ? String(Math.round(initial.probability * 1000) / 10) : '',
  );
  const [impact, setImpact] = useState(initial ? String(initial.impactPct) : '');
  const [deadline, setDeadline] = useState(initial?.deadline.slice(0, 10) ?? '');
  const [kind, setKind] = useState<TriggerKind>(
    initial?.triggerKind ?? (hasInstrument ? 'price_below' : 'date'),
  );
  const [level, setLevel] = useState(
    initial?.triggerLevel != null ? String(initial.triggerLevel) : '',
  );
  const [note, setNote] = useState(initial?.triggerNote ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    const fields: FailurePathFields = {
      condition,
      probability: Number(probability) / 100,
      impactPct: Number(impact),
      deadline,
      triggerKind: kind,
      triggerLevel: isPriceTrigger(kind) ? Number(level) : null,
      triggerNote: note,
    };
    const failure = await onSubmit(fields);
    setBusy(false);
    if (failure) setError(failure);
  };

  return (
    <form className="ft-form ft-form--path" onSubmit={submit}>
      <label htmlFor={`${id}-c`}>How the thesis fails (with a number and a date)</label>
      <textarea id={`${id}-c`} rows={3} value={condition} maxLength={400} onChange={(e) => setCondition(e.target.value)} required />
      <div className="ft-row">
        <div>
          <label htmlFor={`${id}-p`}>Chance, %</label>
          <input id={`${id}-p`} type="number" inputMode="decimal" min="1" max="99" step="any" value={probability} onChange={(e) => setProbability(e.target.value)} required />
        </div>
        <div>
          <label htmlFor={`${id}-i`}>Loss, % of portfolio</label>
          <input id={`${id}-i`} type="number" inputMode="decimal" min="0.1" max="100" step="any" value={impact} onChange={(e) => setImpact(e.target.value)} required />
        </div>
        <div>
          <label htmlFor={`${id}-d`}>Happens by</label>
          <input id={`${id}-d`} type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} required />
        </div>
      </div>
      <div className="ft-row">
        <div>
          <label htmlFor={`${id}-k`}>Watch with</label>
          <select id={`${id}-k`} value={kind} onChange={(e) => setKind(e.target.value as TriggerKind)}>
            {hasInstrument && <option value="price_below">Price at or below</option>}
            {hasInstrument && <option value="price_above">Price at or above</option>}
            <option value="date">Date</option>
            <option value="manual">Manual check</option>
          </select>
        </div>
        {isPriceTrigger(kind) && (
          <div>
            <label htmlFor={`${id}-l`}>Price level</label>
            <input id={`${id}-l`} type="number" inputMode="decimal" min="0" step="any" value={level} onChange={(e) => setLevel(e.target.value)} required />
          </div>
        )}
      </div>
      <label htmlFor={`${id}-n`}>What you will watch</label>
      <input id={`${id}-n`} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} required />
      {error && (
        <p className="ft-error" role="alert">
          {error}
        </p>
      )}
      <div className="ft-actions ft-actions--tight">
        <button type="submit" className="ft-btn ft-btn--primary" disabled={busy}>
          {busy ? 'Saving…' : submitLabel}
        </button>
        <button type="button" className="ft-btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

const CLAIM_STATE_LABEL: Record<ClaimDTO['state'], string> = {
  observed: 'Observed fact',
  inferred: 'Model inference',
  insufficient: 'Withheld: insufficient evidence',
};

const SOURCE_KIND_LABEL: Record<(typeof USER_SOURCE_KINDS)[number], string> = {
  sec_filing: 'SEC filing',
  company_release: 'Company release',
  central_bank: 'Central bank statement',
  bitget_market: 'Bitget market data',
};

const stamp = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString() : 'not stated by the source';

function EvidenceShelf({
  thesis,
  onChange,
}: {
  thesis: ThesisDTO;
  onChange: (thesis: ThesisDTO) => void;
}) {
  const editable = thesis.status === 'failures_resolved';
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const base = `/api/saved-theses/${thesis.id}`;

  const run = async (
    label: string,
    task: () => Promise<ApiResult<{ thesis: ThesisDTO | null }>>,
  ) => {
    setBusy(label);
    setError('');
    const result = await task();
    setBusy('');
    if (result.ok && result.data.thesis) onChange(result.data.thesis);
    else if (!result.ok) setError(result.error);
  };

  return (
    <section className="ft-shelf" aria-label="Evidence Shelf">
      <h3 className="ft-sub">Evidence Shelf</h3>
      <p className="ft-note">
        Every figure is bound to where it came from. Green is an observed fact,
        amber is arithmetic or an unverified source, and red is withheld because
        the evidence is not there. Open a claim to see its source and time.
      </p>
      {error && (
        <p className="ft-error" role="alert">
          {error}
        </p>
      )}

      {thesis.claims.length === 0 ? (
        <p className="ft-note">No evidence bound yet.</p>
      ) : (
        <ul className="ft-claims">
          {thesis.claims.map((claim) => (
            <ClaimRow
              key={claim.id}
              claim={claim}
              editable={editable}
              busy={busy !== ''}
              onAcknowledge={() =>
                run('ack', () => api('PATCH', `${base}/evidence/${claim.id}`, { acknowledge: true }))
              }
              onRemove={() => run('remove', () => api('DELETE', `${base}/evidence/${claim.id}`))}
            />
          ))}
        </ul>
      )}

      {editable && (
        <div className="ft-actions">
          <button
            type="button"
            className="ft-btn ft-btn--primary"
            disabled={busy !== ''}
            onClick={() => run('refresh', () => api('POST', `${base}/evidence/refresh`))}
          >
            {busy === 'refresh' ? 'Fetching from Bitget…' : 'Refresh Bitget evidence'}
          </button>
          <button type="button" className="ft-btn" onClick={() => setAdding((v) => !v)}>
            {adding ? 'Close' : 'Add a source'}
          </button>
        </div>
      )}

      {adding && editable && (
        <SourceForm
          onCancel={() => setAdding(false)}
          onSubmit={async (body) => {
            const result = await api<{ thesis: ThesisDTO | null }>('POST', `${base}/evidence`, body);
            if (!result.ok) return result.error;
            if (result.data.thesis) onChange(result.data.thesis);
            setAdding(false);
            return null;
          }}
        />
      )}

      <div className="ft-gate" data-complete={thesis.evidence.complete}>
        {thesis.status === 'evidence_reviewed' ? (
          <p>Evidence Shelf signed off. Next: the Probability Seal.</p>
        ) : thesis.evidence.complete ? (
          <p>The evidence is bound and fresh. You can sign off the Evidence Shelf.</p>
        ) : (
          <>
            <p>Not ready to sign off:</p>
            <ul>
              {thesis.evidence.blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </>
        )}
        {editable && (
          <button
            type="button"
            className="ft-btn ft-btn--seal"
            disabled={!thesis.evidence.complete || busy !== ''}
            onClick={() =>
              run('advance', () => api('POST', `${base}/advance`, { to: 'evidence_reviewed' }))
            }
          >
            {busy === 'advance' ? 'Signing off…' : 'Sign off the Evidence Shelf'}
          </button>
        )}
      </div>
    </section>
  );
}

function ClaimRow({
  claim,
  editable,
  busy,
  onAcknowledge,
  onRemove,
}: {
  claim: ClaimDTO;
  editable: boolean;
  busy: boolean;
  onAcknowledge: () => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const detailId = useId();
  return (
    <li className="ft-claim" data-state={claim.state}>
      <button
        type="button"
        className="ft-claim-head"
        aria-expanded={open}
        aria-controls={detailId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="ft-claim-label">{claim.label}</span>
        <span className="ft-claim-value">
          {claim.valueText ?? 'Withheld'}
        </span>
        <span className="ft-chip" data-claim={claim.state}>
          {CLAIM_STATE_LABEL[claim.state]}
          {claim.state === 'inferred' && claim.acknowledged ? ' · acknowledged' : ''}
          {claim.verifiedAt ? ' · found on the page' : ''}
        </span>
        {claim.marketClosed && (
          <span className="ft-chip" data-claim="closed">
            US market closed
          </span>
        )}
      </button>
      {open && (
        <dl id={detailId} className="ft-claim-detail">
          <div>
            <dt>Source</dt>
            <dd>
              {SOURCE_KIND_LABEL[claim.sourceKind]}: {claim.sourceLabel}
              {claim.sourceUrl && (
                <>
                  {' '}
                  <a href={claim.sourceUrl} target="_blank" rel="noopener noreferrer">
                    Open source<span className="sr-only"> (opens in a new tab)</span>
                  </a>
                </>
              )}
            </dd>
          </div>
          <div>
            <dt>As of</dt>
            <dd>{stamp(claim.observedAt)}</dd>
          </div>
          <div>
            <dt>Fetched</dt>
            <dd>{stamp(claim.fetchedAt)}</dd>
          </div>
          {claim.verifiedAt && (
            <div className="ft-fact-wide">
              <dt>Checked on the page</dt>
              <dd>
                The app read the page on {stamp(claim.verifiedAt)} and found this figure.
                {claim.excerpt && <q className="ft-excerpt">{claim.excerpt}</q>}
              </dd>
            </div>
          )}
          {claim.note && (
            <div className="ft-fact-wide">
              <dt>Note</dt>
              <dd>{claim.note}</dd>
            </div>
          )}
        </dl>
      )}
      {editable && (
        <div className="ft-actions ft-actions--tight">
          {claim.state === 'inferred' && !claim.acknowledged && (
            <button type="button" className="ft-btn" disabled={busy} onClick={onAcknowledge}>
              I understand this is an inference
            </button>
          )}
          {claim.origin === 'user' && (
            <button type="button" className="ft-link ft-link--danger" disabled={busy} onClick={onRemove}>
              Remove
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function SourceForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (body: Record<string, string>) => Promise<string | null>;
  onCancel: () => void;
}) {
  const id = useId();
  const [label, setLabel] = useState('');
  const [valueText, setValueText] = useState('');
  const [sourceKind, setSourceKind] = useState<string>('sec_filing');
  const [sourceUrl, setSourceUrl] = useState('');
  const [observedAt, setObservedAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    const failure = await onSubmit({ label, valueText, sourceKind, sourceUrl, observedAt });
    setBusy(false);
    if (failure) setError(failure);
  };

  return (
    <form className="ft-form ft-form--path" onSubmit={submit}>
      <label htmlFor={`${id}-l`}>What the source says (the claim)</label>
      <input id={`${id}-l`} value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} required />
      <label htmlFor={`${id}-v`}>The figure or fact</label>
      <input id={`${id}-v`} value={valueText} maxLength={200} onChange={(e) => setValueText(e.target.value)} required />
      <div className="ft-row">
        <div>
          <label htmlFor={`${id}-k`}>Source type</label>
          <select id={`${id}-k`} value={sourceKind} onChange={(e) => setSourceKind(e.target.value)}>
            {USER_SOURCE_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {SOURCE_KIND_LABEL[kind]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-d`}>Published on</label>
          <input id={`${id}-d`} type="date" value={observedAt} onChange={(e) => setObservedAt(e.target.value)} required />
        </div>
      </div>
      <label htmlFor={`${id}-u`}>Link to the source</label>
      <input id={`${id}-u`} type="url" value={sourceUrl} placeholder="https://www.sec.gov/…" onChange={(e) => setSourceUrl(e.target.value)} required />
      <p className="ft-note">
        SEC filings and central bank statements must link to their own site. The
        app reads the page and the figure must be on it, near those words. A
        PDF or an unreadable page stays amber. A company page stays amber.
      </p>
      {error && (
        <p className="ft-error" role="alert">
          {error}
        </p>
      )}
      <div className="ft-actions ft-actions--tight">
        <button type="submit" className="ft-btn ft-btn--primary" disabled={busy}>
          {busy ? 'Saving…' : 'Bind this source'}
        </button>
        <button type="button" className="ft-btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

const pct0 = (p: number) => `${Math.round(p * 100)}%`;
const brierText = (value: number | null) => (value === null ? 'not yet' : value.toFixed(3));
const day = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

function statement(direction: 'up' | 'down', horizonDays: number, resolvesAt?: string, reference?: number) {
  const word = direction === 'up' ? 'above' : 'below';
  const when = resolvesAt ? `on ${day(new Date(new Date(resolvesAt).getTime() - 1).toISOString())}` : `${horizonDays} days from sealing`;
  const price = reference !== undefined ? String(reference) : 'the price at the moment you seal';
  return `The Bitget daily close ${when} will be ${word} ${price}.`;
}

function SealPanel({
  thesis,
  onChange,
}: {
  thesis: ThesisDTO;
  onChange: (thesis: ThesisDTO) => void;
}) {
  const id = useId();
  const [direction, setDirection] = useState<'up' | 'down'>('up');
  const [probability, setProbability] = useState('60');
  const [horizon, setHorizon] = useState('14');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (thesis.seal) return <SealRecord seal={thesis.seal} />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    const result = await api<{ thesis: ThesisDTO }>('POST', `/api/saved-theses/${thesis.id}/seal`, {
      direction,
      probability: Number(probability) / 100,
      horizonDays: Number(horizon),
    });
    setBusy(false);
    if (result.ok) onChange(result.data.thesis);
    else setError(result.error);
  };

  return (
    <section className="ft-shelf" aria-label="Probability Seal">
      <h3 className="ft-sub">Probability Seal</h3>
      <p className="ft-note">
        Commit to one statement about price and say how likely it is. Uncle gives
        his own probability for the same statement without seeing yours. Both are
        sealed together and scored when the day arrives.
      </p>
      <form className="ft-form" onSubmit={submit}>
        <fieldset className="ft-fieldset">
          <legend>Your direction</legend>
          <label className="ft-radio">
            <input type="radio" name={`${id}-d`} checked={direction === 'up'} onChange={() => setDirection('up')} /> Up
          </label>
          <label className="ft-radio">
            <input type="radio" name={`${id}-d`} checked={direction === 'down'} onChange={() => setDirection('down')} /> Down
          </label>
        </fieldset>
        <div className="ft-row">
          <div>
            <label htmlFor={`${id}-p`}>Chance you are right, %</label>
            <input id={`${id}-p`} type="number" inputMode="decimal" min="1" max="99" step="any" value={probability} onChange={(e) => setProbability(e.target.value)} required />
          </div>
          <div>
            <label htmlFor={`${id}-h`}>Horizon, days (1 to 90)</label>
            <input id={`${id}-h`} type="number" inputMode="numeric" min="1" max="90" step="1" value={horizon} onChange={(e) => setHorizon(e.target.value)} required />
          </div>
        </div>
        <p className="ft-statement">{statement(direction, Number(horizon) || 0)}</p>
        {!thesis.instrumentId && (
          <p className="ft-error" role="alert">
            Bitget does not list this stock, so the seal could not be judged later. It cannot be sealed.
          </p>
        )}
        <label className="ft-check">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} /> I understand a seal cannot be changed or deleted.
        </label>
        {error && (
          <p className="ft-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="ft-btn ft-btn--seal" disabled={busy || !agreed || !thesis.instrumentId}>
          {busy ? 'Uncle is forecasting…' : 'Seal it'}
        </button>
      </form>
    </section>
  );
}

function SealRecord({ seal }: { seal: SealDTO }) {
  return (
    <section className="ft-shelf" aria-label="Sealed forecast">
      <h3 className="ft-sub">Sealed {day(seal.sealedAt)}</h3>
      <p className="ft-statement">{statement(seal.direction, seal.horizonDays, seal.resolvesAt, seal.referencePrice)}</p>
      <div className="ft-seal-pair">
        <div className="ft-seal-main">
          <span className="ft-seal-name">Uncle</span>
          <strong>{pct0(seal.systemProbability)}</strong>
          <span className="ft-seal-sub">{seal.systemMethod === 'uncle' ? 'his forecast' : 'historical base rate'}</span>
        </div>
        <div className="ft-seal-side">
          <span className="ft-seal-name">You</span>
          <strong>{pct0(seal.userProbability)}</strong>
        </div>
      </div>
      {seal.systemMethod === 'base_rate' && (
        <p className="ft-note">Uncle was unavailable when you sealed, so his number is the share of past windows of this length that moved this way.</p>
      )}
      {seal.systemRationale && <p className="ft-note">{seal.systemRationale}</p>}
      {seal.baseRate !== null && seal.systemMethod === 'uncle' && (
        <p className="ft-note">Past windows of this length moved this way {pct0(seal.baseRate)} of the time.</p>
      )}
      {seal.status === 'open' && <p className="ft-note">Judged after {day(new Date(new Date(seal.resolvesAt).getTime() - 1).toISOString())}. Open this page then to see the scores.</p>}
      {seal.status === 'unresolvable' && <p className="ft-error">Bitget no longer returns the resolving day, so this seal could not be judged.</p>}
      {seal.status === 'resolved' && (
        <div className="ft-gate" data-complete={seal.outcome === true}>
          <p>
            {seal.outcome ? 'The statement came true' : 'The statement did not come true'}: the Bitget close was {seal.resolvedPrice}.
          </p>
          <p>
            Brier score, lower is better (0.25 is a coin flip): you {brierText(seal.userBrier)}, Uncle {brierText(seal.systemBrier)}.
          </p>
        </div>
      )}
    </section>
  );
}

function CalibrationLedger({
  ledger,
  onOpen,
}: {
  ledger: CalibrationDTO;
  onOpen: (id: string) => void;
}) {
  const c = ledger.calibration;
  return (
    <section className="ft-shelf" aria-label="Calibration ledger">
      <h3 className="ft-sub">Calibration ledger</h3>
      {c.resolved === 0 ? (
        <p className="ft-note">No seal has been judged yet. Scores appear after a horizon ends.</p>
      ) : (
        <>
          <dl className="ft-facts">
            <div>
              <dt>Judged</dt>
              <dd>{c.resolved}</dd>
            </div>
            <div>
              <dt>Your Brier</dt>
              <dd>{brierText(c.userMeanBrier)}</dd>
            </div>
            <div>
              <dt>Uncle's Brier</dt>
              <dd>{brierText(c.systemMeanBrier)}</dd>
            </div>
            <div className="ft-fact-wide">
              <dt>Reading it</dt>
              <dd>
                Lower is better, and {COIN_FLIP_BRIER} is what always saying 50% scores.
                {c.better === 'you' && ' You are ahead of Uncle so far.'}
                {c.better === 'uncle' && ' Uncle is ahead of you so far.'}
                {c.hitRate !== null && c.userMeanProbability !== null &&
                  ` You were right ${pct0(c.hitRate)} of the time and averaged ${pct0(c.userMeanProbability)} confidence.`}
                {c.resolved < 10 && ' With so few seals this says little yet.'}
              </dd>
            </div>
          </dl>
        </>
      )}
      <ul className="ft-theses">
        {ledger.entries.map((entry) => (
          <li key={entry.thesisId}>
            <button type="button" onClick={() => onOpen(entry.thesisId)}>
              <span className="ft-thesis-name">{entry.title}</span>
              <span className="ft-thesis-meta">
                {entry.direction === 'up' ? 'Up' : 'Down'} in {entry.horizonDays} days · you {pct0(entry.userProbability)} · Uncle {pct0(entry.systemProbability)}
                {entry.status === 'resolved' && ` · ${entry.outcome ? 'came true' : 'did not come true'}`}
                {entry.status === 'open' && ' · open'}
                {entry.status === 'unresolvable' && ' · could not be judged'}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

const LEVEL_LABEL: Record<RiskReportDTO['metrics'][number]['level'], string> = {
  ok: 'Within limits',
  warn: 'Warning',
  block: 'Hard limit breached',
  unmeasured: 'Not measured',
};

function MetricList({ metrics }: { metrics: RiskReportDTO['metrics'] }) {
  return (
    <ul className="ft-metrics">
      {metrics.map((m) => (
        <li key={m.key} data-level={m.level}>
          <span className="ft-metric-head">
            <strong>{m.label}</strong>
            <span className="ft-chip" data-risk={m.level}>
              {LEVEL_LABEL[m.level]}
            </span>
          </span>
          <span className="ft-metric-text">{m.message}</span>
        </li>
      ))}
    </ul>
  );
}

function BalancePanel({
  thesis,
  onChange,
}: {
  thesis: ThesisDTO;
  onChange: (thesis: ThesisDTO) => void;
}) {
  if (thesis.lock) return <LockRecord lock={thesis.lock} />;
  return <BalanceForm thesis={thesis} onChange={onChange} />;
}

interface HoldingRow {
  symbol: string;
  value: string;
}

function BalanceForm({
  thesis,
  onChange,
}: {
  thesis: ThesisDTO;
  onChange: (thesis: ThesisDTO) => void;
}) {
  const id = useId();
  const [total, setTotal] = useState('');
  const [collateral, setCollateral] = useState('');
  const [marginUsed, setMarginUsed] = useState('');
  const [rows, setRows] = useState<HoldingRow[]>([]);
  const [saved, setSaved] = useState(false);
  const [planned, setPlanned] = useState('');
  const [leverage, setLeverage] = useState('1');
  const [report, setReport] = useState<RiskReportDTO | null>(null);
  const [acks, setAcks] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    void (async () => {
      const result = await api<{ portfolio: PortfolioDTO | null }>('GET', '/api/portfolio');
      if (!result.ok || !result.data.portfolio) return;
      const p = result.data.portfolio;
      setTotal(String(p.totalUsd));
      setCollateral(p.collateralUsd === null ? '' : String(p.collateralUsd));
      setMarginUsed(p.marginUsedUsd === null ? '' : String(p.marginUsedUsd));
      setRows(p.holdings.map((h) => ({ symbol: h.symbol, value: String(h.valueUsd) })));
      setSaved(true);
    })();
  }, []);

  const touch = () => {
    setReport(null);
    setAcks([]);
  };

  const savePortfolio = async () => {
    setBusy('portfolio');
    setError('');
    const result = await api('PUT', '/api/portfolio', {
      totalUsd: Number(total),
      collateralUsd: collateral === '' ? null : Number(collateral),
      marginUsedUsd: marginUsed === '' ? null : Number(marginUsed),
      holdings: rows
        .filter((r) => r.symbol.trim() !== '' || r.value !== '')
        .map((r) => ({ symbol: r.symbol, valueUsd: Number(r.value) })),
    });
    setBusy('');
    if (result.ok) {
      setSaved(true);
      touch();
    } else setError(result.error);
  };

  const position = { plannedUsd: Number(planned), leverage: Number(leverage) };
  const base = `/api/saved-theses/${thesis.id}`;

  const measure = async () => {
    setBusy('risk');
    setError('');
    const result = await api<{ report: RiskReportDTO }>('POST', `${base}/risk`, position);
    setBusy('');
    if (result.ok) {
      setReport(result.data.report);
      setAcks([]);
    } else setError(result.error);
  };

  const serve = async () => {
    setBusy('lock');
    setError('');
    try {
      const response = await fetch(`${base}/lock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...position, acknowledged: acks, overrideReason: reason }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        thesis?: ThesisDTO;
        error?: string;
        report?: RiskReportDTO;
      };
      if (response.ok && data.thesis) onChange(data.thesis);
      else {
        setError(data.error ?? 'The thesis could not be served.');
        // The server measured again: show what it saw.
        if (data.report) setReport(data.report);
      }
    } catch {
      setError('The shop could not be reached. Check your connection.');
    }
    setBusy('');
  };

  const needsAck = report?.needsAck ?? [];
  const ready =
    report !== null &&
    needsAck.every((k) => acks.includes(k)) &&
    (!report.hasBlock || reason.trim().length >= 20);

  return (
    <section className="ft-shelf" aria-label="Balance Scale">
      <h3 className="ft-sub">Balance Scale</h3>
      <p className="ft-note">
        The last gate. Type in what you hold and how big this position is, and read
        the risk before the thesis is served. Nothing here is read from an
        exchange: it is only as true as what you enter.
      </p>

      <fieldset className="ft-fieldset ft-fieldset--col">
        <legend>Your portfolio</legend>
        <div className="ft-row">
          <div>
            <label htmlFor={`${id}-t`}>Total value, USD</label>
            <input id={`${id}-t`} type="number" inputMode="decimal" min="0" step="any" value={total} onChange={(e) => { setTotal(e.target.value); setSaved(false); touch(); }} />
          </div>
          <div>
            <label htmlFor={`${id}-c`}>Collateral, USD (optional)</label>
            <input id={`${id}-c`} type="number" inputMode="decimal" min="0" step="any" value={collateral} onChange={(e) => { setCollateral(e.target.value); setSaved(false); touch(); }} />
          </div>
          <div>
            <label htmlFor={`${id}-m`}>Margin used, USD (optional)</label>
            <input id={`${id}-m`} type="number" inputMode="decimal" min="0" step="any" value={marginUsed} onChange={(e) => { setMarginUsed(e.target.value); setSaved(false); touch(); }} />
          </div>
        </div>
        {rows.map((row, index) => (
          <div className="ft-row ft-row--holding" key={index}>
            <div>
              <label htmlFor={`${id}-s${index}`}>Holding symbol</label>
              <input id={`${id}-s${index}`} value={row.symbol} maxLength={10} placeholder="NVDA" onChange={(e) => { setRows(rows.map((r, i) => (i === index ? { ...r, symbol: e.target.value.toUpperCase() } : r))); setSaved(false); touch(); }} />
            </div>
            <div>
              <label htmlFor={`${id}-v${index}`}>Value, USD</label>
              <input id={`${id}-v${index}`} type="number" inputMode="decimal" min="0" step="any" value={row.value} onChange={(e) => { setRows(rows.map((r, i) => (i === index ? { ...r, value: e.target.value } : r))); setSaved(false); touch(); }} />
            </div>
            <button type="button" className="ft-link ft-link--danger" onClick={() => { setRows(rows.filter((_, i) => i !== index)); setSaved(false); touch(); }}>
              Remove
            </button>
          </div>
        ))}
        <div className="ft-actions ft-actions--tight">
          <button type="button" className="ft-btn" disabled={rows.length >= 20} onClick={() => { setRows([...rows, { symbol: '', value: '' }]); setSaved(false); }}>
            Add a holding
          </button>
          <button type="button" className="ft-btn ft-btn--primary" disabled={busy !== '' || total === ''} onClick={savePortfolio}>
            {busy === 'portfolio' ? 'Saving…' : saved ? 'Saved' : 'Save portfolio'}
          </button>
        </div>
      </fieldset>

      <div className="ft-row">
        <div>
          <label htmlFor={`${id}-p`}>This position, USD</label>
          <input id={`${id}-p`} type="number" inputMode="decimal" min="0" step="any" value={planned} onChange={(e) => { setPlanned(e.target.value); touch(); }} />
        </div>
        <div>
          <label htmlFor={`${id}-l`}>Leverage (1 to 20)</label>
          <input id={`${id}-l`} type="number" inputMode="decimal" min="1" max="20" step="any" value={leverage} onChange={(e) => { setLeverage(e.target.value); touch(); }} />
        </div>
      </div>
      <button type="button" className="ft-btn ft-btn--primary" disabled={busy !== '' || !saved || planned === ''} onClick={measure}>
        {busy === 'risk' ? 'Measuring…' : 'Read the Balance Scale'}
      </button>
      {!saved && <p className="ft-note">Save your portfolio first.</p>}

      {error && (
        <p className="ft-error" role="alert">
          {error}
        </p>
      )}

      {report && (
        <>
          <MetricList metrics={report.metrics} />
          <p className="ft-note">Measured {new Date(report.measuredAt).toLocaleString()} from Bitget daily candles and the portfolio you typed.</p>
          {needsAck.length > 0 && (
            <fieldset className="ft-fieldset ft-fieldset--col">
              <legend>Acknowledge the risk</legend>
              {report.metrics
                .filter((m) => needsAck.includes(m.key))
                .map((m) => (
                  <label className="ft-check" key={m.key}>
                    <input type="checkbox" checked={acks.includes(m.key)} onChange={(e) => setAcks(e.target.checked ? [...acks, m.key] : acks.filter((k) => k !== m.key))} />
                    I accept the {m.label.toLowerCase()} risk above.
                  </label>
                ))}
              {report.hasBlock && (
                <>
                  <label htmlFor={`${id}-r`}>A hard limit is breached. Why go ahead anyway? (20 characters or more, kept with the thesis)</label>
                  <textarea id={`${id}-r`} rows={3} maxLength={400} value={reason} onChange={(e) => setReason(e.target.value)} />
                </>
              )}
            </fieldset>
          )}
          <button type="button" className="ft-btn ft-btn--seal" disabled={!ready || busy !== ''} onClick={serve}>
            {busy === 'lock' ? 'Serving…' : report.hasBlock ? 'Override and serve' : 'Serve the thesis'}
          </button>
        </>
      )}
    </section>
  );
}

function LockRecord({ lock }: { lock: LockDTO }) {
  return (
    <section className="ft-shelf" aria-label="Served thesis">
      <h3 className="ft-sub">Served {new Date(lock.lockedAt).toLocaleDateString()}</h3>
      <p className="ft-note">
        Position ${lock.plannedUsd.toLocaleString()} at {lock.leverage}x.{' '}
        {lock.verdict === 'clear' && 'Every limit was within range.'}
        {lock.verdict === 'warn' && 'You acknowledged the warnings below.'}
        {lock.verdict === 'override' && 'You went past a hard limit.'}
      </p>
      <MetricList metrics={lock.metrics} />
      {lock.overrideReason && (
        <p className="ft-reason">Your reason for the override: {lock.overrideReason}</p>
      )}
    </section>
  );
}

function PathRail({ status, thesisId }: { status: Parameters<typeof pathProgress>[0]; thesisId: string }) {
  const view = pathProgress(status);
  const go = (id: string) => {
    const el = document.getElementById(`ft-stop-${thesisId}-${id}`);
    if (!el) return;
    if (el instanceof HTMLDetailsElement) el.open = true;
    el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    el.focus?.();
  };
  const next = view.stops[view.currentIndex];
  return (
    <nav className="ft-rail-wrap" aria-label="Path of Discipline">
      <ol className="ft-rail">
        {view.stops.map((stop) => (
          <li key={stop.id} data-state={stop.state}>
            {stop.state === 'ahead' ? (
              <span className="ft-rail-stop" aria-disabled="true" title={stop.blockedBy ?? undefined}>
                <span className="ft-rail-num" aria-hidden="true">{stop.number}</span>
                <span className="ft-rail-label">{stop.label}</span>
                <span className="sr-only">. {stop.blockedBy}</span>
              </span>
            ) : (
              <button type="button" className="ft-rail-stop" onClick={() => go(stop.id)} aria-current={stop.state === 'current' ? 'step' : undefined}>
                <span className="ft-rail-num" aria-hidden="true">{stop.state === 'done' ? '✓' : stop.number}</span>
                <span className="ft-rail-label">{stop.label}</span>
                <span className="sr-only">{stop.state === 'done' ? ', done' : ', you are here'}</span>
              </button>
            )}
          </li>
        ))}
      </ol>
      <p className="ft-note">
        {view.served
          ? 'Every stop is done.'
          : `Stop ${next.number} of ${view.total}: ${next.does}. The stops after it stay closed until this one is done.`}
      </p>
    </nav>
  );
}

function Stop({
  thesisId,
  stop,
  children,
}: {
  thesisId: string;
  stop: StopView;
  children: ReactNode;
}) {
  return (
    <details id={`ft-stop-${thesisId}-${stop.id}`} className="ft-stop" data-state={stop.state} open={stop.state === 'current'} tabIndex={-1}>
      <summary>
        <span className="ft-rail-num" aria-hidden="true">{stop.state === 'done' ? '✓' : stop.number}</span>
        <span className="ft-stop-title">{stop.label}</span>
        <span className="ft-chip" data-risk={stop.state === 'done' ? 'ok' : 'warn'}>
          {stop.state === 'done' ? 'Done' : 'You are here'}
        </span>
      </summary>
      <div className="ft-stop-body">{children}</div>
    </details>
  );
}
