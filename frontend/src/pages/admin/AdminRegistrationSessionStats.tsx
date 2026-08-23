import { useId, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import Button from '../../components/Button';
import InlineStateMessage from '../../components/InlineStateMessage';
import {
  registrationListHref,
  registrationStaffQuery,
  registrationStaffRule,
  type RegistrationStaffQuery,
} from './registrationStaffQuery';

export type AdminRegistrationSessionStatsPayload = {
  sessionId: number;
  seasonName: string;
  sessionName: string;
  registrations: {
    total: number;
    canceled: number;
    inProgressDrafts: number;
    byStatus: {
      submitted: number;
      awaitingStaffReview: number;
      awaitingPlacement: number;
      awaitingPayment: number;
      paymentStarted: number;
      paid: number;
      confirmed: number;
    };
  };
  payment: {
    paid: number;
    unpaid: number;
    deferred: number;
    collectedMinor: number;
    expectedMinor: number;
    outstandingMinor: number;
  };
  membership: {
    regular: number;
    social: number;
    juniorRecreational: number;
    spareOnly: number;
    none: number;
  };
  age: {
    junior: number;
    adult: number;
    unknown: number;
  };
  members: {
    newMembers: number;
    returningMembers: number;
    unknown: number;
  };
  leagues: {
    requested: number;
    availableSpots: number;
    filledSpots: number;
    openSpots: number;
    waitlistEntries: number;
    pendingOffers: number;
  };
  attention: {
    awaitingStaffReview: number;
    awaitingPlacement: number;
    pendingFinancialAssistance: number;
    studentDiscounts: number;
    reciprocalDiscounts: number;
  };
};

type AdminRegistrationSessionStatsProps = {
  stats: AdminRegistrationSessionStatsPayload | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
};

function money(minor: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(minor / 100);
}

function ratio(part: number | string, total: number | string) {
  const numericTotal = typeof total === 'number' ? total : Number.NaN;
  if (typeof total === 'number' && numericTotal <= 0) return String(part);
  return `${part} of ${total}`;
}

function Stat({ label, value, detail }: { label: string; value: ReactNode; detail?: ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums text-gray-900 dark:text-gray-100">{value}</dd>
      {detail ? <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{detail}</p> : null}
    </div>
  );
}

function StatGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="app-card">
      <h3 className="app-section-title text-base">{title}</h3>
      <dl className="mt-3 grid grid-cols-2 gap-3">{children}</dl>
    </section>
  );
}

const JUNIOR_AGE = 21;

function filterQuery(
  ...rules: Array<[field: string, operator: string, value?: unknown]>
): RegistrationStaffQuery {
  return registrationStaffQuery(rules.map(([field, operator, value]) => registrationStaffRule(field, operator, value)));
}

function FilterLink({
  sessionId,
  query,
  label,
  children,
}: {
  sessionId: number;
  query?: RegistrationStaffQuery;
  label: string;
  children: ReactNode;
}) {
  return (
    <Link
      to={registrationListHref(sessionId, query)}
      className="text-primary-teal-link hover:underline"
      aria-label={label}
    >
      {children}
    </Link>
  );
}

