import { z } from 'zod';
import { riskSchema, type Driver, type Risk } from './action.ts';
import { announcementSchema, quickActionSchema } from './engage.ts';
import { decide, type PermissionPolicy, permissionPolicySchema } from './policy.ts';
import { tourSchema } from './tour.ts';

/**
 * The host manifest: what a platform that embeds Vex declares about itself. It lives on the
 * server (never in the browser) and only ever NARROWS what Vex may do. Everything it proposes
 * (connectors) still needs a person's review; everything it switches on (`features`) is off by
 * default, and a host without a manifest behaves exactly as before.
 */

const RISK_ORDER: Record<Risk, number> = { read: 0, write: 1, irreversible: 2 };

const connectorIdSchema = z.string().regex(/^[a-z][a-z0-9]{1,23}$/, 'id de conector: minúsculas y dígitos, empieza por letra, máximo 24');
const envNameSchema = z.string().regex(/^[A-Z][A-Z0-9_]*$/, 'nombre de variable de entorno en mayúsculas');
const hostnameSchema = z
  .string()
  .max(253)
  .regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i, 'dominio no válido (solo el nombre, sin esquema ni puerto)');

/** Where a proposed connector comes from. The same shapes the connector registry imports. */
export const hostConnectorSourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('openapi'), url: z.string().url() }),
  z.strictObject({ kind: z.literal('mcp-http'), url: z.string().url() }),
  z.strictObject({ kind: z.literal('mcp-stdio'), command: z.string().min(1), args: z.array(z.string()).default([]) }),
]);

/** Only the NAME of the environment variable, as in the connector registry: the manifest never carries secrets. */
export const hostConnectorAuthSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({ kind: z.literal('bearer'), env: envNameSchema }),
  z.strictObject({ kind: z.literal('header'), name: z.string().min(1), env: envNameSchema }),
]);

/**
 * A connector the host proposes. It enters the registry as a draft ("Sin revisar"): no tool
 * reaches the model until an administrator reviews it, exactly like a connector imported by hand.
 */
/**
 * Which operations of an OpenAPI source become tools, as the connector registry understands it:
 * rules `GET`, `/ruta`, `GET /ruta` or `tag:nombre`; `include` keeps, `exclude` drops, `maxTools` caps.
 */
export const hostConnectorFilterSchema = z.strictObject({
  include: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
  exclude: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
  maxTools: z.number().int().min(1).max(500).default(200),
});

export const hostConnectorSchema = z
  .strictObject({
    id: connectorIdSchema,
    name: z.string().min(1).max(80).optional(),
    source: hostConnectorSourceSchema,
    baseUrl: z.string().url().optional(),
    auth: hostConnectorAuthSchema.optional(),
    filter: hostConnectorFilterSchema.optional(),
  })
  .refine((c) => c.filter === undefined || c.source.kind === 'openapi', { message: 'filter solo vale para una fuente openapi', path: ['filter'] });
export type HostConnector = z.infer<typeof hostConnectorSchema>;

/** The keys the host sends as screen context with each message, described for the model. */
export const screenContextSchema = z.record(
  z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/, 'clave de contexto: letras, dígitos y guion bajo'),
  z.strictObject({ description: z.string().min(1).max(200) }),
);
export type ScreenContext = z.infer<typeof screenContextSchema>;

/** Switches for the workflows that come after the manifest. All off: nothing changes until a host asks. */
export const hostFeaturesSchema = z.strictObject({
  tours: z.boolean().default(false),
  announcements: z.boolean().default(false),
  quickActions: z.boolean().default(false),
  domDriver: z.boolean().default(false),
  /** A pending confirmation is also sent out through `approvals.channels`, to be resolved from there. */
  channelApprovals: z.boolean().default(false),
});
export type HostFeatures = z.infer<typeof hostFeaturesSchema>;

/**
 * Where a pending confirmation is delivered besides the page: a webhook the host turns into an
 * e-mail or a message (signed with the secret named in `secretEnv`), or the server log. The host
 * decides who gets the link: whoever opens it resolves the confirmation.
 */
export const approvalChannelSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('webhook'), url: z.string().url(), secretEnv: envNameSchema.optional() }),
  z.strictObject({ kind: z.literal('log') }),
]);
export type ApprovalChannel = z.infer<typeof approvalChannelSchema>;
export const approvalsSchema = z.strictObject({ channels: z.array(approvalChannelSchema).min(1).max(5) });

/**
 * The avatar published by the studio for this integration. Looks and personality come signed from
 * there; Vex Core only needs where to ask for the grant and which key must have signed it.
 */
