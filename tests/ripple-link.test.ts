import { describe, expect, it } from 'vitest';
import { THESES } from '../src/thesis/deck';
import { rippleRoomUrl } from '../src/thesis/ripple-link';

describe('Ripple Room link', () => {
  it('is hidden without a valid address', () => {
    expect(rippleRoomUrl(THESES[1], undefined)).toBeNull();
    expect(rippleRoomUrl(THESES[1], '')).toBeNull();
    expect(rippleRoomUrl(THESES[1], 'not a url')).toBeNull();
    expect(rippleRoomUrl(THESES[1], 'javascript:alert(1)')).toBeNull();
  });

  it('fills in the thesis stocks', () => {
    const url = new URL(rippleRoomUrl(THESES[1], 'https://ripple.example.com')!);
    expect(url.searchParams.get('primary')).toBe('TSLA');
    expect(url.searchParams.get('others')).toBe('META,NFLX,COST');
  });
});
