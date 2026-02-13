import { useEffect, useState, FormEvent } from 'react';
import Layout from '../components/Layout';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { get, patch } from '../api/client';
import Button from '../components/Button';

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
      setMessage({ type: 'error', text: 'Failed to update profile' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold mb-6 text-[#121033] dark:text-gray-100">My profile</h1>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
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

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label
                htmlFor="name"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
              >
                Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
                required
              />
            </div>

            <div className="border-t pt-6 dark:border-gray-700">
              <h2 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">
                Contact information
              </h2>

              <div className="space-y-6">
                <div>
                  <label
                    htmlFor="email"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                  >
                    Email address <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="email"
                    id="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
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
                  <label
                    htmlFor="phone"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                  >
                    Phone number
                  </label>
                  <input
                    type="tel"
                    id="phone"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
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
                <h2 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">
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
              <h2 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">
                Appearance
              </h2>

              <div className="space-y-3">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
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
      </div>
    </Layout>
  );
}
