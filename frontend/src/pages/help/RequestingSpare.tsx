import { Link, useLocation } from 'react-router-dom';
import Footer from '../../components/Footer';
import HelpHeader from '../../components/HelpHeader';
import { helpSections } from '../Help';

export default function RequestingSpare() {
  const location = useLocation();
  const currentPath = location.pathname;

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <HelpHeader />
      <div className="flex-grow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
            {/* Sidebar Navigation */}
            <div className="lg:col-span-1">
              <div className="bg-white rounded-lg shadow p-6 sticky top-8">
                <h2 className="text-lg font-semibold mb-4" style={{ color: '#121033' }}>
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
                          : 'text-gray-700 hover:bg-gray-100'
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
              <div className="bg-white rounded-lg shadow p-8">
                <h1 className="text-3xl font-bold mb-6" style={{ color: '#121033' }}>
                  Requesting a Spare
                </h1>

                <div className="prose max-w-none space-y-6 text-gray-700">
                  <section>
                    <h2 className="text-2xl font-semibold mb-4" style={{ color: '#121033' }}>
                      How to Request a Spare
                    </h2>
                    <ol className="list-decimal list-inside space-y-3">
                      <li>
                        <strong>Click "Request a spare"</strong> from the dashboard or navigation menu
                      </li>
                      <li>
                        <strong>Select a league</strong> from the dropdown menu
                      </li>
                      <li>
                        <strong>Choose a game date and time</strong> from the upcoming games list
                      </li>
                      <li>
                        <strong>Enter the name</strong> of the person who needs the spare (usually yourself)
                      </li>
                      <li>
                        <strong>Optionally specify a position</strong> (lead, second, vice, or skip) if needed
                      </li>
                      <li>
                        <strong>Add a personal message</strong> (optional) with any additional details
                      </li>
                      <li>
                        <strong>Choose request type:</strong>
                        <ul className="list-disc list-inside ml-6 mt-2 space-y-1">
                          <li><strong>Public:</strong> Visible to all members</li>
                          <li><strong>Private:</strong> Only sent to specific members you select</li>
                        </ul>
                      </li>
                      <li>
                        <strong>Submit the request</strong> - notifications will be sent automatically
                      </li>
                    </ol>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold mb-4" style={{ color: '#121033' }}>
                      What Happens Next?
                    </h2>
                    <p className="mb-3">
                      After submitting your request:
                    </p>
                    <ul className="list-disc list-inside space-y-2">
                      <li><strong>Public requests:</strong> All members can see it immediately on their dashboard. Notifications are sent to matching members gradually (or immediately if less than 24 hours before game time)</li>
                      <li><strong>Private requests:</strong> Only visible to selected members, who receive email and SMS notifications immediately</li>
                      <li>You'll receive a notification when someone signs up to fill your spare request</li>
                      <li>You can view and manage your request on the "My requests" page</li>
                    </ul>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold mb-4" style={{ color: '#121033' }}>
                      Managing Your Request
                    </h2>
                    <p className="mb-3">
                      On the "My requests" page, you can:
                    </p>
                    <ul className="list-disc list-inside space-y-2">
                      <li><strong>Cancel:</strong> Cancel an open request if you no longer need a spare</li>
                      <li><strong>Re-issue:</strong> Send notifications again if needed (after 72 hours or if someone canceled)</li>
                      <li><strong>Pause notifications:</strong> Temporarily stop sending notifications for staggered requests</li>
                      <li><strong>View status:</strong> See how many members have been notified</li>
                    </ul>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold mb-4" style={{ color: '#121033' }}>
                      Tips
                    </h2>
                    <ul className="list-disc list-inside space-y-2">
                      <li>Request spares as early as possible to give members time to respond</li>
                      <li>Use private requests when you have specific members in mind</li>
                      <li>Include helpful details in your message (e.g., "Need someone who can skip")</li>
                      <li>Check your "My requests" page regularly to see if someone has signed up</li>
                    </ul>
                  </section>
                </div>

                <div className="mt-8 pt-6 border-t border-gray-200">
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
