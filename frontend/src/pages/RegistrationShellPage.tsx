import { useEffect, useId, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import api from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import PublicLayout from '../components/PublicLayout';
import PublicStateCard from '../components/PublicStateCard';
import FormField from '../components/FormField';
import FormCheckbox from '../components/FormCheckbox';
import ChoiceInput from '../components/ChoiceInput';
import Button from '../components/Button';

type RegistrationStatus =
  | 'identity_incomplete'
  | 'policies_incomplete'
  | 'demographics_incomplete'
  | 'shell_complete'
  | 'submitted'
  | 'awaiting_staff_review'
  | 'awaiting_placement'
  | 'awaiting_payment'
  | 'payment_started'
  | 'paid'
  | 'confirmed'
  | 'cancelled';

type MemberSummary = {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  mailingAddress: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
};

type RegistrationShellPayload = {
  registration: {
    id: number;
    season_id: number;
    session_id: number;
    submitted_by_member_id: number | null;
    curler_member_id: number | null;
    returning_member_answer: number | null;
    registering_for_self: number | null;
    status: RegistrationStatus;
    guardian_first_name: string | null;
    guardian_last_name: string | null;
    guardian_email: string | null;
    guardian_phone: string | null;
  };
  submitter: MemberSummary | null;
  curler: MemberSummary | null;
  policies: Array<{ type: string; url: string; accepted: boolean }>;
  policiesComplete: boolean;
  isMinor: boolean;
};

type RegistrationWindow = {
  state: 'closed' | 'priority' | 'open';
  season: { id: number; name: string };
  session: { id: number; name: string };
};

type DemographicsForm = {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  email: string;
  phone: string;
  mailingAddress: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
};

type RegistrationFeeLineItem = {
  lineType: string;
  description: string;
  amountMinor: number;
  discountEligible: boolean;
};

type RegistrationPhase5Payload = {
  selection: {
    membershipOption: 'none' | 'regular' | 'social' | 'regular_spare_only' | 'junior_recreational';
    studentDiscountClaimed: boolean;
    studentInstitution: string | null;
    reciprocalDiscountClaimed: boolean;
    reciprocalClubName: string | null;
    experienceType: 'none_or_minimal' | 'specified_years' | 'known_existing' | null;
    experienceSelfReportedYears: number | null;
  };
  isFirstSessionOfSeason: boolean;
  knownExperienceYears: number;
  feePreview: {
    lineItems: RegistrationFeeLineItem[];
    discountLineItems: RegistrationFeeLineItem[];
    subtotalMinor: number;
    discountTotalMinor: number;
    totalDueMinor: number;
    blockingErrors: Array<{ code: string; message: string }>;
    warnings: Array<{ code: string; message: string }>;
  };
  paymentDecision: {
    outcome: 'immediate_payment' | 'deferred_payment' | 'no_payment_required';
    deferralReasons: string[];
    totalDueMinor: number;
  };
};

const emptyDemographics: DemographicsForm = {
  firstName: '',
  lastName: '',
  dateOfBirth: '',
  email: '',
  phone: '',
  mailingAddress: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
};

function errorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    return error.response?.data?.error || fallback;
  }
  return fallback;
}

function formatCurrency(amountMinor: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amountMinor / 100);
}

function demographicsFromMember(member: MemberSummary | null): DemographicsForm {
  if (!member) return emptyDemographics;
  const [firstFallback = '', ...lastParts] = member.name.split(' ');
  return {
    firstName: member.firstName || firstFallback,
    lastName: member.lastName || lastParts.join(' '),
    dateOfBirth: member.dateOfBirth || '',
    email: member.email || '',
    phone: member.phone || '',
    mailingAddress: member.mailingAddress || '',
    emergencyContactName: member.emergencyContactName || '',
    emergencyContactPhone: member.emergencyContactPhone || '',
  };
}

function nextStepFor(payload: RegistrationShellPayload): string {
  if (!payload.registration.curler_member_id || !payload.registration.submitted_by_member_id) return 'identity';
  if (!payload.policiesComplete) return 'policies';
  if (payload.registration.status === 'shell_complete') return 'membership';
  if (['submitted', 'awaiting_staff_review', 'awaiting_placement', 'awaiting_payment', 'payment_started', 'paid', 'confirmed'].includes(payload.registration.status)) return 'review';
  if (!payload.curler?.dateOfBirth || !payload.curler.mailingAddress || !payload.curler.emergencyContactName) return 'demographics';
  if (payload.isMinor && !payload.registration.guardian_email) return 'guardian';
  return 'membership';
}

function RegistrationCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl rounded-3xl border border-emerald-100 bg-white/95 p-6 shadow-xl shadow-emerald-950/10 sm:p-8">
      {children}
    </div>
  );
}

function FieldInput({
  id,
  value,
  onChange,
  type = 'text',
  autoComplete,
  step,
  required = true,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete?: string;
  step?: string;
  required?: boolean;
}) {
  return (
    <input
      id={id}
      type={type}
      step={step}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="app-input"
      autoComplete={autoComplete}
      required={required}
    />
  );
}

export default function RegistrationShellPage() {
  const navigate = useNavigate();
  const { registrationId, step } = useParams();
  const { member } = useAuth();
  const [windowState, setWindowState] = useState<RegistrationWindow | null>(null);
  const [payload, setPayload] = useState<RegistrationShellPayload | null>(null);
  const [profiles, setProfiles] = useState<MemberSummary[]>([]);
  const [returningAnswer, setReturningAnswer] = useState<'yes' | 'no' | null>(null);
  const [registeringForSelf, setRegisteringForSelf] = useState<'self' | 'other'>('self');
  const [sameEmail, setSameEmail] = useState<'same' | 'different'>('same');
  const [demographics, setDemographics] = useState<DemographicsForm>(emptyDemographics);
  const [guardian, setGuardian] = useState({ firstName: '', lastName: '', email: '', phone: '' });
  const [phase5, setPhase5] = useState<RegistrationPhase5Payload | null>(null);
  const [membershipChoice, setMembershipChoice] = useState<'regular' | 'social'>('regular');
  const [basicIcePrivileges, setBasicIcePrivileges] = useState(false);
  const [studentDiscountClaimed, setStudentDiscountClaimed] = useState(false);
  const [studentInstitution, setStudentInstitution] = useState('');
  const [reciprocalDiscountClaimed, setReciprocalDiscountClaimed] = useState(false);
  const [reciprocalClubName, setReciprocalClubName] = useState('');
  const [experienceChoice, setExperienceChoice] = useState<'none_or_minimal' | 'specified_years' | 'known_existing'>('none_or_minimal');
  const [experienceYears, setExperienceYears] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const profileInputId = useId();
  const choiceInputId = useId();
  const membershipInputId = useId();
  const experienceInputId = useId();

  const currentStep = step || (registrationId ? 'identity' : 'start');

  useEffect(() => {
    api
      .get('/registration/window')
      .then((response) => setWindowState(response.data))
      .catch((err) => setError(errorMessage(err, 'Registration is not available.')));
  }, []);

  useEffect(() => {
    if (!registrationId || !member) return;
    api
      .get(`/registration/drafts/${registrationId}`)
      .then((response) => {
        const data = response.data as RegistrationShellPayload;
        setPayload(data);
        setDemographics(demographicsFromMember(data.curler));
        setGuardian({
          firstName: data.registration.guardian_first_name || '',
          lastName: data.registration.guardian_last_name || '',
          email: data.registration.guardian_email || '',
          phone: data.registration.guardian_phone || '',
        });
        const target = nextStepFor(data);
        if (!step || step === 'identity') {
          navigate(`/registration/${registrationId}/${target}`, { replace: true });
        } else if (target === 'identity') {
          navigate(`/registration/${registrationId}/identity`, { replace: true });
        }
      })
      .catch((err) => setError(errorMessage(err, 'Unable to load this registration draft.')));
  }, [registrationId, member, navigate, step]);

  useEffect(() => {
    if (currentStep !== 'identity' || !member || payload?.registration.returning_member_answer !== 1) return;
    api
      .get('/registration/returning-profiles')
      .then((response) => setProfiles(response.data))
      .catch((err) => setError(errorMessage(err, 'Unable to load eligible curler profiles.')));
  }, [currentStep, member, payload]);

  useEffect(() => {
    const phase5Steps = ['membership', 'discounts', 'experience', 'basic-ice', 'review', 'success', 'cancel'];
    if (!registrationId || !member || !phase5Steps.includes(currentStep)) return;
    api
      .get(`/registration/drafts/${registrationId}/phase5`)
      .then((response) => {
        const data = response.data as RegistrationPhase5Payload;
        setPhase5(data);
        const membershipOption = data.selection.membershipOption;
        setMembershipChoice(membershipOption === 'social' ? 'social' : 'regular');
        setBasicIcePrivileges(membershipOption === 'regular_spare_only');
        setStudentDiscountClaimed(data.selection.studentDiscountClaimed);
        setStudentInstitution(data.selection.studentInstitution || '');
        setReciprocalDiscountClaimed(data.selection.reciprocalDiscountClaimed);
        setReciprocalClubName(data.selection.reciprocalClubName || '');
        setExperienceChoice(data.selection.experienceType || (data.knownExperienceYears > 0 ? 'known_existing' : 'none_or_minimal'));
        setExperienceYears(data.selection.experienceSelfReportedYears?.toString() || '');
      })
      .catch((err) => setError(errorMessage(err, 'Unable to load membership details.')));
  }, [registrationId, member, currentStep]);

  useEffect(() => {
    if (currentStep !== 'cancel' || !registrationId || !member) return;
    api.post(`/registration/drafts/${registrationId}/payment-cancelled`).catch(() => {
      // The page copy still explains that payment was not completed; staff can resolve stale checkout state.
    });
  }, [currentStep, registrationId, member]);

  const seasonSessionLabel = useMemo(() => {
    if (!windowState) return 'the upcoming season';
    return `${windowState.season.name} · ${windowState.session.name}`;
  }, [windowState]);

  async function startDraft(answer: 'yes' | 'no') {
    if (!windowState) return;
    setLoading(true);
    setError('');
    try {
      const response = await api.post('/registration/drafts', {
        seasonId: windowState.season.id,
        sessionId: windowState.session.id,
        returningMember: answer === 'yes',
      });
      const draft = response.data as { id: number };
      if (answer === 'yes' && !member) {
        navigate('/login', { state: { from: { pathname: `/registration/${draft.id}/identity` } } });
        return;
      }
      navigate(`/registration/${draft.id}/identity`);
    } catch (err) {
      setError(errorMessage(err, 'Unable to start registration.'));
    } finally {
      setLoading(false);
    }
  }

  async function attachReturningProfile(curlerMemberId: number) {
    if (!registrationId) return;
    setLoading(true);
    setError('');
    try {
      const response = await api.patch(`/registration/drafts/${registrationId}/identity-returning`, { curlerMemberId });
      const row = response.data as { id: number };
      const effectiveId = typeof row?.id === 'number' ? row.id : Number(registrationId);
      navigate(`/registration/${effectiveId}/policies`, { replace: true });
    } catch (err) {
      setError(errorMessage(err, 'Unable to select that curler profile.'));
    } finally {
      setLoading(false);
    }
  }

  async function submitNewIdentity(event: React.FormEvent) {
    event.preventDefault();
    if (!registrationId) return;
    setLoading(true);
    setError('');
    try {
      const endpoint = member
        ? `/registration/drafts/${registrationId}/identity-new-auth`
        : `/registration/drafts/${registrationId}/identity-new`;
      await api.patch(endpoint, {
        registeringForSelf: registeringForSelf === 'self',
        curler: demographics,
        submitter: member ? undefined : demographics,
        useSubmitterEmailForCurler: sameEmail === 'same',
      });
      if (!member) {
        navigate('/login', { state: { from: { pathname: `/registration/${registrationId}/policies` } } });
        return;
      }
      navigate(`/registration/${registrationId}/policies`);
    } catch (err) {
      setError(errorMessage(err, 'Unable to set up the registration account.'));
    } finally {
      setLoading(false);
    }
  }

  async function acceptPolicies(event: React.FormEvent) {
    event.preventDefault();
    if (!registrationId) return;
    setLoading(true);
    setError('');
    try {
      await api.patch(`/registration/drafts/${registrationId}/policies`, {
        acceptedPolicyTypes: ['code_of_conduct', 'maapp', 'privacy'],
      });
      navigate(`/registration/${registrationId}/demographics`);
    } catch (err) {
      setError(errorMessage(err, 'Unable to record policy acceptance.'));
    } finally {
      setLoading(false);
    }
  }

  async function submitDemographics(event: React.FormEvent) {
    event.preventDefault();
    if (!registrationId) return;
    setLoading(true);
    setError('');
    try {
      const response = await api.patch(`/registration/drafts/${registrationId}/demographics`, demographics);
      const data = response.data as RegistrationShellPayload;
      if (data.isMinor) navigate(`/registration/${registrationId}/guardian`);
      else navigate(`/registration/${registrationId}/complete`);
    } catch (err) {
      setError(errorMessage(err, 'Unable to save demographic information.'));
    } finally {
      setLoading(false);
    }
  }

  async function submitGuardian(event: React.FormEvent) {
    event.preventDefault();
    if (!registrationId) return;
    setLoading(true);
    setError('');
    try {
      await api.patch(`/registration/drafts/${registrationId}/guardian`, guardian);
      navigate(`/registration/${registrationId}/complete`);
    } catch (err) {
      setError(errorMessage(err, 'Unable to save parent/guardian information.'));
    } finally {
      setLoading(false);
    }
  }

  async function completeShell() {
    if (!registrationId) return;
    setLoading(true);
    setError('');
    try {
      await api.post(`/registration/drafts/${registrationId}/complete-shell`);
      navigate(`/registration/${registrationId}/membership`);
    } catch (err) {
      setError(errorMessage(err, 'Registration shell is not complete yet.'));
    } finally {
      setLoading(false);
    }
  }

  async function saveMembership(event: React.FormEvent) {
    event.preventDefault();
    if (!registrationId) return;
    setLoading(true);
    setError('');
    try {
      const response = await api.patch(`/registration/drafts/${registrationId}/membership`, {
        membershipOption: membershipChoice,
        basicIcePrivileges: false,
      });
      setPhase5(response.data as RegistrationPhase5Payload);
      navigate(membershipChoice === 'social' ? `/registration/${registrationId}/review` : `/registration/${registrationId}/discounts`);
    } catch (err) {
      setError(errorMessage(err, 'Unable to save membership choice.'));
    } finally {
      setLoading(false);
    }
  }

  async function saveDiscounts(event: React.FormEvent) {
    event.preventDefault();
    if (!registrationId) return;
    setLoading(true);
    setError('');
    try {
      const response = await api.patch(`/registration/drafts/${registrationId}/discounts`, {
        studentDiscountClaimed,
        studentInstitution,
        reciprocalDiscountClaimed,
        reciprocalClubName,
      });
      setPhase5(response.data as RegistrationPhase5Payload);
      navigate(`/registration/${registrationId}/experience`);
    } catch (err) {
      setError(errorMessage(err, 'Unable to save discounts.'));
    } finally {
      setLoading(false);
    }
  }

  async function saveExperience(event: React.FormEvent) {
    event.preventDefault();
    if (!registrationId) return;
    setLoading(true);
    setError('');
    try {
      const response = await api.patch(`/registration/drafts/${registrationId}/experience`, {
        experienceType: experienceChoice,
        experienceSelfReportedYears: experienceChoice === 'specified_years' ? Number(experienceYears) : null,
      });
      setPhase5(response.data as RegistrationPhase5Payload);
      navigate(`/registration/${registrationId}/basic-ice`);
    } catch (err) {
      setError(errorMessage(err, 'Unable to save curling experience.'));
    } finally {
      setLoading(false);
    }
  }

  async function saveBasicIce(event: React.FormEvent) {
    event.preventDefault();
    if (!registrationId) return;
    setLoading(true);
    setError('');
    try {
      const response = await api.patch(`/registration/drafts/${registrationId}/membership`, {
        membershipOption: 'regular',
        basicIcePrivileges,
      });
      setPhase5(response.data as RegistrationPhase5Payload);
      navigate(`/registration/${registrationId}/review`);
    } catch (err) {
      setError(errorMessage(err, 'Unable to save basic ice privileges.'));
    } finally {
      setLoading(false);
    }
  }

  async function submitRegistration() {
    if (!registrationId) return;
    setLoading(true);
    setError('');
    try {
      const response = await api.post(`/registration/drafts/${registrationId}/submit`);
      const result = response.data as { outcome: string; checkoutUrl?: string };
      if (result.checkoutUrl) {
        window.location.assign(result.checkoutUrl);
        return;
      }
      navigate(`/registration/${registrationId}/success`);
    } catch (err) {
      setError(errorMessage(err, 'Unable to submit registration.'));
    } finally {
      setLoading(false);
    }
  }

  function renderDemographicFields() {
    const setField = (field: keyof DemographicsForm) => (value: string) =>
      setDemographics((current) => ({ ...current, [field]: value }));
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {([
          ['firstName', 'First name', 'given-name'],
          ['lastName', 'Last name', 'family-name'],
          ['dateOfBirth', 'Date of birth', 'bday'],
          ['email', 'Email address', 'email'],
          ['phone', 'Phone number', 'tel'],
          ['mailingAddress', 'Mailing address', 'street-address'],
          ['emergencyContactName', 'Emergency contact name', 'name'],
          ['emergencyContactPhone', 'Emergency contact phone', 'tel'],
        ] as Array<[keyof DemographicsForm, string, string]>).map(([field, label, autoComplete]) => {
          const id = `registration-${field}`;
          return (
            <FormField key={field} label={label} htmlFor={id} required tone="public">
              <FieldInput
                id={id}
                type={field === 'dateOfBirth' ? 'date' : field === 'email' ? 'email' : 'text'}
                value={demographics[field]}
                onChange={setField(field)}
                autoComplete={autoComplete}
              />
            </FormField>
          );
        })}
      </div>
    );
  }

  function renderFeeSummary() {
    if (!phase5) {
      return <PublicStateCard title="Loading fees" description="Calculating your registration total." />;
    }
    const allLines = [...phase5.feePreview.lineItems, ...phase5.feePreview.discountLineItems];
    return (
      <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4">
        <h2 className="text-lg font-semibold text-[#121033]">Charges</h2>
        <div className="mt-3 divide-y divide-emerald-100">
          {allLines.map((line, index) => (
            <div key={`${line.lineType}-${index}`} className="flex items-start justify-between gap-4 py-2 text-sm">
              <span className="text-gray-700">{line.description}</span>
              <span className={line.amountMinor < 0 ? 'font-medium text-emerald-700' : 'font-medium text-gray-900'}>
                {formatCurrency(line.amountMinor)}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-emerald-200 pt-3">
          <span className="font-semibold text-[#121033]">Total due now</span>
          <span className="text-xl font-bold text-[#121033]">{formatCurrency(phase5.feePreview.totalDueMinor)}</span>
        </div>
      </div>
    );
  }

  let content: React.ReactNode;

  if (error && !windowState) {
    content = <PublicStateCard title="Registration unavailable" description={error} tone="error" />;
  } else if (!windowState) {
    content = <PublicStateCard title="Loading registration" description="Checking the current registration window." />;
  } else if (windowState.state === 'closed') {
    content = (
      <PublicStateCard
        title="Registration is closed"
        description={`Registration for ${seasonSessionLabel} is not open yet.`}
        tone="warning"
      />
    );
  } else if (currentStep === 'start') {
    content = (
      <RegistrationCard>
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary-teal">Registration</p>
        <h1 className="mt-3 text-3xl font-bold text-[#121033]">Start registration</h1>
        <p className="mt-3 text-gray-600">This registration is for one curler for {seasonSessionLabel}.</p>
        <FormField label="Is the curler a returning member?" required tone="public" className="mt-8">
          <ChoiceInput
            inputId={choiceInputId}
            layout="block"
            value={returningAnswer}
            onChange={(value) => setReturningAnswer(value as 'yes' | 'no')}
            options={[
              { value: 'yes', label: 'Yes', description: 'The curler has participated with the club before.' },
              { value: 'no', label: 'No', description: 'The curler is new to the club.' },
            ]}
          />
        </FormField>
        {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
        <Button className="mt-6" disabled={!returningAnswer || loading} onClick={() => returningAnswer && startDraft(returningAnswer)}>
          Continue
        </Button>
      </RegistrationCard>
    );
  } else if (currentStep === 'identity' && payload?.registration.returning_member_answer === 1) {
    content = (
      <RegistrationCard>
        <h1 className="text-3xl font-bold text-[#121033]">Who are you registering?</h1>
        <p className="mt-3 text-gray-600">Choose a profile you are allowed to register.</p>
        {!member ? (
          <Button className="mt-6" onClick={() => navigate('/login', { state: { from: { pathname: `/registration/${registrationId}/identity` } } })}>
            Log in to continue
          </Button>
        ) : (
          <FormField label="Curler profile" htmlFor={profileInputId} required tone="public" className="mt-6">
            <ChoiceInput
              inputId={profileInputId}
              layout="block"
              value={null}
              onChange={(value) => value && attachReturningProfile(Number(value))}
              options={profiles.map((profile) => ({
                value: profile.id,
                label: profile.name,
                description: [profile.email, profile.dateOfBirth ? `Born ${profile.dateOfBirth}` : null].filter(Boolean).join(' · '),
              }))}
              emptyText="No eligible profiles were found. Log in with the curler's email or contact staff."
            />
          </FormField>
        )}
        {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
      </RegistrationCard>
    );
  } else if (currentStep === 'identity') {
    content = (
      <RegistrationCard>
        <h1 className="text-3xl font-bold text-[#121033]">Account and curler setup</h1>
        <p className="mt-3 text-gray-600">Enter information for the person being registered.</p>
        <form onSubmit={submitNewIdentity} className="mt-6 space-y-6">
          <FormField label="Who are you registering?" required tone="public">
            <ChoiceInput
              layout="block"
              value={registeringForSelf}
              onChange={(value) => setRegisteringForSelf(value as 'self' | 'other')}
              options={[
                { value: 'self', label: 'I am registering myself' },
                { value: 'other', label: 'I am registering someone else' },
              ]}
            />
          </FormField>
          {registeringForSelf === 'other' ? (
            <FormField label="Curler email" required tone="public">
              <ChoiceInput
                layout="block"
                value={sameEmail}
                onChange={(value) => setSameEmail(value as 'same' | 'different')}
                options={[
                  { value: 'same', label: 'Use my email for the curler' },
                  { value: 'different', label: 'Use a different email for the curler' },
                ]}
              />
            </FormField>
          ) : null}
          {renderDemographicFields()}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <Button type="submit" disabled={loading}>Continue</Button>
        </form>
      </RegistrationCard>
    );
  } else if (currentStep === 'policies') {
    content = (
      <RegistrationCard>
        <h1 className="text-3xl font-bold text-[#121033]">Required policies</h1>
        <p className="mt-3 text-gray-600">The person submitting this registration agrees on behalf of the curler.</p>
        <form onSubmit={acceptPolicies} className="mt-6 space-y-4">
          {[
            ['Code of Conduct', '/go/conduct'],
            ['Minor Athlete Abuse Prevention Policy', '/go/maapp'],
            ['Privacy Policy', '/go/privacy'],
          ].map(([label, href]) => (
            <label key={href} className="flex gap-3 rounded-2xl border border-gray-200 p-4 text-gray-800">
              <input type="checkbox" required className="mt-1 h-4 w-4 rounded border-gray-300 text-primary-teal focus:ring-primary-teal" />
              <span>
                I agree to the <Link className="font-medium text-primary-teal underline" to={href}>{label}</Link>.
              </span>
            </label>
          ))}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <Button type="submit" disabled={loading}>Accept and continue</Button>
        </form>
      </RegistrationCard>
    );
  } else if (currentStep === 'demographics') {
    content = (
      <RegistrationCard>
        <h1 className="text-3xl font-bold text-[#121033]">Curler demographics</h1>
        <p className="mt-3 text-gray-600">Enter information for the person being registered.</p>
        <form onSubmit={submitDemographics} className="mt-6 space-y-6">
          {renderDemographicFields()}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <Button type="submit" disabled={loading}>Save and continue</Button>
        </form>
      </RegistrationCard>
    );
  } else if (currentStep === 'guardian') {
    content = (
      <RegistrationCard>
        <h1 className="text-3xl font-bold text-[#121033]">Parent/guardian information</h1>
        <p className="mt-3 text-gray-600">This is required because the curler is under 18.</p>
        <form onSubmit={submitGuardian} className="mt-6 grid gap-4 sm:grid-cols-2">
          {([
            ['firstName', 'First name', 'given-name'],
            ['lastName', 'Last name', 'family-name'],
            ['email', 'Email address', 'email'],
            ['phone', 'Phone number', 'tel'],
          ] as const).map(([field, label, autoComplete]) => {
            const id = `guardian-${field}`;
            return (
              <FormField key={field} label={label} htmlFor={id} required tone="public">
                <FieldInput
                  id={id}
                  type={field === 'email' ? 'email' : 'text'}
                  value={guardian[field]}
                  onChange={(value) => setGuardian((current) => ({ ...current, [field]: value }))}
                  autoComplete={autoComplete}
                />
              </FormField>
            );
          })}
          <div className="sm:col-span-2 flex flex-wrap gap-3">
            <Button type="button" variant="secondary" onClick={() => setGuardian((current) => ({ ...current, email: demographics.email }))}>
              Use curler email
            </Button>
            <Button type="button" variant="secondary" onClick={() => setGuardian((current) => ({ ...current, phone: demographics.phone }))}>
              Use curler phone
            </Button>
            <Button type="submit" disabled={loading}>Save and continue</Button>
          </div>
          {error ? <p className="sm:col-span-2 text-sm text-red-600">{error}</p> : null}
        </form>
      </RegistrationCard>
    );
  } else if (currentStep === 'complete') {
    content = (
      <RegistrationCard>
        <h1 className="text-3xl font-bold text-[#121033]">Registration shell complete</h1>
        <p className="mt-3 text-gray-600">
          Identity, policies, demographics, and any required parent/guardian information are ready for the next phase.
        </p>
        {payload?.registration.status !== 'shell_complete' ? (
          <Button className="mt-6" onClick={completeShell} disabled={loading}>Mark shell complete</Button>
        ) : (
          <Link className="mt-6 inline-flex rounded-lg bg-primary-teal px-4 py-2 text-sm font-medium text-white" to={`/registration/${registrationId}/membership`}>
            Continue to membership
          </Link>
        )}
        {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
      </RegistrationCard>
    );
  } else if (currentStep === 'membership') {
    content = (
      <RegistrationCard>
        <h1 className="text-3xl font-bold text-[#121033]">Choose membership</h1>
        <p className="mt-3 text-gray-600">Regular membership is for curlers. Social membership is for members who do not plan to curl.</p>
        <form onSubmit={saveMembership} className="mt-6 space-y-6">
          <FormField label="Membership type" htmlFor={membershipInputId} required tone="public">
            <ChoiceInput
              inputId={membershipInputId}
              layout="block"
              value={membershipChoice}
              onChange={(value) => setMembershipChoice(value as 'regular' | 'social')}
              options={[
                { value: 'regular', label: 'Regular membership', description: 'Choose this if the curler plans to curl, spare, practice, or register for leagues.' },
                { value: 'social', label: 'Social membership', description: 'Choose this if the curler wants to be a member but will not curl this session.' },
              ]}
            />
          </FormField>
          {membershipChoice === 'social' ? (
            <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              Social members do not receive discounts, basic ice privileges, or league access.
            </p>
          ) : null}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <Button type="submit" disabled={loading}>Continue</Button>
        </form>
      </RegistrationCard>
    );
  } else if (currentStep === 'discounts') {
    const showWinterOnly = phase5 && !phase5.isFirstSessionOfSeason;
    content = (
      <RegistrationCard>
        <h1 className="text-3xl font-bold text-[#121033]">Discounts</h1>
        <p className="mt-3 text-gray-600">Student and reciprocal discounts are automatically approved when the required information is provided.</p>
        <form onSubmit={saveDiscounts} className="mt-6 space-y-5">
          {showWinterOnly ? (
            <p className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
              The winter-only discount is available for this session and will be applied to regular membership dues.
            </p>
          ) : null}
          <FormCheckbox
            tone="public"
            label="Claim student discount"
            checked={studentDiscountClaimed}
            onChange={setStudentDiscountClaimed}
            helperText="Available for K-12 students and full-time college or university students."
          />
          {studentDiscountClaimed ? (
            <FormField label="Institution of study" htmlFor="student-institution" required tone="public">
              <FieldInput id="student-institution" value={studentInstitution} onChange={setStudentInstitution} />
            </FormField>
          ) : null}
          <FormCheckbox
            tone="public"
            label="Claim reciprocal club discount"
            checked={reciprocalDiscountClaimed}
            onChange={setReciprocalDiscountClaimed}
            helperText="Available to members of another dedicated ice or arena curling club."
          />
          {reciprocalDiscountClaimed ? (
            <FormField label="Other curling club" htmlFor="reciprocal-club" required tone="public">
              <FieldInput id="reciprocal-club" value={reciprocalClubName} onChange={setReciprocalClubName} />
            </FormField>
          ) : null}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={loading}>Continue</Button>
            <Button type="button" variant="secondary" onClick={() => navigate(`/registration/${registrationId}/membership`)}>
              Back
            </Button>
          </div>
        </form>
      </RegistrationCard>
    );
  } else if (currentStep === 'experience') {
    content = (
      <RegistrationCard>
        <h1 className="text-3xl font-bold text-[#121033]">Curling experience</h1>
        <p className="mt-3 text-gray-600">This helps check league eligibility in the next registration phase.</p>
        <form onSubmit={saveExperience} className="mt-6 space-y-6">
          <FormField label="Previous curling experience" htmlFor={experienceInputId} required tone="public">
            <ChoiceInput
              inputId={experienceInputId}
              layout="block"
              value={experienceChoice}
              onChange={(value) => setExperienceChoice(value as 'none_or_minimal' | 'specified_years' | 'known_existing')}
              options={[
                { value: 'none_or_minimal', label: 'None or minimal' },
                { value: 'specified_years', label: 'I have curled before' },
                ...(phase5?.knownExperienceYears
                  ? [{ value: 'known_existing', label: `Use club record (${phase5.knownExperienceYears} years)` }]
                  : []),
              ]}
            />
          </FormField>
          {experienceChoice === 'specified_years' ? (
            <FormField label="Years of experience" htmlFor="experience-years" required tone="public">
              <FieldInput id="experience-years" type="number" step="0.5" value={experienceYears} onChange={setExperienceYears} />
            </FormField>
          ) : null}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={loading}>Continue</Button>
            <Button type="button" variant="secondary" onClick={() => navigate(`/registration/${registrationId}/discounts`)}>
              Back
            </Button>
          </div>
        </form>
      </RegistrationCard>
    );
  } else if (currentStep === 'basic-ice') {
    content = (
      <RegistrationCard>
        <h1 className="text-3xl font-bold text-[#121033]">Basic ice privileges</h1>
        <p className="mt-3 text-gray-600">Basic ice privileges cover sparing and practice for {seasonSessionLabel} without selecting a league in this phase.</p>
        <form onSubmit={saveBasicIce} className="mt-6 space-y-6">
          <FormCheckbox
            tone="public"
            label="I want basic ice privileges for this session"
            checked={basicIcePrivileges}
            onChange={setBasicIcePrivileges}
            helperText="This adds the configured spare-only ice privilege fee to regular membership."
          />
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={loading}>Continue to review</Button>
            <Button type="button" variant="secondary" onClick={() => navigate(`/registration/${registrationId}/experience`)}>
              Back
            </Button>
          </div>
        </form>
      </RegistrationCard>
    );
  } else if (currentStep === 'review') {
    content = (
      <RegistrationCard>
        <h1 className="text-3xl font-bold text-[#121033]">Review and pay</h1>
        <p className="mt-3 text-gray-600">Review the registration for {payload?.curler?.name || 'this curler'} before payment.</p>
        <div className="mt-6 space-y-4">
          <div className="rounded-2xl border border-gray-200 p-4 text-sm text-gray-700">
            <p><span className="font-medium text-gray-900">Membership:</span> {phase5?.selection.membershipOption === 'social' ? 'Social membership' : 'Regular membership'}</p>
            {phase5?.selection.membershipOption === 'regular_spare_only' ? (
              <p><span className="font-medium text-gray-900">Basic ice privileges:</span> Included for this session</p>
            ) : null}
            {phase5?.selection.studentDiscountClaimed ? <p><span className="font-medium text-gray-900">Student discount:</span> {phase5.selection.studentInstitution}</p> : null}
            {phase5?.selection.reciprocalDiscountClaimed ? <p><span className="font-medium text-gray-900">Reciprocal discount:</span> {phase5.selection.reciprocalClubName}</p> : null}
            {phase5?.selection.experienceType ? <p><span className="font-medium text-gray-900">Experience:</span> {phase5.selection.experienceType === 'specified_years' ? `${phase5.selection.experienceSelfReportedYears} years` : phase5.selection.experienceType === 'known_existing' ? `${phase5.knownExperienceYears} years from club records` : 'None or minimal'}</p> : null}
          </div>
          {renderFeeSummary()}
          <p className="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
            {phase5?.paymentDecision.outcome === 'deferred_payment'
              ? 'No payment is due now. We will contact you when your registration is ready for payment.'
              : phase5?.paymentDecision.outcome === 'no_payment_required'
                ? 'No payment is required now.'
                : 'Payment is due now to complete this registration.'}
          </p>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <div className="flex flex-wrap gap-3">
            <Button type="button" disabled={loading || !phase5} onClick={submitRegistration}>
              {phase5?.paymentDecision.outcome === 'immediate_payment' ? 'Submit and pay' : 'Submit registration'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => navigate(`/registration/${registrationId}/basic-ice`)}>
              Back
            </Button>
          </div>
        </div>
      </RegistrationCard>
    );
  } else if (currentStep === 'success') {
    content = (
      <RegistrationCard>
        <h1 className="text-3xl font-bold text-[#121033]">Registration submitted</h1>
        <p className="mt-3 text-gray-600">
          If payment was required, the registration will be confirmed after payment is processed.
        </p>
        <Link className="mt-6 inline-flex rounded-lg bg-primary-teal px-4 py-2 text-sm font-medium text-white" to="/dashboard">
          Return to dashboard
        </Link>
      </RegistrationCard>
    );
  } else if (currentStep === 'cancel') {
    content = (
      <RegistrationCard>
        <h1 className="text-3xl font-bold text-[#121033]">Payment was not completed</h1>
        <p className="mt-3 text-gray-600">Your registration is not confirmed yet. You can return to review and start checkout again.</p>
        <Link className="mt-6 inline-flex rounded-lg bg-primary-teal px-4 py-2 text-sm font-medium text-white" to={`/registration/${registrationId}/review`}>
          Return to review
        </Link>
      </RegistrationCard>
    );
  } else {
    content = <PublicStateCard title="Registration step not found" description="Return to the start of registration and continue from the next incomplete step." tone="warning" />;
  }

  return (
    <PublicLayout>
      <div className="bg-gradient-to-b from-emerald-50 via-white to-white px-4 py-12">
        {content}
      </div>
    </PublicLayout>
  );
}
