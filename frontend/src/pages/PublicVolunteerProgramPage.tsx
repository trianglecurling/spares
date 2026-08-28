import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { HiChevronDown } from 'react-icons/hi2';
import { Link, Navigate, useParams } from 'react-router-dom';
import Button from '../components/Button';
import FormField from '../components/FormField';
import Modal from '../components/Modal';
import PublicLayout from '../components/PublicLayout';
import PublicStateCard from '../components/PublicStateCard';
import SeoMeta from '../components/SeoMeta';
import { ArticleMarkdown } from '../components/ArticleMarkdown';
import { useAuth } from '../contexts/AuthContext';
import { useAlert } from '../contexts/AlertContext';
import api, { formatApiError } from '../utils/api';
import VolunteerSpotsStatusBadge from '../components/volunteering/VolunteerSpotsStatusBadge';
import {
  formatProgramShiftDateSpan,
  formatVolunteerDayHeading,
  formatVolunteerDuration,
  formatVolunteerRange,
  formatVolunteerTimeRange,
  volunteerShiftDayKey,
  type PublicVolunteerProgramView,
} from '../utils/volunteering';

type PublicShift = PublicVolunteerProgramView['shifts'][number];
type PublicRole = PublicShift['roles'][number];

type SignupTarget = {
  shiftRoleId: number;
  roleName: string;
  shiftLabel: string;
};

