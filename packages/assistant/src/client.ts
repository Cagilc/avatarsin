import type { Announcement, OperatorEvent, Principal, QuickAction, Tour, VexPersonality } from '@vex/operator';

/** What GET /operator/info says, as far as the panel needs it. */
export interface OperatorInfo {
  provider: string;
  personality: VexPersonality;
  host: {
    name: string;
    manifest: boolean;
    features?: { tours: boolean; announcements: boolean; quickActions: boolean; domDriver: boolean };
    /** The avatar published by the studio for this host, when the manifest names one. */
    avatar?: { endpoint: string; publicKey: string; keyId: string };
  };
  tools: Array<{ name: string; driver: string; risk: string; description: string }>;
}

export type VisibleAnnouncement = Announcement & { seen: boolean };
export type VisibleTour = Tour & { done: boolean };

export type StreamEvent = OperatorEvent | { type: 'session'; sessionId: string };

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

/** Vex Core over HTTP, framework-free. The token comes from the host each time it is needed. */
export class OperatorClient {
  readonly api: string;
  private readonly getToken: () => Promise<string>;

  constructor(api: string, getToken: () => Promise<string>) {
    this.api = api.replace(/\/+$/, '');
    this.getToken = getToken;
  }

  static async info(api: string): Promise<OperatorInfo> {
    return json(await fetch(`${api.replace(/\/+$/, '')}/operator/info`));
  }

  /** The demo login of a local Vex Core: a token without a password. Never exists on a public server. */
  static async demoLogin(api: string, userId: string): Promise<{ token: string; principal: Principal }> {
    return json(await fetch(`${api.replace(/\/+$/, '')}/platform/auth/demo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId }) }));
  }

  private async headers(): Promise<Record<string, string>> {
    return { 'content-type': 'application/json', authorization: `Bearer ${await this.getToken()}` };
  }

  async confirm(sessionId: string, actionId: string, approved: boolean): Promise<void> {
    await json(await fetch(`${this.api}/operator/confirm`, { method: 'POST', headers: await this.headers(), body: JSON.stringify({ sessionId, actionId, approved }) }));
  }

  async stop(sessionId: string): Promise<{ stopped: boolean }> {
    return json(await fetch(`${this.api}/operator/stop`, { method: 'POST', headers: await this.headers(), body: JSON.stringify({ sessionId }) }));
  }

  /** The announcements this person may see, with whether they dismissed each. Empty when the host has them off. */
  async announcements(): Promise<VisibleAnnouncement[]> {
    return json(await fetch(`${this.api}/engage/announcements`, { headers: await this.headers() }));
  }

  async markSeen(id: string): Promise<void> {
    await json(await fetch(`${this.api}/engage/announcements/${encodeURIComponent(id)}/seen`, { method: 'POST', headers: await this.headers(), body: '{}' }));
  }

  /** A thumbs up or down on one reply (turns are 1-based within the session), with the reason. */
  async feedback(sessionId: string, turn: number, verdict: 'up' | 'down', reason?: string): Promise<void> {
    await json(await fetch(`${this.api}/operator/feedback`, { method: 'POST', headers: await this.headers(), body: JSON.stringify({ sessionId, turn, verdict, ...(reason ? { reason } : {}) }) }));
  }

  /** The tours this person may take, with whether they completed each. Empty when the host has them off. */
  async tours(): Promise<VisibleTour[]> {
    return json(await fetch(`${this.api}/engage/tours`, { headers: await this.headers() }));
  }

  async markTourDone(id: string): Promise<void> {
    await json(await fetch(`${this.api}/engage/tours/${encodeURIComponent(id)}/done`, { method: 'POST', headers: await this.headers(), body: '{}' }));
  }

  /** The quick-action buttons for this person. Empty when the host has them off. */
  async quickActions(): Promise<QuickAction[]> {
    return json(await fetch(`${this.api}/engage/quick-actions`, { headers: await this.headers() }));
  }

  /** Runs a tool button through the operator loop; the same SSE events as a chat message. */
  async runQuickAction(id: string, body: { sessionId?: string; context: Record<string, unknown> }, onEvent: (event: StreamEvent) => void, signal?: AbortSignal): Promise<void> {
    return this.stream(`${this.api}/engage/quick-actions/${encodeURIComponent(id)}/run`, body, onEvent, signal);
  }

  /** POST /operator/chat and deliver each SSE event as it arrives. Resolves when the stream ends. */
  async chat(body: { sessionId?: string; message: string; context: Record<string, unknown> }, onEvent: (event: StreamEvent) => void, signal?: AbortSignal): Promise<void> {
    return this.stream(`${this.api}/operator/chat`, body, onEvent, signal);
  }

  private async stream(url: string, body: unknown, onEvent: (event: StreamEvent) => void, signal?: AbortSignal): Promise<void> {
    const res = await fetch(url, { method: 'POST', headers: await this.headers(), body: JSON.stringify(body), ...(signal ? { signal } : {}) });
    if (!res.ok || !res.body) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error ?? `HTTP ${res.status}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep = buffer.indexOf('\n\n');
      while (sep >= 0) {
        const chunk = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const data = chunk.split('\n').find((l) => l.startsWith('data: '));
        if (data) onEvent(JSON.parse(data.slice(6)) as StreamEvent);
        sep = buffer.indexOf('\n\n');
      }
    }
  }
}
