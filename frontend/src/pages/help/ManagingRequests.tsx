import { Link, useLocation } from 'react-router-dom';
import Footer from '../../components/Footer';
import HelpHeader from '../../components/HelpHeader';
import { helpSections } from '../Help';

export default function ManagingRequests() {
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
                  Managing Your Requests
                </h1>

                <div className="prose max-w-none space-y-6 text-gray-700 dark:text-gray-300">
                  <section>
                    <h2 className="text-2xl font-semibold mb-4 text-[#121033] dark:text-gray-100">
                      Viewing Your Requests
                    </h2>
                    <p className="mb-3">
                      All your spare requests are available on the "My requests" page, organized by
                      status:
                    </p>
                    <ul className="list-disc list-inside space-y-2">
                      <li>
                        <strong>Open requests:</strong> Still looking for a spare
                      </li>
                      <li>
                        <strong>Filled requests:</strong> Someone has signed up
                      </li>
                      <li>
                        <strong>Canceled requests:</strong> You've canceled the request
                      </li>
                    </ul>
                    <p className="mt-4">
                      Requests are sorted with open requests first, then filled, then canceled.
                      Within each group, they're sorted by game date and time.
                    </p>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold mb-4 text-[#121033] dark:text-gray-100">
                      Canceling a Request
                    </h2>
                    <p className="mb-3">If you no longer need a spare:</p>
                    <ol className="list-decimal list-inside space-y-2">
                      <li>Go to "My requests" page</li>
                      <li>Find the request you want to cancel</li>
                      <li>Click "Cancel" button</li>
                      <li>Confirm the cancellation</li>
                      <li>The request will be removed from other members' dashboards</li>
                    </ol>
                    <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">
                      <strong>Note:</strong> You can only cancel open requests. If someone has
                      already signed up, you'll need to contact them directly if plans change.
                    </p>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold mb-4 text-[#121033] dark:text-gray-100">
                      Re-issuing a Request
                    </h2>
                    <p className="mb-3">
                      You can re-issue a request to send notifications again in two situations:
                    </p>
                    <ol className="list-decimal list-inside space-y-3">
                      <li>
                        <strong>After 72 hours:</strong> If it's been more than 72 hours since
                        notifications were last sent, you can re-issue to send fresh notifications
                      </li>
                      <li>
                        <strong>After a cancellation:</strong> If someone signed up and then
                        canceled their spare offer, you can immediately re-issue the request
                      </li>
                    </ol>
                    <p className="mt-4 mb-3">When re-issuing:</p>
                    <ul className="list-disc list-inside space-y-2">
                      <li>You can update your message</li>
                      <li>The notification process starts fresh</li>
                      <li>For public requests, notifications are sent gradually again</li>
                      <li>For private requests, all invited members are notified immediately</li>
                    </ul>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold mb-4 text-[#121033] dark:text-gray-100">
                      Pausing Notifications
                    </h2>
                    <p className="mb-3">For public requests with staggered notifications:</p>
                    <ul className="list-disc list-inside space-y-2">
                      <li>
                        <strong>Pause:</strong> Temporarily stop sending notifications
                      </li>
                      <li>
                        <strong>Unpause:</strong> Resume sending notifications
                      </li>
                      <li>Useful if you need to temporarily halt notifications for any reason</li>
                      <li>
                        The request remains visible on dashboards, but no new notifications are sent
                      </li>
                      <li>When you unpause, the next notification is sent immediately</li>
                    </ul>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold mb-4 text-[#121033] dark:text-gray-100">
                      Viewing Notification Status
                    </h2>
                    <p className="mb-3">On each open request card, you can see:</p>
                    <ul className="list-disc list-inside space-y-2">
                      <li>
                        <strong>"Notifications in progress... X of Y members notified":</strong>{' '}
                        Shows real-time progress for staggered notifications
                      </li>
                      <li>
                        <strong>"All notifications sent. X members notified":</strong> All
                        notifications have been completed
                      </li>
                      <li>
                        <strong>"(Paused)":</strong> Notifications are currently paused
                      </li>
                      <li>
                        <strong>Status updates automatically</strong> as notifications are sent
                      </li>
                    </ul>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold mb-4 text-[#121033] dark:text-gray-100">
                      When Someone Signs Up
                    </h2>
                    <p className="mb-3">When someone signs up to fill your spare request:</p>
                    <ul className="list-disc list-inside space-y-2">
                      <li>You'll receive an email and SMS notification</li>
                      <li>The request status changes to "Filled"</li>
                      <li>You can see who signed up and any comment they included</li>
                      <li>The request is removed from other members' dashboards</li>
                      <li>Notifications stop automatically</li>
                    </ul>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold mb-4 text-[#121033] dark:text-gray-100">
                      When Someone Cancels
                    </h2>
                    <p className="mb-3">If someone who signed up cancels their spare offer:</p>
                    <ul className="list-disc list-inside space-y-2">
                      <li>You'll receive a notification with their cancellation comment</li>
                      <li>The request status changes back to "Open"</li>
                      <li>A "Re-issue" button appears immediately</li>
                      <li>You can re-issue to send notifications again</li>
                      <li>The request becomes visible to other members again</li>
                    </ul>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold mb-4 text-[#121033] dark:text-gray-100">
                      Dashboard View
                    </h2>
                    <p className="mb-3">Your dashboard shows a summary of your requests:</p>
                    <ul className="list-disc list-inside space-y-2">
                      <li>
                        <strong>"My spare requests":</strong> Shows your open and filled requests
                        (not canceled)
                      </li>
                      <li>
                        <strong>"My upcoming sparing":</strong> Shows requests you've signed up to
                        fill
                      </li>
                      <li>Both sections only show future games (past games are filtered out)</li>
                      <li>
                        Click through to "My requests" for full details and management options
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
