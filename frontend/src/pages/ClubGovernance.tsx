import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout';
import { AppPage, AppPageHeader } from '../components/AppPage';
import AppStateCard from '../components/AppStateCard';
import DataTable from '../components/table/DataTable';
import type { DataTableColumn } from '../components/table/tableTypes';
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

type GovernanceOfficer = GovernanceSummaryResponse['officers'][number];

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

  const officerColumns: Array<DataTableColumn<GovernanceOfficer>> = useMemo(
    () => [
      {
        id: 'position',
        header: 'Position',
        renderCell: (officer) => (
          <span className="font-medium text-gray-900 dark:text-gray-100">
            {OFFICER_LABELS[officer.position]}
          </span>
        ),
      },
      {
        id: 'boardMember',
        header: 'Board member',
        renderCell: (officer) => boardMembersById.get(officer.boardMemberId)?.memberName ?? 'Unknown board member',
      },
      {
        id: 'email',
        header: 'Email',
        renderCell: (officer) => (
          <a
            href={`mailto:${OFFICER_EMAILS[officer.position]}`}
            className="text-primary-teal hover:underline"
          >
            {OFFICER_EMAILS[officer.position]}
          </a>
        ),
      },
    ],
    [boardMembersById]
  );

  const boardColumns: Array<DataTableColumn<GovernanceBoardMember>> = useMemo(
    () => [
      {
        id: 'name',
        header: 'Name',
        renderCell: (boardMember) => (
          <span className="font-medium text-gray-900 dark:text-gray-100">{boardMember.memberName}</span>
        ),
      },
      {
        id: 'publicEmail',
        header: 'Public email',
        renderCell: (boardMember) => boardMember.effectivePublicEmail ?? '—',
      },
      {
        id: 'term',
        header: 'Term',
        renderCell: (boardMember) => `${boardMember.firstFiscalYear}–${boardMember.lastFiscalYear}`,
      },
      {
        id: 'liaisonTo',
        header: 'Liaison to',
        renderCell: (boardMember) =>
          boardMember.committeeIds.length === 0
            ? '—'
            : boardMember.committeeIds
                .map((committeeId) => committeesById.get(committeeId)?.name ?? `Committee #${committeeId}`)
                .join(', '),
      },
    ],
    [committeesById]
  );

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

        {loading && <AppStateCard title="Loading governance data..." compact />}
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        {!loading && !error && data && (
          <>
            <section className="space-y-3">
              <h2 className="app-section-title">Officers</h2>
              <DataTable
                rows={data.officers}
                rowKey={(officer) => officer.position}
                columns={officerColumns}
                emptyState={<AppStateCard compact title="No officers are assigned." />}
              />
            </section>

            <section className="space-y-3">
              <h2 className="app-section-title">Board members</h2>
              <DataTable
                rows={activeBoardMembers}
                rowKey={(boardMember) => boardMember.id}
                columns={boardColumns}
                emptyState={<AppStateCard compact title="No active board members." />}
              />
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
