import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { AppPage, AppPageHeader } from '../../components/AppPage';
import AppPageControlsRow from '../../components/AppPageControlsRow';
import AppStateCard from '../../components/AppStateCard';
import BackButton from '../../components/BackButton';
import Button from '../../components/Button';
import FormField from '../../components/FormField';
import FormSection from '../../components/FormSection';
import InlineStateMessage from '../../components/InlineStateMessage';
import MemberMultiSelect from '../../components/MemberMultiSelect';
import DataTable from '../../components/table/DataTable';
import type { DataTableColumn, TableSort } from '../../components/table/tableTypes';
import { useAlert } from '../../contexts/AlertContext';
import { useAuth } from '../../contexts/AuthContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useMemberOptions } from '../../contexts/MemberOptionsContext';
import api, { formatApiError } from '../../utils/api';
import { formatClubDate } from '../../utils/clubTime';
import { memberCanManageCredentials } from '../../utils/credentialAccess';
import { isArchivedAt } from '../../utils/softDelete';
import {
  formatVolunteerDateOnly,
  localDateOnly,
  volunteerCredentialIsValidOn,
} from '../../utils/volunteering';
import {
  credentialHolderEmailEntries,
  type CredentialAdmin,
  type CredentialGrant,
} from './adminCredentialsShared';

type GrantSortKey = 'grantedAt' | 'name' | 'expiresAt';

