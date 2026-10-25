import { describe, expect, it } from 'vitest';
import {
  applyDecision,
  canAdvance,
  evaluateTrigger,
  extractPathObjects,
  parseModelPaths,
  premortemStatus,
  validateFailurePath,
  type FailurePathFields,
  type PathDecision,
} from '../src/thesis/premortem';

const now = new Date('2026-10-24T12:00:00Z');
const ctx = { now, hasInstrument: true };

const good: FailurePathFields = {
  condition: 'AAPL closes below 170 on the daily candle before the January earnings call.',
  probability: 0.2,
  impactPct: 6,
  deadline: '2027-01-30T00:00:00.000Z',
  triggerKind: 'price_below',
  triggerLevel: 170,
  triggerNote: 'Daily close under 170',
};

const states = (...decisions: PathDecision[]) =>
  decisions.map((decision) => ({ decision }));

describe('validateFailurePath', () => {
  it('accepts a concrete, time-bound path', () => {
    const result = validateFailurePath(good, ctx);
    expect(result.ok).toBe(true);
  });

  it('rejects a vague condition with no number', () => {
    const result = validateFailurePath(
      { ...good, condition: 'The market turns against the position badly.' },
      ctx,
    );
    expect(result.ok).toBe(false);
  });

  it.each([0, 1, -0.2, 1.5, Number.NaN, '0.3'])(
    'rejects probability %s',
    (probability) => {
      expect(validateFailurePath({ ...good, probability }, ctx).ok).toBe(false);
    },
  );

  it.each([0, -3, 101, Number.NaN])('rejects impact %s', (impactPct) => {
    expect(validateFailurePath({ ...good, impactPct }, ctx).ok).toBe(false);
  });

  it('rejects a deadline in the past, a bad date and one beyond five years', () => {
    expect(validateFailurePath({ ...good, deadline: '2026-01-01' }, ctx).ok).toBe(false);
    expect(validateFailurePath({ ...good, deadline: 'soon' }, ctx).ok).toBe(false);
    expect(validateFailurePath({ ...good, deadline: '2040-01-01' }, ctx).ok).toBe(false);
  });

  it('needs a level for price triggers and an instrument to watch', () => {
    expect(validateFailurePath({ ...good, triggerLevel: null }, ctx).ok).toBe(false);
    expect(
      validateFailurePath(good, { ...ctx, hasInstrument: false }).ok,
    ).toBe(false);
    expect(
      validateFailurePath(
        { ...good, triggerKind: 'date', triggerLevel: null },
        { ...ctx, hasInstrument: false },
      ).ok,
    ).toBe(true);
  });

  it('rejects non-objects', () => {
    expect(validateFailurePath(null, ctx).ok).toBe(false);
    expect(validateFailurePath('x', ctx).ok).toBe(false);
  });
});

describe('model output parsing', () => {
  const item = {
    condition: 'NVDA falls 25% from its current price within 90 days of the next earnings report.',
    probability: 0.15,
    impact_pct: 8,
    deadline: '2027-02-01',
    trigger: { kind: 'price_below', level: 90, note: 'Close under 90' },
  };

  it('reads fenced JSON with a paths array', () => {
    const text = '```json\n' + JSON.stringify({ paths: [item] }) + '\n```';
    expect(extractPathObjects(text)).toHaveLength(1);
  });

  it('reads a bare array and JSON with prose around it', () => {
    expect(extractPathObjects(JSON.stringify([item, item]))).toHaveLength(2);
    expect(
      extractPathObjects('Here you go: ' + JSON.stringify({ paths: [item] }) + ' Done.'),
    ).toHaveLength(1);
  });

  it('returns nothing for text that is not JSON', () => {
    expect(extractPathObjects('I cannot do that.')).toEqual([]);
  });

  it('keeps valid paths, drops invalid ones and caps at five', () => {
    const bad = { ...item, probability: 2 };
    const text = JSON.stringify({ paths: [item, bad, item, item, item, item, item] });
    const { paths, dropped } = parseModelPaths(text, ctx);
    expect(paths).toHaveLength(5);
    expect(dropped).toHaveLength(1);
    expect(paths[0].triggerKind).toBe('price_below');
    expect(paths[0].triggerLevel).toBe(90);
    expect(paths[0].impactPct).toBe(8);
  });
});

describe('premortemStatus gate', () => {
  it('is complete with three decided paths and two kept', () => {
    expect(premortemStatus(states('accepted', 'modified', 'rejected')).complete).toBe(true);
  });

  it('blocks on pending paths', () => {
    const status = premortemStatus(states('accepted', 'accepted', 'pending'));
    expect(status.complete).toBe(false);
    expect(status.pending).toBe(1);
  });

  it('blocks below three and above five paths', () => {
    expect(premortemStatus(states('accepted', 'accepted')).complete).toBe(false);
    expect(
      premortemStatus(states('accepted', 'accepted', 'accepted', 'accepted', 'accepted', 'accepted'))
        .complete,
    ).toBe(false);
  });

  it('blocks when too many are rejected', () => {
    expect(premortemStatus(states('accepted', 'rejected', 'rejected')).complete).toBe(false);
  });

  it('blocks an empty table', () => {
    expect(premortemStatus([]).complete).toBe(false);
  });
});

