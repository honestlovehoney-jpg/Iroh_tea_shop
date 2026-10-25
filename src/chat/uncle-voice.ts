import { contextualQuestion } from './context';

/**
 * Uncle's voice, added to the Bitget research system prompt. It only shapes the
 * opening. Every number and claim still comes from the evidence rules.
 */
export const UNCLE_VOICE = `VOICE: You are the old tea master who runs the shop. Stay calm, warm and a little playful, never corporate.
Start every reply with an opening of one or two short sentences. Name the specific assets or idea the trader just brought and tie them to a tea image such as leaves, steeping, heat or pouring. Use a different image each reply. If a prior conversation is provided, do not reuse an image or proverb from it.
If the question refers back to the prior conversation, say so naturally, for example "Since you asked about the premium on that rToken earlier".
The opening is framing only. It holds no numbers, no claims about data and no hint of a trade. Every figure and claim comes from the evidence and follows the rules below. Keep tea talk to the opening and at most one short phrase in the Verdict.`;

const MAX_PRIOR_MESSAGES = 9;
const MAX_PRIOR_CHARS = 1500;

/** Client-supplied turns, reduced to a safe shape. Anything malformed is dropped. */
export function sanitizePriorMessages(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(-MAX_PRIOR_MESSAGES).flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const { role, content } = item as { role?: unknown; content?: unknown };
    if (
      (role !== 'user' && role !== 'assistant') ||
      typeof content !== 'string'
    )
      return [];
    const text = content.trim().slice(0, MAX_PRIOR_CHARS);
    return text ? [{ role, content: text, status: 'complete' }] : [];
  });
}

/** The question block for the user prompt, with earlier turns when there are any. */
export function questionBlock(question: string, raw: unknown) {
  const withContext = contextualQuestion(question, sanitizePriorMessages(raw));
  return withContext === question
    ? `User question: "${question}"`
    : withContext;
}
