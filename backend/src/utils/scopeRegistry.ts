/**
 * Canonical list of permission scopes for documentation and admin pickers.
 * Keep in sync with route checks (hasScope) and RBAC seed data in schema.ts.
 */
export type ScopeRegistryEntry = {
  scope: string;
  description: string;
  category: string;
};

export const SCOPE_REGISTRY: ScopeRegistryEntry[] = [
  {
    scope: '*',
    category: 'Wildcards',
    description: 'Matches every scope. Use with extreme care; typically reserved for break-glass server configuration.',
  },
  {
    scope: 'leagues.*',
    category: 'Wildcards',
    description: 'All scopes under the leagues namespace (e.g. leagues.read, leagues.manage). Used for contextual league-admin rules.',
  },

  { scope: 'public.read', category: 'Public', description: 'Anonymous access to public site content.' },
  { scope: 'articles.read', category: 'Public', description: 'Read published articles and news-style content.' },
  { scope: 'calendar.read_public', category: 'Public', description: 'View public calendar information.' },
  { scope: 'contact.submit', category: 'Public', description: 'Submit contact or inquiry forms.' },

  { scope: 'dashboard.read', category: 'Member', description: 'View the signed-in member dashboard.' },
  { scope: 'profile.manage_self', category: 'Member', description: 'Update own profile and preferences.' },
  { scope: 'members.read', category: 'Member', description: 'View member directory and member-related read APIs.' },
  { scope: 'leagues.read', category: 'Member', description: 'View leagues and league-related read APIs.' },
  { scope: 'calendar.read', category: 'Member', description: 'View full member calendar (beyond public-only).' },
  { scope: 'governance.read', category: 'Member', description: 'Read governance documents and policies.' },
  { scope: 'feedback.submit', category: 'Member', description: 'Submit feedback to the club.' },
  { scope: 'spares.read', category: 'Member', description: 'View spare player listings and opportunities.' },
  { scope: 'spares.respond', category: 'Member', description: 'Respond to spare requests as a player.' },
  { scope: 'availability.manage_self', category: 'Member', description: 'Manage own availability for spare matching.' },
  { scope: 'member.active', category: 'Member', description: 'Computed: member account is active (valid membership).' },
  {
    scope: 'member.ice_privileges',
    category: 'Member',
    description: 'Computed: member may use ice-related features (non–social member with privileges).',
  },

  { scope: 'spares.request', category: 'Ice & spares', description: 'Create spare requests for a team or sheet.' },
  { scope: 'ice_bookings.manage_own', category: 'Ice & spares', description: 'Book and manage own ice time bookings.' },

  { scope: 'admin.manage', category: 'Administration', description: 'Full application administration (server admin UI, sensitive settings).' },
  { scope: 'members.manage', category: 'Administration', description: 'Create, update, and manage member records.' },
  { scope: 'governance.manage', category: 'Administration', description: 'Manage governance content and related settings.' },
  { scope: 'feedback.manage', category: 'Administration', description: 'View and manage submitted feedback.' },

  { scope: 'calendar.manage', category: 'Operations', description: 'Manage calendar entries and scheduling content.' },
  { scope: 'content.manage', category: 'Operations', description: 'Manage site content (pages, CMS-style resources).' },
  { scope: 'files.manage', category: 'Operations', description: 'Upload and manage file assets.' },
  { scope: 'sponsorship.manage', category: 'Operations', description: 'Manage sponsors and sponsorship content.' },
  { scope: 'payments.read', category: 'Payments', description: 'Read payment orders, webhook events, transactions, and refund records.' },
  { scope: 'payments.manage', category: 'Payments', description: 'Manage payment operations such as manual transitions and refunds.' },

  { scope: 'leagues.manage', category: 'Leagues', description: 'Manage leagues globally or in a scoped context (league id).' },

  { scope: 'events.read', category: 'Events', description: 'View events and event registration data.' },
  { scope: 'events.manage', category: 'Events', description: 'Create, edit, delete events and manage registrations.' },
];

const byScope = new Map(SCOPE_REGISTRY.map((entry) => [entry.scope, entry]));

export function getScopeRegistry(): ScopeRegistryEntry[] {
  return SCOPE_REGISTRY;
}

export function isDocumentedScope(scope: string): boolean {
  return byScope.has(scope);
}

export function getScopeDocumentation(scope: string): ScopeRegistryEntry | undefined {
  return byScope.get(scope);
}
