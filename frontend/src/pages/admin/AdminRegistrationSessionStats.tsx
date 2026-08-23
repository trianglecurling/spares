import { useId, type ReactNode } from 'react';
import Button from '../../components/Button';
import InlineStateMessage from '../../components/InlineStateMessage';

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
          filters. Canceled registrations are listed separately.
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
            value={stats.registrations.total}
            detail={
              stats.registrations.inProgressDrafts > 0
                ? `${stats.registrations.inProgressDrafts} draft${stats.registrations.inProgressDrafts === 1 ? '' : 's'} still in progress`
                : 'No in-progress drafts'
            }
          />
          <Stat
            label="Paid"
            value={ratio(stats.payment.paid, stats.registrations.total)}
            detail={`${stats.payment.unpaid} unpaid`}
          />
          <Stat label="Canceled" value={stats.registrations.canceled} />
          <Stat
            label="Confirmed"
            value={stats.registrations.byStatus.confirmed}
            detail={`${stats.registrations.byStatus.paid} marked paid`}
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
            value={stats.payment.deferred}
            detail="Active registrations still waiting on a final charge"
          />
          <Stat
            label="Awaiting payment"
            value={stats.registrations.byStatus.awaitingPayment + stats.registrations.byStatus.paymentStarted}
            detail={`${stats.registrations.byStatus.paymentStarted} checkout started`}
          />
        </StatGroup>

        <StatGroup title="Membership">
          <Stat
            label="Regular"
            value={stats.membership.regular}
            detail={
              stats.membership.spareOnly > 0
                ? `${stats.membership.spareOnly} spare-only ice privileges`
                : 'Includes spare-only ice privileges'
            }
          />
          <Stat label="Social" value={stats.membership.social} />
          <Stat
            label="Junior recreational"
            value={stats.membership.juniorRecreational}
            detail={
              stats.membership.none > 0 ? `${stats.membership.none} with no membership selected` : undefined
            }
          />
          <Stat
            label="New vs returning"
            value={`${stats.members.newMembers} / ${stats.members.returningMembers}`}
            detail={stats.members.unknown > 0 ? `${stats.members.unknown} not specified` : 'Based on the returning-member answer'}
          />
        </StatGroup>

        <StatGroup title="Age">
          <Stat label="Under 21" value={stats.age.junior} detail="Age today" />
          <Stat label="Adult" value={stats.age.adult} detail="21 and over" />
          <Stat
            label="Unknown"
            value={stats.age.unknown}
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
            value={stats.leagues.waitlistEntries}
            detail={`${stats.leagues.pendingOffers} pending offer${stats.leagues.pendingOffers === 1 ? '' : 's'}`}
          />
        </StatGroup>

        <StatGroup title="Needs attention">
          <Stat label="Staff review" value={stats.attention.awaitingStaffReview} />
          <Stat label="Awaiting placement" value={stats.attention.awaitingPlacement} />
          <Stat label="Financial assistance" value={stats.attention.pendingFinancialAssistance} detail="Pending requests" />
          <Stat
            label="Discounts claimed"
            value={stats.attention.studentDiscounts + stats.attention.reciprocalDiscounts}
            detail={`${stats.attention.studentDiscounts} student, ${stats.attention.reciprocalDiscounts} reciprocal`}
          />
        </StatGroup>
      </div>
    </section>
  );
}
