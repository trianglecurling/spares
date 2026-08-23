import { useCallback, useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AppPage, AppPageHeader } from '../../components/AppPage';
import AppStateCard from '../../components/AppStateCard';
import BackButton from '../../components/BackButton';
import Button from '../../components/Button';
import ChoiceInput from '../../components/ChoiceInput';
import FormCheckbox from '../../components/FormCheckbox';
import FormField from '../../components/FormField';
import FormSection from '../../components/FormSection';
import MemberAutocomplete from '../../components/MemberAutocomplete';
import { useAlert } from '../../contexts/AlertContext';
import api, { getApiErrorMessage } from '../../utils/api';
import { staffRegistrationSearch } from '../../utils/registrationResume';

type RegistrationSession = {
  id: number;
  seasonId: number;
  seasonName: string;
  name: string;
  isDefault: boolean;
};

type CreateStaffRegistrationResponse = {
  id: number;
  nextStep: string;
  reusedExistingDraft: boolean;
  curler: { id: number; name: string; email: string | null };
};

export default function AdminRegistrationCreate() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { showAlert } = useAlert();
  const sessionFieldId = useId();
  const whoLabelId = useId();
  const memberFieldId = useId();
  const firstNameId = useId();
  const lastNameId = useId();
  const emailId = useId();
  const phoneId = useId();

  const [sessions, setSessions] = useState<RegistrationSession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const initialSessionId = searchParams.get('sessionId') ?? '';
  const [sessionId, setSessionId] = useState(initialSessionId);
  const [who, setWho] = useState<'existing' | 'new'>('existing');
  const [curlerMemberId, setCurlerMemberId] = useState<number | ''>('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [acceptPolicies, setAcceptPolicies] = useState(false);

  const loadSessions = useCallback(async () => {
    setLoadingSessions(true);
    setSessionsError(null);
    try {
      const response = await api.get<{ sessions: RegistrationSession[]; defaultSessionId: number | null }>(
        '/registration/staff/sessions',
      );
      setSessions(response.data.sessions);
      if (!initialSessionId && response.data.defaultSessionId) {
        setSessionId(String(response.data.defaultSessionId));
      }
    } catch (err) {
      setSessionsError(getApiErrorMessage(err, 'Unable to load sessions.'));
    } finally {
      setLoadingSessions(false);
    }
  }, [initialSessionId]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const sessionOptions = useMemo(
    () =>
      sessions.map((session) => ({
        value: String(session.id),
        label: `${session.seasonName} / ${session.name}`,
      })),
    [sessions],
  );

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});
    if (!sessionId) {
      setFieldErrors({ sessionId: 'Select a session.' });
      return;
    }
    if (who === 'existing' && !curlerMemberId) {
      setFieldErrors({ curlerMemberId: 'Select the member you are registering.' });
      return;
    }
    if (who === 'new') {
      const nextErrors: Record<string, string> = {};
      if (!firstName.trim()) nextErrors.firstName = 'Enter a first name.';
      if (!lastName.trim()) nextErrors.lastName = 'Enter a last name.';
      if (!email.trim()) nextErrors.email = 'Enter an email address.';
      if (Object.keys(nextErrors).length > 0) {
        setFieldErrors(nextErrors);
        return;
      }
    }
    if (!acceptPolicies) {
      setFieldErrors({ acceptPoliciesOnBehalf: 'Accept the required policies on behalf of this curler.' });
      return;
    }

    setSubmitting(true);
    try {
      const response = await api.post<CreateStaffRegistrationResponse>('/registration/staff/registrations', {
        sessionId: Number(sessionId),
        acceptPoliciesOnBehalf: true,
        curlerMemberId: who === 'existing' ? Number(curlerMemberId) : undefined,
        newCurler:
          who === 'new'
            ? {
                firstName: firstName.trim(),
                lastName: lastName.trim(),
                email: email.trim(),
                phone: phone.trim() || undefined,
              }
            : undefined,
      });
      const created = response.data;
      showAlert(
        created.reusedExistingDraft
          ? `Continuing an in-progress registration for ${created.curler.name}.`
          : `Started a registration for ${created.curler.name}.`,
        'success',
        'Registration started',
      );
      navigate(`/registration/${created.nextStep}${staffRegistrationSearch(created.id)}`);
    } catch (err) {
      const details = (err as { response?: { data?: { details?: Record<string, string | string[]> } } })?.response?.data
        ?.details;
      const nextFieldErrors: Record<string, string> = {};
      if (details) {
        for (const [key, value] of Object.entries(details)) {
          nextFieldErrors[key] = Array.isArray(value) ? value[0] : value;
        }
      }
      setFieldErrors(nextFieldErrors);
      setFormError(getApiErrorMessage(err, 'Unable to create this registration.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppPage>
      <AppPageHeader
        title="Create registration"
        description="Start a curling registration on behalf of a member. Use this when someone cannot complete the online form, such as a mailed check."
      />
      <div className="mb-4">
        <BackButton
          to={sessionId ? `/admin/registrations/list?sessionId=${sessionId}` : '/admin/registrations/list'}
          label="Back to registrations"
        />
      </div>

      {loadingSessions ? (
        <AppStateCard title="Loading sessions" description="Gathering registration sessions." />
      ) : null}
      {sessionsError ? (
        <AppStateCard
          title="Unable to load sessions"
          description={sessionsError}
          action={<Button onClick={() => void loadSessions()}>Try again</Button>}
        />
      ) : null}

      {!loadingSessions && !sessionsError ? (
        <form className="max-w-3xl space-y-6" onSubmit={(event) => void handleSubmit(event)}>
          <FormSection
            title="Session and curler"
            description="Registration must still be open or in the priority window for the selected session. After this page, you will finish membership and league choices in the usual registration flow."
          >
            <FormField label="Session" htmlFor={sessionFieldId} required error={fieldErrors.sessionId}>
              <ChoiceInput
                inputId={sessionFieldId}
                layout="popover"
                value={sessionId}
                onChange={(value) => {
                  const next = Array.isArray(value) ? value[0] : value;
                  setSessionId(next ?? '');
                }}
                options={sessionOptions}
                placeholder="Select session"
              />
            </FormField>

            <FormField label="Who is this registration for?" labelId={whoLabelId}>
              <ChoiceInput
                layout="inline"
                ariaLabelledBy={whoLabelId}
                value={who}
                onChange={(value) => {
                  const next = Array.isArray(value) ? value[0] : value;
                  setWho(next === 'new' ? 'new' : 'existing');
                }}
                options={[
                  { value: 'existing', label: 'An existing member' },
                  { value: 'new', label: 'Someone new' },
                ]}
              />
            </FormField>

            {who === 'existing' ? (
              <FormField
                label="Member"
                htmlFor={memberFieldId}
                required
                error={fieldErrors.curlerMemberId || fieldErrors.curler}
              >
                <MemberAutocomplete
                  inputId={memberFieldId}
                  value={curlerMemberId}
                  onChange={setCurlerMemberId}
                  placeholder="Search by name or email"
                />
              </FormField>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="First name" htmlFor={firstNameId} required error={fieldErrors.firstName}>
                  <input
                    id={firstNameId}
                    className="app-input"
                    value={firstName}
                    onChange={(event) => setFirstName(event.target.value)}
                    autoComplete="given-name"
                  />
                </FormField>
                <FormField label="Last name" htmlFor={lastNameId} required error={fieldErrors.lastName}>
                  <input
                    id={lastNameId}
                    className="app-input"
                    value={lastName}
                    onChange={(event) => setLastName(event.target.value)}
                    autoComplete="family-name"
                  />
                </FormField>
                <FormField label="Email" htmlFor={emailId} required error={fieldErrors.email}>
                  <input
                    id={emailId}
                    type="email"
                    className="app-input"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="email"
                  />
                </FormField>
                <FormField label="Phone" htmlFor={phoneId} optional>
                  <input
                    id={phoneId}
                    type="tel"
                    className="app-input"
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    autoComplete="tel"
                  />
                </FormField>
              </div>
            )}
          </FormSection>

          <FormSection title="Policies">
            <FormCheckbox
              checked={acceptPolicies}
              onChange={setAcceptPolicies}
              label="I accept the Code of Conduct, Minor Athlete Abuse Prevention Policy, and Privacy Policy on behalf of this curler."
              helperText="The person submitting a registration agrees to these policies for the curler being registered."
            />
            {fieldErrors.acceptPoliciesOnBehalf ? (
              <p className="text-sm text-red-600 dark:text-red-400">{fieldErrors.acceptPoliciesOnBehalf}</p>
            ) : null}
          </FormSection>

          {formError ? <p className="text-sm text-red-700 dark:text-red-400">{formError}</p> : null}

          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Starting registration' : 'Continue registration'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={submitting}
              onClick={() =>
                navigate(sessionId ? `/admin/registrations/list?sessionId=${sessionId}` : '/admin/registrations/list')
              }
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </AppPage>
  );
}
