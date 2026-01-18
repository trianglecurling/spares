import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import { useAlert } from '../contexts/AlertContext';
import Button from '../components/Button';
import Footer from '../components/Footer';
import HelpHeader from '../components/HelpHeader';

export default function Install() {
  const navigate = useNavigate();
  const { showAlert } = useAlert();
  const [databaseType, setDatabaseType] = useState<'sqlite' | 'postgres'>('sqlite');
  const [sqlitePath, setSqlitePath] = useState('./data/spares.sqlite');
  const [postgresHost, setPostgresHost] = useState('');
  const [postgresPort, setPostgresPort] = useState(5432);
  const [postgresDatabase, setPostgresDatabase] = useState('');
  const [postgresUsername, setPostgresUsername] = useState('');
  const [postgresPassword, setPostgresPassword] = useState('');
  const [postgresSSL, setPostgresSSL] = useState(false);
  const [adminEmails, setAdminEmails] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // Check if already configured
    api.get('/install/status')
      .then(response => {
        if (response.data.configured) {
          navigate('/');
        }
        setChecking(false);
      })
      .catch((error: any) => {
        // If it's a 503 error, that's expected when DB is not configured
        if (error.response?.status === 503) {
          // Database not configured - this is fine, stay on install page
          setChecking(false);
        } else {
          // Other error - still show install page
          console.error('Error checking install status:', error);
          setChecking(false);
        }
      });
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const adminEmailList = adminEmails
        .split(',')
        .map(email => email.trim())
        .filter(Boolean);

      if (adminEmailList.length === 0) {
        setError('Please provide at least one admin email address');
        setLoading(false);
        return;
      }

      const payload: any = {
        databaseType,
        adminEmails: adminEmailList,
      };

      if (databaseType === 'sqlite') {
        payload.sqlite = {
          path: sqlitePath,
        };
      } else {
        if (!postgresHost || !postgresDatabase || !postgresUsername || !postgresPassword) {
          setError('Please fill in all PostgreSQL connection fields');
          setLoading(false);
          return;
        }
        payload.postgres = {
          host: postgresHost,
          port: postgresPort,
          database: postgresDatabase,
          username: postgresUsername,
          password: postgresPassword,
          ssl: postgresSSL,
        };
      }

      await api.post('/install', payload);
      
      // Installation successful - reload page to continue
      showAlert('Installation successful! The server will restart. Please refresh the page.', 'success');
      setTimeout(() => window.location.reload(), 2000);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Installation failed. Please check your settings and try again.');
      setLoading(false);
    }
  };

  if (checking) {
    return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
        <HelpHeader />
        <div className="flex-grow flex items-center justify-center">
          <div className="text-center">
          <p className="text-gray-600 dark:text-gray-400">Checking installation status...</p>
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      <HelpHeader />
      <div className="flex-grow">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-8">
            <h1 className="text-3xl font-bold mb-6 text-[#121033] dark:text-gray-100">
              Database Installation
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mb-8">
              Configure your database connection and administrator accounts to complete the installation.
            </p>

            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Database Type Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Database Type
                </label>
                <div className="space-y-2">
                  <label className="flex items-center text-gray-800 dark:text-gray-200">
                    <input
                      type="radio"
                      name="databaseType"
                      value="sqlite"
                      checked={databaseType === 'sqlite'}
                      onChange={(e) => setDatabaseType(e.target.value as 'sqlite' | 'postgres')}
                      className="mr-2"
                    />
                    <span>SQLite (Local database file)</span>
                  </label>
                  <label className="flex items-center text-gray-800 dark:text-gray-200">
                    <input
                      type="radio"
                      name="databaseType"
                      value="postgres"
                      checked={databaseType === 'postgres'}
                      onChange={(e) => setDatabaseType(e.target.value as 'sqlite' | 'postgres')}
                      className="mr-2"
                    />
                    <span>PostgreSQL (Remote database server)</span>
                  </label>
                </div>
              </div>

              {/* SQLite Configuration */}
              {databaseType === 'sqlite' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Database File Path
                  </label>
                  <input
                    type="text"
                    value={sqlitePath}
                    onChange={(e) => setSqlitePath(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-teal"
                    placeholder="./data/spares.sqlite"
                  />
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    Path relative to the backend directory where the database file will be stored.
                  </p>
                </div>
              )}

              {/* PostgreSQL Configuration */}
              {databaseType === 'postgres' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Host
                    </label>
                    <input
                      type="text"
                      value={postgresHost}
                      onChange={(e) => setPostgresHost(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-teal"
                      placeholder="your-server.postgres.database.azure.com"
                      required
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Port
                      </label>
                      <input
                        type="number"
                        value={postgresPort}
                        onChange={(e) => setPostgresPort(parseInt(e.target.value) || 5432)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-teal"
                        min="1"
                        max="65535"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Database Name
                      </label>
                      <input
                        type="text"
                        value={postgresDatabase}
                        onChange={(e) => setPostgresDatabase(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-teal"
                        placeholder="spares"
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Username
                    </label>
                    <input
                      type="text"
                      value={postgresUsername}
                      onChange={(e) => setPostgresUsername(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-teal"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Password
                    </label>
                    <input
                      type="password"
                      value={postgresPassword}
                      onChange={(e) => setPostgresPassword(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-teal"
                      required
                    />
                  </div>

                  <div>
                    <label className="flex items-center text-gray-700 dark:text-gray-300">
                      <input
                        type="checkbox"
                        checked={postgresSSL}
                        onChange={(e) => setPostgresSSL(e.target.checked)}
                        className="mr-2"
                      />
                      <span className="text-sm text-gray-700">Use SSL connection</span>
                    </label>
                  </div>
                </div>
              )}

              {/* Admin Emails */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Administrator Email Addresses
                </label>
                <textarea
                  value={adminEmails}
                  onChange={(e) => setAdminEmails(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-teal"
                  rows={3}
                  placeholder="admin1@example.com, admin2@example.com"
                  required
                />
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  Enter email addresses separated by commas. These users will have administrator privileges.
                </p>
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-300 px-4 py-3 rounded">
                  {error}
                </div>
              )}

              <div className="flex justify-end">
                <Button
                  type="submit"
                  disabled={loading}
                >
                  {loading ? 'Installing...' : 'Complete Installation'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}

