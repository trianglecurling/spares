import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import api from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { useConfirm } from '../contexts/ConfirmContext';
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

type RegistrationMembershipPaymentPayload = {
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

type RegistrationSelectionType =
  | 'guaranteed_return'
  | 'sabbatical'
  | 'drop'
  | 'return_subject_to_availability'
  | 'waitlist_add'
  | 'waitlist_replace'
  | 'third_league_interest'
  | 'byot_request'
  | 'junior_recreational'
  | 'spare_only';

type RegistrationSelectionInput = {
  selectionType: RegistrationSelectionType;
  leagueId?: number | null;
  rank?: number | null;
  replacesLeagueId?: number | null;
  byotTeammateText?: string | null;
  isTemporarySabbaticalFill?: boolean;
};

type LeagueCatalogItem = {
  id: number;
  sessionId?: number | null;
  name: string;
  leagueType: 'standard' | 'bring_your_own_team';
  minExperienceYears?: number | null;
  minAge?: number | null;
  maxAge?: number | null;
  predecessorLeagueId?: number | null;
  allowsWaitlist: boolean;
  allowsSabbatical: boolean;
};

type RegistrationLeagueSelectionPayload = {
  leagues: LeagueCatalogItem[];
  selections: RegistrationSelectionInput[];
  activeLeagueIds: number[];
  participatedLeagueIds: number[];
  evaluation: {
    feePreview: RegistrationMembershipPaymentPayload['feePreview'];
    paymentDecision: RegistrationMembershipPaymentPayload['paymentDecision'];
  };
};

type LocalRegistrationDraftV1 = {
  v: 1;
  seasonId: number;
  sessionId: number;
  returningAnswer: 'no';
  registeringForSelf: 'self' | 'other';
  sameEmail: 'same' | 'different';
  demographics: DemographicsForm;
  guardian: { firstName: string; lastName: string; email: string; phone: string };
  membershipChoice: 'regular' | 'social';
  basicIcePrivileges: boolean;
  studentDiscountClaimed: boolean;
  studentInstitution: string;
  reciprocalDiscountClaimed: boolean;
  reciprocalClubName: string;
  experienceChoice: 'none_or_minimal' | 'specified_years' | 'known_existing';
  experienceYears: string;
  step: string;
};

const LOCAL_DRAFT_KEY = 'thebroomstack.registrationDraft.v1';

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

function isMinorDate(dateOfBirth: string): boolean {
  const birth = new Date(`${dateOfBirth}T00:00:00Z`);
  if (Number.isNaN(birth.getTime())) return false;
  const today = new Date();
  let age = today.getUTCFullYear() - birth.getUTCFullYear();
  const monthDiff = today.getUTCMonth() - birth.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getUTCDate() < birth.getUTCDate())) {
    age -= 1;
  }
  return age < 18;
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
  if (
    ['submitted', 'awaiting_staff_review', 'awaiting_placement', 'awaiting_payment', 'payment_started', 'paid', 'confirmed'].includes(
      payload.registration.status,
    )
  )
    return 'review';
  if (!payload.curler?.dateOfBirth || !payload.curler.mailingAddress || !payload.curler.emergencyContactName) return 'demographics';
  if (payload.isMinor && !payload.registration.guardian_email) return 'guardian';
  return 'membership';
}

