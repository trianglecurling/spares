import { Link, useLocation } from 'react-router-dom';
import Footer from '../../components/Footer';
import HelpHeader from '../../components/HelpHeader';
import { helpSections } from '../Help';

export default function EmailSMS() {
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
                  Email & SMS Notifications
                </h1>

                <div className="prose max-w-none space-y-6 text-gray-700 dark:text-gray-300">
                  <section>
                    <h2 className="text-2xl font-semibold mb-4 text-[#121033] dark:text-gray-100">
                      Types of Notifications
                    </h2>
                    <p className="mb-4">
                      The system sends various notifications to keep you informed about spare
                      requests. You can control which types you receive in your profile settings.
                    </p>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold mb-4 text-[#121033] dark:text-gray-100">
                      Spare Request Notifications
                    </h2>
                    <h3 className="text-xl font-semibold mb-3 mt-4 text-[#121033] dark:text-gray-100">
                      When You Receive a Request
                    </h3>
                    <ul className="list-disc list-inside space-y-2">
                      <li>
                        <strong>Email:</strong> Sent to all members who match the request
                      </li>
                      <li>
                        <strong>SMS:</strong> Sent if you've opted in to SMS notifications
                      </li>
                      <li>
                        <strong>Content includes:</strong>
                        <ul className="list-disc list-inside ml-6 mt-2 space-y-1">
                          <li>Who needs the spare</li>
                          <li>Date and time of the game</li>
                          <li>Position (if specified)</li>
                          <li>Personal message (if included)</li>
                          <li>For private requests: list of all invited members</li>
                          <li>Direct link to accept the spare request</li>
                        </ul>
                      </li>
                    </ul>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold mb-4 text-[#121033] dark:text-gray-100">
                      Response Notifications
                    </h2>
                    <h3 className="text-xl font-semibold mb-3 mt-4 text-[#121033] dark:text-gray-100">
                      When Someone Signs Up for Your Request
                    </h3>
                    <ul className="list-disc list-inside space-y-2">
                      <li>
                        <strong>Email:</strong> Sent immediately when someone signs up
                      </li>
                      <li>
                        <strong>SMS:</strong> Sent if you've opted in to SMS notifications
                      </li>
                      <li>
                        <strong>Content includes:</strong>
                        <ul className="list-disc list-inside ml-6 mt-2 space-y-1">
                          <li>Who signed up to fill your spare</li>
                          <li>Game details</li>
                          <li>Any comment they included</li>
                        </ul>
                      </li>
                    </ul>

                    <h3 className="text-xl font-semibold mb-3 mt-6 text-[#121033] dark:text-gray-100">
                      When Someone Cancels Their Spare Offer
                    </h3>
                    <ul className="list-disc list-inside space-y-2">
                      <li>
                        <strong>Email:</strong> Sent if someone who signed up cancels
                      </li>
                      <li>
                        <strong>SMS:</strong> Sent if you've opted in to SMS notifications
                      </li>
                      <li>
                        <strong>Content includes:</strong>
                        <ul className="list-disc list-inside ml-6 mt-2 space-y-1">
                          <li>Who canceled</li>
                          <li>Their cancellation comment</li>
                          <li>Reminder that you can re-issue the request</li>
                        </ul>
                      </li>
                    </ul>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold mb-4 text-[#121033] dark:text-gray-100">
                      Login Codes
                    </h2>
                    <ul className="list-disc list-inside space-y-2">
                      <li>
                        <strong>Email:</strong> Sent when you request a login code via email
                      </li>
                      <li>
                        <strong>SMS:</strong> Sent when you request a login code via phone
                      </li>
                      <li>
                        <strong>Content:</strong> A 6-digit code that expires after a short time
                      </li>
                      <li>
                        <strong>Security:</strong> Codes are single-use and time-limited
                      </li>
                    </ul>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold mb-4 text-[#121033] dark:text-gray-100">
                      Managing Your Notifications
                    </h2>
                    <p className="mb-3">
                      You can control your notification preferences in your profile:
                    </p>
                    <ul className="list-disc list-inside space-y-2">
                      <li>
                        <strong>Email notifications:</strong> Always enabled (required for account
                        functionality)
                      </li>
                      <li>
                        <strong>SMS notifications:</strong> Opt in/out in your profile settings
                      </li>
                      <li>
                        <strong>Unsubscribe:</strong> Use the unsubscribe link in any email to
                        effectively be removed from all spare lists
                      </li>
                      <li>
                        <strong>Note:</strong> You'll still receive login codes and important
                        account notifications
                      </li>
                    </ul>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold mb-4 text-[#121033] dark:text-gray-100">
                      Email Links
                    </h2>
                    <p className="mb-3">Emails include secure links that:</p>
                    <ul className="list-disc list-inside space-y-2">
                      <li>Allow you to accept spare requests directly from your email</li>
                      <li>Are personalized and secure - don't share them with others</li>
                      <li>Work even if you're not logged in</li>
                      <li>Automatically log you in if needed</li>
                    </ul>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold mb-4 text-[#121033] dark:text-gray-100">
                      Privacy & Security
                    </h2>
                    <ul className="list-disc list-inside space-y-2">
                      <li>Your contact information is kept private</li>
                      <li>Only you and administrators can see your email and phone</li>
                      <li>You can control visibility of your contact info in your profile</li>
                      <li>All notifications are sent securely</li>
                      <li>Links in emails are personalized and secure</li>
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
