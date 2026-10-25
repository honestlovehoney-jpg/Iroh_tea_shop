import 'server-only';
import { lockAnswer } from './answer-lock';
import { askQwen } from './qwen-premortem';
import { parseSystemProbability, type Direction } from './seal';

export interface SystemForecastInput {
  title: string;
  statement: string;
  symbol: string | null;
  direction: Direction;
  horizonDays: number;
  referencePrice: number;
  baseRate: number | null;
  /** Observed and computed claims from the Evidence Shelf, as plain lines. */
  evidence: string[];
  /** The failure paths the person kept, as plain lines. */
  failures: string[];
}

const SYSTEM = `You are Uncle, a calibrated forecaster. You are given one stock thesis and one precise statement. Give your own probability that the statement turns out true.

Return ONLY JSON: {"probability": number, "rationale": string}

Rules:
- probability is strictly between 0.01 and 0.99. Never 0 or 1.
- The statement is about price only: whether the Bitget daily close on the resolving day is above (up) or below (down) the reference price. A good thesis can still lose on this statement.
- Use only the evidence provided. Do not invent news, estimates or company facts.
- If a base rate is given, it is how often the price moved this way in past windows. Start near it unless the evidence gives a concrete reason to move away, and say why.
- With little evidence, stay near 0.5 or near the base rate. Do not sound more sure than the evidence allows.
- rationale: at most two plain sentences. Put no numbers in it that are not in the evidence.`;

export async function generateSystemProbability(
  input: SystemForecastInput,
): Promise<{ probability: number; rationale: string | null } | null> {
  const user = `Thesis: ${input.title}
${input.statement}
Stock: ${input.symbol ?? 'unknown'}
Statement to forecast: the Bitget daily close ${input.horizonDays} days from now will be ${input.direction === 'up' ? 'above' : 'below'} ${input.referencePrice}.
Base rate from past windows: ${input.baseRate === null ? 'not enough history' : `${(input.baseRate * 100).toFixed(1)}%`}
Evidence:
${input.evidence.length ? input.evidence.map((e) => `- ${e}`).join('\n') : '- none'}
Failure paths the person kept:
${input.failures.length ? input.failures.map((f) => `- ${f}`).join('\n') : '- none'}`;
  const reply = await askQwen(SYSTEM, user);
  const parsed = parseSystemProbability(reply);
  if (!parsed) return null;
  // The rationale goes through the same Source Lock as every other answer.
  const locked = parsed.rationale
    ? lockAnswer(parsed.rationale, [input], '')
    : null;
  return {
    probability: parsed.probability,
    rationale: locked && !locked.refused ? locked.text : null,
  };
}
