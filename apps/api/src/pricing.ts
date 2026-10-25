/** Token usage of one completion, as providers report it (`Completion.usage`). */
export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** USD per million tokens, for the estimate the spend meter and the eval reports show. */
export const PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};

/** Reads the usage figures out of a provider's free-form `usage` map. */
export function usageOf(raw: Record<string, number> | undefined): Usage {
  return { input: raw?.['input'] ?? 0, output: raw?.['output'] ?? 0, cacheRead: raw?.['cacheRead'] ?? 0, cacheWrite: raw?.['cacheWrite'] ?? 0 };
}

export function tokensOf(u: Usage): number {
  return u.input + u.output + u.cacheRead + u.cacheWrite;
}

/** Estimated cost of a completion; 0 for a model the table does not know. */
export function costOf(providerName: string, usage: Usage): number {
  const model = providerName.replace(/^anthropic:/, '');
  const p = PRICES[model];
  if (!p) return 0;
  return (usage.input * p.input + usage.output * p.output + usage.cacheRead * p.cacheRead + usage.cacheWrite * p.cacheWrite) / 1_000_000;
}