export const hostAvatarSchema = z.strictObject({
  /** The integration's embed endpoint in the studio: https://studio/v1/embed/<key>. */
  endpoint: z.string().url(),
  /** Raw Ed25519 public key of the studio, base64url (32 bytes → 43 characters). */
  publicKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'clave pública Ed25519 en base64url (43 caracteres)'),
  keyId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
});
export type HostAvatar = z.infer<typeof hostAvatarSchema>;

const uniqueIds = (list: Array<{ id: string }>) => new Set(list.map((c) => c.id)).size === list.length;

export const hostManifestSchema = z
  .strictObject({
    format: z.literal('vex-host'),
    version: z.literal(1),
    host: z.strictObject({
      /** How the prompt names the platform ("el operador de <name>"). */
      name: z.string().min(1).max(80),
      /** The platform's hostname. A grant whose origins do not include it is not for this host. */
      domain: hostnameSchema,
    }),
    avatar: hostAvatarSchema.optional(),
    connectors: z.array(hostConnectorSchema).max(50).default([]).refine(uniqueIds, 'ids de conector repetidos'),
    /** The host's own permission policy. Default: the operator's (platform and reviewed connectors, confirm the irreversible). */
    policy: permissionPolicySchema.optional(),
    screenContext: screenContextSchema.default({}),
    features: hostFeaturesSchema.prefault({}),
    approvals: approvalsSchema.optional(),
    /** Shown only with `features.tours`; the avatar points at registered elements, no model involved. */
    tours: z.array(tourSchema).max(20).default([]).refine(uniqueIds, 'ids de tour repetidos'),
    /** Shown only with `features.announcements`; presentation data, served to the page by Vex Core. */
    announcements: z.array(announcementSchema).max(50).default([]).refine(uniqueIds, 'ids de anuncio repetidos'),
    /** Shown only with `features.quickActions`; a tool button runs through policy and confirmation. */
    quickActions: z.array(quickActionSchema).max(12).default([]).refine(uniqueIds, 'ids de botón repetidos'),
  })
  .refine(
    (m) =>
      m.announcements.every((a) => {
        const cta = a.cta;
        return cta?.kind !== 'quickAction' || m.quickActions.some((q) => q.id === cta.id);
      }),
    { message: 'un anuncio apunta a un botón que no existe', path: ['announcements'] },
  );
export type HostManifest = z.infer<typeof hostManifestSchema>;
export type HostManifestInput = z.input<typeof hostManifestSchema>;

/**
 * What the studio signs for one integration: the tools and the highest risk the avatar's owner
 * allowed there. The signature covers the grant object as received; its shape is checked after.
 */
export const grantSchema = z.strictObject({
  integration: z.string().min(1),
  avatarId: z.string().min(1),
  revision: z.number().int().min(1),
  /** Exact origins (scheme://host[:port]) where the avatar may show; one of them must be this host. */
  origins: z.array(z.string().min(1)).min(1),
  tools: z.array(z.string().min(1).max(64)).max(200),
  maxRisk: riskSchema,
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});
export type Grant = z.infer<typeof grantSchema>;

export const signedGrantSchema = z.strictObject({
  grant: z.record(z.string(), z.unknown()),
  signature: z.string().regex(/^[A-Za-z0-9_-]{40,200}$/),
  keyId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
});
export type SignedGrant = z.infer<typeof signedGrantSchema>;

/** The grant layer a host applies when its avatar is configured but no valid grant is at hand: nothing runs. */
export const NO_GRANT: Pick<Grant, 'tools' | 'maxRisk'> = { tools: [], maxRisk: 'read' };

export function grantExpired(grant: Pick<Grant, 'expiresAt'>, nowMs: number): boolean {
  return Date.parse(grant.expiresAt) <= nowMs;
}

/** True when one of the grant's origins is on the host's domain (the studio ties a key to exact origins). */
export function grantMatchesHost(grant: Pick<Grant, 'origins'>, domain: string): boolean {
  return grant.origins.some((o) => {
    try {
      return new URL(o).hostname.toLowerCase() === domain.toLowerCase();
    } catch {
      return false;
    }
  });
}

/**
 * The one permission rule: what Vex may run = the tools a person approved (`tools`) ∩ the host's
 * policy ∩ the integration's grant. Each layer only removes; none can add a tool another one left
 * out. `grant` is omitted for a host without a studio avatar; a host with one and no valid grant
 * passes NO_GRANT. The policy still decides, call by call, whether a kept tool needs confirmation.
 */
export function permittedTools<T extends { name: string; driver: Driver; risk: Risk }>(tools: T[], policy: PermissionPolicy, grant?: Pick<Grant, 'tools' | 'maxRisk'>): T[] {
  return tools.filter((t) => decide(policy, t) !== 'deny' && (grant === undefined || (grant.tools.includes(t.name) && RISK_ORDER[t.risk] <= RISK_ORDER[grant.maxRisk])));
}
