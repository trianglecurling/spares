import type { AuthenticatedMember } from '../../../backend/src/types.ts';
import { memberHasScope } from './permissions';

export type MemberNavLink = { to: string; label: string };

export function getAdminLinks(member: AuthenticatedMember | null): MemberNavLink[] {
  if (!member) return [];

  const canManageLeagues = memberHasScope(member, 'leagues.manage');
  const canManageMembers = memberHasScope(member, 'members.manage');
  const canManageContent = memberHasScope(member, 'content.manage');
  const canManageGovernance = memberHasScope(member, 'governance.manage');
  const canManageSponsorship = memberHasScope(member, 'sponsorship.manage');
  const canManageEvents = memberHasScope(member, 'events.manage');
  const canAccessEventsAdmin = canManageEvents || (member.ownedEventIds?.length ?? 0) > 0;
  const canManageVolunteering = memberHasScope(member, 'volunteering.manage');
  const canManageRegistration = memberHasScope(member, 'admin.manage');
  const canManageRegistrations =
    memberHasScope(member, 'registrations.manage') || memberHasScope(member, 'admin.manage');
  const canManageWebhooks = memberHasScope(member, 'admin.manage');
  const canReadPayments = memberHasScope(member, 'payments.read');
  const canManageServerConfig = Boolean(member.isServerAdmin);
  const canManageWaivers =
    memberHasScope(member, 'members.manage') || memberHasScope(member, 'events.manage');

  return [
    ...(canManageMembers ? [{ to: '/admin/members', label: 'Manage members' }] : []),
    ...(canManageWaivers ? [{ to: '/admin/waivers', label: 'Manage waivers' }] : []),
    ...(canManageLeagues ? [{ to: '/admin/sheets', label: 'Manage sheets' }] : []),
    ...(canManageContent ? [{ to: '/admin/content', label: 'Manage content' }] : []),
    ...(canManageGovernance ? [{ to: '/admin/governance', label: 'Manage governance' }] : []),
    ...(canAccessEventsAdmin ? [{ to: '/admin/events', label: 'Manage events' }] : []),
    ...(canManageVolunteering ? [{ to: '/admin/volunteering', label: 'Manage volunteering' }] : []),
    ...(canManageRegistrations || canManageRegistration
      ? [{ to: '/admin/registrations', label: 'Manage registration' }]
      : []),
    ...(canManageSponsorship ? [{ to: '/admin/sponsorship', label: 'Manage sponsorships' }] : []),
    ...(canReadPayments ? [{ to: '/admin/payments', label: 'Manage payments' }] : []),
    ...(canManageWebhooks ? [{ to: '/admin/webhooks', label: 'Outbound webhooks' }] : []),
    ...(canManageServerConfig ? [{ to: '/admin/roles', label: 'Manage roles' }] : []),
    ...(canManageServerConfig ? [{ to: '/admin/config', label: 'Server config' }] : []),
  ];
}
