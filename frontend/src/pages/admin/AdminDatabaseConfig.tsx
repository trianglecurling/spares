import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../../components/Layout';
import axios from 'axios';
import { get, post } from '../../api/client';
import { useAlert } from '../../contexts/AlertContext';
import Button from '../../components/Button';

export default function AdminDatabaseConfig() {
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
  const [hasExistingPostgresConfig, setHasExistingPostgresConfig] = useState(false);
  const [adminEmails, setAdminEmails] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loadingConfig, setLoadingConfig] = useState(true);

  useEffect(() => {
    loadCurrentConfig();
  }, []);

  const loadCurrentConfig = async () => {
    try {
      const config = await get('/database-config');

      if (config) {
        setDatabaseType(config.type);
        if (config.sqlite) {
          setSqlitePath(config.sqlite.path || './data/spares.sqlite');
        }
        if (config.postgres) {
          setPostgresHost(config.postgres.host || '');
          setPostgresPort(config.postgres.port || 5432);
          setPostgresDatabase(config.postgres.database || '');
          setPostgresUsername(config.postgres.username || '');
          setPostgresPassword(''); // Don't populate password
          setPostgresSSL(config.postgres.ssl || false);
          setHasExistingPostgresConfig(true);
        }
        if (config.adminEmails) {
          setAdminEmails(config.adminEmails.join(', '));
        }
      }
    } catch (error: unknown) {
      console.error('Failed to load database config:', error);
      setError('Failed to load current database configuration');
    } finally {
      setLoadingConfig(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const adminEmailList = adminEmails
        .split(',')
        .map((email) => email.trim())
        .filter(Boolean);

      if (adminEmailList.length === 0) {
        setError('Please provide at least one admin email address');
        setLoading(false);
        return;
      }

      const payload: {
        databaseType: 'sqlite' | 'postgres';
        adminEmails: string[];
        sqlite?: { path: string };
        postgres?: {
          host: string;
          port: number;
          database: string;
          username: string;
          password?: string;
          ssl: boolean;
        };
      } = {
        databaseType,
        adminEmails: adminEmailList,
      };

      if (databaseType === 'sqlite') {
        payload.sqlite = {
          path: sqlitePath,
        };
      } else {
        if (
          !postgresHost ||
          !postgresDatabase ||
          !postgresUsername ||
          (!postgresPassword && !hasExistingPostgresConfig)
        ) {
          setError('Please fill in all PostgreSQL connection fields');
          setLoading(false);
          return;
        }
        payload.postgres = {
          host: postgresHost,
          port: postgresPort,
          database: postgresDatabase,
          username: postgresUsername,
          password: postgresPassword || undefined,
          ssl: postgresSSL,
        };
      }

      await post('/database-config', payload);

      showAlert(
        'Database configuration updated successfully! The server needs to be restarted for changes to take effect. Please restart the server using: sudo systemctl restart spares-production',
        'success'
      );
      navigate('/admin/config');
    } catch (err: unknown) {
      const message = axios.isAxiosError(err) ? err.response?.data?.error : undefined;
      setError(
        message ||
          'Failed to update database configuration. Please check your settings and try again.'
      );
      setLoading(false);
    }
  };

  if (loadingConfig) {
    return (
      <Layout>
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">Loading...</div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-3xl mx-auto">
        <div className="mb-6">
          <Button variant="secondary" onClick={() => navigate('/admin/config')} className="mb-4">
            ← Back to Server Config
          </Button>
          <h1 className="text-3xl font-bold text-[#121033] dark:text-gray-100">
            Configure Database
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-2">
            Update your database connection settings. Changes will require a server restart.
          </p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Database Type Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Database Type
              </label>
              <div className="space-y-2">
                <label className="flex items-center">
                  <input
                    type="radio"
                    name="databaseType"
                    value="sqlite"
                    checked={databaseType === 'sqlite'}
                    onChange={(e) => setDatabaseType(e.target.value as 'sqlite' | 'postgres')}
                    className="mr-2"
                  />
                  <span className="dark:text-gray-300">SQLite (Local database file)</span>
                </label>
                <label className="flex items-center">
                  <input
                    type="radio"
                    name="databaseType"
                    value="postgres"
                    checked={databaseType === 'postgres'}
                    onChange={(e) => setDatabaseType(e.target.value as 'sqlite' | 'postgres')}
                    className="mr-2"
                  />
                  <span className="dark:text-gray-300">PostgreSQL (Remote database server)</span>
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
                    required={databaseType === 'postgres'}
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
                      required={databaseType === 'postgres'}
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
                    required={databaseType === 'postgres'}
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
                    placeholder={postgresPassword ? '' : 'Leave blank to keep current password'}
                  />
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    Leave blank to keep the current password.
                  </p>
                </div>

                <div>
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={postgresSSL}
                      onChange={(e) => setPostgresSSL(e.target.checked)}
                      className="mr-2"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      Use SSL connection
                    </span>
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
                Enter email addresses separated by commas. These users will have administrator
                privileges.
              </p>
            </div>

            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded">
                {error}
              </div>
            )}

            <div className="flex justify-end space-x-3">
              <Button
                type="button"
                variant="secondary"
                onClick={() => navigate('/admin/config')}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? 'Saving...' : 'Save Configuration'}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </Layout>
  );
}
