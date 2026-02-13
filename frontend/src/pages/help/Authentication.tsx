import { Link, useLocation } from 'react-router-dom';
import Footer from '../../components/Footer';
import HelpHeader from '../../components/HelpHeader';
import { helpSections } from '../Help';

export default function Authentication() {
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
                  Authentication & Login
                </h1>

                <div className="prose max-w-none space-y-6 text-gray-700 dark:text-gray-300">
                  <section>
                    <h2 className="text-2xl font-semibold mb-4 text-[#121033] dark:text-gray-100">
                      How to Log In
                    </h2>
                    <ol className="list-decimal list-inside space-y-3">
                      <li>
                        <strong>Enter your email or phone number</strong> on the login page
                      </li>
                      <li>
                        <strong>Click "Send Login Code"</strong> - you'll receive a 6-digit code via
                        email or SMS
                      </li>
                      <li>
                        <strong>Enter the code</strong> when prompted
                      </li>
                      <li>
                        <strong>If multiple accounts share your contact:</strong> Select your name
                        from the list
                      </li>
                      <li>
                        <strong>You're logged in!</strong> The system remembers your login for
                        future visits
                      </li>
                    </ol>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold mb-4 text-[#121033] dark:text-gray-100">
                      First-Time Login
                    </h2>
                    <p className="mb-3">
                      On your first login, you'll be asked to complete your profile:
                    </p>
                    <ul className="list-disc list-inside space-y-2">
                      <li>Confirm or update your name</li>
                      <li>Set your email and phone visibility preferences</li>
                      <li>Choose whether to receive SMS notifications</li>
                      <li>Once completed, you can access all features</li>
                    </ul>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold mb-4 text-[#121033] dark:text-gray-100">
                      Staying Logged In
                    </h2>
                    <p className="mb-3">The system uses secure tokens to keep you logged in:</p>
                    <ul className="list-disc list-inside space-y-2">
                      <li>Your login persists across browser sessions</li>
                      <li>You won't need to enter a code every time you visit</li>
                      <li>If your session expires, you'll be prompted to log in again</li>
                      <li>You can log out at any time from your profile page</li>
                    </ul>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold mb-4 text-[#121033] dark:text-gray-100">
                      Multiple Accounts
                    </h2>
                    <p className="mb-3">
                      If multiple members share the same email or phone number:
                    </p>
                    <ul className="list-disc list-inside space-y-2">
                      <li>After entering the code, you'll see a list of names</li>
                      <li>Select your name to log in to your account</li>
                      <li>Each member has their own separate account and data</li>
                    </ul>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold mb-4 text-[#121033] dark:text-gray-100">
                      Security
                    </h2>
                    <ul className="list-disc list-inside space-y-2">
                      <li>Login codes expire after a short time for security</li>
                      <li>
                        Codes are single-use - you'll need a new code if you try to use an old one
                      </li>
                      <li>Your account information is kept secure and private</li>
                      <li>Only you and administrators can see your personal information</li>
                    </ul>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold mb-4 text-[#121033] dark:text-gray-100">
                      Troubleshooting
                    </h2>
                    <ul className="list-disc list-inside space-y-2">
                      <li>
                        <strong>Didn't receive a code?</strong> Check your spam folder, or try
                        requesting a new code
                      </li>
                      <li>
                        <strong>Code expired?</strong> Request a new code - they expire quickly for
                        security
                      </li>
                      <li>
                        <strong>Wrong code?</strong> Make sure you're entering all 6 digits
                        correctly
                      </li>
                      <li>
                        <strong>Can't log in?</strong> Contact support at av@trianglecurling.com
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