export default function AdminRegistrationSessionStats({
  stats,
  loading,
  error,
  onRetry,
}: AdminRegistrationSessionStatsProps) {
  const headingId = useId();

  if (loading && !stats) {
    return <InlineStateMessage title="Loading session summary" description="Gathering counts for the selected session." />;
  }

  if (error && !stats) {
    return (
      <InlineStateMessage
        tone="error"
        title="Unable to load session summary"
        description={error}
        action={
          <Button type="button" variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        }
      />
    );
  }

  if (!stats) return null;

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <div>
        <h2 id={headingId} className="app-section-title">
          Session summary
        </h2>
        <p className="app-section-subtitle">
          {stats.seasonName} / {stats.sessionName}. Counts use submitted registrations for this session and ignore table
          filters. Canceled registrations are listed separately. Linked counts open the matching filtered list.
        </p>
      </div>

      {error ? (
        <InlineStateMessage
          tone="error"
          title="Session summary may be out of date"
          description={error}
          action={
            <Button type="button" variant="secondary" onClick={onRetry}>
              Try again
            </Button>
          }
        />
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <StatGroup title="Registrations">
          <Stat
            label="Submitted"
            value={
              <FilterLink sessionId={stats.sessionId} label="Show submitted registrations">
                {stats.registrations.total}
              </FilterLink>
            }
            detail={
              stats.registrations.inProgressDrafts > 0 ? (
                <>
                  <FilterLink
                    sessionId={stats.sessionId}
                    query={filterQuery(['isDraft', 'eq', true])}
                    label="Show in-progress draft registrations"
                  >
                    {stats.registrations.inProgressDrafts}
                  </FilterLink>
                  {` draft${stats.registrations.inProgressDrafts === 1 ? '' : 's'} still in progress`}
                </>
              ) : (
                'No in-progress drafts'
              )
            }
          />
          <Stat
            label="Paid"
            value={
              <>
                <FilterLink
                  sessionId={stats.sessionId}
                  query={filterQuery(['paymentStatus', 'eq', 'paid'])}
                  label="Show registrations with a paid invoice"
                >
                  {stats.payment.paid}
                </FilterLink>
                {` of ${stats.registrations.total}`}
              </>
            }
            detail={
              <>
                <FilterLink
                  sessionId={stats.sessionId}
                  query={filterQuery(['paymentStatus', 'neq', 'paid'])}
                  label="Show registrations that are not paid"
                >
                  {stats.payment.unpaid}
                </FilterLink>{' '}
                unpaid
              </>
            }
          />
          <Stat
            label="Canceled"
            value={
              <FilterLink
                sessionId={stats.sessionId}
                query={filterQuery(['status', 'eq', 'cancelled'])}
                label="Show canceled registrations"
              >
                {stats.registrations.canceled}
              </FilterLink>
            }
          />
          <Stat
            label="Confirmed"
            value={
              <FilterLink
                sessionId={stats.sessionId}
                query={filterQuery(['status', 'eq', 'confirmed'])}
                label="Show confirmed registrations"
              >
                {stats.registrations.byStatus.confirmed}
              </FilterLink>
            }
            detail={
              <>
                <FilterLink
                  sessionId={stats.sessionId}
                  query={filterQuery(['status', 'eq', 'paid'])}
                  label="Show registrations marked paid"
                >
                  {stats.registrations.byStatus.paid}
                </FilterLink>{' '}
                marked paid
              </>
            }
          />
        </StatGroup>

        <StatGroup title="Dues">
          <Stat
            label="Collected"
            value={ratio(money(stats.payment.collectedMinor), money(stats.payment.expectedMinor))}
            detail="Paid invoice totals of all active invoice totals"
          />
          <Stat label="Outstanding" value={money(stats.payment.outstandingMinor)} />
          <Stat
            label="Deferred"
            value={
              <FilterLink
                sessionId={stats.sessionId}
                query={filterQuery(['paymentDeferred', 'eq', true])}
                label="Show registrations with deferred payment"
              >
                {stats.payment.deferred}
              </FilterLink>
            }
            detail="Active registrations still waiting on a final charge"
          />
          <Stat
            label="Awaiting payment"
            value={
              <FilterLink
                sessionId={stats.sessionId}
                query={filterQuery(['status', 'in', ['awaiting_payment', 'payment_started']])}
                label="Show registrations awaiting payment"
              >
                {stats.registrations.byStatus.awaitingPayment + stats.registrations.byStatus.paymentStarted}
              </FilterLink>
            }
            detail={
              <>
                <FilterLink
                  sessionId={stats.sessionId}
                  query={filterQuery(['status', 'eq', 'payment_started'])}
                  label="Show registrations with checkout started"
                >
                  {stats.registrations.byStatus.paymentStarted}
                </FilterLink>{' '}
                checkout started
              </>
            }
          />
        </StatGroup>

        <StatGroup title="Membership">
          <Stat
            label="Regular"
            value={
              <FilterLink
                sessionId={stats.sessionId}
                query={filterQuery(['membershipOption', 'in', ['regular', 'regular_spare_only']])}
                label="Show regular membership registrations"
              >
                {stats.membership.regular}
              </FilterLink>
            }
            detail={
              stats.membership.spareOnly > 0 ? (
                <>
                  <FilterLink
                    sessionId={stats.sessionId}
                    query={filterQuery(['membershipOption', 'eq', 'regular_spare_only'])}
                    label="Show spare-only ice privilege registrations"
                  >
                    {stats.membership.spareOnly}
                  </FilterLink>{' '}
                  spare-only ice privileges
                </>
              ) : (
                'Includes spare-only ice privileges'
              )
            }
          />
          <Stat
            label="Social"
            value={
              <FilterLink
                sessionId={stats.sessionId}
                query={filterQuery(['membershipOption', 'eq', 'social'])}
                label="Show social membership registrations"
              >
                {stats.membership.social}
              </FilterLink>
            }
          />
          <Stat
            label="Junior recreational"
            value={
              <FilterLink
                sessionId={stats.sessionId}
                query={filterQuery(['membershipOption', 'eq', 'junior_recreational'])}
                label="Show junior recreational membership registrations"
              >
                {stats.membership.juniorRecreational}
              </FilterLink>
            }
            detail={
              stats.membership.none > 0 ? (
                <>
                  <FilterLink
                    sessionId={stats.sessionId}
                    query={filterQuery(['membershipOption', 'eq', 'none'])}
                    label="Show registrations with no membership selected"
                  >
                    {stats.membership.none}
                  </FilterLink>{' '}
                  with no membership selected
                </>
              ) : undefined
            }
          />
          <Stat
            label="New vs returning"
            value={
              <>
                <FilterLink
                  sessionId={stats.sessionId}
                  query={filterQuery(['returningMember', 'eq', 'new'])}
                  label="Show new member registrations"
                >
                  {stats.members.newMembers}
                </FilterLink>
                {' / '}
                <FilterLink
                  sessionId={stats.sessionId}
                  query={filterQuery(['returningMember', 'eq', 'returning'])}
                  label="Show returning member registrations"
                >
                  {stats.members.returningMembers}
                </FilterLink>
              </>
            }
            detail={
              stats.members.unknown > 0 ? (
                <>
                  <FilterLink
                    sessionId={stats.sessionId}
                    query={filterQuery(['returningMember', 'is_empty'])}
                    label="Show registrations with no returning-member answer"
                  >
                    {stats.members.unknown}
                  </FilterLink>{' '}
                  not specified
                </>
              ) : (
                'Based on the returning-member answer'
              )
            }
          />
        </StatGroup>

        <StatGroup title="Age">
          <Stat
            label="Under 21"
            value={
              <FilterLink
                sessionId={stats.sessionId}
                query={filterQuery(['age', 'lt', JUNIOR_AGE])}
                label="Show registrations under 21"
              >
                {stats.age.junior}
              </FilterLink>
            }
            detail="Age today"
          />
          <Stat
            label="Adult"
            value={
              <FilterLink
                sessionId={stats.sessionId}
                query={filterQuery(['age', 'gte', JUNIOR_AGE])}
                label="Show registrations 21 and over"
              >
                {stats.age.adult}
              </FilterLink>
            }
            detail="21 and over"
          />
          <Stat
            label="Unknown"
            value={
              <FilterLink
                sessionId={stats.sessionId}
                query={filterQuery(['age', 'is_empty'])}
                label="Show registrations with no date of birth"
              >
                {stats.age.unknown}
              </FilterLink>
            }
            detail="No date of birth on the curler record"
          />
        </StatGroup>

        <StatGroup title="League spots">
          <Stat
            label="Requested"
            value={ratio(stats.leagues.requested, stats.leagues.availableSpots)}
            detail="Desired league count versus configured league capacity"
          />
          <Stat label="Filled" value={stats.leagues.filledSpots} detail="Active roster placements" />
          <Stat label="Open" value={stats.leagues.openSpots} detail="Permanent vacancies from waitlist capacity" />
          <Stat
            label="Waitlist"
            value={
              <FilterLink
                sessionId={stats.sessionId}
                query={filterQuery(['hasWaitlist', 'eq', true])}
                label="Show registrations on a waitlist"
              >
                {stats.leagues.waitlistEntries}
              </FilterLink>
            }
            detail={
              <>
                <FilterLink
                  sessionId={stats.sessionId}
                  query={filterQuery(['hasPendingOffer', 'eq', true])}
                  label="Show registrations with a pending waitlist offer"
                >
                  {stats.leagues.pendingOffers}
                </FilterLink>
                {` pending offer${stats.leagues.pendingOffers === 1 ? '' : 's'}`}
              </>
            }
          />
        </StatGroup>

        <StatGroup title="Needs attention">
          <Stat
            label="Staff review"
            value={
              <FilterLink
                sessionId={stats.sessionId}
                query={filterQuery(['status', 'eq', 'awaiting_staff_review'])}
                label="Show registrations awaiting staff review"
              >
                {stats.attention.awaitingStaffReview}
              </FilterLink>
            }
          />
          <Stat
            label="Awaiting placement"
            value={
              <FilterLink
                sessionId={stats.sessionId}
                query={filterQuery(['status', 'eq', 'awaiting_placement'])}
                label="Show registrations awaiting placement"
              >
                {stats.attention.awaitingPlacement}
              </FilterLink>
            }
          />
          <Stat
            label="Financial assistance"
            value={
              <FilterLink
                sessionId={stats.sessionId}
                query={filterQuery(['financialAssistanceStatus', 'eq', 'pending'])}
                label="Show registrations with pending financial assistance"
              >
                {stats.attention.pendingFinancialAssistance}
              </FilterLink>
            }
            detail="Pending requests"
          />
          <Stat
            label="Discounts claimed"
            value={
              <FilterLink
                sessionId={stats.sessionId}
                query={registrationStaffQuery(
                  [
                    registrationStaffRule('studentDiscountClaimed', 'eq', true),
                    registrationStaffRule('reciprocalDiscountClaimed', 'eq', true),
                  ],
                  'any',
                )}
                label="Show registrations that claimed a student or reciprocal discount"
              >
                {stats.attention.studentDiscounts + stats.attention.reciprocalDiscounts}
              </FilterLink>
            }
            detail={
              <>
                <FilterLink
                  sessionId={stats.sessionId}
                  query={filterQuery(['studentDiscountClaimed', 'eq', true])}
                  label="Show registrations that claimed a student discount"
                >
                  {stats.attention.studentDiscounts}
                </FilterLink>{' '}
                student,{' '}
                <FilterLink
                  sessionId={stats.sessionId}
                  query={filterQuery(['reciprocalDiscountClaimed', 'eq', true])}
                  label="Show registrations that claimed a reciprocal discount"
                >
                  {stats.attention.reciprocalDiscounts}
                </FilterLink>{' '}
                reciprocal
              </>
            }
          />
        </StatGroup>
      </div>
    </section>
  );
}
