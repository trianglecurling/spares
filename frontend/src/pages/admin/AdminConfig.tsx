import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../../components/Layout';
import { AppPage, AppPageHeader } from '../../components/AppPage';
import AppPageControlsRow from '../../components/AppPageControlsRow';
import AppStateCard from '../../components/AppStateCard';
import { get, patch, post } from '../../api/client';
import { formatApiError } from '../../utils/api';
import Button from '../../components/Button';
import { useAuth } from '../../contexts/AuthContext';
import { formatPhone } from '../../utils/phone';
import { setFrontendLogCaptureEnabled } from '../../otel';
import ChoiceInput, { type ChoiceOption } from '../../components/ChoiceInput';

const DASHBOARD_ALERT_VARIANT_OPTIONS: ChoiceOption<string>[] = [
  { value: 'info', label: 'Info (blue)' },
  { value: 'warning', label: 'Warning (amber)' },
  { value: 'success', label: 'Success (green)' },
  { value: 'danger', label: 'Danger (red)' },
];

const DASHBOARD_ALERT_ICON_OPTIONS: ChoiceOption<string>[] = [
  { value: 'announcement', label: 'Announcement' },
  { value: 'info', label: 'Info' },
  { value: 'warning', label: 'Warning' },
  { value: 'success', label: 'Success' },
  { value: 'error', label: 'Error' },
  { value: 'none', label: 'No icon' },
];

interface ServerConfig {
  twilioApiKeySid: string | null;
  twilioApiKeySecret: string | null;
  twilioAccountSid: string | null;
  twilioCampaignSid: string | null;
  azureConnectionString: string | null;
  azureSenderEmail: string | null;
  dashboardAlertTitle: string | null;
  dashboardAlertBody: string | null;
  dashboardAlertExpiresAt: string | null;
  dashboardAlertVariant: string | null;
  dashboardAlertIcon: string | null;
  testMode: boolean;
  disableEmail: boolean;
  disableSms: boolean;
  frontendOtelEnabled: boolean;
  captureFrontendLogs: boolean;
  captureBackendLogs: boolean;
  testCurrentTime: string | null;
  notificationDelaySeconds: number;
  sessionTokenTtlMinutes: number;
  refreshTokenTtlDays: number;
  updatedAt: string | null;
}

interface UpdateConfigPayload {
  twilioApiKeySid?: string;
  twilioApiKeySecret?: string;
  twilioAccountSid?: string;
  twilioCampaignSid?: string;
  azureConnectionString?: string;
  azureSenderEmail?: string;
  dashboardAlertTitle?: string;
  dashboardAlertBody?: string;
  dashboardAlertExpiresAt?: string;
  dashboardAlertVariant?: 'info' | 'warning' | 'success' | 'danger';
  dashboardAlertIcon?: 'info' | 'warning' | 'success' | 'none' | 'announcement' | 'error';
  testMode?: boolean;
  disableEmail?: boolean;
  disableSms?: boolean;
  frontendOtelEnabled?: boolean;
  captureFrontendLogs?: boolean;
  captureBackendLogs?: boolean;
  testCurrentTime?: string;
  notificationDelaySeconds?: number;
  sessionTokenTtlMinutes?: number;
  refreshTokenTtlDays?: number;
}

const EASTERN_TIME_ZONE = 'America/New_York';

type DateTimeParts = {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second?: string;
};

const extractDateTimeParts = (
  date: Date,
  timeZone: string,
  includeSeconds = false
): DateTimeParts | null => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: includeSeconds ? '2-digit' : undefined,
    hour12: false,
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, part) => {
      if (part.type !== 'literal') {
        acc[part.type] = part.value;
      }
      return acc;
    }, {});

  if (!parts.year || !parts.month || !parts.day || !parts.hour || !parts.minute) {
    return null;
  }
  if (includeSeconds && !parts.second) {
    return null;
  }

  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
};

const formatEasternDateTime = (value?: string | null): string => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const parts = extractDateTimeParts(date, EASTERN_TIME_ZONE);
  if (!parts) return '';

  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
};

const getTimeZoneOffsetMinutes = (date: Date, timeZone: string) => {
  const parts = extractDateTimeParts(date, timeZone, true);
  if (!parts || !parts.second) return 0;

  const utcTime = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );

  return (utcTime - date.getTime()) / 60000;
};

