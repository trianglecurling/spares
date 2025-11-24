import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function HelpHeader() {
  const { member } = useAuth();

  return (
    <nav className="bg-white shadow-sm border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center space-x-8">
            <Link to={member ? "/" : "/login"} className="text-xl font-bold" style={{ color: '#121033' }}>
              Triangle Curling
            </Link>
            <Link 
              to="/help" 
              className="text-gray-700 hover:text-primary-teal transition-colors"
            >
              Help
            </Link>
          </div>
          <div className="flex items-center">
            {member ? (
              <Link 
                to="/" 
                className="text-gray-700 hover:text-primary-teal transition-colors"
              >
                Dashboard
              </Link>
            ) : (
              <Link 
                to="/login" 
                className="text-gray-700 hover:text-primary-teal transition-colors"
              >
                Login
              </Link>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}

