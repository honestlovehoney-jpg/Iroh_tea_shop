export type ResearchAvailability = 'configured' | 'unavailable' | 'offline';

/**
 * Uncle's research route needs both the key and the base URL, so the chat only
 * reports 'configured' when both are set. Read per request, on the server.
 */
export function getResearchAvailability(): ResearchAvailability {
  const key = process.env.QWEN_API_KEY?.trim();
  const base = process.env.QWEN_BASE_URL?.trim();
  return key && base ? 'configured' : 'unavailable';
}
