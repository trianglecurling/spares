import { Link } from 'react-router-dom';
import Button from '../Button';

type Props = {
  continueLabel?: string;
  /** New curlers do not have protected return spots; show waitlist-focused copy instead. */
  audience?: 'returning' | 'new';
  /** When false, skip the Saturday Instructional callout (new curlers with more than one year). */
  recommendSaturdayInstructional?: boolean;
  onContinue: () => void;
};

function SaturdayInstructionalArticleLink({ children }: { children: string }) {
  return (
    <Link
      to="/article/saturday-instructional-program"
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-primary-teal-link underline hover:opacity-90"
    >
      {children}
    </Link>
  );
}

function WaitlistsExplainerLink() {
  return (
    <Link
      to="/explainers/waitlists"
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-primary-teal underline hover:text-primary-teal/80"
    >
      How waitlists work
    </Link>
  );
}

function ReturningMemberIntro() {
  return (
    <>
      <section className="space-y-3">
        <h2 className="app-section-title">What you will do next</h2>
        <p className="text-sm text-gray-700">
          On the next screen you will choose how many leagues/instructional programs you want to play this session, then build an ordered
          priority list of leagues. Put the league you want most at the top. We work down that list to fill up to the
          number of leagues you asked for.
        </p>
        <p className="text-sm text-gray-700">
          Your list can be longer than the number of leagues you want. Extra leagues are backups if a higher choice does
          not come through.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="app-section-title">How league rosters are built</h2>
        <p className="text-sm text-gray-700">
          Each returning member has up to two protected spots from leagues they participated in last session. You can:
        </p>
        <ul className="list-disc space-y-2 pl-5 text-sm text-gray-700">
          <li>
            <span className="font-medium text-gray-900">Guaranteed return</span> — keep a protected spot in a league you
            played before, so you are on that roster.
          </li>
          <li>
            <span className="font-medium text-gray-900">Guaranteed fallback</span> — rank a different league higher while
            still holding a protected spot lower on your list. If you cannot switch into the higher league, you keep the
            fallback spot.
          </li>
          <li>
            <span className="font-medium text-gray-900">Sabbatical</span> — step away from a league for this session while
            keeping your right to return later. There is a small fee for this option.
          </li>
        </ul>
        <p className="text-sm text-gray-700">
          Waitlists are used to fill league vacancies after all returning participants are rostered. Waitlists are processed after the priority
          registration period. To join another league, you must first join its waitlist. Some leagues may move through their waitlists quickly
          while others may take longer. You will stay on the waitlist until you remove yourself or you decline an offer to join the league twice.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="app-section-title">Read more</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700">
          <li>
            <WaitlistsExplainerLink />
          </li>
          <li>
            <Link
              to="/explainers/sabbaticals"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary-teal underline hover:text-primary-teal/80"
            >
              How sabbaticals work
            </Link>
          </li>
        </ul>
      </section>
    </>
  );
}

function NewMemberIntro({ recommendSaturdayInstructional }: { recommendSaturdayInstructional: boolean }) {
  return (
    <>
      <section className="space-y-3">
        <h2 className="app-section-title">What you will do next</h2>
        <p className="text-sm text-gray-700">
          {recommendSaturdayInstructional
            ? 'On the next screen you will rank your choice of leagues (or select our very popular Saturday Instructional program). If you are joining a league, we recommend adding several options to your list, as the majority of our leagues will fill.'
            : 'On the next screen you will choose how many leagues or instructional programs you want to play this session, then build an ordered priority list. Put the league you want most at the top. Extra leagues are backups if a higher choice does not come through.'}
        </p>
        {recommendSaturdayInstructional ? (
          <div
            className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950"
            role="status"
          >
            <p className="font-semibold">Saturday Instructional</p>
            <p className="mt-1 text-sky-900">
              A great first choice for new curlers. Add it at the top of your list if it fits your schedule.
            </p>
            <p className="mt-2">
              <SaturdayInstructionalArticleLink>Read more</SaturdayInstructionalArticleLink>
            </p>
          </div>
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="app-section-title">How league rosters are built</h2>
        <p className="text-sm text-gray-700">
          Returning members are placed first. Remaining spots are offered from waitlists after priority registration.
        </p>
        <p className="text-sm text-gray-700">
          Adding a league to your list joins its waitlist. Add as many as you can — some waitlists move quickly, others
          take longer. Extra leagues never commit you to more than the number you chose to play.
        </p>
      </section>
    </>
  );
}

/**
 * Purely informational screen before the league priority list. Explains what
 * the next step asks for. Returning members also see how protected return spots
 * work; new members get a shorter waitlist-focused version.
 */
export default function LeaguePriorityIntroStep({
  continueLabel = 'Continue',
  audience = 'returning',
  recommendSaturdayInstructional = audience === 'new',
  onContinue,
}: Props) {
  return (
    <div className="space-y-6">
      {audience === 'new' ? (
        <NewMemberIntro recommendSaturdayInstructional={recommendSaturdayInstructional} />
      ) : (
        <ReturningMemberIntro />
      )}
      <div className="flex flex-wrap gap-3">
        <Button type="button" onClick={onContinue}>
          {continueLabel}
        </Button>
      </div>
    </div>
  );
}
