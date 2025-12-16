import { Link, useLocation } from 'react-router-dom';
import Footer from '../../components/Footer';
import HelpHeader from '../../components/HelpHeader';
import { helpSections } from '../Help';

export default function Availability() {
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
              Setting Your Availability
            </h1>

            <div className="prose max-w-none space-y-6 text-gray-700 dark:text-gray-300">
              <section>
                <h2 className="text-2xl font-semibold mb-4 text-[#121033] dark:text-gray-100">
                  Why Set Your Availability?
                </h2>
                <p className="mb-3">
                  Setting your availability helps the system match you with relevant spare requests:
                </p>
                <ul className="list-disc list-inside space-y-2">
                  <li>You'll receive email/SMS notifications only for requests matching your availability</li>
                  <li>You can only sign up for requests that match your availability settings</li>
                  <li>It reduces notification noise - you only get notified about requests you can actually help with</li>
                  <li>It helps the system find spares more efficiently</li>
                  <li><strong>Note:</strong> All public requests are visible to everyone on their dashboard, regardless of availability</li>
                </ul>
              </section>

              <section>
                <h2 className="text-2xl font-semibold mb-4 text-[#121033] dark:text-gray-100">
                  How to Set Availability
                </h2>
                <ol className="list-decimal list-inside space-y-3">
                  <li>
                    <strong>Click "Set your availability"</strong> from the dashboard or navigation menu
                  </li>
                  <li>
                    <strong>Select a league</strong> from the dropdown menu
                  </li>
                  <li>
                    <strong>Toggle "Available"</strong> to indicate you're available for that league
                  </li>
                  <li>
                    <strong>If you can skip:</strong> Toggle "Comfortable playing skip" if you're willing to spare as skip
                  </li>
                  <li>
                    <strong>Repeat for each league</strong> you want to set availability for
                  </li>
                  <li>
                    <strong>Your changes save automatically</strong> - no need to click a save button
                  </li>
                </ol>
              </section>

              <section>
                <h2 className="text-2xl font-semibold mb-4 text-[#121033] dark:text-gray-100">
                  Understanding Availability
                </h2>
                <h3 className="text-xl font-semibold mb-3 mt-4 text-[#121033] dark:text-gray-100">
                  Available
                </h3>
                <ul className="list-disc list-inside space-y-2">
                  <li>When enabled: You'll receive email/SMS notifications for spare requests in this league and can sign up for them</li>
                  <li>When disabled: You won't receive notifications for this league and can't sign up for requests in this league</li>
                  <li><strong>Note:</strong> You can still see all public requests on your dashboard regardless of availability</li>
                  <li>You can change this at any time</li>
                  <li>Setting availability doesn't commit you to anything - you can still decline requests</li>
                </ul>

                <h3 className="text-xl font-semibold mb-3 mt-6 text-[#121033] dark:text-gray-100">
                  Comfortable Playing Skip
                </h3>
                <ul className="list-disc list-inside space-y-2">
                  <li>When enabled: You'll receive notifications for skip position requests and can sign up for them</li>
                  <li>When disabled: You won't receive notifications for skip position requests and can't sign up for them</li>
                  <li><strong>Note:</strong> You can still see skip position requests on your dashboard, but you can't respond to them</li>
                  <li>This is separate from general availability - you can be available but not comfortable skipping</li>
                  <li>Only matters for requests that specifically need a skip</li>
                </ul>
              </section>

              <section>
                <h2 className="text-2xl font-semibold mb-4 text-[#121033] dark:text-gray-100">
                  Updating Your Availability
                </h2>
                <p className="mb-3">
                  You can update your availability at any time:
                </p>
                <ul className="list-disc list-inside space-y-2">
                  <li>Changes take effect immediately</li>
                  <li>If you disable availability for a league, you'll stop receiving notifications for that league and won't be able to sign up</li>
                  <li>If you enable availability, you'll start receiving notifications right away and can sign up for requests</li>
                  <li><strong>Note:</strong> All public requests remain visible on your dashboard regardless of availability settings</li>
                  <li>You don't need to notify anyone - the system handles it automatically</li>
                </ul>
              </section>

              <section>
                <h2 className="text-2xl font-semibold mb-4 text-[#121033] dark:text-gray-100">
                  Best Practices
                </h2>
                <ul className="list-disc list-inside space-y-2">
                  <li><strong>Keep it current:</strong> Update your availability as your schedule changes</li>
                  <li><strong>Be honest:</strong> Only mark yourself as available if you're actually able to spare</li>
                  <li><strong>Update regularly:</strong> Check your availability settings periodically</li>
                  <li><strong>Skip preference:</strong> Only enable "comfortable playing skip" if you're confident in that position</li>
                  <li><strong>Multiple leagues:</strong> Set availability for all leagues you participate in</li>
                </ul>
              </section>

              <section>
                <h2 className="text-2xl font-semibold mb-4 text-[#121033] dark:text-gray-100">
                  How Availability Affects Matching
                </h2>
                <p className="mb-3">
                  The system uses your availability settings to:
                </p>
                <ul className="list-disc list-inside space-y-2">
                  <li>Determine which requests you receive email/SMS notifications for</li>
                  <li>Control which requests you can sign up for (you can only respond if your availability matches)</li>
                  <li>Include you in notification lists for matching requests</li>
                  <li>Match skip position requests only to members comfortable skipping (for notifications and sign-up eligibility)</li>
                  <li>Help requesters see who's available when creating private requests</li>
                  <li><strong>Note:</strong> All public requests are visible to everyone on their dashboard, regardless of availability</li>
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

