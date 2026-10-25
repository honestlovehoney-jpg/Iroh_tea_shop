import { describe, expect, it } from 'vitest';
import { PATH_STOPS, canOpenStop, pathProgress, pathSummary } from '../src/thesis/path';

describe('pathProgress', () => {
  it('starts at the Failure Table once the thesis exists', () => {
    const view = pathProgress('draft');
    expect(view.stops.map((s) => s.state)).toEqual(['done', 'current', 'ahead', 'ahead', 'ahead']);
    expect(view.completed).toBe(1);
    expect(view.served).toBe(false);
    expect(view.stops[3].blockedBy).toBe('Finish the Evidence Shelf first.');
  });

  it('moves one stop at a time as the status advances', () => {
    expect(pathProgress('failures_resolved').stops.map((s) => s.state)).toEqual(['done', 'done', 'current', 'ahead', 'ahead']);
    expect(pathProgress('evidence_reviewed').stops.map((s) => s.state)).toEqual(['done', 'done', 'done', 'current', 'ahead']);
    expect(pathProgress('sealed').stops.map((s) => s.state)).toEqual(['done', 'done', 'done', 'done', 'current']);
  });

  it('finishes every stop when served', () => {
    const view = pathProgress('locked');
    expect(view.stops.every((s) => s.state === 'done')).toBe(true);
    expect(view.served).toBe(true);
    expect(view.currentIndex).toBe(-1);
    expect(view.completed).toBe(PATH_STOPS.length);
  });

  it('has exactly one current stop until served', () => {
    for (const status of ['draft', 'failures_resolved', 'evidence_reviewed', 'sealed'] as const)
      expect(pathProgress(status).stops.filter((s) => s.state === 'current')).toHaveLength(1);
  });
});

describe('canOpenStop', () => {
  it('lets you read finished stops and work the current one, never skip ahead', () => {
    expect(canOpenStop('draft', 'failures')).toBe(true);
    expect(canOpenStop('draft', 'evidence')).toBe(false);
    expect(canOpenStop('draft', 'balance')).toBe(false);
    expect(canOpenStop('sealed', 'evidence')).toBe(true);
    expect(canOpenStop('sealed', 'balance')).toBe(true);
    expect(canOpenStop('failures_resolved', 'seal')).toBe(false);
  });
});

describe('pathSummary', () => {
  it('says where a thesis stands in one line', () => {
    expect(pathSummary('draft')).toBe('Stop 2 of 5: Failure Table');
    expect(pathSummary('sealed')).toBe('Stop 5 of 5: Balance Scale');
    expect(pathSummary('locked')).toBe('Served');
  });
});