export default function AdminMemberCredentialDetail() {
  const { credentialId } = useParams<{ credentialId: string }>();
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const { member } = useAuth();
  const { options: memberOptions } = useMemberOptions();
  const baseId = useId();
  const canAccess = memberCanManageCredentials(member);

  const [loading, setLoading] = useState(true);
  const [credential, setCredential] = useState<CredentialAdmin | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [grantMemberIds, setGrantMemberIds] = useState<number[]>([]);
  const [grantExpiresAt, setGrantExpiresAt] = useState('');
  const [granting, setGranting] = useState(false);
  const [revokingMemberId, setRevokingMemberId] = useState<number | null>(null);
  const [savingExpiresMemberId, setSavingExpiresMemberId] = useState<number | null>(null);
  const [sort, setSort] = useState<TableSort<GrantSortKey>>({ key: 'name', direction: 'asc' });

  const load = useCallback(async () => {
    if (!credentialId) return;
    setLoading(true);
    setNotFound(false);
    try {
      const res = await api.get(`/members/admin/credentials/${credentialId}`);
      const next = res.data?.credential as CredentialAdmin | undefined;
      if (!next) {
        setNotFound(true);
        setCredential(null);
        return;
      }
      setCredential(next);
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 404 || status === 403) {
        setNotFound(true);
        setCredential(null);
      } else {
        showAlert(formatApiError(err, 'Failed to load credential'), 'error');
      }
    } finally {
      setLoading(false);
    }
  }, [credentialId, showAlert]);

  useEffect(() => {
    void load();
  }, [load]);

  const today = localDateOnly();
  const archived = isArchivedAt(credential?.archivedAt);

  const patchCredential = (patch: (cred: CredentialAdmin) => CredentialAdmin) => {
    setCredential((prev) => (prev ? patch(prev) : prev));
  };

  const handleGrant = async () => {
    if (!credential || grantMemberIds.length === 0) return;
    const alreadyHeld = new Set(credential.grants.map((grant) => grant.memberId));
    const toGrant = grantMemberIds.filter((id) => !alreadyHeld.has(id));
    if (toGrant.length === 0) {
      setGrantMemberIds([]);
      return;
    }

    setGranting(true);
    const granted: CredentialGrant[] = [];
    const failures: string[] = [];
    try {
      for (const memberId of toGrant) {
        try {
          const res = await api.post(`/members/admin/credentials/${credential.id}/grants`, {
            memberId,
            expiresAt: grantExpiresAt.trim() || null,
          });
          const option = memberOptions.find((option) => option.id === memberId);
          granted.push({
            id: res.data.id as number,
            memberId,
            memberName: option?.name || `Member ${memberId}`,
            memberEmail: option?.email ?? null,
            grantedAt: new Date().toISOString(),
            grantedByMemberId: member?.id ?? null,
            expiresAt: (res.data.expiresAt as string | null | undefined) ?? (grantExpiresAt.trim() || null),
          });
        } catch (err) {
          failures.push(formatApiError(err, `Failed to grant to member ${memberId}`));
        }
      }

      if (granted.length > 0) {
        patchCredential((cred) => ({
          ...cred,
          grants: [...granted, ...cred.grants],
        }));
      }
      if (failures.length > 0) {
        showAlert(failures[0], 'error');
      }
      setGrantMemberIds([]);
    } finally {
      setGranting(false);
    }
  };

  const handleUpdateExpiresAt = async (memberId: number, expiresAt: string | null) => {
    if (!credential) return;
    const previous = credential.grants.find((grant) => grant.memberId === memberId)?.expiresAt ?? null;
    patchCredential((cred) => ({
      ...cred,
      grants: cred.grants.map((grant) => (grant.memberId === memberId ? { ...grant, expiresAt } : grant)),
    }));
    setSavingExpiresMemberId(memberId);
    try {
      await api.patch(`/members/admin/credentials/${credential.id}/grants/${memberId}`, {
        expiresAt,
      });
    } catch (err) {
      patchCredential((cred) => ({
        ...cred,
        grants: cred.grants.map((grant) =>
          grant.memberId === memberId ? { ...grant, expiresAt: previous } : grant
        ),
      }));
      showAlert(formatApiError(err, 'Failed to update expiration date'), 'error');
    } finally {
      setSavingExpiresMemberId(null);
    }
  };

  const handleRevoke = async (grant: CredentialGrant) => {
    if (!credential) return;
    const ok = await confirm({
      title: 'Revoke credential',
      message: `Revoke "${credential.name}" from ${grant.memberName}?`,
      variant: 'danger',
    });
    if (!ok) return;
    setRevokingMemberId(grant.memberId);
    try {
      await api.delete(`/members/admin/credentials/${credential.id}/grants/${grant.memberId}`);
      patchCredential((cred) => ({
        ...cred,
        grants: cred.grants.filter((row) => row.memberId !== grant.memberId),
      }));
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to revoke credential'), 'error');
    } finally {
      setRevokingMemberId(null);
    }
  };

  const handleCopyEmails = async () => {
    if (!credential) return;
    const entries = credentialHolderEmailEntries(credential.grants, today);
    if (entries.length === 0) {
      showAlert('No holder emails to copy', 'warning');
      return;
    }
    try {
      await navigator.clipboard.writeText(entries.join(', '));
      showAlert('Holder emails copied', 'success');
    } catch {
      showAlert('Failed to copy emails', 'error');
    }
  };

  const sortedGrants = useMemo(() => {
    if (!credential) return [];
    const rows = [...credential.grants];
    const direction = sort.direction === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      if (sort.key === 'name') {
        return a.memberName.localeCompare(b.memberName) * direction;
      }
      if (sort.key === 'grantedAt') {
        return a.grantedAt.localeCompare(b.grantedAt) * direction;
      }
      return (a.expiresAt ?? '').localeCompare(b.expiresAt ?? '') * direction;
    });
    return rows;
  }, [credential, sort]);

  const columns: Array<DataTableColumn<CredentialGrant, GrantSortKey>> = [
      {
        id: 'grantedAt',
        header: 'Grant date',
        sortable: true,
        sortKey: 'grantedAt',
        renderCell: (row) => formatClubDate(row.grantedAt) || '—',
      },
      {
        id: 'name',
        header: 'Name',
        sortable: true,
        sortKey: 'name',
        cellClassName: 'min-w-[12rem]',
        renderCell: (row) => (
          <div>
            <div className="font-medium text-gray-900 dark:text-gray-100">{row.memberName}</div>
            {row.memberEmail ? (
              <div className="text-sm text-gray-600 dark:text-gray-400">{row.memberEmail}</div>
            ) : null}
          </div>
        ),
      },
      {
        id: 'expiresAt',
        header: 'Expiration date',
        sortable: true,
        sortKey: 'expiresAt',
        renderCell: (row) => {
          const expired = !volunteerCredentialIsValidOn(row.expiresAt, today);
          const expiresInputId = `${baseId}-grant-expires-${row.id}`;
          return (
            <div className="space-y-1">
              <label className="sr-only" htmlFor={expiresInputId}>
                Expiration date for {row.memberName}
              </label>
              <input
                id={expiresInputId}
                type="date"
                className="app-input w-full max-w-xs"
                value={row.expiresAt ?? ''}
                disabled={savingExpiresMemberId === row.memberId}
                onChange={(e) => {
                  void handleUpdateExpiresAt(row.memberId, e.target.value.trim() || null);
                }}
              />
              {expired && row.expiresAt ? (
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  Expired {formatVolunteerDateOnly(row.expiresAt)}
                </p>
              ) : null}
            </div>
          );
        },
      },
    ];

  if (!canAccess) {
    return <Navigate to="/admin/members/credentials" replace />;
  }

  if (loading) {
    return (
      <AppPage>
        <AppPageHeader
          title="Credential"
          actions={<BackButton label="Back to credentials" to="/admin/members/credentials" />}
        />
        <AppStateCard title="Loading credential..." />
      </AppPage>
    );
  }

  if (notFound || !credential) {
    return (
      <AppPage>
        <AppPageHeader
          title="Credential"
          actions={<BackButton label="Back to credentials" to="/admin/members/credentials" />}
        />
        <AppStateCard
          title="Credential not found"
          description="This credential may have been removed, or you do not have permission to manage it."
        />
      </AppPage>
    );
  }

  return (
    <AppPage>
      <AppPageHeader
        title={credential.name}
        description={credential.description || undefined}
        actions={<BackButton label="Back to credentials" to="/admin/members/credentials" />}
      />

      {credential.systemKey ? (
        <FormSection title="Grants" surface="panel">
          <InlineStateMessage
            title="Granted automatically"
            description={
              credential.systemGrantRule ||
              'Members receive this credential when they meet its conditions. It cannot be granted or revoked by hand.'
            }
          />
        </FormSection>
      ) : (
        <div className="space-y-4">
          <FormSection title="Grant credential" surface="panel">
            {archived ? (
              <InlineStateMessage
                title="This credential is archived"
                description="Restore it from the credentials list before granting it to members."
              />
            ) : (
              <>
                <FormField label="Grant to members" htmlFor={`${baseId}-grant`}>
                  <MemberMultiSelect
                    inputId={`${baseId}-grant`}
                    selectedIds={grantMemberIds}
                    onChange={setGrantMemberIds}
                    placeholder="Search members to grant..."
                  />
                </FormField>
                <FormField
                  label="Expiration date"
                  htmlFor={`${baseId}-grant-expires`}
                  optional
                  helperText="Leave blank if this credential does not expire. Valid through the selected date."
                >
                  <input
                    id={`${baseId}-grant-expires`}
                    type="date"
                    className="app-input w-full max-w-xs"
                    value={grantExpiresAt}
                    onChange={(e) => setGrantExpiresAt(e.target.value)}
                  />
                </FormField>
                <Button
                  type="button"
                  disabled={grantMemberIds.length === 0 || granting}
                  onClick={() => void handleGrant()}
                >
                  {granting
                    ? 'Granting…'
                    : grantMemberIds.length > 1
                      ? 'Grant credentials'
                      : 'Grant credential'}
                </Button>
              </>
            )}
          </FormSection>

          {credential.grants.length === 0 ? (
            <InlineStateMessage title="No members hold this credential yet." />
          ) : (
            <>
              <AppPageControlsRow
                right={
                  <Button type="button" variant="secondary" onClick={() => void handleCopyEmails()}>
                    Copy emails
                  </Button>
                }
              />
              <DataTable
                rows={sortedGrants}
                rowKey={(row) => row.id}
                columns={columns}
                sort={sort}
                onSortChange={setSort}
                emptyState={<InlineStateMessage title="No members hold this credential yet." />}
                actions={{
                  widthClassName: 'w-[7rem]',
                  renderActions: (row) => (
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={revokingMemberId === row.memberId}
                      onClick={() => void handleRevoke(row)}
                    >
                      {revokingMemberId === row.memberId ? 'Revoking…' : 'Revoke'}
                    </Button>
                  ),
                }}
              />
            </>
          )}
        </div>
      )}
    </AppPage>
  );
}
