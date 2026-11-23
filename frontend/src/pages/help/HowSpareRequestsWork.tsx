import { Link, useLocation } from 'react-router-dom';
import Footer from '../../components/Footer';
import HelpHeader from '../../components/HelpHeader';
import { helpSections } from '../Help';
import {
  formatHours,
  formatMinutes,
  formatSeconds,
  useSpareSettings,
} from '../../hooks/useSpareSettings';

const headingClass = 'text-2xl font-semibold mb-4 text-[#121033] dark:text-gray-100';

export default function HowSpareRequestsWork() {
  const location = useLocation();
  const currentPath = location.pathname;
  const { settings } = useSpareSettings();

  const byeWindow = formatMinutes(settings.byePriorityWindowMinutes);
  const urgent = formatHours(settings.urgentThresholdHours);
  const delay = formatSeconds(settings.notificationDelaySeconds);
  const cooldown = formatHours(settings.reissueCooldownHours);
  const hasByeWindow = settings.byePriorityWindowMinutes > 0;
  const hasUrgentThreshold = settings.urgentThresholdHours > 0;

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      <HelpHeader />
      <div className="flex-grow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
            <div className="lg:col-span-1">
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 sticky top-8">
                <h2 className="text-lg font-semibold mb-4 text-[#121033] dark:text-gray-100">
                  Help Topics
                </h2>
                <nav className="space-y-2">
                  {helpSections.map((section) => (
                    <Link
                      key={section.path}
                      to={section.path}
                      aria-current={currentPath === section.path ? 'page' : undefined}
                      className={`block px-3 py-2 rounded-md text-sm transition-colors ${
                        currentPath === section.path
                          ? 'bg-primary-teal-solid text-white'
                          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                      }`}
                    >
                      {section.title}
                    </Link>
                  ))}
                </nav>
              </div>
            </div>

            <div className="lg:col-span-3">
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-8">
                <h1 className="text-3xl font-bold mb-6 text-[#121033] dark:text-gray-100">
                  How spare requests work
                </h1>

                <div className="prose max-w-none space-y-8 text-gray-700 dark:text-gray-300">
                  <section>
                    <p>
                      When you can&apos;t make a game, you create a spare request for that game.
                      The club then lets other members know, and the first eligible member to
                      accept fills the spot. This page explains who hears about a request, in what
                      order, and how quickly.
                    </p>
                  </section>

                  <section>
                    <h2 className={headingClass}>Public and private requests</h2>
                    <ul className="list-disc list-inside space-y-2">
                      <li>
                        <strong>Public</strong> requests go out to members who are available for
                        that league, following the steps below. Once the request is listed, any
                        member can see it on their dashboard and accept it.
                      </li>
                      <li>
                        <strong>Private</strong> requests go only to the members you invite. Every
                        invitee is notified right away, and nobody else can see the request.
                      </li>
                      <li>
                        If nobody you invited can make it, choose <strong>Make public</strong> on
                        the My requests page to open a private request to everyone. A public
                        request can&apos;t be made private.
                      </li>
                    </ul>
                  </section>

                  <section>
                    <h2 className={headingClass}>Players on bye get first chance</h2>
                    <p className="mb-3">
                      When a team in the same league has a bye that week, its players are the
                      first to hear about a public request.
                    </p>
                    <ul className="list-disc list-inside space-y-2">
                      <li>All players on bye are notified at once, as soon as the request is created.</li>
                      {hasByeWindow ? (
                        <li>
                          For the next {byeWindow}, only players on bye can see and accept the
                          request. Everyone else is notified after that exclusive window ends.
                        </li>
                      ) : (
                        <li>There is currently no exclusive window, so everyone else is notified right after.</li>
                      )}
                      <li>
                        Players on bye are notified even if they didn&apos;t mark themselves
                        available for that league, and even for a skip position.
                      </li>
                      <li>
                        If you get an email about a request but aren&apos;t on bye, you may be
                        asked to wait until the exclusive window ends before you can accept.
                      </li>
                    </ul>
                  </section>

                  <section>
                    <h2 className={headingClass}>How everyone else is notified</h2>
                    <ol className="list-decimal list-inside space-y-2">
                      <li>
                        After the bye window, available members are notified one at a time, in
                        random order.
                      </li>
                      <li>The system waits {delay} between each notification.</li>
                      <li>
                        The request appears on member dashboards once the bye window is over, so
                        anyone can accept it even before their own notification goes out.
                      </li>
                      <li>
                        Notifications stop as soon as someone accepts, or when everyone has been
                        notified.
                      </li>
                    </ol>
                    <p className="mt-3">
                      Spreading notifications out gives the first people notified a fair chance to
                      respond, and avoids a flood of emails for a spot that fills quickly.
                    </p>
                  </section>

                  {hasUrgentThreshold ? (
                    <section>
                      <h2 className={headingClass}>Urgent requests</h2>
                      <p>
                        If the game starts in less than {urgent}, there&apos;s no time to wait. The
                        exclusive window and the delay are skipped, and every eligible member is
                        notified at once. The request is listed on dashboards immediately.
                      </p>
                    </section>
                  ) : null}

                  <section>
                    <h2 className={headingClass}>Who gets notified</h2>
                    <ul className="list-disc list-inside space-y-2">
                      <li>
                        Members who marked themselves available for the league on the{' '}
                        <Link to="/help/availability" className="text-primary-teal-link hover:underline">
                          availability
                        </Link>{' '}
                        page, plus players on bye.
                      </li>
                      <li>
                        For a skip position, only members who said they are comfortable skipping
                        are notified (players on bye are always included).
                      </li>
                      <li>
                        Members already playing or sparing in that draw aren&apos;t notified.
                      </li>
                      <li>
                        Notifications go by email, and by text message for members who opted in.
                      </li>
                    </ul>
                  </section>

                  <section>
                    <h2 className={headingClass}>Requesting for someone else</h2>
                    <ul className="list-disc list-inside space-y-2">
                      <li>You can request a spare for yourself or any teammate.</li>
                      <li>
                        League managers can request a spare for any player in a league they
                        manage, even if they aren&apos;t on that player&apos;s team.
                      </li>
                      <li>
                        Whoever creates the request manages it from their My requests page.
                      </li>
                    </ul>
                  </section>

                  <section>
                    <h2 className={headingClass}>Managing your request</h2>
                    <ul className="list-disc list-inside space-y-2">
                      <li>
                        <strong>Pause notifications</strong> stops new notifications for a public
                        request. Unpause to pick up where it left off.
                      </li>
                      <li>
                        <strong>Re-issue</strong> starts notifications over. It&apos;s available{' '}
                        {settings.reissueCooldownHours > 0
                          ? `${cooldown} after notifications were last sent, or`
                          : 'any time after notifications were sent, and'}{' '}
                        right away if someone accepts and then cancels.
                      </li>
                      <li>
                        <strong>Cancel</strong> removes the request if you no longer need a spare.
                      </li>
                    </ul>
                    <p className="mt-3">
                      See{' '}
                      <Link to="/help/managing-requests" className="text-primary-teal-link hover:underline">
                        Managing your requests
                      </Link>{' '}
                      for step-by-step instructions.
                    </p>
                  </section>
                </div>

                <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700">
                  <Link to="/help" className="text-primary-teal-link hover:underline">
                    ← Back to Help Index
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}
