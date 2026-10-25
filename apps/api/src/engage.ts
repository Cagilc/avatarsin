import { liveTools, type ConnectorManifest } from '@vex/connectors';
import { MAX_QUICK_ACTIONS, announcementSchema, applicable, engageIdSchema, type Announcement, type HostManifest, type Principal, type QuickAction, type Tour } from '@vex/operator';
import type { OperatorStore, StoredAnnouncement } from './storage.ts';

/**
 * Announcements and quick actions for one host: what the manifest declares, what connector
 * approvals drafted, who has seen what. Everything here is presentation: a quick action that
 * names a tool is still run by the operator loop, under the policy and the grant.
 */

export interface EngageOptions {
  manifest?: HostManifest | undefined;
  store: OperatorStore;
  now?: () => number;
}

export type VisibleAnnouncement = Announcement & { seen: boolean };
export type VisibleTour = Tour & { done: boolean };

const BODY_MAX = 2000;

export class Engage {
  private readonly manifest: HostManifest | undefined;
  private readonly store: OperatorStore;
  private readonly now: () => number;

  constructor(opts: EngageOptions) {
    this.manifest = opts.manifest;
    this.store = opts.store;
    this.now = opts.now ?? (() => Date.now());
  }

  get announcementsOn(): boolean {
    return this.manifest?.features.announcements === true;
  }

  get quickActionsOn(): boolean {
    return this.manifest?.features.quickActions === true;
  }

  get toursOn(): boolean {
    return this.manifest?.features.tours === true;
  }

  /** The tours this person may take, with whether they completed each. */
  toursFor(principal: Principal): VisibleTour[] {
    if (!this.toursOn) return [];
    const done = new Set(this.store.doneTours(principal.id));
    return applicable(this.manifest?.tours ?? [], { role: principal.role, nowMs: this.now() }).map((t) => ({ ...t, done: done.has(t.id) }));
  }

  /** The person finished one of their tours. False when it is not theirs. */
  markTourDone(principal: Principal, id: string): boolean {
    if (!this.toursFor(principal).some((t) => t.id === id)) return false;
    this.store.markTourDone(principal.id, id);
    return true;
  }

  /** Manifest announcements plus the published ones from connector approvals, in that order. */
  private published(): Announcement[] {
    const stored = this.store.listAnnouncements().filter((a) => a.status === 'published');
    return [...(this.manifest?.announcements ?? []), ...stored.map(({ status: _s, createdAt: _c, publishedAt: _p, publishedBy: _b, connector: _k, ...a }) => a)];
  }

  /** What this person may see now, unseen first is the panel's job; here, manifest order. */
  announcementsFor(principal: Principal): VisibleAnnouncement[] {
    if (!this.announcementsOn) return [];
    const seen = new Set(this.store.seenAnnouncements(principal.id));
    return applicable(this.published(), { role: principal.role, nowMs: this.now() }).map((a) => ({ ...a, seen: seen.has(a.id) }));
  }

  /** Marks one of the person's visible announcements as seen. False when it is not theirs to see. */
  markSeen(principal: Principal, id: string): boolean {
    if (!this.announcementsFor(principal).some((a) => a.id === id)) return false;
    this.store.markSeen(principal.id, id);
    return true;
  }

  /** The buttons this person gets: role and dates, and only tools the loop would run (`permitted`). At most MAX_QUICK_ACTIONS. */
  quickActionsFor(principal: Principal, permitted: ReadonlySet<string>): QuickAction[] {
    if (!this.quickActionsOn) return [];
    return applicable(this.manifest?.quickActions ?? [], { role: principal.role, nowMs: this.now() })
      .filter((q) => q.tool === undefined || permitted.has(q.tool))
      .slice(0, MAX_QUICK_ACTIONS);
  }

  /** A button by id, whatever the audience: the run endpoint decides and audits. */
  quickAction(id: string): QuickAction | undefined {
    return this.manifest?.quickActions.find((q) => q.id === id);
  }

  /** Announcements for everyone, for the prompt (never role-specific ones: the prompt is shared). */
  forPrompt(): Announcement[] {
    if (!this.announcementsOn) return [];
    return applicable(this.published(), { role: '', nowMs: this.now() }).filter((a) => !a.roles).slice(0, 10);
  }

  drafts(): StoredAnnouncement[] {
    return this.store.listAnnouncements().filter((a) => a.status === 'draft');
  }

  /**
   * A review that switched tools on (new, or back on after a contract change) drafts an
   * announcement with the names and descriptions the person approved. Nobody sees it until an
   * administrator publishes it.
   */
  draftFromReview(before: ConnectorManifest, after: ConnectorManifest, reviewer: string): StoredAnnouncement | null {
    const was = new Set(liveTools(before).map((t) => t.name));
    const fresh = liveTools(after).filter((t) => !was.has(t.name));
    if (fresh.length === 0) return null;
    const stamp = this.now().toString(36);
    const id = engageIdSchema.parse(`con-${after.id}-${stamp}`.slice(0, 40));
    const lines = fresh.map((t) => `• ${t.name}: ${t.description.replace(/\s+/g, ' ').trim().slice(0, 160)}`);
    const body = [`Vex puede usar ${fresh.length === 1 ? 'una herramienta nueva' : `${fresh.length} herramientas nuevas`} de ${after.name}:`, ...lines].join('\n').slice(0, BODY_MAX);
    const draft: StoredAnnouncement = {
      ...announcementSchema.parse({ id, title: `Novedad: ${after.name}`.slice(0, 120), body, source: 'connector' }),
      status: 'draft',
      createdAt: new Date(this.now()).toISOString(),
      connector: after.id,
      createdBy: reviewer,
    };
    this.store.saveAnnouncement(draft);
    return draft;
  }

  /** Publishes a draft, with the administrator's final words. Null when there is no such draft. */
  publish(id: string, patch: { title?: string; body?: string }, by: string): StoredAnnouncement | null {
    const draft = this.drafts().find((a) => a.id === id);
    if (!draft) return null;
    const { status: _status, createdAt, createdBy, connector, publishedAt: _p, publishedBy: _b, ...plain } = draft;
    const edited = announcementSchema.parse({ ...plain, ...(patch.title ? { title: patch.title } : {}), ...(patch.body ? { body: patch.body } : {}), since: new Date(this.now()).toISOString() });
    const published: StoredAnnouncement = { ...edited, status: 'published', createdAt, ...(connector ? { connector } : {}), ...(createdBy ? { createdBy } : {}), publishedAt: new Date(this.now()).toISOString(), publishedBy: by };
    this.store.saveAnnouncement(published);
    return published;
  }

  /** Removes a stored announcement (draft or published). Manifest ones are not the server's to remove. */
  remove(id: string): boolean {
    if (!this.store.listAnnouncements().some((a) => a.id === id)) return false;
    this.store.deleteAnnouncement(id);
    return true;
  }
}
