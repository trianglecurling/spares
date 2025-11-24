import { Link, useLocation } from 'react-router-dom';
import Footer from '../../components/Footer';
import HelpHeader from '../../components/HelpHeader';
import { helpSections } from '../Help';

export default function Notifications() {
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
                  Notification Process
                </h1>

                <div className="prose max-w-none space-y-6 text-gray-700">
                  <section>
                    <h2 className="text-2xl font-semibold mb-4" style={{ color: '#121033' }}>
                      How Notifications Work
                    </h2>
                    <p className="mb-4">
                      The system automatically sends notifications to help match spare requests with available members. 
                      The process differs depending on whether the request is public or private, and how soon the game is.
                    </p>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold mb-4" style={{ color: '#121033' }}>
                      Public Request Notifications
                    </h2>
                    
                    <h3 className="text-xl font-semibold mb-3 mt-4" style={{ color: '#121033' }}>
                      Less Than 24 Hours Before Game Time
                    </h3>
                    <ul className="list-disc list-inside space-y-2">
                      <li>All matching members receive notifications immediately</li>
                      <li>Notifications are sent via email and SMS (if opted in)</li>
                      <li>The request appears on all matching members' dashboards right away</li>
                      <li>This ensures urgent requests get maximum visibility quickly</li>
                    </ul>

                    <h3 className="text-xl font-semibold mb-3 mt-6" style={{ color: '#121033' }}>
                      More Than 24 Hours Before Game Time
                    </h3>
                    <p className="mb-3">
                      For requests with more time, the system uses a gradual notification process:
                    </p>
                    <ol className="list-decimal list-inside space-y-2">
                      <li>The system creates a list of all matching members</li>
                      <li>The list is randomly shuffled to ensure fairness</li>
                      <li>Notifications are sent one member at a time</li>
                      <li>After each notification, the system waits a few minutes (configurable by administrators)</li>
                      <li>If someone signs up, notifications stop automatically</li>
                      <li>If no one signs up, the next member in the list is notified</li>
                      <li>This continues until either someone signs up or all members have been notified</li>
                    </ol>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold mb-4" style={{ color: '#121033' }}>
                      Private Request Notifications
                    </h2>
                    <ul className="list-disc list-inside space-y-2">
                      <li>All invited members receive notifications immediately</li>
                      <li>Both email and SMS notifications are sent (if opted in)</li>
                      <li>The email includes a list of all invited members</li>
                      <li>No gradual process - everyone is notified at once</li>
                    </ul>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold mb-4" style={{ color: '#121033' }}>
                      Tracking Notification Progress
                    </h2>
                    <p className="mb-3">
                      On the "My requests" page, you can see the status of notifications:
                    </p>
                    <ul className="list-disc list-inside space-y-2">
                      <li><strong>"Notifications in progress... X of Y members notified":</strong> Shows real-time progress for staggered notifications</li>
                      <li><strong>"All notifications sent. X members notified":</strong> All notifications have been sent</li>
                      <li><strong>"Notifications stopped":</strong> Request was filled or cancelled</li>
                      <li><strong>"(Paused)":</strong> Notifications are temporarily paused</li>
                    </ul>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold mb-4" style={{ color: '#121033' }}>
                      Pausing Notifications
                    </h2>
                    <p className="mb-3">
                      For public requests with staggered notifications, you can pause the process:
                    </p>
                    <ul className="list-disc list-inside space-y-2">
                      <li>Click "Pause notifications" to temporarily stop sending notifications</li>
                      <li>No new notifications will be sent while paused</li>
                      <li>Click "Unpause notifications" to resume</li>
                      <li>When unpaused, the next notification will be sent immediately</li>
                      <li>Useful if you need to temporarily stop notifications for any reason</li>
                    </ul>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold mb-4" style={{ color: '#121033' }}>
                      Re-issuing Requests
                    </h2>
                    <p className="mb-3">
                      You can re-issue a request to send notifications again in two situations:
                    </p>
                    <ol className="list-decimal list-inside space-y-2">
                      <li><strong>After 72 hours:</strong> If it's been more than 72 hours since notifications were last sent</li>
                      <li><strong>After a cancellation:</strong> If someone signed up and then canceled their spare offer</li>
                    </ol>
                    <p className="mt-4">
                      When re-issuing, you can update your message, and the notification process starts fresh.
                    </p>
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
