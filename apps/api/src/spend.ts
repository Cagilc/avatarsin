import type { Completion, CompletionRequest, ModelProvider, Principal } from '@vex/operator';
import { costOf, tokensOf, usageOf } from './pricing.ts';
import type { OperatorStore, SpendRecord } from './storage.ts';

/**
 * The spend meter: every completion the model makes is charged to the person who asked for it,
 * and two caps hold by default: tokens per person and day, and dollars per installation and
 * month (days and months in UTC). Past a cap Vex keeps working in scripted mode and says so;
 * at 80 % it warns. The installation's owner tunes the caps in the environment.
 */

export interface SpendLimits {
  /** Tokens (input + output + cache) per person per UTC day. 0 = no cap. */
  userDayTokens: number;
  /** Estimated USD per installation per UTC month. 0 = no cap. */
  monthUsd: number;
  /** Fraction of a cap that triggers a warning. */
  warnRatio: number;
}

export const DEFAULT_LIMITS: SpendLimits = { userDayTokens: 300_000, monthUsd: 50, warnRatio: 0.8 };

export type CapName = 'user-day' | 'month';

export interface SpendStatus {
  userDay: { tokens: number; limit: number; ratio: number };
  month: { usd: number; limit: number; ratio: number };
  /** The cap that is reached, if any. */
  blocked: CapName | null;
  /** The cap past the warning ratio and not yet reached, if any. */
  warn: CapName | null;
}

export class SpendMeter {
  private readonly store: OperatorStore;
  readonly limits: SpendLimits;
  private readonly now: () => number;

  constructor(store: OperatorStore, limits: Partial<SpendLimits> = {}, now: () => number = () => Date.now()) {
    this.store = store;
    this.limits = { ...DEFAULT_LIMITS, ...limits };
    this.now = now;
  }

  private dayStart(): string {
    const d = new Date(this.now());
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
  }

  private monthStart(): string {
    const d = new Date(this.now());
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
  }

  status(principal: Pick<Principal, 'id'>): SpendStatus {
    const day = this.store.spendSince(this.dayStart(), principal.id);
    const month = this.store.spendSince(this.monthStart());
    const ratio = (value: number, limit: number) => (limit > 0 ? value / limit : 0);
    const userDay = { tokens: day.tokens, limit: this.limits.userDayTokens, ratio: ratio(day.tokens, this.limits.userDayTokens) };
    const monthly = { usd: month.usd, limit: this.limits.monthUsd, ratio: ratio(month.usd, this.limits.monthUsd) };
    const blocked: CapName | null = userDay.limit > 0 && userDay.tokens >= userDay.limit ? 'user-day' : monthly.limit > 0 && monthly.usd >= monthly.limit ? 'month' : null;
    const warn: CapName | null = blocked ? null : userDay.ratio >= this.limits.warnRatio ? 'user-day' : monthly.ratio >= this.limits.warnRatio ? 'month' : null;
    return { userDay, month: monthly, blocked, warn };
  }

  /** This month's total and today's figures per person, for administrators. */
  report(): { month: { usd: number; tokens: number; calls: number; limit: number }; today: Array<{ principalId: string; tokens: number; usd: number; calls: number }>; limits: SpendLimits } {
    const month = this.store.spendSince(this.monthStart());
    return { month: { ...month, limit: this.limits.monthUsd }, today: this.store.spendByPrincipalSince(this.dayStart()), limits: this.limits };
  }

  record(principal: Pick<Principal, 'id'>, providerName: string, raw: Record<string, number> | undefined): SpendRecord {
    const usage = usageOf(raw);
    const rec: SpendRecord = { ts: new Date(this.now()).toISOString(), principalId: principal.id, model: providerName, ...usage, usd: costOf(providerName, usage) };
    this.store.recordSpend(rec);
    return rec;
  }

  /** The provider with every completion charged to this person. */
  metered(provider: ModelProvider, principal: Pick<Principal, 'id'>): ModelProvider {
    const meter = this;
    return {
      name: provider.name,
      async complete(req: CompletionRequest): Promise<Completion> {
        const c = await provider.complete(req);
        if (c.usage && tokensOf(usageOf(c.usage)) > 0) meter.record(principal, provider.name, c.usage);
        return c;
      },
    };
  }
}

/** What Vex tells the person when a cap or a pause sends the run to scripted mode. */
export function capNotice(cap: CapName | 'pause'): string {
  switch (cap) {
    case 'user-day':
      return 'Has llegado al tope de uso de IA de hoy: sigo en modo guion (sin modelo) hasta mañana.';
    case 'month':
      return 'La instalación ha llegado a su tope mensual de IA: sigo en modo guion (sin modelo).';
    case 'pause':
      return 'Un administrador ha pausado la IA: sigo en modo guion (sin modelo).';
  }
}

export function warnNotice(status: SpendStatus): string | null {
  if (status.warn === 'user-day') return `Aviso: llevas el ${Math.round(status.userDay.ratio * 100)} % de tu uso de IA de hoy.`;
  if (status.warn === 'month') return `Aviso: la instalación lleva el ${Math.round(status.month.ratio * 100)} % de su tope mensual de IA.`;
  return null;
}
