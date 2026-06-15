import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { AppPage, AppPageHeader } from '../../components/AppPage';
import AppStateCard from '../../components/AppStateCard';
import PageTabs from '../../components/PageTabs';
import Button from '../../components/Button';
import ChoiceInput, { type ChoiceOption } from '../../components/ChoiceInput';
import FormField from '../../components/FormField';
import { useAlert } from '../../contexts/AlertContext';
import { useAuth } from '../../contexts/AuthContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { del, get, patch, post } from '../../api/client';
import { formatApiError } from '../../utils/api';
import { memberHasScope } from '../../utils/permissions';
import AdminRegistrationCommunicationsPanel from './AdminRegistrationCommunicationsPanel';
import AdminRegistrationsList from './AdminRegistrationsList';

type RegistrationState = 'closed' | 'priority' | 'open';

interface Season {
  id: number;
  name: string;
  startDate: string;
  endDate: string;
}

interface Session {
  id: number;
  seasonId: number;
  name: string;
  startDate: string;
  endDate: string;
}

interface RegistrationStateTransition {
  id: number;
  seasonId: number;
  sessionId: number;
  effectiveAt: string;
  state: RegistrationState;
}

interface PriceSettings {
  scope: string;
  regularMembershipFeeDollars: number;
  socialMembershipFeeDollars: number;
  spareOnlyIcePrivilegeFeeDollars: number;
  sabbaticalFeeDollars: number;
  juniorRecreationalFeeDollars: number;
  leagueFeeDollars: number;
}

type DiscountAmountType = 'dollar' | 'percent';

interface DiscountSlotForm {
  amountType: DiscountAmountType;
  value: number;
}

interface DiscountApiResponse {
  scope: string;
  studentDiscount: DiscountSlotForm;
  reciprocalDiscount: DiscountSlotForm;
  winterOnlyDiscount: DiscountSlotForm;
}

type DiscountFormState = {
  studentDiscount: DiscountSlotForm;
  reciprocalDiscount: DiscountSlotForm;
  winterOnlyDiscount: DiscountSlotForm;
};

type TabKey = 'registrations' | 'seasons' | 'sessions' | 'periods' | 'prices' | 'discounts' | 'communications';

const CONFIG_TAB_KEYS = ['seasons', 'sessions', 'periods', 'prices', 'discounts', 'communications'] as const;

const REGISTRATION_STATE_OPTIONS: ChoiceOption<RegistrationState>[] = [
  { value: 'closed', label: 'Closed' },
  { value: 'priority', label: 'Priority' },
  { value: 'open', label: 'Open' },
];

const emptySeasonForm = {
  id: null as number | null,
  name: '',
  startDate: '',
  endDate: '',
};

const emptySessionForm = {
  id: null as number | null,
  seasonId: 0,
  name: '',
  startDate: '',
  endDate: '',
};

const emptyApplyNowForm = {
  seasonId: 0,
  sessionId: 0,
  state: 'closed' as RegistrationState,
};

const emptyTransitionForm = {
  id: null as number | null,
  seasonId: 0,
  sessionId: 0,
  effectiveAt: '',
  state: 'closed' as RegistrationState,
};

const emptyPriceForm = {
  regularMembershipFeeDollars: 0,
  socialMembershipFeeDollars: 0,
  spareOnlyIcePrivilegeFeeDollars: 0,
  sabbaticalFeeDollars: 0,
  juniorRecreationalFeeDollars: 0,
  leagueFeeDollars: 0,
};

const emptyDiscountForm: DiscountFormState = {
  studentDiscount: { amountType: 'dollar', value: 0 },
  reciprocalDiscount: { amountType: 'dollar', value: 0 },
  winterOnlyDiscount: { amountType: 'dollar', value: 0 },
};

const DISCOUNT_AMOUNT_TYPE_OPTIONS: ChoiceOption<DiscountAmountType>[] = [
  { value: 'dollar', label: 'Fixed dollar amount' },
  { value: 'percent', label: 'Percentage off' },
];