const parseEasternDateTimeToIso = (value: string): string => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return '';

  const [, year, month, day, hour, minute] = match;
  const utcGuess = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    0
  );
  const offsetMinutes = getTimeZoneOffsetMinutes(new Date(utcGuess), EASTERN_TIME_ZONE);
  const utcTime = utcGuess - offsetMinutes * 60000;

  return new Date(utcTime).toISOString();
};

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
    dashboardAlertTitle: '',
    dashboardAlertBody: '',
    dashboardAlertExpiresAt: '',
    dashboardAlertVariant: 'info',
    dashboardAlertIcon: 'announcement',
    testMode: false,
    disableEmail: false,
    disableSms: false,
    frontendOtelEnabled: true,
    captureFrontendLogs: true,
    captureBackendLogs: true,
    testCurrentTime: '',
    notificationDelaySeconds: 180,
    sessionTokenTtlMinutes: 30,
    refreshTokenTtlDays: 60,
  });

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const response = await get('/config');
      setConfig(response);
      setFormData({
        twilioApiKeySid: response.twilioApiKeySid || '',
        twilioApiKeySecret: '', // Never populate the secret field
        twilioAccountSid: response.twilioAccountSid || '',
        twilioCampaignSid: response.twilioCampaignSid || '',
        azureConnectionString: '', // Never populate the connection string field
        azureSenderEmail: response.azureSenderEmail || '',
        dashboardAlertTitle: response.dashboardAlertTitle || '',
        dashboardAlertBody: response.dashboardAlertBody || '',
        dashboardAlertExpiresAt: response.dashboardAlertExpiresAt || '',
        dashboardAlertVariant: response.dashboardAlertVariant || 'info',
        dashboardAlertIcon: response.dashboardAlertIcon || 'announcement',
        testMode: response.testMode || false,
        disableEmail: response.disableEmail || false,
        disableSms: response.disableSms || false,
        frontendOtelEnabled: response.frontendOtelEnabled ?? true,
        captureFrontendLogs: response.captureFrontendLogs ?? true,
        captureBackendLogs: response.captureBackendLogs ?? true,
        testCurrentTime: response.testCurrentTime || '',
        notificationDelaySeconds: response.notificationDelaySeconds || 180,
        sessionTokenTtlMinutes: response.sessionTokenTtlMinutes || 30,
        refreshTokenTtlDays: response.refreshTokenTtlDays || 60,
      });
    } catch (error) {
      console.error('Failed to load config:', error);
      setMessage({ type: 'error', text: 'Failed to load server configuration' });
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);

    try {
      const payload: UpdateConfigPayload = {};

      // Only include fields that have been changed
      if (formData.twilioApiKeySid !== (config?.twilioApiKeySid || '')) {
        payload.twilioApiKeySid = formData.twilioApiKeySid || undefined;
      }
      if (formData.twilioApiKeySecret) {
        payload.twilioApiKeySecret = formData.twilioApiKeySecret;
      }
      if (formData.twilioAccountSid !== (config?.twilioAccountSid || '')) {
        payload.twilioAccountSid = formData.twilioAccountSid || undefined;
      }
      if (formData.twilioCampaignSid !== (config?.twilioCampaignSid || '')) {
        payload.twilioCampaignSid = formData.twilioCampaignSid || undefined;
      }
      if (formData.azureConnectionString) {
        payload.azureConnectionString = formData.azureConnectionString;
      }
      if (formData.azureSenderEmail !== (config?.azureSenderEmail || '')) {
        payload.azureSenderEmail = formData.azureSenderEmail || undefined;
      }
      if (formData.dashboardAlertTitle !== (config?.dashboardAlertTitle || '')) {
        payload.dashboardAlertTitle = formData.dashboardAlertTitle || undefined;
      }
      if (formData.dashboardAlertBody !== (config?.dashboardAlertBody || '')) {
        payload.dashboardAlertBody = formData.dashboardAlertBody || undefined;
      }
      if (formData.dashboardAlertExpiresAt !== (config?.dashboardAlertExpiresAt || '')) {
        payload.dashboardAlertExpiresAt = formData.dashboardAlertExpiresAt || undefined;
      }
      if (formData.dashboardAlertVariant !== (config?.dashboardAlertVariant || '')) {
        const allowedVariants = ['info', 'warning', 'success', 'danger'] as const;
        payload.dashboardAlertVariant = allowedVariants.includes(
          formData.dashboardAlertVariant as (typeof allowedVariants)[number]
        )
          ? (formData.dashboardAlertVariant as (typeof allowedVariants)[number])
          : undefined;
      }
      if (formData.dashboardAlertIcon !== (config?.dashboardAlertIcon || '')) {
        const allowedIcons = [
          'info',
          'warning',
          'success',
          'none',
          'announcement',
          'error',
        ] as const;
        payload.dashboardAlertIcon = allowedIcons.includes(
          formData.dashboardAlertIcon as (typeof allowedIcons)[number]
        )
          ? (formData.dashboardAlertIcon as (typeof allowedIcons)[number])
          : undefined;
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
      if (formData.frontendOtelEnabled !== config?.frontendOtelEnabled) {
        payload.frontendOtelEnabled = formData.frontendOtelEnabled;
      }
      if (formData.captureFrontendLogs !== config?.captureFrontendLogs) {
        payload.captureFrontendLogs = formData.captureFrontendLogs;
      }
      if (formData.captureBackendLogs !== config?.captureBackendLogs) {
        payload.captureBackendLogs = formData.captureBackendLogs;
      }
      if (formData.testCurrentTime !== (config?.testCurrentTime || '')) {
        payload.testCurrentTime = formData.testCurrentTime || undefined;
      }
      if (formData.notificationDelaySeconds !== (config?.notificationDelaySeconds || 180)) {
        payload.notificationDelaySeconds = formData.notificationDelaySeconds;
      }
      if (formData.sessionTokenTtlMinutes !== (config?.sessionTokenTtlMinutes || 30)) {
        payload.sessionTokenTtlMinutes = formData.sessionTokenTtlMinutes;
      }
      if (formData.refreshTokenTtlDays !== (config?.refreshTokenTtlDays || 60)) {
        payload.refreshTokenTtlDays = formData.refreshTokenTtlDays;
      }

      await patch('/config', payload);
      setMessage({ type: 'success', text: 'Server configuration updated successfully' });
      await loadConfig();
      setFrontendLogCaptureEnabled(formData.captureFrontendLogs);

      // Clear password fields after successful save
      setFormData({
        ...formData,
        twilioApiKeySecret: '',
        azureConnectionString: '',
      });
    } catch (error) {
      console.error('Failed to update config:', error);
      setMessage({
        type: 'error',
        text: formatApiError(error, 'Failed to update server configuration'),
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleTestEmail = async () => {
    setTestingEmail(true);
    setMessage(null);

    try {
      const response = await post('/config/test-email', undefined);
      setMessage({ type: 'success', text: response.message || 'Test email sent successfully!' });
    } catch (error: unknown) {
      setMessage({ type: 'error', text: formatApiError(error, 'Failed to send test email') });
    } finally {
      setTestingEmail(false);
    }
  };

  const handleTestSms = async () => {
    setTestingSms(true);
    setMessage(null);

    try {
      const response = await post('/config/test-sms', undefined);
      setMessage({ type: 'success', text: response.message || 'Test SMS sent successfully!' });
    } catch (error: unknown) {
      setMessage({ type: 'error', text: formatApiError(error, 'Failed to send test SMS') });
    } finally {
      setTestingSms(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <AppPage>
          <AppStateCard title="Loading server configuration..." />
        </AppPage>
      </Layout>
    );
  }

  return (
    <Layout>
      <AppPage>
        <AppPageHeader title="Server configuration" />

        <AppPageControlsRow
          left={
            <div className="flex flex-wrap items-center gap-4">
              <Link
                to="/admin/observability"
                className="text-primary-teal hover:text-opacity-80 text-sm font-medium"
              >
                Observability →
              </Link>
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
          }
        />

        {message && (
          <div className={message.type === 'success' ? 'app-alert-success' : 'app-alert-error'}>
            {message.text}
          </div>
        )}

        <div className="app-card p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Test Mode Configuration */}
            <div className="border-b dark:border-gray-700 pb-6">
              <h2 className="app-section-title mb-4">
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
                  <label
                    htmlFor="testMode"
                    className="ml-3 block text-sm font-medium text-gray-700 dark:text-gray-300"
                  >
                    Enable test mode
                  </label>
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400 ml-7">
                  When enabled, email is sent through the test mailer SMTP server (default{' '}
                  <code className="text-xs">127.0.0.1:1025</code>, e.g. Mailpit) so you can inspect
                  messages without using production email. SMS messages are still printed to the
                  server console instead of being sent.
                </p>

                <div className="flex items-center mt-4">
                  <input
                    type="checkbox"
                    id="disableEmail"
                    checked={formData.disableEmail}
                    onChange={(e) => setFormData({ ...formData, disableEmail: e.target.checked })}
                    className="h-4 w-4 text-primary-teal focus:ring-primary-teal border-gray-300 dark:border-gray-600 rounded"
                  />
                  <label
                    htmlFor="disableEmail"
                    className="ml-3 block text-sm font-medium text-gray-700 dark:text-gray-300"
                  >
                    Disable email sending
                  </label>
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400 ml-7">
                  When enabled, emails will be printed to the console instead of being sent,
                  regardless of test mode.
                </p>

                <div className="flex items-center mt-4">
                  <input
                    type="checkbox"
                    id="disableSms"
                    checked={formData.disableSms}
                    onChange={(e) => setFormData({ ...formData, disableSms: e.target.checked })}
                    className="h-4 w-4 text-primary-teal focus:ring-primary-teal border-gray-300 dark:border-gray-600 rounded"
                  />
                  <label
                    htmlFor="disableSms"
                    className="ml-3 block text-sm font-medium text-gray-700 dark:text-gray-300"
                  >
                    Disable SMS sending
                  </label>
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400 ml-7">
                  When enabled, SMS messages will be printed to the console instead of being sent,
                  regardless of test mode.
                </p>
              </div>
            </div>

            {/* Authentication Configuration */}
            <div className="border-b dark:border-gray-700 pb-6">
              <h2 className="app-section-title mb-4">
                Authentication
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="sessionTokenTtlMinutes" className="app-label">
                    Session token lifetime (minutes)
                  </label>
                  <input
                    type="number"
                    id="sessionTokenTtlMinutes"
                    min={5}
                    max={1440}
                    value={formData.sessionTokenTtlMinutes}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        sessionTokenTtlMinutes: Number(e.target.value),
                      })
                    }
                    className="app-input"
                  />
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                    Access tokens authorize API requests. The default is 30 minutes.
                  </p>
                </div>
                <div>
                  <label htmlFor="refreshTokenTtlDays" className="app-label">
                    Refresh token lifetime (days)
                  </label>
                  <input
                    type="number"
                    id="refreshTokenTtlDays"
                    min={1}
                    max={365}
                    value={formData.refreshTokenTtlDays}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        refreshTokenTtlDays: Number(e.target.value),
                      })
                    }
                    className="app-input"
                  />
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                    Refresh tokens transparently renew expired sessions. The default is 60 days.
                  </p>
                </div>
              </div>
            </div>

            {/* Dashboard Alert Configuration */}
            <div className="border-b dark:border-gray-700 pb-6">
              <h2 className="app-section-title mb-4">
                Dashboard Alert
              </h2>
              <div className="space-y-4">
                <div>
                  <label
                    htmlFor="dashboardAlertTitle"
                    className="app-label"
                  >
                    Alert title
                  </label>
                  <input
                    type="text"
                    id="dashboardAlertTitle"
                    value={formData.dashboardAlertTitle}
                    onChange={(e) =>
                      setFormData({ ...formData, dashboardAlertTitle: e.target.value })
                    }
                    className="app-input"
                    placeholder="Monday Leagues Canceled"
                  />
                </div>
                <div>
                  <label
                    htmlFor="dashboardAlertBody"
                    className="app-label"
                  >
                    Alert message
                  </label>
                  <textarea
                    id="dashboardAlertBody"
                    value={formData.dashboardAlertBody}
                    onChange={(e) =>
                      setFormData({ ...formData, dashboardAlertBody: e.target.value })
                    }
                    rows={4}
                    className="app-input"
                    placeholder="Due to the icy road conditions, Monday leagues have been canceled!"
                  />
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                    Leave both fields empty to hide the alert on the dashboard.
                  </p>
                </div>
                <div>
                  <label
                    htmlFor="dashboardAlertExpiresAt"
                    className="app-label"
                  >
                    Optional expiration (Eastern Time)
                  </label>
                  <input
                    type="datetime-local"
                    id="dashboardAlertExpiresAt"
                    value={formatEasternDateTime(formData.dashboardAlertExpiresAt)}
                    onChange={(e) => {
                      const value = e.target.value;
                      setFormData({
                        ...formData,
                        dashboardAlertExpiresAt: value ? parseEasternDateTimeToIso(value) : '',
                      });
                    }}
                    className="app-input"
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label
                      htmlFor="dashboardAlertVariant"
                      className="app-label"
                    >
                      Alert color
                    </label>
                    <ChoiceInput<string>
                      inputId="dashboardAlertVariant"
                      options={DASHBOARD_ALERT_VARIANT_OPTIONS}
                      value={formData.dashboardAlertVariant}
                      onChange={(next) => {
                        if (next != null && !Array.isArray(next))
                          setFormData({ ...formData, dashboardAlertVariant: next });
                      }}
                      listboxLabel="Alert color"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="dashboardAlertIcon"
                      className="app-label"
                    >
                      Alert icon
                    </label>
                    <ChoiceInput<string>
                      inputId="dashboardAlertIcon"
                      options={DASHBOARD_ALERT_ICON_OPTIONS}
                      value={formData.dashboardAlertIcon}
                      onChange={(next) => {
                        if (next != null && !Array.isArray(next))
                          setFormData({ ...formData, dashboardAlertIcon: next });
                      }}
                      listboxLabel="Alert icon"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Observability Configuration */}
            <div className="border-b dark:border-gray-700 pb-6">
              <h2 className="app-section-title mb-4">
                Observability
              </h2>
              <div className="space-y-4">
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="frontendOtelEnabled"
                    checked={formData.frontendOtelEnabled}
                    onChange={(e) =>
                      setFormData({ ...formData, frontendOtelEnabled: e.target.checked })
                    }
                    className="h-4 w-4 text-primary-teal focus:ring-primary-teal border-gray-300 dark:border-gray-600 rounded"
                  />
                  <label
                    htmlFor="frontendOtelEnabled"
                    className="ml-3 block text-sm font-medium text-gray-700 dark:text-gray-300"
                  >
                    Enable frontend OpenTelemetry
                  </label>
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400 ml-7">
                  When disabled, the frontend will not initialize OpenTelemetry and no traces/logs
                  are sent.
                </p>

                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="captureFrontendLogs"
                    checked={formData.captureFrontendLogs}
                    onChange={(e) =>
                      setFormData({ ...formData, captureFrontendLogs: e.target.checked })
                    }
                    className="h-4 w-4 text-primary-teal focus:ring-primary-teal border-gray-300 dark:border-gray-600 rounded"
                  />
                  <label
                    htmlFor="captureFrontendLogs"
                    className="ml-3 block text-sm font-medium text-gray-700 dark:text-gray-300"
                  >
                    Capture frontend console logs
                  </label>
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400 ml-7">
                  When enabled, browser console logs are forwarded to the OpenTelemetry logs
                  pipeline.
                </p>

                <div className="flex items-center mt-4">
                  <input
                    type="checkbox"
                    id="captureBackendLogs"
                    checked={formData.captureBackendLogs}
                    onChange={(e) =>
                      setFormData({ ...formData, captureBackendLogs: e.target.checked })
                    }
                    className="h-4 w-4 text-primary-teal focus:ring-primary-teal border-gray-300 dark:border-gray-600 rounded"
                  />
                  <label
                    htmlFor="captureBackendLogs"
                    className="ml-3 block text-sm font-medium text-gray-700 dark:text-gray-300"
                  >
                    Capture backend console logs
                  </label>
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400 ml-7">
                  When enabled, server console logs are forwarded to the OpenTelemetry pipeline.
                </p>
              </div>
            </div>

            {/* Test Current Time Configuration */}
            <div className="border-b dark:border-gray-700 pb-6">
              <h2 className="app-section-title mb-4">
                Test Current Time
              </h2>
              <div className="space-y-4">
                <div>
                  <label
                    htmlFor="testCurrentTime"
                    className="app-label"
                  >
                    Override current date/time (for testing/debugging)
                  </label>
                  <input
                    type="datetime-local"
                    id="testCurrentTime"
                    value={
                      formData.testCurrentTime
                        ? new Date(formData.testCurrentTime).toISOString().slice(0, 16)
                        : ''
                    }
                    onChange={(e) => {
                      const value = e.target.value;
                      setFormData({
                        ...formData,
                        testCurrentTime: value ? new Date(value).toISOString() : '',
                      });
                    }}
                    className="app-input"
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
              <h2 className="app-section-title mb-4">
                Notification Delay
              </h2>
              <div className="space-y-4">
                <div>
                  <label
                    htmlFor="notificationDelaySeconds"
                    className="app-label"
                  >
                    Delay between notifications (seconds)
                  </label>
                  <input
                    type="number"
                    id="notificationDelaySeconds"
                    min="1"
                    value={formData.notificationDelaySeconds}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        notificationDelaySeconds: parseInt(e.target.value) || 180,
                      })
                    }
                    className="app-input"
                  />
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    The number of seconds to wait between sending notifications for public spare
                    requests. Default is 180 seconds (3 minutes). Minimum is 1 second.
                  </p>
                </div>
              </div>
            </div>

            {/* Twilio Configuration */}
            <div className="border-b dark:border-gray-700 pb-6">
              <h2 className="app-section-title mb-4">
                Twilio (SMS provider)
              </h2>
              <div className="space-y-4">
                <div>
                  <label
                    htmlFor="twilioApiKeySid"
                    className="app-label"
                  >
                    API Key SID
                  </label>
                  <input
                    type="text"
                    id="twilioApiKeySid"
                    value={formData.twilioApiKeySid}
                    onChange={(e) => setFormData({ ...formData, twilioApiKeySid: e.target.value })}
                    className="app-input font-mono text-sm"
                    placeholder="SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  />
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Your Twilio API Key SID (starts with "SK")
                  </p>
                </div>

                <div>
                  <label
                    htmlFor="twilioApiKeySecret"
                    className="app-label"
                  >
                    API Key Secret
                  </label>
                  <input
                    type="password"
                    id="twilioApiKeySecret"
                    value={formData.twilioApiKeySecret}
                    onChange={(e) =>
                      setFormData({ ...formData, twilioApiKeySecret: e.target.value })
                    }
                    className="app-input font-mono text-sm"
                    placeholder={config?.twilioApiKeySecret ? '••••••••' : 'Enter API key secret'}
                  />
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    {config?.twilioApiKeySecret
                      ? 'Leave blank to keep current secret. Enter new secret to update.'
                      : 'Your Twilio API Key Secret (kept secure)'}
                  </p>
                </div>

                <div>
                  <label
                    htmlFor="twilioAccountSid"
                    className="app-label"
                  >
                    Account SID
                  </label>
                  <input
                    type="text"
                    id="twilioAccountSid"
                    value={formData.twilioAccountSid}
                    onChange={(e) => setFormData({ ...formData, twilioAccountSid: e.target.value })}
                    className="app-input font-mono text-sm"
                    placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  />
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Your Twilio Account SID (starts with "AC")
                  </p>
                </div>

                <div>
                  <label
                    htmlFor="twilioCampaignSid"
                    className="app-label"
                  >
                    Campaign SID
                  </label>
                  <input
                    type="text"
                    id="twilioCampaignSid"
                    value={formData.twilioCampaignSid}
                    onChange={(e) =>
                      setFormData({ ...formData, twilioCampaignSid: e.target.value })
                    }
                    className="app-input font-mono text-sm"
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
              <h2 className="app-section-title mb-4">
                Azure Communication Services (Email provider)
              </h2>
              <div className="space-y-4">
                <div>
                  <label
                    htmlFor="azureConnectionString"
                    className="app-label"
                  >
                    Connection string
                  </label>
                  <textarea
                    id="azureConnectionString"
                    value={formData.azureConnectionString}
                    onChange={(e) =>
                      setFormData({ ...formData, azureConnectionString: e.target.value })
                    }
                    className="app-input font-mono text-sm"
                    rows={3}
                    placeholder={
                      config?.azureConnectionString ? '••••••••' : 'Endpoint=https://...'
                    }
                  />
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    {config?.azureConnectionString
                      ? 'Leave blank to keep current connection string. Enter new string to update.'
                      : 'Your Azure Communication Services connection string'}
                  </p>
                </div>

                <div>
                  <label
                    htmlFor="azureSenderEmail"
                    className="app-label"
                  >
                    Sender email address
                  </label>
                  <input
                    type="email"
                    id="azureSenderEmail"
                    value={formData.azureSenderEmail}
                    onChange={(e) => setFormData({ ...formData, azureSenderEmail: e.target.value })}
                    className="app-input"
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
              <Button type="button" variant="secondary" onClick={loadConfig} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Saving...' : 'Save configuration'}
              </Button>
            </div>
          </form>
        </div>
      </AppPage>
    </Layout>
  );
}
