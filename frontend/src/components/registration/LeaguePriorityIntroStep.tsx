import { Link } from 'react-router-dom';
import Button from '../Button';

type Props = {
  continueLabel?: string;
  onContinue: () => void;
};

/**
 * Purely informational screen before the league priority list. Explains what
 * the next step asks for and how protected return spots work when rosters are
 * built.
 */
export default function LeaguePriorityIntroStep({ continueLabel = 'Continue', onContinue }: Props) {
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="app-section-title">What you will do next</h2>
        <p className="text-sm text-gray-700">
          On the next screen you will choose how many leagues you want to play this session, then build an ordered
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
          Waitlists are used to fill those protected spots. If you already have two guaranteed leagues, extra leagues
          further down your list are not used. You can still add a league and move it higher to try a switch with
          guaranteed fallback; until you do, that extra row is marked superfluous and you cannot continue. Labels on the
          next screen update as you reorder your list so you can see what is guaranteed and what is not.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="app-section-title">Read more</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700">
          <li>
            <Link
              to="/explainers/waitlists"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary-teal underline hover:text-primary-teal/80"
            >
              How waitlists work
            </Link>
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

      <div className="flex flex-wrap gap-3">
        <Button type="button" onClick={onContinue}>
          {continueLabel}
        </Button>
      </div>
    </div>
  );
}
