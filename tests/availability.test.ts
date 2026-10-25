import { describe, expect, it } from 'vitest';
import { getResearchAvailability } from '../src/chat/availability';

const withEnv = (key: string | undefined, base: string | undefined) => {
  if (key === undefined) delete process.env.QWEN_API_KEY;
  else process.env.QWEN_API_KEY = key;
  if (base === undefined) delete process.env.QWEN_BASE_URL;
  else process.env.QWEN_BASE_URL = base;
  return getResearchAvailability();
};

describe('getResearchAvailability', () => {
  it('is configured only when both the key and the base URL are set', () => {
    const before = {
      key: process.env.QWEN_API_KEY,
      base: process.env.QWEN_BASE_URL,
    };
    expect(withEnv('k', 'https://example.test/v1')).toBe('configured');
    expect(withEnv('k', undefined)).toBe('unavailable');
    expect(withEnv(undefined, 'https://example.test/v1')).toBe('unavailable');
    expect(withEnv(undefined, undefined)).toBe('unavailable');
    expect(withEnv('  ', 'https://example.test/v1')).toBe('unavailable');
    withEnv(before.key, before.base);
  });
});
