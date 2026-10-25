import { ClaudeAssistant } from './claude.ts';
import { HeuristicAssistant } from './heuristic.ts';
import type { Assistant } from './types.ts';

export * from './types.ts';
export { HeuristicAssistant } from './heuristic.ts';
export { ClaudeAssistant } from './claude.ts';

/** Claude when a key is configured (STUDIO_ASSISTANT=heuristic forces the geometric one). */
export function createAssistant(env: NodeJS.ProcessEnv): Assistant {
  if (env['STUDIO_ASSISTANT'] === 'heuristic' || !env['ANTHROPIC_API_KEY']) return new HeuristicAssistant();
  return new ClaudeAssistant({ model: env['STUDIO_MODEL'] ?? 'claude-opus-5-5' });
}
