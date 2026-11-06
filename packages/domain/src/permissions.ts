/** Permissions are a fixed list; roles are named combinations of them. */
export const PERMISSIONS = [
  'table.work',
  'district.watch',
  'incident.manage',
  'tally.correct',
  'team.invite',
  'semaphore.read',
  'semaphore.write',
  'semaphore.sensitive',
  'stats.read',
  'election.manage',
  'users.manage',
  'persons.manage',
  'security.manage',
  'audit.read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = {
  /** Looks after one table: sees only its roll. */
  fiscal: ['table.work'],
  /** Helps several poll watchers and receives their alerts. */
  jefe: ['district.watch', 'incident.manage', 'tally.correct', 'team.invite'],
  /** Notes who votes for the party. Sensitive categories take the role below as well. */
  semaforo: ['semaphore.read', 'semaphore.write'],
  semaforo_sensible: ['semaphore.sensitive'],
  /** Sees numbers, never a name. */
  estadistico: ['stats.read'],
  /** Runs the party's elections. */
  coordinacion: ['election.manage', 'users.manage', 'team.invite', 'district.watch', 'incident.manage', 'tally.correct', 'semaphore.read', 'semaphore.write', 'stats.read', 'persons.manage', 'audit.read'],
  /** Runs the system. On purpose, this role alone does not see rolls or political data. */
  sistema: ['users.manage', 'security.manage', 'audit.read'],
} as const satisfies Record<string, readonly Permission[]>;

export type Role = keyof typeof ROLES;

export const isRole = (value: unknown): value is Role => typeof value === 'string' && value in ROLES;

export function rolesCan(roles: readonly Role[], permission: Permission): boolean {
  return roles.some((role) => (ROLES[role] as readonly Permission[]).includes(permission));
}

/** Which work a person sees first, when they have several roles. */
export const ROLE_PRIORITY: readonly Role[] = ['coordinacion', 'sistema', 'jefe', 'semaforo', 'estadistico', 'fiscal'];

export function mainRole(roles: readonly Role[]): Role | null {
  return ROLE_PRIORITY.find((role) => roles.includes(role)) ?? null;
}

/**
 * Sensitive categories are always sealed, whatever the profile. A roll read with an external AI is loaded with a warning,
 * loaded only after confirming it was a paid service that keeps nothing (the roll cannot prove it), or refused.
 * After the close, the phone keeps the roll at most `localHoursAfterClose` hours.
 */
export const SECURITY_PROFILES = {
  /** A university or student election. */
  estudiantil: { documentDigits: 8, secondFactor: false, fiscalSeesSemaphore: true, externalAi: 'warn', localHoursAfterClose: 12 },
  /** A municipal or provincial election. */
  local: { documentDigits: 3, secondFactor: true, fiscalSeesSemaphore: false, externalAi: 'paid-only', localHoursAfterClose: 6 },
  /** A national election. */
  nacional: { documentDigits: 3, secondFactor: true, fiscalSeesSemaphore: false, externalAi: 'forbidden', localHoursAfterClose: 0 },
} as const;

export type SecurityProfile = keyof typeof SECURITY_PROFILES;

/** From the least to the most careful. */
const STRICTNESS = Object.keys(SECURITY_PROFILES) as SecurityProfile[];

export const stricterProfile = (a: SecurityProfile, b: SecurityProfile | null): SecurityProfile => (b && STRICTNESS.indexOf(b) > STRICTNESS.indexOf(a) ? b : a);

export const isSecurityProfile = (value: unknown): value is SecurityProfile => typeof value === 'string' && value in SECURITY_PROFILES;

/** The roles a party edited. A role that is not here has the recommended permissions. */
export type RoleOverrides = Partial<Record<Role, readonly Permission[]>>;

export const permissionsOf = (roles: readonly Role[], overrides: RoleOverrides = {}): Permission[] => [
  ...new Set(roles.flatMap((role): readonly Permission[] => overrides[role] ?? ROLES[role])),
];

/** Without these, nobody could give back what was taken away. */
export const PERMISSIONS_KEPT: Partial<Record<Role, readonly Permission[]>> = { sistema: ['users.manage', 'security.manage'] };
