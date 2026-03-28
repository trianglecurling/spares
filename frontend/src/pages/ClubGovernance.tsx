import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout';
import { AppPage, AppPageHeader } from '../components/AppPage';
import api from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { deserializeCommitteeContactInfo } from '../utils/governanceContactInfo';
import {
  GovernanceBoardMember,
  GovernanceCommittee,
  GovernanceOfficerPosition,
  GovernanceSummaryResponse,
  OFFICER_LABELS,
} from '../types/governance';

const OFFICER_EMAILS: Record<GovernanceOfficerPosition, string> = {
  president: 'president@trianglecurling.com',
  vice_president: 'vp@trianglecurling.com',
  treasurer: 'treasurer@trianglecurling.com',
  secretary: 'secretary@trianglecurling.com',
};

function formatCommitteeContactDisplay(contactInfo: string | null): string {
  const parsed = deserializeCommitteeContactInfo(contactInfo);
  const parts: string[] = [];
  if (parsed.emails.length > 0) parts.push(`Emails: ${parsed.emails.join(', ')}`);
  if (parsed.slackChannels.length > 0) parts.push(`Slack: ${parsed.slackChannels.join(', ')}`);
  if (parsed.note) parts.push(parsed.note);
  return parts.join(' | ') || 'None';
}

export default function ClubGovernance() {
  const { member } = useAuth();
  const [data, setData] = useState<GovernanceSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get<GovernanceSummaryResponse>('/governance')
      .then((response) => {
        if (!cancelled) {
          setData(response.data);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message =
          typeof err === 'object' && err !== null && 'response' in err
            ? String((err as { response?: { data?: { error?: string } } }).response?.data?.error ?? 'Unable to load club governance.')
            : 'Unable to load club governance.';
        setError(message);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const boardMembersById = useMemo(() => {
    const map = new Map<number, GovernanceBoardMember>();
    for (const boardMember of data?.boardMembers ?? []) {
      map.set(boardMember.id, boardMember);
    }
    return map;
  }, [data?.boardMembers]);

  const activeBoardMembers = useMemo(() => {
    const active = (data?.boardMembers ?? []).filter((bm) => bm.isActive);
    active.sort((a, b) => {
      if (a.lastFiscalYear !== b.lastFiscalYear) return a.lastFiscalYear - b.lastFiscalYear;
      return a.memberName.localeCompare(b.memberName);
    });
    return active;
  }, [data?.boardMembers]);

  const committeesById = useMemo(() => {
    const map = new Map<number, GovernanceCommittee>();
    for (const committee of data?.committees ?? []) {
      map.set(committee.id, committee);
    }
    return map;
  }, [data?.committees]);

  return (
    <Layout>
      <AppPage>
        <AppPageHeader
          title="Club governance"
          description="Current board members, officers, and committee details."
          actions={
            (member?.isAdmin || member?.isServerAdmin) && (
              <Link
                to="/admin/governance"
                className="inline-flex rounded-lg bg-primary-teal px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-teal/90"
              >
                Manage governance
              </Link>
            )
          }
        />

        {loading && <p className="text-sm text-gray-600 dark:text-gray-400">Loading governance data...</p>}
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        {!loading && !error && data && (
          <>
            <section className="space-y-3">
              <h2 className="app-section-title">Officers</h2>
              <div className="app-table-shell">
                <table className="app-table text-sm">
                  <thead className="app-table-head">
                    <tr>
                      <th className="app-table-th">Position</th>
                      <th className="app-table-th">Board member</th>
                      <th className="app-table-th">Email</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {data.officers.length === 0 && (
                      <tr>
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400" colSpan={3}>
                          No officers are assigned.
                        </td>
                      </tr>
                    )}
                    {data.officers.map((officer) => (
                      <tr key={officer.position}>
                        <td className="app-table-td font-medium text-gray-900 dark:text-gray-100">
                          {OFFICER_LABELS[officer.position]}
                        </td>
                        <td className="app-table-td">
                          {boardMembersById.get(officer.boardMemberId)?.memberName ?? 'Unknown board member'}
                        </td>
                        <td className="app-table-td">
                          <a
                            href={`mailto:${OFFICER_EMAILS[officer.position]}`}
                            className="text-primary-teal hover:underline"
                          >
                            {OFFICER_EMAILS[officer.position]}
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="app-section-title">Board members</h2>
              <div className="app-table-shell">
                <table className="app-table text-sm">
                  <thead className="app-table-head">
                    <tr>
                      <th className="app-table-th">Name</th>
                      <th className="app-table-th">Public email</th>
                      <th className="app-table-th">Term</th>
                      <th className="app-table-th">Liaison to</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {activeBoardMembers.length === 0 && (
                      <tr>
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400" colSpan={4}>
                          No active board members.
                        </td>
                      </tr>
                    )}
                    {activeBoardMembers.map((boardMember) => (
                      <tr key={boardMember.id}>
                        <td className="app-table-td font-medium text-gray-900 dark:text-gray-100">
                          {boardMember.memberName}
                        </td>
                        <td className="app-table-td">{boardMember.effectivePublicEmail ?? '—'}</td>
                        <td className="app-table-td">
                          {boardMember.firstFiscalYear}–{boardMember.lastFiscalYear}
                        </td>
                        <td className="app-table-td">
                          {boardMember.committeeIds.length === 0
                            ? '—'
                            : boardMember.committeeIds
                                .map((committeeId) => committeesById.get(committeeId)?.name ?? `Committee #${committeeId}`)
                                .join(', ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="app-section-title">Committees</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {data.committees.length === 0 && (
                  <p className="text-sm text-gray-500 dark:text-gray-400">No committees configured.</p>
                )}
                {data.committees.map((committee) => (
                  <article
                    key={committee.id}
                    className="app-card space-y-2"
                  >
                    <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">{committee.name}</h3>
                    <p className="text-sm text-gray-700 dark:text-gray-300">
                      <span className="font-medium">Board liaison:</span>{' '}
                      {committee.boardLiaisonBoardMemberId
                        ? (boardMembersById.get(committee.boardLiaisonBoardMemberId)?.memberName ?? 'Unknown board member')
                        : 'Not assigned'}
                    </p>
                    <p className="text-sm text-gray-700 dark:text-gray-300">
                      <span className="font-medium">Chairs:</span>{' '}
                      {committee.chairs.length > 0
                        ? committee.chairs.map((chair) => chair.memberName).join(', ')
                        : 'None'}
                    </p>
                    <p className="text-sm text-gray-700 dark:text-gray-300">
                      <span className="font-medium">Contact info:</span>{' '}
                      {formatCommitteeContactDisplay(committee.contactInfo)}
                    </p>
                    <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                      <span className="font-medium">Responsibilities:</span>{' '}
                      {committee.responsibilities || 'Not specified'}
                    </p>
                  </article>
                ))}
              </div>
            </section>
          </>
        )}
      </AppPage>
    </Layout>
  );
}
