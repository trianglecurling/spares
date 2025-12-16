import { Link, useLocation } from 'react-router-dom';
import Footer from '../components/Footer';
import HelpHeader from '../components/HelpHeader';

const helpSections = [
  { path: '/help/quick-start', title: 'Quick Start', description: 'Get started in minutes' },
  { path: '/help/requesting-spare', title: 'Requesting a Spare', description: 'How to request a spare for your game' },
  { path: '/help/responding', title: 'Responding to Requests', description: 'How to sign up as a spare' },
  { path: '/help/public-vs-private', title: 'Public vs Private Requests', description: 'Understanding request types' },
  { path: '/help/notifications', title: 'Notification Process', description: 'How notifications work' },
  { path: '/help/authentication', title: 'Authentication & Login', description: 'How to log in and manage your account' },
  { path: '/help/email-sms', title: 'Email & SMS Notifications', description: 'What messages you\'ll receive' },
  { path: '/help/availability', title: 'Setting Availability', description: 'How to set when you\'re available' },
  { path: '/help/managing-requests', title: 'Managing Your Requests', description: 'Cancel, re-issue, and more' },
];

export { helpSections };

export default function Help() {
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
                  Help & Documentation
                </h1>
                <p className="text-gray-600 dark:text-gray-400 mb-8">
                  Welcome to the Triangle Curling Spare Management System help center. 
                  Use the navigation menu to find information about specific features.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {helpSections.map((section) => (
                    <Link
                      key={section.path}
                      to={section.path}
                      className="block p-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:border-primary-teal dark:hover:border-primary-teal hover:shadow-md transition-all"
                    >
                      <h3 className="text-lg font-semibold mb-2 text-[#121033] dark:text-gray-100">
                        {section.title}
                      </h3>
                      <p className="text-gray-600 dark:text-gray-400 text-sm">{section.description}</p>
                    </Link>
                  ))}
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

