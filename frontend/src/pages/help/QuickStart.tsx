import { Link, useLocation } from 'react-router-dom';
import Footer from '../../components/Footer';
import HelpHeader from '../../components/HelpHeader';
import { helpSections } from '../Help';

export default function QuickStart() {
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
              Quick Start Guide
            </h1>

            <div className="prose max-w-none space-y-6">
              <section>
                <h2 className="text-2xl font-semibold mb-4" style={{ color: '#121033' }}>
                  Getting Started
                </h2>
                <ol className="list-decimal list-inside space-y-3 text-gray-700">
                  <li>
                    <strong>Log in:</strong> Use your email or phone number to receive a login code. 
                    Enter the code to access your account.
                  </li>
                  <li>
                    <strong>Set your availability:</strong> Go to "Set your availability" and indicate 
                    which leagues you're available for. This helps the system match you with spare requests.
                  </li>
                  <li>
                    <strong>Request a spare:</strong> If you need a spare for a game, click "Request a spare" 
                    and fill out the form with the game details.
                  </li>
                  <li>
                    <strong>Respond to requests:</strong> Browse the dashboard to see spare requests 
                    and click "Sign Up" if you're available.
                  </li>
                </ol>
              </section>

              <section>
                <h2 className="text-2xl font-semibold mb-4" style={{ color: '#121033' }}>
                  Key Features
                </h2>
                <ul className="list-disc list-inside space-y-2 text-gray-700">
                  <li><strong>Public requests:</strong> Visible to all members</li>
                  <li><strong>Private requests:</strong> Only sent to specific members you invite</li>
                  <li><strong>Automatic notifications:</strong> Members receive email and SMS notifications about spare requests</li>
                  <li><strong>Easy management:</strong> View and manage all your requests in one place</li>
                </ul>
              </section>

              <section>
                <h2 className="text-2xl font-semibold mb-4" style={{ color: '#121033' }}>
                  Next Steps
                </h2>
                <p className="text-gray-700 mb-4">
                  For more detailed information, check out these guides:
                </p>
                <ul className="list-disc list-inside space-y-2 text-gray-700">
                  <li><Link to="/help/requesting-spare" className="text-primary-teal hover:underline">Requesting a Spare</Link></li>
                  <li><Link to="/help/responding" className="text-primary-teal hover:underline">Responding to Requests</Link></li>
                  <li><Link to="/help/public-vs-private" className="text-primary-teal hover:underline">Public vs Private Requests</Link></li>
                  <li><Link to="/help/notifications" className="text-primary-teal hover:underline">Notification Process</Link></li>
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

