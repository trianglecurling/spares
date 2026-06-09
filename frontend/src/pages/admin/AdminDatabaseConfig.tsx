import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../../components/Layout';
import { AppPage, AppPageHeader } from '../../components/AppPage';
import axios from 'axios';
import { get, post } from '../../api/client';
import { useAlert } from '../../contexts/AlertContext';
import BackButton from '../../components/BackButton';
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
      const payload: {
        databaseType: 'sqlite' | 'postgres';
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
        <AppPage>
          <div className="app-card text-center py-12 text-gray-500 dark:text-gray-400">Loading...</div>
        </AppPage>
      </Layout>
    );
  }

  return (
    <Layout>
      <AppPage narrow>
        <BackButton label="Server config" onClick={() => navigate('/admin/config')} className="mb-4" />
        <AppPageHeader
          title="Configure Database"
          description="Update your database connection settings. Changes will require a server restart."
        />

        <div className="app-card p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Database Type Selection */}
            <div>
              <label className="app-label">
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
                <label className="app-label">
                  Database File Path
                </label>
                <input
                  type="text"
                  value={sqlitePath}
                  onChange={(e) => setSqlitePath(e.target.value)}
                  className="app-input"
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
                  <label className="app-label">
                    Host
                  </label>
                  <input
                    type="text"
                    value={postgresHost}
                    onChange={(e) => setPostgresHost(e.target.value)}
                    className="app-input"
                    placeholder="your-server.postgres.database.azure.com"
                    required={databaseType === 'postgres'}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="app-label">
                      Port
                    </label>
                    <input
                      type="number"
                      value={postgresPort}
                      onChange={(e) => setPostgresPort(parseInt(e.target.value) || 5432)}
                      className="app-input"
                      min="1"
                      max="65535"
                    />
                  </div>

                  <div>
                    <label className="app-label">
                      Database Name
                    </label>
                    <input
                      type="text"
                      value={postgresDatabase}
                      onChange={(e) => setPostgresDatabase(e.target.value)}
                      className="app-input"
                      placeholder="spares"
                      required={databaseType === 'postgres'}
                    />
                  </div>
                </div>

                <div>
                  <label className="app-label">
                    Username
                  </label>
                  <input
                    type="text"
                    value={postgresUsername}
                    onChange={(e) => setPostgresUsername(e.target.value)}
                    className="app-input"
                    required={databaseType === 'postgres'}
                  />
                </div>

                <div>
                  <label className="app-label">
                    Password
                  </label>
                  <input
                    type="password"
                    value={postgresPassword}
                    onChange={(e) => setPostgresPassword(e.target.value)}
                    className="app-input"
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

            {error && (
              <div className="app-alert-error">
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
      </AppPage>
    </Layout>
  );
}