function formatDiscountSummary(slot: DiscountSlotForm): string {
  return slot.amountType === 'percent' ? `${slot.value}% off` : `$${slot.value.toFixed(2)}`;
}

function formatDateTimeLocal(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function parseDateTimeLocal(value: string): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function describeSeason(seasons: Season[], seasonId: number): string {
  return seasons.find((season) => season.id === seasonId)?.name ?? 'Unknown season';
}

function describeSession(sessions: Session[], sessionId: number): string {
  return sessions.find((session) => session.id === sessionId)?.name ?? 'Unknown session';
}

function joinClasses(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export default function AdminRegistrationConfig() {
  const { showAlert } = useAlert();
  const { member } = useAuth();
  const { confirm } = useConfirm();
  const location = useLocation();
  const canManageConfig = Boolean(member && memberHasScope(member, 'admin.manage'));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [transitions, setTransitions] = useState<RegistrationStateTransition[]>([]);
  const [seasonForm, setSeasonForm] = useState(emptySeasonForm);
  const [sessionForm, setSessionForm] = useState(emptySessionForm);
  const [transitionForm, setTransitionForm] = useState(emptyTransitionForm);
  const [applyNowForm, setApplyNowForm] = useState(emptyApplyNowForm);
  const [priceForm, setPriceForm] = useState(emptyPriceForm);
  const [discountForm, setDiscountForm] = useState(emptyDiscountForm);

  const activeTab = useMemo<TabKey>(() => {
    const segments = location.pathname.split('/').filter(Boolean);
    const last = segments.at(-1);
    if (last === 'seasons' || last === 'sessions' || last === 'periods' || last === 'prices' || last === 'discounts') {
      return last;
    }
    if (last === 'communications') return 'communications';
    return 'registrations';
  }, [location.pathname]);

  const isConfigTab = (CONFIG_TAB_KEYS as readonly string[]).includes(activeTab);

  const seasonOptions = useMemo<ChoiceOption<number>[]>(
    () => seasons.map((season) => ({ value: season.id, label: season.name })),
    [seasons]
  );

  const sessionOptions = useMemo<ChoiceOption<number>[]>(
    () =>
      sessions.map((session) => ({
        value: session.id,
        label: `${session.name} (${describeSeason(seasons, session.seasonId)})`,
      })),
    [seasons, sessions]
  );

  const applyNowSessionOptions = useMemo<ChoiceOption<number>[]>(
    () =>
      sessions
        .filter((session) => session.seasonId === applyNowForm.seasonId)
        .map((session) => ({ value: session.id, label: session.name })),
    [sessions, applyNowForm.seasonId]
  );

  const loadAll = async () => {
    setLoading(true);
    try {
      const [seasonRows, sessionRows, transitionRows, priceRow, discountRow] = await Promise.all([
        get('/registration-config/seasons'),
        get('/registration-config/sessions'),
        get('/registration-config/registration-state-transitions'),
        get('/registration-config/prices'),
        get('/registration-config/discounts'),
      ]);
      setSeasons(seasonRows as Season[]);
      setSessions(sessionRows as Session[]);
      setTransitions(transitionRows as RegistrationStateTransition[]);
      const prices = priceRow as PriceSettings;
      const discounts = discountRow as DiscountApiResponse;
      setPriceForm({
        regularMembershipFeeDollars: prices.regularMembershipFeeDollars,
        socialMembershipFeeDollars: prices.socialMembershipFeeDollars,
        spareOnlyIcePrivilegeFeeDollars: prices.spareOnlyIcePrivilegeFeeDollars,
        sabbaticalFeeDollars: prices.sabbaticalFeeDollars,
        juniorRecreationalFeeDollars: prices.juniorRecreationalFeeDollars,
        leagueFeeDollars: prices.leagueFeeDollars,
      });
      setDiscountForm({
        studentDiscount: discounts.studentDiscount,
        reciprocalDiscount: discounts.reciprocalDiscount,
        winterOnlyDiscount: discounts.winterOnlyDiscount,
      });
    } catch (error) {
      showAlert(formatApiError(error, 'Failed to load registration configuration'), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isConfigTab) {
      setLoading(false);
      return;
    }
    void loadAll();
  }, [activeTab, isConfigTab]);

  const handleSaveSeason = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name: seasonForm.name,
        startDate: seasonForm.startDate,
        endDate: seasonForm.endDate,
      };
      if (seasonForm.id) {
        await patch('/registration-config/seasons/{id}', payload, { id: String(seasonForm.id) });
      } else {
        await post('/registration-config/seasons', payload);
      }
      setSeasonForm(emptySeasonForm);
      await loadAll();
      showAlert('Season saved.', 'success');
    } catch (error) {
      showAlert(formatApiError(error, 'Failed to save season'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSession = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = {
        seasonId: sessionForm.seasonId,
        name: sessionForm.name,
        startDate: sessionForm.startDate,
        endDate: sessionForm.endDate,
      };
      if (sessionForm.id) {
        await patch('/registration-config/sessions/{id}', payload, { id: String(sessionForm.id) });
      } else {
        await post('/registration-config/sessions', payload);
      }
      setSessionForm(emptySessionForm);
      await loadAll();
      showAlert('Session saved.', 'success');
    } catch (error) {
      showAlert(formatApiError(error, 'Failed to save session'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveTransition = async (event: FormEvent) => {
    event.preventDefault();
    const iso = parseDateTimeLocal(transitionForm.effectiveAt);
    if (!iso) {
      showAlert('Choose a valid effective date and time.', 'warning');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        seasonId: transitionForm.seasonId,
        sessionId: transitionForm.sessionId,
        effectiveAt: iso,
        state: transitionForm.state,
      };
      if (transitionForm.id) {
        await patch('/registration-config/registration-state-transitions/{id}', payload, {
          id: String(transitionForm.id),
        });
      } else {
        await post('/registration-config/registration-state-transitions', payload);
      }
      setTransitionForm(emptyTransitionForm);
      await loadAll();
      showAlert('Registration schedule row saved.', 'success');
    } catch (error) {
      showAlert(formatApiError(error, 'Failed to save registration schedule row'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleApplyRegistrationStateNow = async (event: FormEvent) => {
    event.preventDefault();
    if (!applyNowForm.seasonId || !applyNowForm.sessionId) {
      showAlert('Select a season and session.', 'warning');
      return;
    }
    setSaving(true);
    try {
      await post('/registration-config/registration-state-transitions/apply-now', {
        seasonId: applyNowForm.seasonId,
        sessionId: applyNowForm.sessionId,
        state: applyNowForm.state,
      });
      await loadAll();
      showAlert('Registration state applied for the selected season and session.', 'success');
    } catch (error) {
      showAlert(formatApiError(error, 'Failed to apply registration state'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTransition = async (transition: RegistrationStateTransition) => {
    const confirmed = await confirm({
      title: 'Remove schedule row',
      message: 'Remove this registration state change?',
      variant: 'danger',
      confirmText: 'Remove',
    });
    if (!confirmed) return;
    try {
      await del('/registration-config/registration-state-transitions/{id}', undefined, {
        id: String(transition.id),
      });
      if (transitionForm.id === transition.id) setTransitionForm(emptyTransitionForm);
      await loadAll();
      showAlert('Schedule row removed.', 'success');
    } catch (error) {
      showAlert(formatApiError(error, 'Failed to remove schedule row'), 'error');
    }
  };

  const handleSavePrices = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await patch('/registration-config/prices', { ...priceForm });
      await loadAll();
      showAlert('Prices saved.', 'success');
    } catch (error) {
      showAlert(formatApiError(error, 'Failed to save prices'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDiscounts = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await patch('/registration-config/discounts', discountForm);
      await loadAll();
      showAlert('Discounts saved.', 'success');
    } catch (error) {
      showAlert(formatApiError(error, 'Failed to save discounts'), 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!canManageConfig && activeTab !== 'registrations') {
    return <Navigate to="/admin/registrations" replace />;
  }

  const tabs = [
    { key: 'registrations', label: 'Registrations', to: '/admin/registrations', isActive: activeTab === 'registrations' },
    ...(canManageConfig
      ? [
          { key: 'seasons', label: 'Seasons', to: '/admin/registrations/seasons', isActive: activeTab === 'seasons' },
          { key: 'sessions', label: 'Sessions', to: '/admin/registrations/sessions', isActive: activeTab === 'sessions' },
          {
            key: 'periods',
            label: 'Registration schedule',
            to: '/admin/registrations/periods',
            isActive: activeTab === 'periods',
          },
          { key: 'prices', label: 'Prices', to: '/admin/registrations/prices', isActive: activeTab === 'prices' },
          {
            key: 'discounts',
            label: 'Discounts',
            to: '/admin/registrations/discounts',
            isActive: activeTab === 'discounts',
          },
          {
            key: 'communications',
            label: 'Communications',
            to: '/admin/registrations/communications',
            isActive: activeTab === 'communications',
          },
        ]
      : []),
  ];

  return (
    <>
      <AppPage>
        <AppPageHeader
          title="Registration management"
          description="View submitted registrations and configure seasons, sessions, registration schedule, and pricing."
        />

        <PageTabs items={tabs} />

        {activeTab === 'registrations' ? <AdminRegistrationsList /> : null}
        {activeTab === 'communications' ? <AdminRegistrationCommunicationsPanel /> : null}

        {isConfigTab && loading ? (
          <AppStateCard title="Loading registration configuration" description="Fetching the latest staff configuration." />
        ) : null}

        {isConfigTab && !loading ? (
          <>
            {activeTab === 'seasons' && (
              <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(360px,420px)]">
                <ConfigTable
                  title="Curling seasons"
                  emptyText="No curling seasons have been configured."
                  headers={['Name', 'Season dates', '']}
                  rows={seasons.map((season) => ({
                    key: season.id,
                    cells: [
                      season.name,
                      `${season.startDate} to ${season.endDate}`,
                      <Button
                        key="edit"
                        variant="secondary"
                        className="px-3 py-1.5"
                        onClick={() => setSeasonForm({ ...season, id: season.id })}
                      >
                        Edit
                      </Button>,
                    ],
                  }))}
                />
                <form className="app-card space-y-4" onSubmit={handleSaveSeason}>
                  <h2 className="app-section-title">{seasonForm.id ? 'Edit season' : 'Create season'}</h2>
                  <TextField
                    id="season-name"
                    label="Name"
                    value={seasonForm.name}
                    onChange={(name) => setSeasonForm((form) => ({ ...form, name }))}
                    required
                  />
                  <DateField
                    id="season-start"
                    label="Season start date"
                    value={seasonForm.startDate}
                    onChange={(startDate) => setSeasonForm((form) => ({ ...form, startDate }))}
                    required
                  />
                  <DateField
                    id="season-end"
                    label="Season end date"
                    value={seasonForm.endDate}
                    onChange={(endDate) => setSeasonForm((form) => ({ ...form, endDate }))}
                    required
                  />
                  <FormActions saving={saving} onCancel={() => setSeasonForm(emptySeasonForm)} isEditing={Boolean(seasonForm.id)} />
                </form>
              </section>
            )}

            {activeTab === 'sessions' && (
              <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(360px,420px)]">
                <ConfigTable
                  title="Curling sessions"
                  emptyText="No curling sessions have been configured."
                  headers={['Name', 'Season', 'Dates', '']}
                  rows={sessions.map((session) => ({
                    key: session.id,
                    cells: [
                      session.name,
                      describeSeason(seasons, session.seasonId),
                      `${session.startDate} to ${session.endDate}`,
                      <Button
                        key="edit"
                        variant="secondary"
                        className="px-3 py-1.5"
                        onClick={() => setSessionForm({ ...session, id: session.id })}
                      >
                        Edit
                      </Button>,
                    ],
                  }))}
                />
                <form className="app-card space-y-4" onSubmit={handleSaveSession}>
                  <h2 className="app-section-title">{sessionForm.id ? 'Edit session' : 'Create session'}</h2>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Sessions are ordered automatically by start date within each season.
                  </p>
                  <ChoiceField
                    id="session-season"
                    label="Season"
                    options={seasonOptions}
                    value={sessionForm.seasonId || null}
                    onChange={(seasonId) => setSessionForm((form) => ({ ...form, seasonId: seasonId ?? 0 }))}
                    required
                  />
                  <TextField
                    id="session-name"
                    label="Name"
                    value={sessionForm.name}
                    onChange={(name) => setSessionForm((form) => ({ ...form, name }))}
                    required
                  />
                  <DateField
                    id="session-start"
                    label="Start date"
                    value={sessionForm.startDate}
                    onChange={(startDate) => setSessionForm((form) => ({ ...form, startDate }))}
                    required
                  />
                  <DateField
                    id="session-end"
                    label="End date"
                    value={sessionForm.endDate}
                    onChange={(endDate) => setSessionForm((form) => ({ ...form, endDate }))}
                    required
                  />
                  <FormActions saving={saving} onCancel={() => setSessionForm(emptySessionForm)} isEditing={Boolean(sessionForm.id)} />
                </form>
              </section>
            )}

            {activeTab === 'periods' && (
              <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(360px,440px)]">
                <ConfigTable
                  title="Registration schedule"
                  emptyText="No state changes have been configured yet."
                  headers={['Season', 'Session', 'Effective', 'State', '']}
                  rows={transitions.map((row) => ({
                    key: row.id,
                    cells: [
                      describeSeason(seasons, row.seasonId),
                      describeSession(sessions, row.sessionId),
                      new Date(row.effectiveAt).toLocaleString(),
                      row.state,
                      <span key="actions" className="inline-flex flex-wrap justify-end gap-2">
                        <Button
                          variant="secondary"
                          className="px-3 py-1.5"
                          onClick={() =>
                            setTransitionForm({
                              ...row,
                              id: row.id,
                              effectiveAt: formatDateTimeLocal(row.effectiveAt),
                            })
                          }
                        >
                          Edit
                        </Button>
                        <Button variant="secondary" className="px-3 py-1.5" onClick={() => handleDeleteTransition(row)}>
                          Remove
                        </Button>
                      </span>,
                    ],
                  }))}
                />
                <div className="flex flex-col gap-6">
                  <form className="app-card space-y-4" onSubmit={handleApplyRegistrationStateNow}>
                    <h2 className="app-section-title">Set registration state now</h2>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Applies immediately by adding a schedule row with the current time. Use this for manual overrides;
                      future or past effective times still use the form below.
                    </p>
                    <ChoiceField
                      id="apply-now-season"
                      label="Season"
                      options={seasonOptions}
                      value={applyNowForm.seasonId || null}
                      onChange={(seasonId) =>
                        setApplyNowForm((form) => ({
                          ...form,
                          seasonId: seasonId ?? 0,
                          sessionId: 0,
                        }))
                      }
                      required
                    />
                    <ChoiceField
                      id="apply-now-session"
                      label="Session"
                      options={applyNowSessionOptions}
                      value={applyNowForm.sessionId || null}
                      onChange={(sessionId) =>
                        setApplyNowForm((form) => ({ ...form, sessionId: sessionId ?? 0 }))
                      }
                      required
                    />
                    {applyNowForm.seasonId > 0 && applyNowSessionOptions.length === 0 ? (
                      <p className="text-sm text-gray-600 dark:text-gray-400">No sessions exist for this season yet.</p>
                    ) : null}
                    <ChoiceField
                      id="apply-now-state"
                      label="Registration state"
                      options={REGISTRATION_STATE_OPTIONS}
                      value={applyNowForm.state}
                      onChange={(state) => setApplyNowForm((form) => ({ ...form, state: state ?? 'closed' }))}
                      required
                    />
                    <div className="flex flex-wrap justify-end gap-2 pt-2">
                      <Button type="button" variant="secondary" onClick={() => setApplyNowForm(emptyApplyNowForm)}>
                        Reset
                      </Button>
                      <Button type="submit" disabled={saving}>
                        {saving ? 'Applying…' : 'Apply now'}
                      </Button>
                    </div>
                  </form>
                  <form className="app-card space-y-4" onSubmit={handleSaveTransition}>
                  <h2 className="app-section-title">{transitionForm.id ? 'Edit state change' : 'Add state change'}</h2>
                  <div className="app-alert-info text-sm">
                    Each row sets registration to closed, priority, or open for a season and session at an effective
                    time. Add as many rows as you need; the active state at any moment is the latest change at or
                    before that time.
                  </div>
                  <ChoiceField
                    id="transition-season"
                    label="Season"
                    options={seasonOptions}
                    value={transitionForm.seasonId || null}
                    onChange={(seasonId) => setTransitionForm((form) => ({ ...form, seasonId: seasonId ?? 0 }))}
                    required
                  />
                  <ChoiceField
                    id="transition-session"
                    label="Session"
                    options={sessionOptions}
                    value={transitionForm.sessionId || null}
                    onChange={(sessionId) => setTransitionForm((form) => ({ ...form, sessionId: sessionId ?? 0 }))}
                    required
                  />
                  <DateTimeField
                    id="transition-effective"
                    label="Effective date and time"
                    value={transitionForm.effectiveAt}
                    onChange={(effectiveAt) => setTransitionForm((form) => ({ ...form, effectiveAt }))}
                  />
                  <ChoiceField
                    id="transition-state"
                    label="New state"
                    options={REGISTRATION_STATE_OPTIONS}
                    value={transitionForm.state}
                    onChange={(state) => setTransitionForm((form) => ({ ...form, state: state ?? 'closed' }))}
                    required
                  />
                  <FormActions
                    saving={saving}
                    onCancel={() => setTransitionForm(emptyTransitionForm)}
                    isEditing={Boolean(transitionForm.id)}
                  />
                </form>
                </div>
              </section>
            )}

            {activeTab === 'prices' && (
              <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(360px,440px)]">
                <section className="app-card space-y-3">
                  <h2 className="app-section-title">Current prices</h2>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Amounts are stored precisely to the cent. Values apply club-wide (only one active registration
                    season at a time).
                  </p>
                  <dl className="grid gap-2 text-sm">
                    <div className="flex justify-between gap-4">
                      <dt className="text-gray-600 dark:text-gray-400">Regular membership</dt>
                      <dd>${priceForm.regularMembershipFeeDollars.toFixed(2)}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-gray-600 dark:text-gray-400">Social membership</dt>
                      <dd>${priceForm.socialMembershipFeeDollars.toFixed(2)}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-gray-600 dark:text-gray-400">Spare-only ice privilege</dt>
                      <dd>${priceForm.spareOnlyIcePrivilegeFeeDollars.toFixed(2)}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-gray-600 dark:text-gray-400">Sabbatical</dt>
                      <dd>${priceForm.sabbaticalFeeDollars.toFixed(2)}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-gray-600 dark:text-gray-400">Junior recreational</dt>
                      <dd>${priceForm.juniorRecreationalFeeDollars.toFixed(2)}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-gray-600 dark:text-gray-400">League fee (default)</dt>
                      <dd>${priceForm.leagueFeeDollars.toFixed(2)}</dd>
                    </div>
                  </dl>
                </section>
                <form className="app-card space-y-4" onSubmit={handleSavePrices}>
                  <h2 className="app-section-title">Edit prices</h2>
                  <DollarField
                    id="regular-fee"
                    label="Regular membership (USD)"
                    value={priceForm.regularMembershipFeeDollars}
                    onChange={(regularMembershipFeeDollars) =>
                      setPriceForm((form) => ({ ...form, regularMembershipFeeDollars }))
                    }
                  />
                  <DollarField
                    id="social-fee"
                    label="Social membership (USD)"
                    value={priceForm.socialMembershipFeeDollars}
                    onChange={(socialMembershipFeeDollars) =>
                      setPriceForm((form) => ({ ...form, socialMembershipFeeDollars }))
                    }
                  />
                  <DollarField
                    id="spare-fee"
                    label="Spare-only ice privilege (USD)"
                    value={priceForm.spareOnlyIcePrivilegeFeeDollars}
                    onChange={(spareOnlyIcePrivilegeFeeDollars) =>
                      setPriceForm((form) => ({ ...form, spareOnlyIcePrivilegeFeeDollars }))
                    }
                  />
                  <DollarField
                    id="sabbatical-fee"
                    label="Sabbatical fee (USD)"
                    value={priceForm.sabbaticalFeeDollars}
                    onChange={(sabbaticalFeeDollars) => setPriceForm((form) => ({ ...form, sabbaticalFeeDollars }))}
                  />
                  <DollarField
                    id="junior-fee"
                    label="Junior recreational fee (USD)"
                    value={priceForm.juniorRecreationalFeeDollars}
                    onChange={(juniorRecreationalFeeDollars) =>
                      setPriceForm((form) => ({ ...form, juniorRecreationalFeeDollars }))
                    }
                  />
                  <DollarField
                    id="league-fee-default"
                    label="Default league fee (USD)"
                    value={priceForm.leagueFeeDollars}
                    onChange={(leagueFeeDollars) => setPriceForm((form) => ({ ...form, leagueFeeDollars }))}
                  />
                  <FormActions saving={saving} onCancel={() => loadAll()} isEditing={false} />
                </form>
              </section>
            )}

            {activeTab === 'discounts' && (
              <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(360px,440px)]">
                <section className="app-card space-y-3">
                  <h2 className="app-section-title">Configured discounts</h2>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Each discount can be a fixed dollar amount or a percentage off eligible lines. Percentages use whole
                    numbers (30 means 30% off).
                  </p>
                  <dl className="grid gap-2 text-sm">
                    <div className="flex justify-between gap-4">
                      <dt className="text-gray-600 dark:text-gray-400">Student</dt>
                      <dd>{formatDiscountSummary(discountForm.studentDiscount)}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-gray-600 dark:text-gray-400">Reciprocal club</dt>
                      <dd>{formatDiscountSummary(discountForm.reciprocalDiscount)}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-gray-600 dark:text-gray-400">Winter-only</dt>
                      <dd>{formatDiscountSummary(discountForm.winterOnlyDiscount)}</dd>
                    </div>
                  </dl>
                </section>
                <form className="app-card space-y-4" onSubmit={handleSaveDiscounts}>
                  <h2 className="app-section-title">Edit discounts</h2>
                  <DiscountSlotEditor
                    baseId="discount-student"
                    title="Student discount"
                    slot={discountForm.studentDiscount}
                    onChange={(studentDiscount) => setDiscountForm((form) => ({ ...form, studentDiscount }))}
                  />
                  <DiscountSlotEditor
                    baseId="discount-reciprocal"
                    title="Reciprocal club discount"
                    slot={discountForm.reciprocalDiscount}
                    onChange={(reciprocalDiscount) => setDiscountForm((form) => ({ ...form, reciprocalDiscount }))}
                  />
                  <DiscountSlotEditor
                    baseId="discount-winter"
                    title="Winter-only discount"
                    slot={discountForm.winterOnlyDiscount}
                    onChange={(winterOnlyDiscount) => setDiscountForm((form) => ({ ...form, winterOnlyDiscount }))}
                  />
                  <FormActions saving={saving} onCancel={() => loadAll()} isEditing={false} />
                </form>
              </section>
            )}
          </>
        ) : null}
      </AppPage>
    </>
  );
}

function ConfigTable({
  title,
  emptyText,
  headers,
  rows,
}: {
  title: string;
  emptyText: string;
  headers: string[];
  rows: Array<{ key: number; cells: ReactNode[] }>;
}) {
  return (
    <section className="app-card overflow-hidden">
      <h2 className="app-section-title mb-4">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-600 dark:text-gray-400">{emptyText}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="app-table min-w-full">
            <thead>
              <tr>
                {headers.map((header) => (
                  <th key={header} className="app-table-th text-left">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="app-table-row">
                  {row.cells.map((cell, index) => (
                    <td
                      key={index}
                      className={joinClasses('app-table-td', index === row.cells.length - 1 && 'text-right')}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  required,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <FormField label={label} htmlFor={id} required={required}>
      <input id={id} className="app-input" value={value} onChange={(event) => onChange(event.target.value)} required={required} />
    </FormField>
  );
}

function DateField(props: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <FormField label={props.label} htmlFor={props.id} required={props.required}>
      <input
        id={props.id}
        type="date"
        className="app-input"
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        required={props.required}
      />
    </FormField>
  );
}

function DateTimeField(props: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  return (
    <FormField label={props.label} htmlFor={props.id} required>
      <input
        id={props.id}
        type="datetime-local"
        className="app-input"
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        required
      />
    </FormField>
  );
}

function DiscountSlotEditor({
  baseId,
  title,
  slot,
  onChange,
}: {
  baseId: string;
  title: string;
  slot: DiscountSlotForm;
  onChange: (next: DiscountSlotForm) => void;
}) {
  const typeId = `${baseId}-type`;
  const valueId = `${baseId}-value`;
  return (
    <div className="space-y-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
      <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{title}</p>
      <ChoiceField
        id={typeId}
        label="Discount type"
        options={DISCOUNT_AMOUNT_TYPE_OPTIONS}
        value={slot.amountType}
        onChange={(amountType) => {
          if (amountType) onChange({ ...slot, amountType });
        }}
        required
      />
      {slot.amountType === 'dollar' ? (
        <DollarField
          id={valueId}
          label="Discount amount (USD)"
          value={slot.value}
          onChange={(value) => onChange({ ...slot, value })}
        />
      ) : (
        <PercentOffField
          id={valueId}
          label="Percent off"
          value={slot.value}
          onChange={(value) => onChange({ ...slot, value })}
        />
      )}
    </div>
  );
}

function PercentOffField(props: { id: string; label: string; value: number; onChange: (value: number) => void }) {
  return (
    <FormField
      label={props.label}
      htmlFor={props.id}
      helperText="Enter a whole number: 30 means 30% off (not 0.3)."
    >
      <input
        id={props.id}
        type="number"
        className="app-input"
        min={0}
        max={100}
        step={1}
        inputMode="numeric"
        value={Number.isFinite(props.value) ? props.value : 0}
        onChange={(event) => {
          const next = Number.parseFloat(event.target.value);
          props.onChange(Number.isFinite(next) ? next : 0);
        }}
      />
    </FormField>
  );
}

function DollarField(props: {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <FormField label={props.label} htmlFor={props.id}>
      <input
        id={props.id}
        type="number"
        className="app-input"
        min={0}
        step={0.01}
        inputMode="decimal"
        value={Number.isFinite(props.value) ? props.value : 0}
        onChange={(event) => {
          const next = Number.parseFloat(event.target.value);
          props.onChange(Number.isFinite(next) ? next : 0);
        }}
      />
    </FormField>
  );
}

function ChoiceField<Value extends string | number>({
  id,
  label,
  options,
  value,
  onChange,
  required,
}: {
  id: string;
  label: string;
  options: ChoiceOption<Value>[];
  value: Value | null;
  onChange: (value: Value | null) => void;
  required?: boolean;
}) {
  return (
    <FormField label={label} htmlFor={id} required={required}>
      {({ describedBy, invalid }) => (
        <ChoiceInput
          inputId={id}
          options={options}
          value={value}
          onChange={(nextValue) => onChange(Array.isArray(nextValue) ? null : nextValue)}
          ariaDescribedBy={describedBy}
          ariaInvalid={invalid}
          required={required}
        />
      )}
    </FormField>
  );
}

function FormActions({
  saving,
  onCancel,
  isEditing,
}: {
  saving: boolean;
  onCancel: () => void;
  isEditing: boolean;
}) {
  return (
    <div className="flex flex-wrap justify-end gap-2 pt-2">
      <Button type="button" variant="secondary" onClick={onCancel}>
        {isEditing ? 'Cancel' : 'Reset'}
      </Button>
      <Button type="submit" disabled={saving}>
        {saving ? 'Saving...' : isEditing ? 'Save changes' : 'Save'}
      </Button>
    </div>
  );
}
