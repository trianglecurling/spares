import { useEffect, useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import ChoiceInput, { type ChoiceOption } from '../components/ChoiceInput';
import FormCheckbox from '../components/FormCheckbox';
import FormField from '../components/FormField';
import PublicLayout from '../components/PublicLayout';
import PublicStateCard from '../components/PublicStateCard';
import SeoMeta from '../components/SeoMeta';
import {
  formatCurrency,
  formatRegistrationDiscountOffPhrase,
} from '../components/registration/registrationViewEditShared';
import api, { formatApiError } from '../utils/api';

type PublicDiscountSlot = {
  amountType: 'dollar' | 'percent';
  value: number;
};

type PublicDuesSchedule = {
  season: { id: number; name: string; startDate: string; endDate: string };
  fallSession: { id: number; name: string };
  winterSession: { id: number; name: string } | null;
  fees: {
    regularMembershipDollars: number;
    leagueFeeDollars: number;
    spareOnlyIcePrivilegeDollars: number;
    socialMembershipDollars: number;
    juniorRecreationalDollars: number;
  };
  discounts: {
    student: PublicDiscountSlot;
    reciprocal: PublicDiscountSlot;
    winterOnly: PublicDiscountSlot;
  };
};

type SessionMembershipType = 'none' | 'regular' | 'social' | 'junior_recreational';
type SessionIceTime = 'none' | 'spare_only' | '1_league' | '2_leagues';

type SessionSelection = {
  membershipType: SessionMembershipType;
  iceTime: SessionIceTime;
};

type DuesEstimate = {
  fall: {
    totalMinor: number;
    lineItems: Array<{ description: string; amountMinor: number }>;
    discountLineItems: Array<{ description: string; amountMinor: number }>;
  };
  winter: {
    totalMinor: number;
    lineItems: Array<{ description: string; amountMinor: number }>;
    discountLineItems: Array<{ description: string; amountMinor: number }>;
  };
  annualTotalMinor: number;
  benefits: {
    annual: string[];
    fall: string[];
    winter: string[];
  };
};

const defaultSessionSelection = (): SessionSelection => ({
  membershipType: 'none',
  iceTime: 'none',
});

const membershipOptions: ChoiceOption<SessionMembershipType>[] = [
  { value: 'none', label: 'Not registering this session' },
  { value: 'regular', label: 'Regular membership' },
  { value: 'social', label: 'Social membership' },
  { value: 'junior_recreational', label: 'Junior recreational membership' },
];

const iceTimeOptions: ChoiceOption<SessionIceTime>[] = [
  { value: 'none', label: 'No ice time' },
  { value: 'spare_only', label: 'Daytime league or spare-only' },
  { value: '1_league', label: '1 league' },
  { value: '2_leagues', label: '2 leagues' },
];

function formatDollars(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function discountDescription(slot: PublicDiscountSlot, scope: string): string {
  if (slot.amountType === 'percent') return `${slot.value}% off ${scope}`;
  return `${formatDollars(slot.value)} off ${scope}`;
}

function hasCalculatorSelections(fall: SessionSelection, winter: SessionSelection): boolean {
  return fall.membershipType !== 'none' || winter.membershipType !== 'none';
}

function PaymentBreakdown({
  title,
  breakdown,
}: {
  title: string;
  breakdown: DuesEstimate['fall'];
}) {
  if (breakdown.totalMinor <= 0 && breakdown.lineItems.length === 0) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        <p className="mt-2 text-sm text-gray-600">No payment for this session.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      <ul className="mt-3 space-y-2 text-sm text-gray-700">
        {breakdown.lineItems.map((item) => (
          <li key={`${item.description}-${item.amountMinor}`} className="flex justify-between gap-4">
            <span>{item.description}</span>
            <span className="shrink-0 tabular-nums">{formatCurrency(item.amountMinor)}</span>
          </li>
        ))}
        {breakdown.discountLineItems.map((item) => (
          <li key={`${item.description}-${item.amountMinor}`} className="flex justify-between gap-4 text-emerald-800">
            <span>{item.description}</span>
            <span className="shrink-0 tabular-nums">{formatCurrency(item.amountMinor)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex justify-between border-t border-gray-200 pt-3 text-sm font-semibold text-gray-900">
        <span>Session total</span>
        <span className="tabular-nums">{formatCurrency(breakdown.totalMinor)}</span>
      </div>
    </div>
  );
}

function BenefitsList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-700">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function SessionCalculatorSection({
  title,
  membershipType,
  iceTime,
  onMembershipTypeChange,
  onIceTimeChange,
  membershipFieldId,
  iceTimeFieldId,
}: {
  title: string;
  membershipType: SessionMembershipType;
  iceTime: SessionIceTime;
  onMembershipTypeChange: (value: SessionMembershipType) => void;
  onIceTimeChange: (value: SessionIceTime) => void;
  membershipFieldId: string;
  iceTimeFieldId: string;
}) {
  const showIceTime = membershipType === 'regular';

  return (
    <section className="public-card space-y-5 p-5 sm:p-6">
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      <FormField tone="public" label="Membership type" htmlFor={membershipFieldId}>
        <ChoiceInput
          inputId={membershipFieldId}
          value={membershipType}
          onChange={(value) => {
            if (value == null || Array.isArray(value)) return;
            onMembershipTypeChange(value);
            if (value !== 'regular') onIceTimeChange('none');
          }}
          options={membershipOptions}
          placeholder="Choose membership type"
          listboxLabel="Membership type"
          inputClassName="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-200"
        />
      </FormField>
      {showIceTime ? (
        <FormField tone="public" label="Ice time" htmlFor={iceTimeFieldId}>
          <ChoiceInput
            inputId={iceTimeFieldId}
            value={iceTime}
            onChange={(value) => {
              if (value == null || Array.isArray(value)) return;
              onIceTimeChange(value);
            }}
            options={iceTimeOptions}
            placeholder="Choose ice time"
            listboxLabel="Ice time"
            inputClassName="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-200"
          />
        </FormField>
      ) : null}
    </section>
  );
}

export default function PublicDuesPage() {
  const fallMembershipId = useId();
  const fallIceTimeId = useId();
  const winterMembershipId = useId();
  const winterIceTimeId = useId();

  const [schedule, setSchedule] = useState<PublicDuesSchedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<DuesEstimate | null>(null);
  const [estimateLoading, setEstimateLoading] = useState(false);

  const [fall, setFall] = useState<SessionSelection>(defaultSessionSelection);
  const [winter, setWinter] = useState<SessionSelection>(defaultSessionSelection);
  const [studentDiscount, setStudentDiscount] = useState(false);
  const [reciprocalDiscount, setReciprocalDiscount] = useState(false);

  useEffect(() => {
    let canceled = false;
    setLoading(true);
    setError(null);
    api
      .get<PublicDuesSchedule>('/public/dues')
      .then((response) => {
        if (!canceled) setSchedule(response.data);
      })
      .catch((loadError: unknown) => {
        if (!canceled) {
          setError(formatApiError(loadError, 'Failed to load dues schedule'));
          setSchedule(null);
        }
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, []);

  const estimatePayload = useMemo(
    () => ({
      fall,
      winter,
      studentDiscount,
      reciprocalDiscount,
    }),
    [fall, winter, studentDiscount, reciprocalDiscount],
  );

  useEffect(() => {
    if (!schedule || !hasCalculatorSelections(fall, winter)) {
      setEstimate(null);
      return;
    }

    let canceled = false;
    setEstimateLoading(true);
    api
      .post<DuesEstimate>('/public/dues/estimate', estimatePayload)
      .then((response) => {
        if (!canceled) setEstimate(response.data);
      })
      .catch(() => {
        if (!canceled) setEstimate(null);
      })
      .finally(() => {
        if (!canceled) setEstimateLoading(false);
      });

    return () => {
      canceled = true;
    };
  }, [schedule, estimatePayload, fall, winter]);

  const feeRows = useMemo(() => {
    if (!schedule) return [];
    const { fees } = schedule;
    return [
      { label: `${schedule.season.name} base membership`, amount: fees.regularMembershipDollars },
      { label: 'Each league', amount: fees.leagueFeeDollars },
      { label: 'Daytime league or spare-only', amount: fees.spareOnlyIcePrivilegeDollars },
      { label: 'Social membership (includes association dues)', amount: fees.socialMembershipDollars },
      { label: 'Junior recreational membership (fall or winter session)', amount: fees.juniorRecreationalDollars },
    ];
  }, [schedule]);

  const discountRows = useMemo(() => {
    if (!schedule) return [];
    const { discounts } = schedule;
    return [
      { type: 'Student discount', details: discountDescription(discounts.student, 'membership and leagues') },
      { type: 'Reciprocal discount', details: discountDescription(discounts.reciprocal, 'membership') },
      { type: 'Winter-only discount', details: discountDescription(discounts.winterOnly, 'membership') },
    ];
  }, [schedule]);

  const winterOnlyNoteVisible =
    fall.membershipType === 'none' && winter.membershipType === 'regular' && schedule != null;

  if (loading) {
    return (
      <PublicLayout>
        <SeoMeta
          title="Membership and dues | Triangle Curling Club"
          description="Review Triangle Curling Club membership fees and estimate your annual dues."
          canonicalPath="/dues"
        />
        <div className="public-container public-section">
          <PublicStateCard title="Loading dues information" description="Please wait…" />
        </div>
      </PublicLayout>
    );
  }

  if (error || !schedule) {
    return (
      <PublicLayout>
        <SeoMeta
          title="Membership and dues | Triangle Curling Club"
          description="Review Triangle Curling Club membership fees and estimate your annual dues."
          canonicalPath="/dues"
        />
        <div className="public-container public-section">
          <PublicStateCard title="Dues information unavailable" description={error ?? 'Please try again later.'} tone="error" />
        </div>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout>
      <SeoMeta
        title="Membership and dues | Triangle Curling Club"
        description="Review Triangle Curling Club membership fees, discounts, and an interactive dues estimator."
        canonicalPath="/dues"
      />

      <div className="public-container public-section space-y-10">
        <section className="space-y-4">
          <p className="text-sm font-semibold text-emerald-800">
            <Link to="/registration/start" className="hover:underline">
              « Back to membership overview
            </Link>
          </p>
          <div className="public-page-title-rule">
            <h1 className="public-heading">Membership and dues structure</h1>
          </div>
          <p className="public-body max-w-3xl">
            All curling members must pay for a base membership and an additional fee based on desired leagues and/or ice
            time. Your base membership fee goes toward insurance, basic club operations, and dues on your behalf to our
            associated organizations: the Grand National Curling Club (GNCC), United States Curling Association (USA
            Curling), and if applicable, the United States Women&apos;s Curling Association (USWCA). Use the interactive
            dues estimator below for more details on your membership benefits.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-gray-900">Fees ({schedule.season.name} curling season)</h2>
          <p className="text-sm text-gray-600">
            League fees shown use the default league fee. Individual leagues may set their own fee.
          </p>
          <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left font-semibold text-gray-700">
                    Membership type
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold text-gray-700">
                    Rate
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {feeRows.map((row) => (
                  <tr key={row.label}>
                    <td className="px-4 py-3 text-gray-800">{row.label}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-900">{formatDollars(row.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-gray-900">Discounts</h2>
          <p className="text-sm text-gray-600">See below for details and restrictions.</p>
          <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left font-semibold text-gray-700">
                    Discount type
                  </th>
                  <th scope="col" className="px-4 py-3 text-left font-semibold text-gray-700">
                    Details
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {discountRows.map((row) => (
                  <tr key={row.type}>
                    <td className="px-4 py-3 font-medium text-gray-800">{row.type}</td>
                    <td className="px-4 py-3 text-gray-700">{row.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-gray-900">Dues calculator</h2>
          <p className="text-sm text-gray-600">
            Select your preferences for membership and ice time below to see your estimated dues and membership
            benefits.
          </p>

          <div className="grid gap-4 lg:grid-cols-2">
            <SessionCalculatorSection
              title={schedule.fallSession.name}
              membershipType={fall.membershipType}
              iceTime={fall.iceTime}
              onMembershipTypeChange={(value) => setFall((current) => ({ ...current, membershipType: value }))}
              onIceTimeChange={(value) => setFall((current) => ({ ...current, iceTime: value }))}
              membershipFieldId={fallMembershipId}
              iceTimeFieldId={fallIceTimeId}
            />
            {schedule.winterSession ? (
              <SessionCalculatorSection
                title={schedule.winterSession.name}
                membershipType={winter.membershipType}
                iceTime={winter.iceTime}
                onMembershipTypeChange={(value) => setWinter((current) => ({ ...current, membershipType: value }))}
                onIceTimeChange={(value) => setWinter((current) => ({ ...current, iceTime: value }))}
                membershipFieldId={winterMembershipId}
                iceTimeFieldId={winterIceTimeId}
              />
            ) : null}
          </div>

          <section className="public-card space-y-4 p-5 sm:p-6">
            <h2 className="text-lg font-semibold text-gray-900">Discount</h2>
            <div className="space-y-3">
              <FormCheckbox
                tone="public"
                checked={studentDiscount}
                onChange={setStudentDiscount}
                label={`Student discount (${formatRegistrationDiscountOffPhrase(schedule.discounts.student)} membership and leagues)`}
              />
              <FormCheckbox
                tone="public"
                checked={reciprocalDiscount}
                onChange={setReciprocalDiscount}
                label={`Reciprocal discount (${formatRegistrationDiscountOffPhrase(schedule.discounts.reciprocal)} membership)`}
              />
              {winterOnlyNoteVisible ? (
                <p className="text-sm text-gray-600">
                  The winter-only discount ({formatRegistrationDiscountOffPhrase(schedule.discounts.winterOnly)}{' '}
                  membership) applies automatically when you begin in {schedule.winterSession?.name ?? 'winter'} without
                  registering in {schedule.fallSession.name}.
                </p>
              ) : null}
            </div>
          </section>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-gray-900">Estimated dues</h2>
          {!hasCalculatorSelections(fall, winter) ? (
            <p className="text-sm italic text-gray-600">Choose from the options above to see your estimated dues.</p>
          ) : estimateLoading ? (
            <p className="text-sm text-gray-600">Calculating estimate…</p>
          ) : estimate ? (
            <div className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-2">
                <PaymentBreakdown title={`${schedule.fallSession.name} payment`} breakdown={estimate.fall} />
                {schedule.winterSession ? (
                  <PaymentBreakdown
                    title={`${schedule.winterSession.name} payment`}
                    breakdown={estimate.winter}
                  />
                ) : null}
              </div>
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                <div className="flex items-center justify-between gap-4 text-base font-semibold text-emerald-950">
                  <span>Estimated annual dues</span>
                  <span className="tabular-nums">{formatCurrency(estimate.annualTotalMinor)}</span>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-600">Unable to calculate an estimate right now.</p>
          )}
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-gray-900">Membership benefits based on your selections</h2>
          {!estimate || !hasCalculatorSelections(fall, winter) ? (
            <p className="text-sm italic text-gray-600">Choose from the options above to see your membership benefits.</p>
          ) : (
            <div className="public-card space-y-5 p-5 sm:p-6">
              <BenefitsList title="Annual benefits (September 1–August 31)" items={estimate.benefits.annual} />
              <BenefitsList
                title={`${schedule.fallSession.name} benefits (September 1–December 31)`}
                items={estimate.benefits.fall}
              />
              {schedule.winterSession ? (
                <BenefitsList
                  title={`${schedule.winterSession.name} benefits (January–May 31)`}
                  items={estimate.benefits.winter}
                />
              ) : null}
              {estimate.benefits.annual.length === 0 &&
              estimate.benefits.fall.length === 0 &&
              estimate.benefits.winter.length === 0 ? (
                <p className="text-sm text-gray-600">
                  No ice-time membership benefits apply to the current selections.
                </p>
              ) : null}
            </div>
          )}
        </section>

        <section className="space-y-3 public-card p-5 sm:p-6">
          <h2 className="text-xl font-semibold text-gray-900">Details and restrictions</h2>
          <ul className="list-disc space-y-2 pl-5 text-sm text-gray-700">
            <li>An annual membership runs through August 31.</li>
            <li>
              Ice time includes building access rights, unlimited practice and sparing, and more through December 31 (
              {schedule.fallSession.name.toLowerCase()} session) or when the ice is removed, typically in May (
              {schedule.winterSession?.name.toLowerCase() ?? 'winter'} session).
            </li>
            <li>Daytime leagues are free with standard league registration.</li>
            <li>Spare-only membership is only permitted for curlers with at least one year of experience.</li>
            <li>All social memberships include dues paid to GNCC, USA Curling, and USWCA (as applicable) at no extra charge.</li>
            <li>Membership benefits apply starting September 1 or after payment is received, whichever is later.</li>
            <li>
              The junior recreational membership is priced specially for juniors and is not eligible for any discounts.
            </li>
            <li>
              USWCA dues will be paid automatically on behalf of members registering with &quot;she/her&quot; pronouns,
              unless the member has opted out during registration.
            </li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold text-gray-900">Questions</h2>
          <p className="text-sm text-gray-700">
            Questions about membership?{' '}
            <a href="mailto:membership@trianglecurling.com" className="font-medium text-emerald-800 hover:underline">
              membership@trianglecurling.com
            </a>
          </p>
          <p className="text-sm text-gray-700">
            Questions about dues or payments?{' '}
            <a href="mailto:finance@trianglecurling.com" className="font-medium text-emerald-800 hover:underline">
              finance@trianglecurling.com
            </a>
          </p>
        </section>
      </div>
    </PublicLayout>
  );
}
