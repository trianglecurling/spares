import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Footer from './Footer';

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const { member, logout } = useAuth();
  const location = useLocation();

  const isActive = (path: string) => location.pathname === path;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <nav className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-8">
              <Link to="/" className="text-xl font-bold" style={{ color: '#121033' }}>
                Triangle Curling
              </Link>
              
              <div className="hidden md:flex space-x-4">
                <Link
                  to="/"
                  className={`px-3 py-2 rounded-md text-sm font-medium ${
                    isActive('/')
                      ? 'bg-primary-dark text-white'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  Dashboard
                </Link>
                
                <Link
                  to="/availability"
                  className={`px-3 py-2 rounded-md text-sm font-medium ${
                    isActive('/availability')
                      ? 'bg-primary-dark text-white'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  My availability
                </Link>
                
                <Link
                  to="/my-requests"
                  className={`px-3 py-2 rounded-md text-sm font-medium ${
                    isActive('/my-requests')
                      ? 'bg-primary-dark text-white'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  My requests
                </Link>

                <Link
                  to="/members"
                  className={`px-3 py-2 rounded-md text-sm font-medium ${
                    isActive('/members')
                      ? 'bg-primary-dark text-white'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  Directory
                </Link>
                
                {member?.isAdmin && (
                  <>
                    <Link
                      to="/admin/members"
                      className={`px-3 py-2 rounded-md text-sm font-medium ${
                        isActive('/admin/members')
                          ? 'bg-primary-dark text-white'
                          : 'text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      Manage members
                    </Link>
                    
                    <Link
                      to="/admin/leagues"
                      className={`px-3 py-2 rounded-md text-sm font-medium ${
                        isActive('/admin/leagues')
                          ? 'bg-primary-dark text-white'
                          : 'text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      Leagues
                    </Link>
                    
                    <Link
                      to="/admin/config"
                      className={`px-3 py-2 rounded-md text-sm font-medium ${
                        isActive('/admin/config')
                          ? 'bg-primary-dark text-white'
                          : 'text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      Server config
                    </Link>
                  </>
                )}
              </div>
            </div>
            
            <div className="flex items-center space-x-4">
              <Link 
                to="/profile" 
                className="text-sm text-gray-700 hover:text-primary-teal font-medium"
              >
                {member?.name}
              </Link>
              <button
                onClick={logout}
                className="text-sm text-gray-700 hover:text-gray-900"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </nav>
      
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-grow w-full">
        {children}
      </main>

      <Footer />
    </div>
  );
}