function loadLocalDraft(): LocalRegistrationDraftV1 | null {
  try {
    const raw = localStorage.getItem(LOCAL_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalRegistrationDraftV1;
    if (parsed?.v !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveLocalDraft(draft: LocalRegistrationDraftV1) {
  localStorage.setItem(LOCAL_DRAFT_KEY, JSON.stringify(draft));
}

function clearLocalDraft() {
  localStorage.removeItem(LOCAL_DRAFT_KEY);
}

function buildGuestDraftBase(
  windowState: RegistrationWindow,
  partial: Partial<Omit<LocalRegistrationDraftV1, 'v' | 'seasonId' | 'sessionId' | 'returningAnswer'>> & {
    step: string;
  },
): LocalRegistrationDraftV1 {
  return {
    v: 1,
    seasonId: windowState.season.id,
    sessionId: windowState.session.id,
    returningAnswer: 'no',
    registeringForSelf: partial.registeringForSelf ?? 'self',
    sameEmail: partial.sameEmail ?? 'same',
    demographics: partial.demographics ?? emptyDemographics,
    guardian: partial.guardian ?? { firstName: '', lastName: '', email: '', phone: '' },
    membershipChoice: partial.membershipChoice ?? 'regular',
    basicIcePrivileges: partial.basicIcePrivileges ?? false,
    studentDiscountClaimed: partial.studentDiscountClaimed ?? false,
    studentInstitution: partial.studentInstitution ?? '',
    reciprocalDiscountClaimed: partial.reciprocalDiscountClaimed ?? false,
    reciprocalClubName: partial.reciprocalClubName ?? '',
    experienceChoice: partial.experienceChoice ?? 'none_or_minimal',
    experienceYears: partial.experienceYears ?? '',
    step: partial.step,
  };
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
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { step: stepParam } = useParams<{ step: string }>();
  const { member } = useAuth();
  const { confirm } = useConfirm();
  const [windowState, setWindowState] = useState<RegistrationWindow | null>(null);
  const [payload, setPayload] = useState<RegistrationShellPayload | null>(null);
  const [registrationId, setRegistrationId] = useState<number | null>(null);
  const [profiles, setProfiles] = useState<MemberSummary[]>([]);
  const [returningAnswer, setReturningAnswer] = useState<'yes' | 'no' | null>(null);
  const [registeringForSelf, setRegisteringForSelf] = useState<'self' | 'other'>('self');
  const [sameEmail, setSameEmail] = useState<'same' | 'different'>('same');
  const [demographics, setDemographics] = useState<DemographicsForm>(emptyDemographics);
  const [guardian, setGuardian] = useState({ firstName: '', lastName: '', email: '', phone: '' });
  const [membershipPayment, setMembershipPayment] = useState<RegistrationMembershipPaymentPayload | null>(null);
  const [membershipChoice, setMembershipChoice] = useState<'regular' | 'social' | 'junior_recreational'>('regular');
  const [juniorAssistancePercent, setJuniorAssistancePercent] = useState<'0' | '25' | '50' | '75'>('0');
  const [basicIcePrivileges, setBasicIcePrivileges] = useState(false);
  const [studentDiscountClaimed, setStudentDiscountClaimed] = useState(false);
  const [studentInstitution, setStudentInstitution] = useState('');
  const [reciprocalDiscountClaimed, setReciprocalDiscountClaimed] = useState(false);
  const [reciprocalClubName, setReciprocalClubName] = useState('');
  const [experienceChoice, setExperienceChoice] = useState<'none_or_minimal' | 'specified_years' | 'known_existing'>('none_or_minimal');
  const [experienceYears, setExperienceYears] = useState('');
  const [leaguePayload, setLeaguePayload] = useState<RegistrationLeagueSelectionPayload | null>(null);
  const [leagueSelections, setLeagueSelections] = useState<RegistrationSelectionInput[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resumeOffer, setResumeOffer] = useState<'none' | 'server' | 'local'>('none');
  const [serverResume, setServerResume] = useState<(RegistrationShellPayload & { id: number }) | null>(null);

  const profileInputId = useId();
  const choiceInputId = useId();
  const membershipInputId = useId();
  const experienceInputId = useId();

  const currentStep = useMemo(() => {
    if (location.pathname === '/registration/start') return 'start';
    if (location.pathname === '/registration/success') return 'success';
    if (location.pathname === '/registration/cancel') return 'cancel';
    return stepParam || 'start';
  }, [location.pathname, stepParam]);

  const paymentRegistrationId = useMemo(() => {
    const raw = searchParams.get('registration_id');
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }, [searchParams]);

  const isGuestLocal = !member;

  const hydrateFromServerPayload = useCallback((data: RegistrationShellPayload & { id: number }) => {
    const { id, ...shell } = data;
    setRegistrationId(id);
    setPayload(shell as RegistrationShellPayload);
    setDemographics(demographicsFromMember(data.curler));
    setGuardian({
      firstName: data.registration.guardian_first_name || '',
      lastName: data.registration.guardian_last_name || '',
      email: data.registration.guardian_email || '',
      phone: data.registration.guardian_phone || '',
    });
  }, []);

  const applyGuestDraftToState = useCallback((draft: LocalRegistrationDraftV1) => {
    setRegisteringForSelf(draft.registeringForSelf);
    setSameEmail(draft.sameEmail);
    setDemographics(draft.demographics);
    setGuardian(draft.guardian);
    setMembershipChoice(draft.membershipChoice);
    setBasicIcePrivileges(draft.basicIcePrivileges);
    setStudentDiscountClaimed(draft.studentDiscountClaimed);
    setStudentInstitution(draft.studentInstitution);
    setReciprocalDiscountClaimed(draft.reciprocalDiscountClaimed);
    setReciprocalClubName(draft.reciprocalClubName);
    setExperienceChoice(draft.experienceChoice);
    setExperienceYears(draft.experienceYears);
  }, []);

  const persistGuestDraft = useCallback(
    (step: string) => {
      if (!windowState || member) return;
      saveLocalDraft(
        buildGuestDraftBase(windowState, {
          registeringForSelf,
          sameEmail,
          demographics,
          guardian,
          membershipChoice: membershipChoice === 'junior_recreational' ? 'regular' : membershipChoice,
          basicIcePrivileges,
          studentDiscountClaimed,
          studentInstitution,
          reciprocalDiscountClaimed,
          reciprocalClubName,
          experienceChoice,
          experienceYears,
          step,
        }),
      );
    },
    [
      windowState,
      member,
      registeringForSelf,
      sameEmail,
      demographics,
      guardian,
      membershipChoice,
      basicIcePrivileges,
      studentDiscountClaimed,
      studentInstitution,
      reciprocalDiscountClaimed,
      reciprocalClubName,
      experienceChoice,
      experienceYears,
    ],
  );

  useEffect(() => {
    api
      .get('/registration/window')
      .then((response) => setWindowState(response.data))
      .catch((err) => setError(errorMessage(err, 'Registration is not available.')));
  }, []);

  useEffect(() => {
    if (currentStep !== 'start' || !windowState) return;
    let cancelled = false;
    setResumeOffer('none');
    setServerResume(null);
    (async () => {
      if (member) {
        try {
          const { data } = await api.get<{ draft: (RegistrationShellPayload & { id: number }) | null }>('/registration/drafts/me');
          if (cancelled) return;
          if (data.draft) {
            setServerResume(data.draft);
            setResumeOffer('server');
          }
        } catch {
          if (!cancelled) setResumeOffer('none');
        }
      } else {
        const local = loadLocalDraft();
        if (
          local &&
          local.seasonId === windowState.season.id &&
          local.sessionId === windowState.session.id &&
          local.returningAnswer === 'no'
        ) {
          if (!cancelled) setResumeOffer('local');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentStep, member, windowState]);

  useEffect(() => {
    if (!member || currentStep === 'start' || currentStep === 'success' || currentStep === 'cancel') return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get<{ draft: (RegistrationShellPayload & { id: number }) | null }>('/registration/drafts/me');
        if (cancelled) return;
        if (!data.draft) {
          navigate('/registration/start', { replace: true });
          return;
        }
        hydrateFromServerPayload(data.draft);
        const target = nextStepFor(data.draft);
        if (currentStep === 'identity' && target !== 'identity') {
          navigate(`/registration/${target}`, { replace: true });
        }
      } catch (err) {
        if (!cancelled) setError(errorMessage(err, 'Unable to load this registration draft.'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [member, currentStep, navigate, hydrateFromServerPayload]);

  useEffect(() => {
    if (!isGuestLocal || !windowState || ['start', 'success', 'cancel'].includes(currentStep)) return;
    const local = loadLocalDraft();
    if (!local || local.seasonId !== windowState.season.id || local.sessionId !== windowState.session.id) {
      navigate('/registration/start', { replace: true });
    } else {
      applyGuestDraftToState(local);
    }
  }, [isGuestLocal, windowState, currentStep, navigate, applyGuestDraftToState]);

  useEffect(() => {
    if (currentStep !== 'identity' || !member || payload?.registration.returning_member_answer !== 1) return;
    api
      .get('/registration/returning-profiles')
      .then((response) => setProfiles(response.data))
      .catch((err) => setError(errorMessage(err, 'Unable to load eligible curler profiles.')));
  }, [currentStep, member, payload]);

  useEffect(() => {
    const membershipPaymentFlowSteps = ['membership', 'discounts', 'experience', 'basic-ice', 'league-selection', 'third-league-interest', 'league-summary', 'review'];
    if (!member || !registrationId || !membershipPaymentFlowSteps.includes(currentStep)) return;
    api
      .get(`/registration/drafts/${registrationId}/membership-payment`)
      .then((response) => {
        const data = response.data as RegistrationMembershipPaymentPayload;
        setMembershipPayment(data);
        const membershipOption = data.selection.membershipOption;
        setMembershipChoice(membershipOption === 'junior_recreational' ? 'junior_recreational' : membershipOption === 'social' ? 'social' : 'regular');
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
    const leagueSteps = ['league-selection', 'third-league-interest', 'league-summary', 'review'];
    if (!member || !registrationId || !leagueSteps.includes(currentStep)) return;
    api
      .get(`/registration/drafts/${registrationId}/league-catalog`)
      .then((response) => {
        const data = response.data as RegistrationLeagueSelectionPayload;
        setLeaguePayload(data);
        setLeagueSelections(data.selections);
      })
      .catch((err) => setError(errorMessage(err, 'Unable to load league choices.')));
  }, [registrationId, member, currentStep]);

  useEffect(() => {
    const guestPhaseSteps = ['discounts', 'experience', 'basic-ice', 'review'];
    if (!isGuestLocal || !windowState || !guestPhaseSteps.includes(currentStep)) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.post<RegistrationMembershipPaymentPayload>('/registration/guest/preview-membership-payment', {
          seasonId: windowState.season.id,
          sessionId: windowState.session.id,
          curlerDateOfBirth: demographics.dateOfBirth,
          membershipChoice,
          basicIcePrivileges,
          studentDiscountClaimed,
          studentInstitution: studentInstitution || null,
          reciprocalDiscountClaimed,
          reciprocalClubName: reciprocalClubName || null,
          experienceType: experienceChoice,
          experienceSelfReportedYears: experienceChoice === 'specified_years' ? Number(experienceYears) : null,
        });
        if (!cancelled) setMembershipPayment(data);
      } catch (err) {
        if (!cancelled) setError(errorMessage(err, 'Unable to load membership preview.'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    currentStep,
    isGuestLocal,
    windowState,
    demographics.dateOfBirth,
    membershipChoice,
    basicIcePrivileges,
    studentDiscountClaimed,
    studentInstitution,
    reciprocalDiscountClaimed,
    reciprocalClubName,
    experienceChoice,
    experienceYears,
  ]);

  useEffect(() => {
    if (currentStep !== 'cancel' || !paymentRegistrationId || !member) return;
    api.post(`/registration/drafts/${paymentRegistrationId}/payment-cancelled`).catch(() => {});
  }, [currentStep, paymentRegistrationId, member]);

  const seasonSessionLabel = useMemo(() => {
    if (!windowState) return 'the upcoming season';
    return `${windowState.season.name} · ${windowState.session.name}`;
  }, [windowState]);

  async function handleStartOver() {
    const accepted = await confirm({
      title: 'Start over?',
      message:
        'This clears your in-progress registration and returns you to the registration start page. This cannot be undone.',
      confirmText: 'Start over',
      variant: 'warning',
    });
    if (!accepted) return;
    setError('');
    setLoading(true);
    try {
      if (member) {
        try {
          const { data } = await api.get<{ draft: { id: number } | null }>('/registration/drafts/me');
          if (data.draft) {
            await api.delete(`/registration/drafts/${data.draft.id}`);
          }
        } catch (err) {
          if (registrationId !== null) {
            await api.delete(`/registration/drafts/${registrationId}`);
          } else {
            throw err;
          }
        }
      }
      clearLocalDraft();
      setRegistrationId(null);
      setPayload(null);
      setMembershipPayment(null);
      setResumeOffer('none');
      setServerResume(null);
      setReturningAnswer(null);
      navigate('/registration/start', { replace: true });
    } catch (err) {
      setError(errorMessage(err, 'Unable to clear registration.'));
    } finally {
      setLoading(false);
    }
  }

  async function handleResumeLocalContinue() {
    const local = loadLocalDraft();
    if (!local) {
      setResumeOffer('none');
      return;
    }
    applyGuestDraftToState(local);
    navigate(`/registration/${local.step}`, { replace: true });
  }

  async function handleResumeServerContinue() {
    if (!serverResume) return;
    hydrateFromServerPayload(serverResume);
    const target = nextStepFor(serverResume);
    setResumeOffer('none');
    navigate(`/registration/${target}`, { replace: true });
  }

  async function handleResumeDiscard() {
    const accepted = await confirm({
      title: 'Start from the beginning?',
      message: 'Your saved progress will be removed.',
      confirmText: 'Discard progress',
      variant: 'warning',
    });
    if (!accepted) return;
    if (resumeOffer === 'server' && serverResume) {
      try {
        await api.delete(`/registration/drafts/${serverResume.id}`);
      } catch (err) {
        setError(errorMessage(err, 'Unable to discard registration.'));
        return;
      }
    } else if (resumeOffer === 'local') {
      clearLocalDraft();
    }
    setServerResume(null);
    setResumeOffer('none');
  }

  async function startDraft(answer: 'yes' | 'no') {
    if (!windowState) return;
    setLoading(true);
    setError('');
    try {
      if (answer === 'yes') {
        if (!member) {
          navigate('/login', { state: { from: { pathname: '/registration/start' } } });
          return;
        }
        const response = await api.post('/registration/drafts', {
          seasonId: windowState.season.id,
          sessionId: windowState.session.id,
          returningMember: true,
        });
        const draft = response.data as { id: number };
        setRegistrationId(draft.id);
        navigate('/registration/identity');
        return;
      }
      if (member) {
        const response = await api.post('/registration/drafts', {
          seasonId: windowState.season.id,
          sessionId: windowState.session.id,
          returningMember: false,
        });
        const draft = response.data as { id: number };
        setRegistrationId(draft.id);
        navigate('/registration/identity');
        return;
      }
      saveLocalDraft(
        buildGuestDraftBase(windowState, {
          step: 'identity',
        }),
      );
      navigate('/registration/identity');
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
      setRegistrationId(effectiveId);
      navigate('/registration/policies', { replace: true });
    } catch (err) {
      setError(errorMessage(err, 'Unable to select that curler profile.'));
    } finally {
      setLoading(false);
    }
  }

  async function submitNewIdentity(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      if (member && registrationId !== null) {
        await api.patch(`/registration/drafts/${registrationId}/identity-new`, {
          registeringForSelf: registeringForSelf === 'self',
          curler: demographics,
          submitter: member ? undefined : demographics,
          useSubmitterEmailForCurler: sameEmail === 'same',
        });
        navigate('/registration/policies');
      } else if (windowState) {
        persistGuestDraft('policies');
        navigate('/registration/policies');
      }
    } catch (err) {
      setError(errorMessage(err, 'Unable to set up the registration account.'));
    } finally {
      setLoading(false);
    }
  }

  async function acceptPolicies(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      if (member && registrationId !== null) {
        await api.patch(`/registration/drafts/${registrationId}/policies`, {
          acceptedPolicyTypes: ['code_of_conduct', 'maapp', 'privacy'],
        });
        navigate('/registration/demographics');
      } else {
        persistGuestDraft('demographics');
        navigate('/registration/demographics');
      }
    } catch (err) {
      setError(errorMessage(err, 'Unable to record policy acceptance.'));
    } finally {
      setLoading(false);
    }
  }

  async function submitDemographics(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      if (member && registrationId !== null) {
        const response = await api.patch(`/registration/drafts/${registrationId}/demographics`, demographics);
        const data = response.data as RegistrationShellPayload;
        if (data.isMinor) navigate('/registration/guardian');
        else navigate('/registration/complete');
      } else if (isMinorDate(demographics.dateOfBirth)) {
        persistGuestDraft('guardian');
        navigate('/registration/guardian');
      } else {
        persistGuestDraft('complete');
        navigate('/registration/complete');
      }
    } catch (err) {
      setError(errorMessage(err, 'Unable to save demographic information.'));
    } finally {
      setLoading(false);
    }
  }

  async function submitGuardian(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      if (member && registrationId !== null) {
        await api.patch(`/registration/drafts/${registrationId}/guardian`, guardian);
        navigate('/registration/complete');
      } else {
        persistGuestDraft('complete');
        navigate('/registration/complete');
      }
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
      navigate('/registration/membership');
    } catch (err) {
      setError(errorMessage(err, 'Registration shell is not complete yet.'));
    } finally {
      setLoading(false);
    }
  }

  async function saveMembership(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      if (member && registrationId !== null) {
        const response = await api.patch(`/registration/drafts/${registrationId}/membership`, {
          membershipOption: membershipChoice,
          basicIcePrivileges: false,
          juniorAssistancePercent: membershipChoice === 'junior_recreational' ? Number(juniorAssistancePercent) : 0,
        });
        setMembershipPayment(response.data as RegistrationMembershipPaymentPayload);
        navigate(
          membershipChoice === 'social'
            ? '/registration/review'
            : membershipChoice === 'junior_recreational'
              ? '/registration/league-summary'
              : '/registration/discounts'
        );
      } else {
        persistGuestDraft(membershipChoice === 'social' ? 'review' : 'discounts');
        navigate(membershipChoice === 'social' ? '/registration/review' : '/registration/discounts');
      }
    } catch (err) {
      setError(errorMessage(err, 'Unable to save membership choice.'));
    } finally {
      setLoading(false);
    }
  }

  async function saveDiscounts(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      if (member && registrationId !== null) {
        const response = await api.patch(`/registration/drafts/${registrationId}/discounts`, {
          studentDiscountClaimed,
          studentInstitution,
          reciprocalDiscountClaimed,
          reciprocalClubName,
        });
        setMembershipPayment(response.data as RegistrationMembershipPaymentPayload);
        navigate('/registration/experience');
      } else {
        persistGuestDraft('experience');
        navigate('/registration/experience');
      }
    } catch (err) {
      setError(errorMessage(err, 'Unable to save discounts.'));
    } finally {
      setLoading(false);
    }
  }

  async function saveExperience(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      if (member && registrationId !== null) {
        const response = await api.patch(`/registration/drafts/${registrationId}/experience`, {
          experienceType: experienceChoice,
          experienceSelfReportedYears: experienceChoice === 'specified_years' ? Number(experienceYears) : null,
        });
        setMembershipPayment(response.data as RegistrationMembershipPaymentPayload);
        navigate('/registration/basic-ice');
      } else {
        persistGuestDraft('basic-ice');
        navigate('/registration/basic-ice');
      }
    } catch (err) {
      setError(errorMessage(err, 'Unable to save curling experience.'));
    } finally {
      setLoading(false);
    }
  }

  async function saveBasicIce(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      if (member && registrationId !== null) {
        const response = await api.patch(`/registration/drafts/${registrationId}/membership`, {
          membershipOption: 'regular',
          basicIcePrivileges,
        });
        setMembershipPayment(response.data as RegistrationMembershipPaymentPayload);
        navigate('/registration/league-selection');
      } else {
        persistGuestDraft('review');
        navigate('/registration/review');
      }
    } catch (err) {
      setError(errorMessage(err, 'Unable to save basic ice privileges.'));
    } finally {
      setLoading(false);
    }
  }

  async function saveLeagueSelections(nextStep = '/registration/third-league-interest') {
    if (!registrationId) return;
    setLoading(true);
    setError('');
    try {
      const response = await api.put(`/registration/drafts/${registrationId}/league-selections`, {
        selections: leagueSelections,
      });
      const data = response.data as RegistrationLeagueSelectionPayload;
      setLeaguePayload(data);
      setLeagueSelections(data.selections);
      navigate(nextStep);
    } catch (err) {
      setError(errorMessage(err, 'Unable to save league selections.'));
    } finally {
      setLoading(false);
    }
  }

  function updateLeagueSelection(leagueId: number, selectionType: RegistrationSelectionType | 'none') {
    setLeagueSelections((current) => {
      const withoutLeague = current.filter((selection) => selection.leagueId !== leagueId || selection.selectionType === 'third_league_interest');
      if (selectionType === 'none') return withoutLeague;
      return [...withoutLeague, { selectionType, leagueId }];
    });
  }

  function updateThirdLeagueInterest(leagueId: number, checked: boolean) {
    setLeagueSelections((current) => {
      const others = current.filter((selection) => !(selection.leagueId === leagueId && selection.selectionType === 'third_league_interest'));
      if (!checked) return others;
      const nextRank = current.filter((selection) => selection.selectionType === 'third_league_interest').length + 1;
      return [...others, { selectionType: 'third_league_interest', leagueId, rank: nextRank }];
    });
  }

  function updateByotTeammates(leagueId: number, text: string) {
    setLeagueSelections((current) =>
      current.map((selection) => (selection.leagueId === leagueId && selection.selectionType === 'byot_request' ? { ...selection, byotTeammateText: text } : selection))
    );
  }

  async function submitRegistration() {
    setLoading(true);
    setError('');
    try {
      if (member && registrationId !== null) {
        const response = await api.post(`/registration/drafts/${registrationId}/submit`);
        const result = response.data as { outcome: string; checkoutUrl?: string };
        if (result.checkoutUrl) {
          window.location.assign(result.checkoutUrl);
          return;
        }
        navigate('/registration/success');
      } else if (windowState) {
        const { data } = await api.post<{ outcome: string; checkoutUrl?: string; registrationId?: number }>('/registration/guest/submit', {
          seasonId: windowState.season.id,
          sessionId: windowState.session.id,
          registeringForSelf: registeringForSelf === 'self',
          useSubmitterEmailForCurler: sameEmail === 'same',
          submitter: registeringForSelf === 'self' ? undefined : demographics,
          curler: demographics,
          guardian: isMinorDate(demographics.dateOfBirth) ? guardian : undefined,
          membershipChoice,
          basicIcePrivileges,
          studentDiscountClaimed,
          studentInstitution: studentInstitution || null,
          reciprocalDiscountClaimed,
          reciprocalClubName: reciprocalClubName || null,
          experienceType: experienceChoice,
          experienceSelfReportedYears: experienceChoice === 'specified_years' ? Number(experienceYears) : null,
        });
        clearLocalDraft();
        if (data.checkoutUrl) {
          window.location.assign(data.checkoutUrl);
          return;
        }
        navigate('/registration/success');
      }
    } catch (err) {
      setError(errorMessage(err, 'Unable to submit registration.'));
    } finally {
      setLoading(false);
    }
  }

  const showStartOver =
    windowState &&
    windowState.state !== 'closed' &&
    !['start', 'success'].includes(currentStep) &&
    !(currentStep === 'cancel' && !member);

  function StartOverLink() {
    if (!showStartOver) return null;
    return (
      <div className="mb-4 flex justify-end border-b border-emerald-100 pb-4">
        <Button type="button" variant="secondary" className="text-sm" disabled={loading} onClick={handleStartOver}>
          Start over
        </Button>
      </div>
    );
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
    if (!membershipPayment) {
      return <PublicStateCard title="Loading fees" description="Calculating your registration total." />;
    }
    const allLines = [...membershipPayment.feePreview.lineItems, ...membershipPayment.feePreview.discountLineItems];
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
          <span className="text-xl font-bold text-[#121033]">{formatCurrency(membershipPayment.feePreview.totalDueMinor)}</span>
        </div>
      </div>
    );
  }

  function selectionLabel(selection: RegistrationSelectionInput): string {
    switch (selection.selectionType) {
      case 'guaranteed_return':
        return 'Guaranteed return';
      case 'sabbatical':
        return 'Sabbatical';
      case 'drop':
        return 'Dropped';
      case 'return_subject_to_availability':
        return 'Subject to availability';
      case 'waitlist_add':
        return 'Waitlist: ADD';
      case 'waitlist_replace':
        return 'Waitlist: REPLACE';
      case 'third_league_interest':
        return 'Third-league interest';
      case 'byot_request':
        return 'BYOT request';
      case 'junior_recreational':
        return 'Junior Recreational';
      case 'spare_only':
        return 'Spare-only';
      default:
        return 'League selection';
    }
  }

  function leagueName(leagueId: number | null | undefined): string {
    return leaguePayload?.leagues.find((league) => league.id === leagueId)?.name ?? 'League';
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
    if (resumeOffer !== 'none') {
      content = (
        <RegistrationCard>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary-teal">Registration</p>
          <h1 className="mt-3 text-3xl font-bold text-[#121033]">Resume registration?</h1>
          <p className="mt-3 text-gray-600">You have an in-progress registration for {seasonSessionLabel}.</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Button
              onClick={() => {
                if (resumeOffer === 'server') void handleResumeServerContinue();
                else void handleResumeLocalContinue();
              }}
            >
              Continue where you left off
            </Button>
            <Button variant="secondary" onClick={() => void handleResumeDiscard()}>
              Start from the beginning
            </Button>
          </div>
        </RegistrationCard>
      );
    } else {
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
    }
  } else if (currentStep === 'identity' && payload?.registration.returning_member_answer === 1) {
    if (member && (registrationId === null || !payload)) {
      content = <PublicStateCard title="Loading registration" description="Restoring your registration draft." />;
    } else {
      content = (
      <RegistrationCard>
        <StartOverLink />
        <h1 className="text-3xl font-bold text-[#121033]">Who are you registering?</h1>
        <p className="mt-3 text-gray-600">Choose a profile you are allowed to register.</p>
        {!member ? (
          <Button className="mt-6" onClick={() => navigate('/login', { state: { from: { pathname: '/registration/identity' } } })}>
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
    }
  } else if (currentStep === 'identity') {
    if (member && registrationId === null) {
      content = <PublicStateCard title="Loading registration" description="Restoring your registration draft." />;
    } else {
      content = (
      <RegistrationCard>
        <StartOverLink />
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
          <Button type="submit" disabled={loading}>
            Continue
          </Button>
        </form>
      </RegistrationCard>
    );
    }
  } else if (currentStep === 'policies') {
    content = (
      <RegistrationCard>
        <StartOverLink />
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
                I agree to the{' '}
                <Link className="font-medium text-primary-teal underline" to={href}>
                  {label}
                </Link>
                .
              </span>
            </label>
          ))}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <Button type="submit" disabled={loading}>
            Accept and continue
          </Button>
        </form>
      </RegistrationCard>
    );
  } else if (currentStep === 'demographics') {
    content = (
      <RegistrationCard>
        <StartOverLink />
        <h1 className="text-3xl font-bold text-[#121033]">Curler demographics</h1>
        <p className="mt-3 text-gray-600">Enter information for the person being registered.</p>
        <form onSubmit={submitDemographics} className="mt-6 space-y-6">
          {renderDemographicFields()}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <Button type="submit" disabled={loading}>
            Save and continue
          </Button>
        </form>
      </RegistrationCard>
    );
  } else if (currentStep === 'guardian') {
    content = (
      <RegistrationCard>
        <StartOverLink />
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
          </div>
          <Button type="submit" disabled={loading} className="sm:col-span-2">
            Save and continue
          </Button>
          {error ? <p className="sm:col-span-2 text-sm text-red-600">{error}</p> : null}
        </form>
      </RegistrationCard>
    );
  } else if (currentStep === 'complete') {
    content = (
      <RegistrationCard>
        <StartOverLink />
        <h1 className="text-3xl font-bold text-[#121033]">Registration shell complete</h1>
        <p className="mt-3 text-gray-600">
          Identity, policies, demographics, and any required parent/guardian information are ready for the next phase.
        </p>
        {member && payload?.registration.status !== 'shell_complete' ? (
          <Button className="mt-6" onClick={completeShell} disabled={loading}>
            Mark shell complete
          </Button>
        ) : (
          <Link className="mt-6 inline-flex rounded-lg bg-primary-teal px-4 py-2 text-sm font-medium text-white" to="/registration/membership">
            Continue to membership
          </Link>
        )}
        {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
      </RegistrationCard>
    );
  } else if (currentStep === 'membership') {
    content = (
      <RegistrationCard>
        <StartOverLink />
        <h1 className="text-3xl font-bold text-[#121033]">Choose membership</h1>
        <p className="mt-3 text-gray-600">Choose the membership or program path for this curler.</p>
        <form onSubmit={saveMembership} className="mt-6 space-y-6">
          <FormField label="Membership type" htmlFor={membershipInputId} required tone="public">
            <ChoiceInput
              inputId={membershipInputId}
              layout="block"
              value={membershipChoice}
              onChange={(value) => setMembershipChoice(value as 'regular' | 'social' | 'junior_recreational')}
              options={[
                {
                  value: 'regular',
                  label: 'Regular membership',
                  description: 'Choose this if the curler plans to curl, spare, practice, or register for leagues.',
                },
                {
                  value: 'social',
                  label: 'Social membership',
                  description: 'Choose this if the curler wants to be a member but will not curl this session.',
                },
                {
                  value: 'junior_recreational',
                  label: 'Junior Recreational',
                  description: 'Choose this special junior program. It skips normal league selection.',
                },
              ]}
            />
          </FormField>
          {membershipChoice === 'social' ? (
            <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              Social members do not receive discounts, basic ice privileges, or league access.
            </p>
          ) : null}
          {membershipChoice === 'junior_recreational' ? (
            <FormField label="Financial assistance request" htmlFor={`${membershipInputId}-assistance`} tone="public">
              <ChoiceInput
                inputId={`${membershipInputId}-assistance`}
                layout="block"
                value={juniorAssistancePercent}
                onChange={(value) => setJuniorAssistancePercent(value as '0' | '25' | '50' | '75')}
                options={[
                  { value: '0', label: 'No assistance requested' },
                  { value: '25', label: 'Request 25% assistance' },
                  { value: '50', label: 'Request 50% assistance' },
                  { value: '75', label: 'Request 75% assistance' },
                ]}
              />
            </FormField>
          ) : null}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <Button type="submit" disabled={loading}>
            Continue
          </Button>
        </form>
      </RegistrationCard>
    );
  } else if (currentStep === 'discounts') {
    const showWinterOnly = membershipPayment && !membershipPayment.isFirstSessionOfSeason;
    content = (
      <RegistrationCard>
        <StartOverLink />
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
            <Button type="submit" disabled={loading}>
              Continue
            </Button>
            <Button type="button" variant="secondary" onClick={() => navigate('/registration/membership')}>
              Back
            </Button>
          </div>
        </form>
      </RegistrationCard>
    );
  } else if (currentStep === 'experience') {
    content = (
      <RegistrationCard>
        <StartOverLink />
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
                ...(membershipPayment?.knownExperienceYears
                  ? [{ value: 'known_existing' as const, label: `Use club record (${membershipPayment.knownExperienceYears} years)` }]
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
            <Button type="submit" disabled={loading}>
              Continue
            </Button>
            <Button type="button" variant="secondary" onClick={() => navigate('/registration/discounts')}>
              Back
            </Button>
          </div>
        </form>
      </RegistrationCard>
    );
  } else if (currentStep === 'basic-ice') {
    content = (
      <RegistrationCard>
        <StartOverLink />
        <h1 className="text-3xl font-bold text-[#121033]">Basic ice privileges</h1>
        <p className="mt-3 text-gray-600">
          Basic ice privileges cover sparing and practice for {seasonSessionLabel} without selecting a league in this phase.
        </p>
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
            <Button type="submit" disabled={loading}>
              Continue to league selection
            </Button>
            <Button type="button" variant="secondary" onClick={() => navigate('/registration/experience')}>
              Back
            </Button>
          </div>
        </form>
      </RegistrationCard>
    );
  } else if (currentStep === 'league-selection') {
    const leagues = leaguePayload?.leagues ?? [];
    content = (
      <RegistrationCard>
        <StartOverLink />
        <h1 className="text-3xl font-bold text-[#121033]">Choose leagues</h1>
        <p className="mt-3 text-gray-600">
          Select the leagues this curler wants for {seasonSessionLabel}. Eligibility is checked when you save.
        </p>
        <div className="mt-6 space-y-5">
          {leagues.length === 0 ? (
            <PublicStateCard title="No leagues available" description="There are no leagues configured for this registration session yet." tone="warning" />
          ) : (
            leagues.map((league) => {
              const currentSelection = leagueSelections.find(
                (selection) => selection.leagueId === league.id && selection.selectionType !== 'third_league_interest'
              );
              const hasReturnRight =
                windowState?.state === 'priority' &&
                Boolean(league.predecessorLeagueId && leaguePayload?.participatedLeagueIds.includes(league.predecessorLeagueId));
              const value = currentSelection?.selectionType ?? 'none';
              return (
                <div key={league.id} className="rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm">
                  <FormField label={league.name} htmlFor={`league-${league.id}`} tone="public">
                    <ChoiceInput
                      inputId={`league-${league.id}`}
                      layout="block"
                      value={value}
                      onChange={(next) => updateLeagueSelection(league.id, next as RegistrationSelectionType | 'none')}
                      options={[
                        { value: 'none', label: 'No selection' },
                        ...(hasReturnRight
                          ? [
                              { value: 'guaranteed_return', label: 'Return', description: 'Claim an eligible guaranteed return spot.' },
                              ...(league.allowsSabbatical
                                ? [{ value: 'sabbatical', label: 'Sabbatical', description: 'Preserve the spot while stepping away.' }]
                                : []),
                              { value: 'drop', label: 'Drop', description: 'Release this protected spot.' },
                            ]
                          : []),
                        ...(league.leagueType === 'bring_your_own_team'
                          ? [{ value: 'byot_request', label: 'BYOT request', description: 'List teammates for coordinator review.' }]
                          : [
                              { value: 'waitlist_add', label: 'Waitlist: ADD', description: 'Try to add this as a first or second league.' },
                              { value: 'return_subject_to_availability', label: 'Subject to availability', description: 'Request a non-guaranteed spot.' },
                            ]),
                      ]}
                    />
                  </FormField>
                  {currentSelection?.selectionType === 'byot_request' ? (
                    <FormField label="Teammates" htmlFor={`league-${league.id}-teammates`} required tone="public">
                      <textarea
                        id={`league-${league.id}-teammates`}
                        className="app-input min-h-24"
                        value={currentSelection.byotTeammateText ?? ''}
                        onChange={(event) => updateByotTeammates(league.id, event.target.value)}
                        placeholder="List teammate names"
                      />
                    </FormField>
                  ) : null}
                </div>
              );
            })
          )}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <div className="flex flex-wrap gap-3">
            <Button type="button" disabled={loading} onClick={() => saveLeagueSelections()}>
              Continue
            </Button>
            <Button type="button" variant="secondary" onClick={() => navigate('/registration/basic-ice')}>
              Back
            </Button>
          </div>
        </div>
      </RegistrationCard>
    );
  } else if (currentStep === 'third-league-interest') {
    const thirdLeagueSelections = leagueSelections.filter((selection) => selection.selectionType === 'third_league_interest');
    content = (
      <RegistrationCard>
        <StartOverLink />
        <h1 className="text-3xl font-bold text-[#121033]">Third-league interest</h1>
        <p className="mt-3 text-gray-600">
          These choices tell staff which additional standard leagues would be suitable if third-league spots are available. They are not waitlist entries.
        </p>
        <div className="mt-6 space-y-4">
          {(leaguePayload?.leagues ?? [])
            .filter((league) => league.leagueType !== 'bring_your_own_team')
            .map((league) => (
              <FormCheckbox
                key={league.id}
                tone="public"
                label={league.name}
                checked={thirdLeagueSelections.some((selection) => selection.leagueId === league.id)}
                onChange={(checked) => updateThirdLeagueInterest(league.id, checked)}
                helperText="Interest only; staff handle third-league placement later."
              />
            ))}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <div className="flex flex-wrap gap-3">
            <Button type="button" disabled={loading} onClick={() => saveLeagueSelections('/registration/league-summary')}>
              Continue
            </Button>
            <Button type="button" variant="secondary" onClick={() => navigate('/registration/league-selection')}>
              Back
            </Button>
          </div>
        </div>
      </RegistrationCard>
    );
  } else if (currentStep === 'league-summary') {
    const selections = leagueSelections;
    content = (
      <RegistrationCard>
        <StartOverLink />
        <h1 className="text-3xl font-bold text-[#121033]">League selection summary</h1>
        <p className="mt-3 text-gray-600">Review the curler's league choices before continuing to final review.</p>
        <div className="mt-6 space-y-4">
          {membershipChoice === 'junior_recreational' ? (
            <p className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
              Junior Recreational skips normal league selection, waitlists, sparing, and third-league interest.
            </p>
          ) : selections.length === 0 ? (
            <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">No league choices have been saved.</p>
          ) : (
            <div className="divide-y divide-emerald-100 rounded-2xl border border-emerald-100">
              {selections.map((selection, index) => (
                <div key={`${selection.selectionType}-${selection.leagueId ?? 'none'}-${index}`} className="p-4 text-sm">
                  <p className="font-medium text-[#121033]">{selection.leagueId ? leagueName(selection.leagueId) : selectionLabel(selection)}</p>
                  <p className="text-gray-700">{selectionLabel(selection)}</p>
                  {selection.selectionType === 'waitlist_replace' && selection.replacesLeagueId ? (
                    <p className="text-gray-600">Would replace {leagueName(selection.replacesLeagueId)}.</p>
                  ) : null}
                  {selection.selectionType === 'byot_request' && selection.byotTeammateText ? (
                    <p className="text-gray-600">Teammates: {selection.byotTeammateText}</p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
          {leaguePayload?.evaluation.paymentDecision.outcome === 'deferred_payment' ? (
            <p className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
              Payment will be deferred because one or more choices require placement or staff review.
            </p>
          ) : null}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <div className="flex flex-wrap gap-3">
            <Button type="button" disabled={loading} onClick={() => navigate('/registration/review')}>
              Continue to review
            </Button>
            {membershipChoice === 'junior_recreational' ? (
              <Button type="button" variant="secondary" onClick={() => navigate('/registration/membership')}>
                Back
              </Button>
            ) : (
              <Button type="button" variant="secondary" onClick={() => navigate('/registration/third-league-interest')}>
                Back
              </Button>
            )}
          </div>
        </div>
      </RegistrationCard>
    );
  } else if (currentStep === 'review') {
    const curlerLabel = member ? payload?.curler?.name : `${demographics.firstName} ${demographics.lastName}`.trim() || 'this curler';
    content = (
      <RegistrationCard>
        <StartOverLink />
        <h1 className="text-3xl font-bold text-[#121033]">Review and pay</h1>
        <p className="mt-3 text-gray-600">Review the registration for {curlerLabel} before payment.</p>
        <div className="mt-6 space-y-4">
          <div className="rounded-2xl border border-gray-200 p-4 text-sm text-gray-700">
            <p>
              <span className="font-medium text-gray-900">Membership:</span>{' '}
              {membershipPayment?.selection.membershipOption === 'social'
                ? 'Social membership'
                : membershipPayment?.selection.membershipOption === 'junior_recreational'
                  ? 'Junior Recreational'
                  : 'Regular membership'}
            </p>
            {membershipPayment?.selection.membershipOption === 'regular_spare_only' ? (
              <p>
                <span className="font-medium text-gray-900">Basic ice privileges:</span> Included for this session
              </p>
            ) : null}
            {membershipPayment?.selection.studentDiscountClaimed ? (
              <p>
                <span className="font-medium text-gray-900">Student discount:</span> {membershipPayment.selection.studentInstitution}
              </p>
            ) : null}
            {membershipPayment?.selection.reciprocalDiscountClaimed ? (
              <p>
                <span className="font-medium text-gray-900">Reciprocal discount:</span> {membershipPayment.selection.reciprocalClubName}
              </p>
            ) : null}
            {membershipPayment?.selection.experienceType ? (
              <p>
                <span className="font-medium text-gray-900">Experience:</span>{' '}
                {membershipPayment.selection.experienceType === 'specified_years'
                  ? `${membershipPayment.selection.experienceSelfReportedYears} years`
                  : membershipPayment.selection.experienceType === 'known_existing'
                    ? `${membershipPayment.knownExperienceYears} years from club records`
                    : 'None or minimal'}
              </p>
            ) : null}
          </div>
          {leagueSelections.length > 0 ? (
            <div className="rounded-2xl border border-gray-200 p-4 text-sm text-gray-700">
              <h2 className="font-semibold text-[#121033]">League choices</h2>
              <div className="mt-2 space-y-2">
                {leagueSelections.map((selection, index) => (
                  <p key={`${selection.selectionType}-${selection.leagueId ?? 'none'}-${index}`}>
                    <span className="font-medium text-gray-900">{selection.leagueId ? leagueName(selection.leagueId) : selectionLabel(selection)}:</span>{' '}
                    {selectionLabel(selection)}
                  </p>
                ))}
              </div>
            </div>
          ) : membershipPayment?.selection.membershipOption === 'junior_recreational' ? (
            <div className="rounded-2xl border border-gray-200 p-4 text-sm text-gray-700">
              <span className="font-medium text-gray-900">League choices:</span> Junior Recreational skips normal league selection.
            </div>
          ) : null}
          {renderFeeSummary()}
          <p className="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
            {membershipPayment?.paymentDecision.outcome === 'deferred_payment'
              ? 'No payment is due now. We will contact you when your registration is ready for payment.'
              : membershipPayment?.paymentDecision.outcome === 'no_payment_required'
                ? 'No payment is required now.'
                : 'Payment is due now to complete this registration.'}
          </p>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <div className="flex flex-wrap gap-3">
            <Button type="button" disabled={loading || !membershipPayment} onClick={submitRegistration}>
              {membershipPayment?.paymentDecision.outcome === 'immediate_payment' ? 'Submit and pay' : 'Submit registration'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => navigate('/registration/league-summary')}>
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
        <p className="mt-3 text-gray-600">If payment was required, the registration will be confirmed after payment is processed.</p>
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
        <Link
          className="mt-6 inline-flex rounded-lg bg-primary-teal px-4 py-2 text-sm font-medium text-white"
          to={paymentRegistrationId ? `/registration/review` : '/registration/start'}
        >
          Return to review
        </Link>
      </RegistrationCard>
    );
  } else {
    content = (
      <PublicStateCard title="Registration step not found" description="Return to the start of registration and continue from the next incomplete step." tone="warning" />
    );
  }

  return (
    <PublicLayout>
      <div className="bg-gradient-to-b from-emerald-50 via-white to-white px-4 py-12">{content}</div>
    </PublicLayout>
  );
}
