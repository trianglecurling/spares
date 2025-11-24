import { Link, useLocation } from 'react-router-dom';
import Footer from '../../components/Footer';
import HelpHeader from '../../components/HelpHeader';
import { helpSections } from '../Help';

export default function PublicVsPrivate() {
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
                  Public vs Private Spare Requests
                </h1>

                <div className="prose max-w-none space-y-6 text-gray-700">
                  <section>
                    <h2 className="text-2xl font-semibold mb-4" style={{ color: '#121033' }}>
                      Public Requests
                    </h2>
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                      <p className="font-semibold text-blue-900 mb-2">Best for:</p>
                      <p className="text-blue-800">When you want to reach as many potential spares as possible</p>
                    </div>
                    <ul className="list-disc list-inside space-y-2">
                      <li><strong>Visibility:</strong> All members can see it on their dashboard immediately</li>
                      <li><strong>Notifications:</strong> 
                        <ul className="list-disc list-inside ml-6 mt-2 space-y-1">
                          <li>If less than 24 hours before game time: All matching members are notified immediately</li>
                          <li>If more than 24 hours before game time: Notifications are sent gradually, one member at a time, every few minutes</li>
                        </ul>
                      </li>
                      <li><strong>Notifications:</strong> Only members who have set their availability for the relevant league will receive email/SMS notifications</li>
                      <li><strong>Skip position:</strong> If requesting a skip, only members comfortable skipping will receive notifications</li>
                      <li><strong>Visibility:</strong> All members can see all public requests on their dashboard, regardless of availability</li>
                      <li><strong>Control:</strong> You can pause notifications if needed, then unpause to resume</li>
                    </ul>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold mb-4" style={{ color: '#121033' }}>
                      Private Requests
                    </h2>
                    <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
                      <p className="font-semibold text-green-900 mb-2">Best for:</p>
                      <p className="text-green-800">When you have specific members in mind or want to limit who sees your request</p>
                    </div>
                    <ul className="list-disc list-inside space-y-2">
                      <li><strong>Visibility:</strong> Only visible to the specific members you invite</li>
                      <li><strong>Notifications:</strong> All invited members receive email and SMS notifications immediately</li>
                      <li><strong>Selection:</strong> You choose exactly which members to invite using the member search</li>
                      <li><strong>Privacy:</strong> Other members won't see the request on their dashboard</li>
                      <li><strong>Email list:</strong> Invited members can see who else was invited in the notification email</li>
                    </ul>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold mb-4" style={{ color: '#121033' }}>
                      When to Use Each Type
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="border border-gray-200 rounded-lg p-4">
                        <h3 className="font-semibold mb-2" style={{ color: '#121033' }}>Use Public When:</h3>
                        <ul className="list-disc list-inside space-y-1 text-sm">
                          <li>You need a spare and don't have specific people in mind</li>
                          <li>You want maximum visibility</li>
                          <li>You want to give everyone a fair chance</li>
                        </ul>
                      </div>
                      <div className="border border-gray-200 rounded-lg p-4">
                        <h3 className="font-semibold mb-2" style={{ color: '#121033' }}>Use Private When:</h3>
                        <ul className="list-disc list-inside space-y-1 text-sm">
                          <li>You have specific members you want to ask</li>
                          <li>You want to keep the request private</li>
                        </ul>
                      </div>
                    </div>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold mb-4" style={{ color: '#121033' }}>
                      Switching Between Types
                    </h2>
                    <p className="mb-3">
                      You can't change a request from public to private (or vice versa) after it's created. 
                      If you need to change the type, you'll need to cancel the existing request and create a new one.
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
