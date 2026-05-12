import { useEffect, useState, FormEvent, useId } from 'react';
import Layout from '../components/Layout';
import { AppPage, AppPageHeader } from '../components/AppPage';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { get, patch, put } from '../api/client';
import { getApiErrorMessage } from '../utils/api';
import Button from '../components/Button';
import FormSection from '../components/FormSection';
import MemberMultiSelect from '../components/MemberMultiSelect';

export default function Profile() {
  const { member, updateMember } = useAuth();
  const { theme, setTheme } = useTheme();
  const [loading, setLoading] = useState(false);
  const [smsDisabled, setSmsDisabled] = useState<boolean | null>(null);
  const [formData, setFormData] = useState({
    name: member?.name || '',
    email: member?.email || '',
    phone: member?.phone || '',
    optedInSms: member?.optedInSms || false,
    emailVisible: member?.emailVisible || false,
    phoneVisible: member?.phoneVisible || false,
  });
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const accessFieldId = useId();
  const [delegateIds, setDelegateIds] = useState<number[]>([]);
  const [implicitAccessIds, setImplicitAccessIds] = useState<number[]>([]);
  const [accessLoading, setAccessLoading] = useState(true);
  const [accessSaving, setAccessSaving] = useState(false);
  const [accessMessage, setAccessMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const normalizeThemePreference = (value?: string | null): 'light' | 'dark' | 'system' => {
    if (value === 'light' || value === 'dark' || value === 'system') return value;
    return 'system';
  };

  useEffect(() => {
    const load = async () => {
      try {
        const res = await get('/public-config');
        setSmsDisabled(!!res?.disableSms);
        if (res?.disableSms) {
          setFormData((prev) => ({ ...prev, optedInSms: false }));
        }
      } catch {
        setSmsDisabled(false);
      }
    };
    load();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadAccess = async () => {
      try {
        const res = await get('/members/me/account-access-delegates');
        if (!cancelled) {
          setDelegateIds(res.delegatedToMemberIds);
          setImplicitAccessIds(res.implicitAccessMemberIds);
        }
      } catch {
        if (!cancelled) {
          setAccessMessage({ type: 'error', text: 'Could not load account access settings.' });
        }
      } finally {
        if (!cancelled) {
          setAccessLoading(false);
        }
      }
    };
    loadAccess();
    return () => {
      cancelled = true;
    };
  }, []);

  const saveAccountAccessDelegates = async () => {
    setAccessSaving(true);
    setAccessMessage(null);
    try {
      const res = await put('/members/me/account-access-delegates', { memberIds: delegateIds });
      setDelegateIds(res.delegatedToMemberIds);
      setImplicitAccessIds(res.implicitAccessMemberIds);
      setAccessMessage({ type: 'success', text: 'Account access list updated.' });
    } catch {
      setAccessMessage({ type: 'error', text: 'Could not save account access settings.' });
    } finally {
      setAccessSaving(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      const response = await patch('/members/me', {
        name: formData.name,
        email: formData.email,
        phone: formData.phone || undefined,
        optedInSms: smsDisabled ? false : formData.optedInSms,
        emailVisible: formData.emailVisible,
        phoneVisible: formData.phoneVisible,
      });

      updateMember({
        ...member!,
        ...response,
        themePreference: normalizeThemePreference(response.themePreference),
      } as import('../../../backend/src/types').AuthenticatedMember);
      setMessage({ type: 'success', text: 'Profile updated successfully' });
    } catch (error) {
      console.error('Failed to update profile:', error);
      setMessage({
        type: 'error',
        text: getApiErrorMessage(error, 'Could not update your profile. Please try again.'),
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <AppPage narrow>
        <AppPageHeader title="My profile" />

        {message && (
          <div className={message.type === 'success' ? 'app-alert-success' : 'app-alert-error'}>
            {message.text}
          </div>
        )}

        <div className="app-card">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="name" className="app-label">
                Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="app-input"
                required
              />
            </div>

            <div className="border-t pt-6 dark:border-gray-700">
              <h2 className="app-section-title mb-4">
                Contact information
              </h2>

              <div className="space-y-6">
                <div>
                  <label htmlFor="email" className="app-label">
                    Email address <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="email"
                    id="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="app-input"
                    required
                  />
                  <div className="mt-2 flex items-start">
                    <input
                      type="checkbox"
                      id="emailVisible"
                      checked={formData.emailVisible}
                      onChange={(e) => setFormData({ ...formData, emailVisible: e.target.checked })}
                      className="mt-1 mr-3 text-primary-teal focus:ring-primary-teal rounded"
                    />
                    <label
                      htmlFor="emailVisible"
                      className="text-sm text-gray-600 dark:text-gray-400 select-none cursor-pointer"
                    >
                      Show my email in the member directory
                    </label>
                  </div>
                </div>

                <div>
                  <label htmlFor="phone" className="app-label">
                    Phone number
                  </label>
                  <input
                    type="tel"
                    id="phone"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="app-input"
                  />
                  <div className="mt-2 flex items-start">
                    <input
                      type="checkbox"
                      id="phoneVisible"
                      checked={formData.phoneVisible}
                      onChange={(e) => setFormData({ ...formData, phoneVisible: e.target.checked })}
                      className="mt-1 mr-3 text-primary-teal focus:ring-primary-teal rounded"
                    />
                    <label
                      htmlFor="phoneVisible"
                      className="text-sm text-gray-600 dark:text-gray-400 select-none cursor-pointer"
                    >
                      Show my phone number in the member directory
                    </label>
                  </div>
                </div>
              </div>
            </div>

            {smsDisabled === false && (
              <div className="border-t pt-6 dark:border-gray-700">
                <h2 className="app-section-title mb-4">
                  Notifications
                </h2>

                <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-md">
                  <div className="flex items-start">
                    <input
                      type="checkbox"
                      id="optedInSms"
                      checked={formData.optedInSms}
                      onChange={(e) => setFormData({ ...formData, optedInSms: e.target.checked })}
                      className="mt-1 mr-3 text-primary-teal focus:ring-primary-teal rounded"
                    />
                    <label htmlFor="optedInSms" className="text-sm select-none cursor-pointer">
                      <span className="font-medium text-gray-900 dark:text-gray-100">
                        Receive text message notifications
                      </span>
                      <p className="text-gray-600 dark:text-gray-400 mt-1">
                        Receive text message notifications when new spare requests match your
                        availability and when someone has responded to your request. Message and
                        data rates may apply. Reply STOP to any message to unsubscribe.
                      </p>
                    </label>
                  </div>
                </div>
              </div>
            )}

            <div className="border-t pt-6 dark:border-gray-700">
              <h2 className="app-section-title mb-4">
                Appearance
              </h2>

              <div className="space-y-3">
                <label className="app-label">
                  Theme
                </label>
                <div className="space-y-2">
                  <label className="flex items-center cursor-pointer">
                    <input
                      type="radio"
                      name="theme"
                      value="system"
                      checked={theme === 'system'}
                      onChange={() => setTheme('system')}
                      className="mr-3 text-primary-teal focus:ring-primary-teal"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">System default</span>
                  </label>
                  <label className="flex items-center cursor-pointer">
                    <input
                      type="radio"
                      name="theme"
                      value="light"
                      checked={theme === 'light'}
                      onChange={() => setTheme('light')}
                      className="mr-3 text-primary-teal focus:ring-primary-teal"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">Light</span>
                  </label>
                  <label className="flex items-center cursor-pointer">
                    <input
                      type="radio"
                      name="theme"
                      value="dark"
                      checked={theme === 'dark'}
                      onChange={() => setTheme('dark')}
                      className="mr-3 text-primary-teal focus:ring-primary-teal"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">Dark</span>
                  </label>
                </div>
              </div>
            </div>

            <div className="pt-4">
              <Button type="submit" disabled={loading}>
                {loading ? 'Saving...' : 'Save changes'}
              </Button>
            </div>
          </form>
        </div>

        <div className="app-card mt-6">
          <FormSection
            title="Let others access my account"
            description="If you want to let someone else access your account, for example a spouse or parent, you can add them here."
          >
            {accessMessage && (
              <div
                className={accessMessage.type === 'success' ? 'app-alert-success' : 'app-alert-error'}
              >
                {accessMessage.text}
              </div>
            )}
            {accessLoading ? (
              <p className="text-sm text-gray-600 dark:text-gray-400">Loading…</p>
            ) : (
              <div className="space-y-4">
                {implicitAccessIds.length > 0 && (
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    You have other member accounts that share your email address. Those accounts
                    can already sign in as one another. That access is automatic and cannot be
                    changed here.
                  </p>
                )}
                <div>
                  <label htmlFor={accessFieldId} className="app-label">
                    Members who may use your account
                  </label>
                  <MemberMultiSelect
                    inputId={accessFieldId}
                    selectedIds={delegateIds}
                    onChange={setDelegateIds}
                    filterOption={(opt) => opt.id !== member?.id}
                    isOptionDisabled={(opt) =>
                      opt.id === member?.id || implicitAccessIds.includes(opt.id)
                    }
                    getOptionStatusText={(opt) =>
                      implicitAccessIds.includes(opt.id)
                        ? 'Already has access (same email)'
                        : undefined
                    }
                  />
                </div>
                <Button
                  type="button"
                  onClick={() => {
                    void saveAccountAccessDelegates();
                  }}
                  disabled={accessSaving}
                >
                  {accessSaving ? 'Saving…' : 'Save access list'}
                </Button>
              </div>
            )}
          </FormSection>
        </div>
      </AppPage>
    </Layout>
  );
}
