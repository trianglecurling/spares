import { Link, useLocation } from 'react-router-dom';
import Footer from '../../components/Footer';
import HelpHeader from '../../components/HelpHeader';
import { helpSections } from '../Help';

export default function Responding() {
  const location = useLocation();
  const currentPath = location.pathname;

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      <HelpHeader />
      <div className="flex-grow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
            {/* Sidebar Navigation */}
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
                      className={`block px-3 py-2 rounded-md text-sm transition-colors ${
                        currentPath === section.path
                          ? 'bg-primary-teal text-white'
                          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                      }`}
                    >
                      {section.title}
                    </Link>
                  ))}
                </nav>
              </div>
            </div>

            {/* Main Content */}
            <div className="lg:col-span-3">
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-8">
                <h1 className="text-3xl font-bold mb-6 text-[#121033] dark:text-gray-100">
                  Responding to Spare Requests
                </h1>

                <div className="prose max-w-none space-y-6 text-gray-700 dark:text-gray-300">
                  <section>
                    <h2 className="text-2xl font-semibold mb-4 text-[#121033] dark:text-gray-100">
                      How to Sign Up as a Spare
                    </h2>
                    <ol className="list-decimal list-inside space-y-3">
                      <li>
                        <strong>View spare requests</strong> on your dashboard - all public requests
                        are visible to everyone
                      </li>
                      <li>
                        <strong>Click "Sign Up"</strong> on any request you're available for
                      </li>
                      <li>
                        <strong>Optionally add a comment</strong> with any relevant information
                        (e.g., "I can arrive 15 minutes early")
                      </li>
                      <li>
                        <strong>Confirm</strong> - the requester will be notified immediately
                      </li>
                    </ol>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold mb-4 text-[#121033] dark:text-gray-100">
                      What Happens When You Sign Up?
                    </h2>
                    <ul className="list-disc list-inside space-y-2">
                      <li>
                        The request is marked as "filled" and removed from other members' dashboards
                      </li>
                      <li>The requester receives an email and SMS notification</li>
                      <li>Your comment (if provided) is visible to the requester</li>
                      <li>The request appears in your "My upcoming sparing" section</li>
                    </ul>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold mb-4 text-[#121033] dark:text-gray-100">
                      Canceling Your Spare Offer
                    </h2>
                    <p className="mb-3">If you need to cancel after signing up:</p>
                    <ol className="list-decimal list-inside space-y-2">
                      <li>Go to "My upcoming sparing" on your dashboard</li>
                      <li>Click "Cancel sparing" on the request</li>
                      <li>Confirm and provide a comment explaining why you're canceling</li>
                      <li>The requester will be notified and can re-issue the request if needed</li>
                    </ol>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold mb-4 text-[#121033] dark:text-gray-100">
                      Which Requests Can You See?
                    </h2>
                    <p className="mb-3">
                      All public spare requests are visible to everyone on their dashboard,
                      regardless of availability:
                    </p>
                    <ul className="list-disc list-inside space-y-2">
                      <li>
                        <strong>Public requests:</strong> All members can see all public requests on
                        their dashboard
                      </li>
                      <li>
                        <strong>Private requests:</strong> Only visible if you were specifically
                        invited
                      </li>
                      <li>
                        <strong>Future games only:</strong> Past games are automatically filtered
                        out
                      </li>
                    </ul>
                    <p className="mt-3 mb-3">
                      <strong>Note:</strong> While all public requests are visible, your
                      availability settings determine:
                    </p>
                    <ul className="list-disc list-inside space-y-2">
                      <li>Which requests you receive email/SMS notifications about</li>
                      <li>
                        Which requests you can respond to (you can only sign up if your availability
                        matches)
                      </li>
                      <li>
                        For skip position requests: You can only respond if you've indicated you're
                        comfortable playing skip
                      </li>
                    </ul>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold mb-4 text-[#121033] dark:text-gray-100">
                      Tips
                    </h2>
                    <ul className="list-disc list-inside space-y-2">
                      <li>
                        Sign up as soon as you know you're available - others may be looking too
                      </li>
                      <li>
                        Include helpful comments when signing up (e.g., arrival time, experience
                        level)
                      </li>
                      <li>
                        If you need to cancel, do so as early as possible to give the requester time
                        to find another spare
                      </li>
                      <li>
                        Keep your availability up to date so you receive notifications for relevant
                        requests
                      </li>
                    </ul>
                  </section>
                </div>

                <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700">
                  <Link to="/help" className="text-primary-teal hover:underline">
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
