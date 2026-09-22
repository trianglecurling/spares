import { useCallback, useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { HiClipboardDocument, HiEye, HiEyeSlash } from 'react-icons/hi2';
import AppPageControlsRow from '../../components/AppPageControlsRow';
import AppStateCard from '../../components/AppStateCard';
import Button from '../../components/Button';
import ChoiceInput from '../../components/ChoiceInput';
import FormCheckbox from '../../components/FormCheckbox';
import FormField from '../../components/FormField';
import FormSection from '../../components/FormSection';
import DataTable from '../../components/table/DataTable';
import type { DataTableColumn } from '../../components/table/tableTypes';
import { useAlert } from '../../contexts/AlertContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import api, { formatApiError, getApiErrorMessage } from '../../utils/api';

type RegistrationSession = {
  id: number;
  seasonId: number;
  seasonName: string;
  name: string;
  isDefault: boolean;
};

type SpecialLinkRow = {
  id: number;
  token: string;
  label: string | null;
  email: string;
  allowLeagueRegistration: boolean;
  allowedLeagueIds: number[] | null;
  used: boolean;
  invalidated: boolean;
  usedByRegistrationId: number | null;
  createdAt: string;
  usedAt: string | null;
  registrationUrl: string;
};

type LeagueOption = { id: number; name: string };

function linkStatusLabel(link: SpecialLinkRow): string {
  if (link.invalidated) return 'Invalidated';
  if (link.used) return 'Used';
  return 'Active';
}

export default function AdminRegistrationSpecialLinks() {
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();
  const sessionFieldId = useId();
  const emailId = useId();
  const labelId = useId();
  const leaguesId = useId();

  const [sessions, setSessions] = useState<RegistrationSession[]>([]);
  const [leagues, setLeagues] = useState<LeagueOption[]>([]);
  const [links, setLinks] = useState<SpecialLinkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [email, setEmail] = useState('');
  const [label, setLabel] = useState('');
  const [allowLeagueRegistration, setAllowLeagueRegistration] = useState(false);
  const [allowedLeagueIds, setAllowedLeagueIds] = useState<number[]>([]);
  const [revealedLinks, setRevealedLinks] = useState<Set<number>>(new Set());
  const [copiedLinkId, setCopiedLinkId] = useState<number | null>(null);

  const sessionId = searchParams.get('sessionId') ?? '';

  const sessionOptions = useMemo(
    () =>
      sessions.map((session) => ({
        value: String(session.id),
        label: `${session.seasonName} / ${session.name}`,
      })),
    [sessions],
  );

  const leagueOptions = useMemo(
    () => leagues.map((league) => ({ value: league.id, label: league.name })),
    [leagues],
  );

  const leagueNameById = useMemo(() => new Map(leagues.map((league) => [league.id, league.name])), [leagues]);

  const loadSessions = useCallback(async () => {
    const response = await api.get<{ sessions: RegistrationSession[]; defaultSessionId: number | null }>(
      '/registration/staff/sessions',
    );
    setSessions(response.data.sessions);
    if (!sessionId && response.data.defaultSessionId) {
      setSearchParams({ sessionId: String(response.data.defaultSessionId) }, { replace: true });
    }
  }, [sessionId, setSearchParams]);

  const loadLinks = useCallback(async () => {
    if (!sessionId) {
      setLinks([]);
      setLeagues([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<{ links: SpecialLinkRow[]; leagues: LeagueOption[] }>(
        '/registration/staff/special-links',
        { params: { sessionId } },
      );
      setLinks(response.data.links);
      setLeagues(response.data.leagues);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Unable to load special registration links.'));
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void loadSessions().catch((err) => setError(getApiErrorMessage(err, 'Unable to load sessions.')));
  }, [loadSessions]);

  useEffect(() => {
    void loadLinks();
  }, [loadLinks]);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setFieldErrors({});
    if (!sessionId) {
      setFieldErrors({ sessionId: 'Select a session.' });
      return;
    }
    setSubmitting(true);
    try {
      const response = await api.post<SpecialLinkRow>('/registration/staff/special-links', {
        sessionId: Number(sessionId),
        email,
        label: label.trim() || null,
        allowLeagueRegistration,
        allowedLeagueIds: allowLeagueRegistration ? allowedLeagueIds : null,
      });
      setLinks((current) => [response.data, ...current]);
      setRevealedLinks((current) => new Set(current).add(response.data.id));
      setEmail('');
      setLabel('');
      setAllowLeagueRegistration(false);
      setAllowedLeagueIds([]);
      showAlert('Special registration link created', 'success');
    } catch (err) {
      const details = (err as { response?: { data?: { details?: Record<string, string> } } }).response?.data?.details;
      if (details && typeof details === 'object') {
        setFieldErrors(details);
      }
      showAlert(formatApiError(err, 'Failed to create special registration link'), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleInvalidate(linkId: number) {
    const confirmed = await confirm({ message: 'Invalidate this special registration link?', title: 'Invalidate' });
    if (!confirmed) return;
    try {
      await api.delete(`/registration/staff/special-links/${linkId}`);
      setLinks((current) => current.map((link) => (link.id === linkId ? { ...link, invalidated: true } : link)));
      showAlert('Link invalidated', 'success');
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to invalidate special registration link'), 'error');
    }
  }

  function getLinkUrl(link: SpecialLinkRow) {
    try {
      const parsed = new URL(link.registrationUrl);
      return `${window.location.origin}${parsed.pathname}${parsed.search}`;
    } catch {
      return `${window.location.origin}/registration/start?slk=${encodeURIComponent(link.token)}`;
    }
  }

  async function copyLink(link: SpecialLinkRow) {
    const url = getLinkUrl(link);
    await navigator.clipboard.writeText(url);
    setCopiedLinkId(link.id);
    window.setTimeout(() => setCopiedLinkId((current) => (current === link.id ? null : current)), 1500);
  }

  const columns: Array<DataTableColumn<SpecialLinkRow>> = useMemo(
    () => [
      {
        id: 'label',
        header: 'Label',
        renderCell: (link) => link.label || '(no label)',
      },
      {
        id: 'email',
        header: 'Email',
        renderCell: (link) => link.email,
      },
      {
        id: 'leagues',
        header: 'Leagues',
        renderCell: (link) =>
          link.allowLeagueRegistration
            ? (link.allowedLeagueIds ?? [])
                .map((id) => leagueNameById.get(id) ?? `League ${id}`)
                .join(', ')
            : 'Membership only',
      },
      {
        id: 'status',
        header: 'Status',
        renderCell: (link) =>
          link.usedByRegistrationId ? (
            <Link to={`/admin/registrations/${link.usedByRegistrationId}`} className="text-primary-teal-link hover:underline">
              {linkStatusLabel(link)}
            </Link>
          ) : (
            linkStatusLabel(link)
          ),
      },
      {
        id: 'link',
        header: 'Link',
        cellClassName: 'text-sm',
        renderCell: (link) => {
          const revealed = revealedLinks.has(link.id);
          const copied = copiedLinkId === link.id;
          return (
            <div className="flex items-center gap-1.5">
              {revealed ? (
                <code className="select-all break-all rounded bg-gray-100 px-1.5 py-0.5 text-xs dark:bg-gray-700">
                  {getLinkUrl(link)}
                </code>
              ) : (
                <span className="text-xs italic text-gray-400 dark:text-gray-500">Hidden</span>
              )}
              <button
                type="button"
                onClick={() =>
                  setRevealedLinks((current) => {
                    const next = new Set(current);
                    if (next.has(link.id)) next.delete(link.id);
                    else next.add(link.id);
                    return next;
                  })
                }
                className="shrink-0 rounded p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                title={revealed ? 'Hide link' : 'Reveal link'}
              >
                {revealed ? <HiEyeSlash className="h-4 w-4" /> : <HiEye className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={() => void copyLink(link)}
                className="shrink-0 rounded p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                title={copied ? 'Copied' : 'Copy link'}
              >
                <HiClipboardDocument className="h-4 w-4" />
              </button>
            </div>
          );
        },
      },
    ],
    [copiedLinkId, leagueNameById, revealedLinks],
  );

  return (
    <>
      <AppPageControlsRow
        left={
          <FormField label="Session" htmlFor={sessionFieldId}>
            <ChoiceInput
              inputId={sessionFieldId}
              layout="popover"
              value={sessionId}
              onChange={(value) => {
                const next = Array.isArray(value) ? value[0] : value;
                if (!next) return;
                setSearchParams({ sessionId: String(next) });
              }}
              options={sessionOptions}
              placeholder="Select session"
            />
          </FormField>
        }
      />

      <div className="app-card-subtle">
        <form onSubmit={handleCreate}>
          <FormSection
            title="Create special registration link"
            description="Special links work even when registration is closed. Each link is assigned to one email address and can be used once."
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Registrant email" htmlFor={emailId} required error={fieldErrors.email}>
                <input
                  id={emailId}
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="app-input"
                  autoComplete="email"
                  required
                />
              </FormField>
              <FormField
                label="Label"
                htmlFor={labelId}
                helperText="Optional internal label so staff can recognize this invite."
              >
                <input
                  id={labelId}
                  type="text"
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  className="app-input"
                  placeholder="e.g. Late returning member"
                />
              </FormField>
            </div>
            <FormCheckbox
              label="Allow league registration"
              checked={allowLeagueRegistration}
              onChange={(checked) => {
                setAllowLeagueRegistration(checked);
                if (!checked) setAllowedLeagueIds([]);
              }}
              helperText="If off, the registrant can only choose basic ice, regular with no ice, or social membership."
            />
            {allowLeagueRegistration ? (
              <FormField
                label="Available leagues"
                htmlFor={leaguesId}
                required
                error={fieldErrors.allowedLeagueIds}
                helperText="The registrant can only choose from these leagues."
              >
                <ChoiceInput<number>
                  inputId={leaguesId}
                  options={leagueOptions}
                  value={allowedLeagueIds}
                  onChange={(next) => setAllowedLeagueIds(Array.isArray(next) ? next : next != null ? [next] : [])}
                  maxSelectedItems={null}
                  listboxLabel="Available leagues"
                  placeholder={leagueOptions.length === 0 ? 'No leagues in this session' : 'Select leagues…'}
                  disabled={leagueOptions.length === 0}
                />
              </FormField>
            ) : null}
            <div className="flex justify-end">
              <Button type="submit" disabled={submitting || !sessionId}>
                {submitting ? 'Creating…' : 'Create link'}
              </Button>
            </div>
          </FormSection>
        </form>
      </div>

      {loading ? (
        <AppStateCard title="Loading special registration links" description="Fetching invites for this session." />
      ) : null}
      {error ? (
        <AppStateCard
          title="Unable to load special registration links"
          description={error}
          action={<Button onClick={() => void loadLinks()}>Try again</Button>}
        />
      ) : null}
      {!loading && !error ? (
        <DataTable
          rows={links}
          rowKey={(link) => link.id}
          columns={columns}
          emptyState={
            <AppStateCard
              compact
              title="No special registration links"
              description="Create a link to invite someone to register while registration is closed."
            />
          }
          actions={{
            widthClassName: 'w-[7rem]',
            renderActions: (link) =>
              !link.invalidated && !link.used ? (
                <button
                  type="button"
                  onClick={() => void handleInvalidate(link.id)}
                  className="text-xs text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                >
                  Invalidate
                </button>
              ) : null,
          }}
        />
      ) : null}
    </>
  );
}