export default function PublicVolunteerProgramPage() {
  const { slug: slugParam } = useParams<{ slug: string }>();
  const { member, token, isLoading: authLoading } = useAuth();
  const { showAlert } = useAlert();
  const nameId = useId();
  const emailId = useId();
  const commentsId = useId();

  const slug = slugParam?.trim() || '';
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [program, setProgram] = useState<PublicVolunteerProgramView | null>(null);
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const [signupTarget, setSignupTarget] = useState<SignupTarget | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [comments, setComments] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!slug) {
      setNotFound(true);
      setProgram(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setNotFound(false);
    try {
      const res = await api.get<{ program: PublicVolunteerProgramView }>(
        `/public/volunteering/programs/${encodeURIComponent(slug)}`
      );
      setProgram(res.data.program);
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 404) {
        setNotFound(true);
        setProgram(null);
      } else {
        showAlert(formatApiError(err, 'Failed to load volunteer program'), 'error');
      }
    } finally {
      setLoading(false);
    }
  }, [slug, showAlert]);

  useEffect(() => {
    void load();
  }, [load]);

  const shiftsWithRoles = useMemo(
    () => (program?.shifts ?? []).filter((shift) => shift.roles.length > 0),
    [program]
  );

  const dayGroups = useMemo(() => {
    const map = new Map<string, PublicShift[]>();
    for (const shift of shiftsWithRoles) {
      const key = volunteerShiftDayKey(shift.startDt);
      const list = map.get(key) ?? [];
      list.push(shift);
      map.set(key, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [shiftsWithRoles]);

  const firstDayKey = dayGroups[0]?.[0] ?? null;
  useEffect(() => {
    if (!firstDayKey) {
      setExpandedDays(new Set());
      return;
    }
    // Open the first day by default so guests immediately see signup options.
    setExpandedDays(new Set([firstDayKey]));
  }, [program?.id, firstDayKey]);

  if (authLoading) {
    return (
      <PublicLayout>
        <PublicStateCard title="Loading" description="Checking your session." />
      </PublicLayout>
    );
  }

  if (token && member && slug) {
    return <Navigate to={`/volunteering/programs/${slug}`} replace />;
  }

  if (loading) {
    return (
      <PublicLayout>
        <SeoMeta title="Volunteer program" />
        <PublicStateCard title="Loading program" description="Fetching open volunteer shifts." />
      </PublicLayout>
    );
  }

  if (notFound || !program) {
    return (
      <PublicLayout>
        <SeoMeta title="Volunteer program" />
        <PublicStateCard
          title="Program not found"
          description="This volunteer sign-up page is unavailable. It may be unpublished or the link may be incorrect."
        />
      </PublicLayout>
    );
  }

  if (slug !== program.slug) {
    return <Navigate to={`/volunteering/public/programs/${program.slug}`} replace />;
  }

  const memberLoginHref = `/login?redirect=${encodeURIComponent(`/volunteering/programs/${program.slug}`)}`;
  const hasShifts = shiftsWithRoles.length > 0;
  const multiDay = dayGroups.length > 1;

  const toggleDay = (dayKey: string) => {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(dayKey)) next.delete(dayKey);
      else next.add(dayKey);
      return next;
    });
  };

  const openSignup = (role: PublicRole, shift: PublicShift) => {
    setFormError(null);
    setSignupTarget({
      shiftRoleId: role.id,
      roleName: role.roleName,
      shiftLabel: formatVolunteerRange(shift.startDt, shift.endDt),
    });
  };

  const submitSignup = async () => {
    if (!signupTarget) return;
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    if (!trimmedName) {
      setFormError('Name is required.');
      return;
    }
    if (!trimmedEmail) {
      setFormError('Email is required.');
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      await api.post(`/public/volunteering/shift-roles/${signupTarget.shiftRoleId}/signups`, {
        name: trimmedName,
        email: trimmedEmail,
        comments: comments.trim() || null,
      });
      setSignupTarget(null);
      setName('');
      setEmail('');
      setComments('');
      showAlert(
        "You're signed up. Check your email for a confirmation message with a link to manage your signup.",
        'success'
      );
      await load();
    } catch (err) {
      setFormError(formatApiError(err, 'Failed to sign up'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PublicLayout>
      <SeoMeta title={program.title} description="Sign up to volunteer for this program." />
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold text-gray-900">{program.title}</h1>
          {hasShifts ? (
            <p className="text-gray-600">{formatProgramShiftDateSpan(program.shifts)}</p>
          ) : null}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
            {program.location ? <span>{program.location}</span> : null}
            <span>Contact: {program.pointOfContact}</span>
          </div>
        </header>

        <div className="rounded-lg border border-primary-teal/30 bg-primary-teal/5 px-4 py-3 text-sm text-gray-800">
          <p className="font-medium text-gray-900">Club members: sign in first</p>
          <p className="mt-1">
            If you have a club account,{' '}
            <Link to={memberLoginHref} className="text-primary-teal-link underline underline-offset-2">
              sign in
            </Link>{' '}
            to use the member volunteering hub (and any credential-required roles).
          </p>
        </div>

        {program.description ? <ArticleMarkdown markdown={program.description} /> : null}

        {hasShifts ? (
          multiDay ? (
            <div className="space-y-3">
              {dayGroups.map(([dayKey, shifts]) => {
                const expanded = expandedDays.has(dayKey);
                const rolePreview = uniqueSorted(
                  shifts.flatMap((shift) => shift.roles.map((role) => role.roleName))
                );
                return (
                  <section
                    key={dayKey}
                    className="overflow-hidden rounded-lg border border-gray-200 bg-white"
                  >
                    <button
                      type="button"
                      onClick={() => toggleDay(dayKey)}
                      className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50"
                      aria-expanded={expanded}
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <h2 className="font-medium text-gray-900">
                            {formatVolunteerDayHeading(dayKey)}
                          </h2>
                          <VolunteerSpotsStatusBadge
                            roles={shifts.flatMap((shift) => shift.roles)}
                          />
                        </div>
                        {!expanded ? <AccordionPreview items={rolePreview} /> : null}
                      </div>
                      <HiChevronDown
                        className={`mt-1 h-4 w-4 shrink-0 text-gray-500 transition-transform ${
                          expanded ? 'rotate-180' : ''
                        }`}
                      />
                    </button>
                    {expanded ? (
                      <div className="space-y-3 border-t border-gray-200 px-4 py-3">
                        {shifts.map((shift) => (
                          <PublicShiftBlock
                            key={shift.id}
                            shift={shift}
                            headingMode="time"
                            memberLoginHref={memberLoginHref}
                            onSignUp={openSignup}
                          />
                        ))}
                      </div>
                    ) : null}
                  </section>
                );
              })}
            </div>
          ) : (
            <div className="space-y-3">
              {shiftsWithRoles.map((shift) => (
                <PublicShiftBlock
                  key={shift.id}
                  shift={shift}
                  headingMode="full"
                  memberLoginHref={memberLoginHref}
                  onSignUp={openSignup}
                />
              ))}
            </div>
          )
        ) : null}
      </div>

      {signupTarget ? (
        <Modal
          isOpen
          onClose={() => setSignupTarget(null)}
          title={`Sign up · ${signupTarget.roleName}`}
          size="lg"
          verticalAlign="start"
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-600">{signupTarget.shiftLabel}</p>
            <p className="text-sm text-gray-600">
              We’ll email you a confirmation with a link to manage or cancel this signup.
            </p>
            <FormField tone="public" label="Name" htmlFor={nameId} required>
              <input
                id={nameId}
                className="app-input w-full"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                required
              />
            </FormField>
            <FormField tone="public" label="Email" htmlFor={emailId} required>
              <input
                id={emailId}
                type="email"
                className="app-input w-full"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </FormField>
            <FormField
              tone="public"
              label="Comments"
              htmlFor={commentsId}
              optional
              helperText="Visible to members viewing this program."
            >
              <textarea
                id={commentsId}
                className="app-input w-full min-h-[96px]"
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                maxLength={2000}
              />
            </FormField>
            {formError ? (
              <p className="text-sm text-red-600" role="alert">
                {formError}
              </p>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setSignupTarget(null)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button type="button" onClick={() => void submitSignup()} disabled={submitting}>
                {submitting ? 'Signing up…' : 'Confirm signup'}
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </PublicLayout>
  );
}

function PublicShiftBlock({
  shift,
  headingMode,
  memberLoginHref,
  onSignUp,
}: {
  shift: PublicShift;
  headingMode: 'full' | 'time';
  memberLoginHref: string;
  onSignUp: (role: PublicRole, shift: PublicShift) => void;
}) {
  const duration = formatVolunteerDuration(shift.startDt, shift.endDt);
  const heading =
    headingMode === 'full'
      ? formatVolunteerRange(shift.startDt, shift.endDt)
      : formatVolunteerTimeRange(shift.startDt, shift.endDt);

  return (
    <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className="border-b border-gray-200 px-4 py-3">
        <h3 className="font-medium text-gray-900">{heading}</h3>
        {duration ? <p className="mt-1 text-sm text-gray-600">Duration: {duration}</p> : null}
      </div>
      <ul className="divide-y divide-gray-200">
        {shift.roles.map((role) => (
          <li key={role.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
            <div className="min-w-0 space-y-1">
              <div className="font-medium text-gray-900">{role.roleName}</div>
              {role.roleDescription ? (
                <p className="whitespace-pre-wrap text-sm text-gray-600">{role.roleDescription}</p>
              ) : null}
              <p className="text-sm text-gray-600">
                Volunteers: {role.volunteersRegistered}/{role.volunteersNeeded}
              </p>
              {role.requiresCredentials ? (
                <p className="text-sm text-amber-800">
                  Requires credentials
                  {role.requiredCredentialNames.length > 0
                    ? `: ${role.requiredCredentialNames.join(', ')}`
                    : ''}
                  . Sign in as a member to sign up.
                </p>
              ) : null}
            </div>
            <div className="shrink-0">
              {role.requiresCredentials ? (
                <Link
                  to={memberLoginHref}
                  className="inline-flex items-center justify-center rounded-lg bg-primary-teal-solid px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-teal-solid/90"
                >
                  Sign in to sign up
                </Link>
              ) : role.isFull ? (
                <span className="text-sm text-gray-500">Full</span>
              ) : (
                <Button type="button" onClick={() => onSignUp(role, shift)}>
                  Sign up
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  );
}

function AccordionPreview({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  const maxVisible = 4;
  const visible = items.slice(0, maxVisible);
  const extra = items.length - visible.length;
  const label = extra > 0 ? `${visible.join(' · ')} · +${extra} more` : visible.join(' · ');
  return <p className="mt-1 text-sm text-gray-500">{label}</p>;
}
