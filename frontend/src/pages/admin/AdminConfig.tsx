import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../../components/Layout';
import api from '../../utils/api';
import Button from '../../components/Button';
import { useAuth } from '../../contexts/AuthContext';
import { formatPhone } from '../../utils/phone';

interface ServerConfig {
  twilioApiKeySid: string | null;
  twilioApiKeySecret: string | null;
  twilioAccountSid: string | null;
  twilioCampaignSid: string | null;
  azureConnectionString: string | null;
  azureSenderEmail: string | null;
  testMode: boolean;
  disableEmail: boolean;
  disableSms: boolean;
  testCurrentTime: string | null;
  notificationDelaySeconds: number;
  updatedAt: string | null;
}

export default function AdminConfig() {
  const { member } = useAuth();
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);
  const [testingSms, setTestingSms] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  
  const [formData, setFormData] = useState({
    twilioApiKeySid: '',
    twilioApiKeySecret: '',
    twilioAccountSid: '',
    twilioCampaignSid: '',
    azureConnectionString: '',
    azureSenderEmail: '',
    testMode: false,
    disableEmail: false,
    disableSms: false,
    testCurrentTime: '',
    notificationDelaySeconds: 180,
  });

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const response = await api.get('/config');
      setConfig(response.data);
      setFormData({
        twilioApiKeySid: response.data.twilioApiKeySid || '',
        twilioApiKeySecret: '', // Never populate the secret field
        twilioAccountSid: response.data.twilioAccountSid || '',
        twilioCampaignSid: response.data.twilioCampaignSid || '',
        azureConnectionString: '', // Never populate the connection string field
        azureSenderEmail: response.data.azureSenderEmail || '',
        testMode: response.data.testMode || false,
        disableEmail: response.data.disableEmail || false,
        disableSms: response.data.disableSms || false,
        testCurrentTime: response.data.testCurrentTime || '',
        notificationDelaySeconds: response.data.notificationDelaySeconds || 180,
      });
    } catch (error) {
      console.error('Failed to load config:', error);
      setMessage({ type: 'error', text: 'Failed to load server configuration' });
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);

    try {
      const payload: any = {};
      
      // Only include fields that have been changed
      if (formData.twilioApiKeySid !== (config?.twilioApiKeySid || '')) {
        payload.twilioApiKeySid = formData.twilioApiKeySid || null;
      }
      if (formData.twilioApiKeySecret) {
        payload.twilioApiKeySecret = formData.twilioApiKeySecret;
      }
      if (formData.twilioAccountSid !== (config?.twilioAccountSid || '')) {
        payload.twilioAccountSid = formData.twilioAccountSid || null;
      }
      if (formData.twilioCampaignSid !== (config?.twilioCampaignSid || '')) {
        payload.twilioCampaignSid = formData.twilioCampaignSid || null;
      }
      if (formData.azureConnectionString) {
        payload.azureConnectionString = formData.azureConnectionString;
      }
      if (formData.azureSenderEmail !== (config?.azureSenderEmail || '')) {
        payload.azureSenderEmail = formData.azureSenderEmail || null;
      }
      if (formData.testMode !== config?.testMode) {
        payload.testMode = formData.testMode;
      }
      if (formData.disableEmail !== config?.disableEmail) {
        payload.disableEmail = formData.disableEmail;
      }
      if (formData.disableSms !== config?.disableSms) {
        payload.disableSms = formData.disableSms;
      }
      if (formData.testCurrentTime !== (config?.testCurrentTime || '')) {
        payload.testCurrentTime = formData.testCurrentTime || null;
      }
      if (formData.notificationDelaySeconds !== (config?.notificationDelaySeconds || 180)) {
        payload.notificationDelaySeconds = formData.notificationDelaySeconds;
      }

      await api.patch('/config', payload);
      setMessage({ type: 'success', text: 'Server configuration updated successfully' });
      await loadConfig();
      
      // Clear password fields after successful save
      setFormData({
        ...formData,
        twilioApiKeySecret: '',
        azureConnectionString: '',
      });
    } catch (error) {
      console.error('Failed to update config:', error);
      setMessage({ type: 'error', text: 'Failed to update server configuration' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleTestEmail = async () => {
    setTestingEmail(true);
    setMessage(null);

    try {
      const response = await api.post('/config/test-email');
      setMessage({ type: 'success', text: response.data.message || 'Test email sent successfully!' });
    } catch (error: any) {
      const errorMessage = error.response?.data?.error || error.response?.data?.details || 'Failed to send test email';
      setMessage({ type: 'error', text: errorMessage });
    } finally {
      setTestingEmail(false);
    }
  };

  const handleTestSms = async () => {
    setTestingSms(true);
    setMessage(null);

    try {
      const response = await api.post('/config/test-sms');
      setMessage({ type: 'success', text: response.data.message || 'Test SMS sent successfully!' });
    } catch (error: any) {
      const errorMessage = error.response?.data?.error || error.response?.data?.details || 'Failed to send test SMS';
      setMessage({ type: 'error', text: errorMessage });
    } finally {
      setTestingSms(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">Loading...</div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold text-[#121033] dark:text-gray-100">
            Server configuration
          </h1>
          <div className="flex items-center gap-4">
            <Link
              to="/admin/feedback"
              className="text-primary-teal hover:text-opacity-80 text-sm font-medium"
            >
              View feedback →
            </Link>
            <Link
              to="/admin/database-config"
              className="text-primary-teal hover:text-opacity-80 text-sm font-medium"
            >
              Configure database →
            </Link>
          </div>
        </div>

        {message && (
          <div
            className={`mb-6 p-4 rounded ${
              message.type === 'success' 
                ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200' 
                : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200'
            }`}
          >
            {message.text}
          </div>
        )}

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Test Mode Configuration */}
            <div className="border-b dark:border-gray-700 pb-6">
              <h2 className="text-xl font-semibold mb-4 text-[#121033] dark:text-gray-100">
                Test Mode & Message Controls
              </h2>
              <div className="space-y-4">
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="testMode"
                    checked={formData.testMode}
                    onChange={(e) => setFormData({ ...formData, testMode: e.target.checked })}
                    className="h-4 w-4 text-primary-teal focus:ring-primary-teal border-gray-300 dark:border-gray-600 rounded"
                  />
                  <label htmlFor="testMode" className="ml-3 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Enable test mode
                  </label>
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400 ml-7">
                  When enabled, emails and SMS messages will be printed to the console instead of being sent. 
                  This is useful for testing without sending actual messages.
                </p>
                
                <div className="flex items-center mt-4">
                  <input
                    type="checkbox"
                    id="disableEmail"
                    checked={formData.disableEmail}
                    onChange={(e) => setFormData({ ...formData, disableEmail: e.target.checked })}
                    className="h-4 w-4 text-primary-teal focus:ring-primary-teal border-gray-300 dark:border-gray-600 rounded"
                  />
                  <label htmlFor="disableEmail" className="ml-3 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Disable email sending
                  </label>
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400 ml-7">
                  When enabled, emails will be printed to the console instead of being sent, regardless of test mode.
                </p>
                
                <div className="flex items-center mt-4">
                  <input
                    type="checkbox"
                    id="disableSms"
                    checked={formData.disableSms}
                    onChange={(e) => setFormData({ ...formData, disableSms: e.target.checked })}
                    className="h-4 w-4 text-primary-teal focus:ring-primary-teal border-gray-300 dark:border-gray-600 rounded"
                  />
                  <label htmlFor="disableSms" className="ml-3 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Disable SMS sending
                  </label>
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400 ml-7">
                  When enabled, SMS messages will be printed to the console instead of being sent, regardless of test mode.
                </p>
              </div>
            </div>

            {/* Test Current Time Configuration */}
            <div className="border-b dark:border-gray-700 pb-6">
              <h2 className="text-xl font-semibold mb-4 text-[#121033] dark:text-gray-100">
                Test Current Time
              </h2>
              <div className="space-y-4">
                <div>
                  <label htmlFor="testCurrentTime" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Override current date/time (for testing/debugging)
                  </label>
                  <input
                    type="datetime-local"
                    id="testCurrentTime"
                    value={formData.testCurrentTime ? new Date(formData.testCurrentTime).toISOString().slice(0, 16) : ''}
                    onChange={(e) => {
                      const value = e.target.value;
                      setFormData({ 
                        ...formData, 
                        testCurrentTime: value ? new Date(value).toISOString() : '' 
                      });
                    }}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
                  />
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Set a fake "current" date/time for testing. Leave empty to use real time. 
                    Format: YYYY-MM-DDTHH:mm (e.g., 2024-01-15T14:30)
                  </p>
                  {formData.testCurrentTime && (
                    <div className="mt-2">
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => setFormData({ ...formData, testCurrentTime: '' })}
                      >
                        Clear test time
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Notification Delay Configuration */}
            <div className="border-b dark:border-gray-700 pb-6">
              <h2 className="text-xl font-semibold mb-4 text-[#121033] dark:text-gray-100">
                Notification Delay
              </h2>
              <div className="space-y-4">
                <div>
                  <label htmlFor="notificationDelaySeconds" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Delay between notifications (seconds)
                  </label>
                  <input
                    type="number"
                    id="notificationDelaySeconds"
                    min="1"
                    value={formData.notificationDelaySeconds}
                    onChange={(e) => setFormData({ 
                      ...formData, 
                      notificationDelaySeconds: parseInt(e.target.value) || 180 
                    })}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
                  />
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    The number of seconds to wait between sending notifications for public spare requests. 
                    Default is 180 seconds (3 minutes). Minimum is 1 second.
                  </p>
                </div>
              </div>
            </div>

            {/* Twilio Configuration */}
            <div className="border-b dark:border-gray-700 pb-6">
              <h2 className="text-xl font-semibold mb-4 text-[#121033] dark:text-gray-100">
                Twilio (SMS provider)
              </h2>
              <div className="space-y-4">
                <div>
                  <label htmlFor="twilioApiKeySid" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    API Key SID
                  </label>
                  <input
                    type="text"
                    id="twilioApiKeySid"
                    value={formData.twilioApiKeySid}
                    onChange={(e) => setFormData({ ...formData, twilioApiKeySid: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent font-mono text-sm"
                    placeholder="SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  />
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Your Twilio API Key SID (starts with "SK")
                  </p>
                </div>

                <div>
                  <label htmlFor="twilioApiKeySecret" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    API Key Secret
                  </label>
                  <input
                    type="password"
                    id="twilioApiKeySecret"
                    value={formData.twilioApiKeySecret}
                    onChange={(e) => setFormData({ ...formData, twilioApiKeySecret: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent font-mono text-sm"
                    placeholder={config?.twilioApiKeySecret ? '••••••••' : 'Enter API key secret'}
                  />
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    {config?.twilioApiKeySecret 
                      ? 'Leave blank to keep current secret. Enter new secret to update.'
                      : 'Your Twilio API Key Secret (kept secure)'}
                  </p>
                </div>

                <div>
                  <label htmlFor="twilioAccountSid" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Account SID
                  </label>
                  <input
                    type="text"
                    id="twilioAccountSid"
                    value={formData.twilioAccountSid}
                    onChange={(e) => setFormData({ ...formData, twilioAccountSid: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent font-mono text-sm"
                    placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  />
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Your Twilio Account SID (starts with "AC")
                  </p>
                </div>

                <div>
                  <label htmlFor="twilioCampaignSid" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Campaign SID
                  </label>
                  <input
                    type="text"
                    id="twilioCampaignSid"
                    value={formData.twilioCampaignSid}
                    onChange={(e) => setFormData({ ...formData, twilioCampaignSid: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent font-mono text-sm"
                    placeholder="CMxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  />
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Your Twilio Campaign SID (starts with "CM")
                  </p>
                </div>

                <div className="pt-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleTestSms}
                    disabled={testingSms || !member?.phone}
                  >
                    {testingSms ? 'Sending...' : 'Send test SMS'}
                  </Button>
                  {!member?.phone && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                      Add a phone number to your profile to test SMS
                    </p>
                  )}
                  {member?.phone && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                      Test SMS will be sent to {formatPhone(member.phone)}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Azure Communication Services Configuration */}
            <div className="border-b dark:border-gray-700 pb-6">
              <h2 className="text-xl font-semibold mb-4 text-[#121033] dark:text-gray-100">
                Azure Communication Services (Email provider)
              </h2>
              <div className="space-y-4">
                <div>
                  <label htmlFor="azureConnectionString" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Connection string
                  </label>
                  <textarea
                    id="azureConnectionString"
                    value={formData.azureConnectionString}
                    onChange={(e) => setFormData({ ...formData, azureConnectionString: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent font-mono text-sm"
                    rows={3}
                    placeholder={config?.azureConnectionString ? '••••••••' : 'Endpoint=https://...'}
                  />
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    {config?.azureConnectionString
                      ? 'Leave blank to keep current connection string. Enter new string to update.'
                      : 'Your Azure Communication Services connection string'}
                  </p>
                </div>

                <div>
                  <label htmlFor="azureSenderEmail" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Sender email address
                  </label>
                  <input
                    type="email"
                    id="azureSenderEmail"
                    value={formData.azureSenderEmail}
                    onChange={(e) => setFormData({ ...formData, azureSenderEmail: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
                    placeholder="noreply@tccnc.club"
                  />
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    The email address that will appear as the sender
                  </p>
                </div>

                <div className="pt-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleTestEmail}
                    disabled={testingEmail || !member?.email}
                  >
                    {testingEmail ? 'Sending...' : 'Send test email'}
                  </Button>
                  {!member?.email && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                      Add an email address to your profile to test email
                    </p>
                  )}
                  {member?.email && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                      Test email will be sent to {member.email}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Last Updated Info */}
            {config?.updatedAt && (
              <div className="text-sm text-gray-500 dark:text-gray-400">
                Last updated: {new Date(config.updatedAt).toLocaleString()}
              </div>
            )}

            <div className="flex justify-end space-x-3 pt-4 border-t dark:border-gray-700">
              <Button
                type="button"
                variant="secondary"
                onClick={loadConfig}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Saving...' : 'Save configuration'}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </Layout>
  );
}