describe('applyDecision', () => {
  it('accepts a valid path', () => {
    const result = applyDecision(good, { action: 'accept' }, ctx);
    expect(result.ok && result.decision).toBe('accepted');
  });

  it('refuses to accept a path whose deadline already passed', () => {
    const old = { ...good, deadline: '2026-10-01T00:00:00.000Z' };
    expect(applyDecision(old, { action: 'accept' }, ctx).ok).toBe(false);
  });

  it('modifies with a valid change and refuses a no-op or invalid edit', () => {
    const ok = applyDecision(good, { action: 'modify', edits: { probability: 0.35 } }, ctx);
    expect(ok.ok && ok.fields?.probability).toBe(0.35);
    expect(ok.ok && ok.decision).toBe('modified');
    expect(applyDecision(good, { action: 'modify', edits: { probability: 0.2 } }, ctx).ok).toBe(false);
    expect(applyDecision(good, { action: 'modify', edits: { probability: 5 } }, ctx).ok).toBe(false);
    expect(applyDecision(good, { action: 'modify', edits: {} }, ctx).ok).toBe(false);
  });

  it('needs a reason to reject', () => {
    expect(applyDecision(good, { action: 'reject', reason: 'no' }, ctx).ok).toBe(false);
    const ok = applyDecision(good, { action: 'reject', reason: 'Already hedged with a put.' }, ctx);
    expect(ok.ok && ok.decision).toBe('rejected');
  });
});

describe('canAdvance', () => {
  it('opens failures_resolved only when the premortem is complete', () => {
    expect(canAdvance('draft', 'failures_resolved', states('accepted', 'accepted', 'accepted')).ok).toBe(true);
    const blocked = canAdvance('draft', 'failures_resolved', states('pending', 'accepted', 'accepted'));
    expect(!blocked.ok && blocked.code).toBe('blocked');
  });

  it('refuses to skip stages or go backwards', () => {
    const skip = canAdvance('draft', 'locked', states('accepted', 'accepted', 'accepted'));
    expect(!skip.ok && skip.code).toBe('out_of_order');
    const back = canAdvance('failures_resolved', 'draft', []);
    expect(!back.ok && back.code).toBe('out_of_order');
  });

  it('opens evidence_reviewed only when the Evidence Shelf is complete', () => {
    expect(
      canAdvance('failures_resolved', 'evidence_reviewed', [], { complete: true, blockers: [] }).ok,
    ).toBe(true);
    const blocked = canAdvance('failures_resolved', 'evidence_reviewed', [], {
      complete: false,
      blockers: ['No observed fact is bound yet.'],
    });
    expect(!blocked.ok && blocked.code).toBe('blocked');
    const none = canAdvance('failures_resolved', 'evidence_reviewed', []);
    expect(!none.ok && none.code).toBe('blocked');
  });

  it('keeps later stages closed until they are built', () => {
    const later = canAdvance('sealed', 'locked', []);
    expect(!later.ok && later.code).toBe('blocked');
    const past = canAdvance('locked', 'locked', []);
    expect(!past.ok && past.code).toBe('out_of_order');
    const seal = canAdvance('evidence_reviewed', 'sealed', []);
    expect(!seal.ok && seal.code).toBe('blocked');
  });
});

describe('evaluateTrigger', () => {
  it('flags a price_below breach and an approach within five percent', () => {
    expect(evaluateTrigger(good, 169, now).state).toBe('breached');
    expect(evaluateTrigger(good, 170, now).state).toBe('breached');
    expect(evaluateTrigger(good, 176, now).state).toBe('approaching');
    expect(evaluateTrigger(good, 200, now).state).toBe('clear');
  });

  it('handles price_above symmetrically', () => {
    const up = { ...good, triggerKind: 'price_above' as const, triggerLevel: 100 };
    expect(evaluateTrigger(up, 101, now).state).toBe('breached');
    expect(evaluateTrigger(up, 96, now).state).toBe('approaching');
    expect(evaluateTrigger(up, 80, now).state).toBe('clear');
  });

  it('reports expired for a passed deadline and unmonitored when there is no price', () => {
    const past = { ...good, deadline: '2026-10-01T00:00:00.000Z' };
    expect(evaluateTrigger(past, 200, now).state).toBe('expired');
    expect(evaluateTrigger(good, null, now).state).toBe('unmonitored');
    expect(
      evaluateTrigger({ ...good, triggerKind: 'manual', triggerLevel: null }, null, now).state,
    ).toBe('unmonitored');
  });

  it('warns on a date trigger inside seven days', () => {
    const soon = {
      ...good,
      triggerKind: 'date' as const,
      triggerLevel: null,
      deadline: '2026-10-28T00:00:00.000Z',
    };
    expect(evaluateTrigger(soon, null, now).state).toBe('approaching');
  });

  it('breach wins over expiry', () => {
    const past = { ...good, deadline: '2026-10-01T00:00:00.000Z' };
    expect(evaluateTrigger(past, 160, now).state).toBe('breached');
  });
});
