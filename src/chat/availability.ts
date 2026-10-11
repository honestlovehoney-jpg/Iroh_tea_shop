export type ResearchAvailability = 'configured' | 'unavailable' | 'offline';

export function getResearchAvailability(): ResearchAvailability {
  return process.env.QWEN_API_KEY ? 'configured' : 'unavailable';
}
