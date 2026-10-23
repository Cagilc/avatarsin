import { ScriptedProvider, type ModelProvider } from '@vex/operator';
import { AnthropicProvider } from './anthropic.ts';

export interface ProviderConfig {
  /** auto → anthropic when a key is present, scripted otherwise. */
  provider: 'auto' | 'anthropic' | 'scripted';
  model: string;
  apiKey: string | undefined;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ProviderConfig {
  const provider = env['VEX_PROVIDER'];
  return {
    provider: provider === 'anthropic' || provider === 'scripted' ? provider : 'auto',
    model: env['VEX_MODEL'] || 'claude-opus-5-5',
    apiKey: env['ANTHROPIC_API_KEY'] || undefined,
  };
}

export function createProvider(config: ProviderConfig): ModelProvider {
  const useAnthropic = config.provider === 'anthropic' || (config.provider === 'auto' && config.apiKey !== undefined);
  if (useAnthropic) {
    if (config.apiKey === undefined) throw new Error('VEX_PROVIDER=anthropic requires ANTHROPIC_API_KEY.');
    return new AnthropicProvider({ model: config.model });
  }
  return new ScriptedProvider();
}
