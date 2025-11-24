import { useState } from 'react';
import Layout from '../components/Layout';
import { useAuth } from '../contexts/AuthContext';
import api from '../utils/api';
import Button from '../components/Button';

export default function Profile() {
  const { member, updateMember } = useAuth();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: member?.name || '',
    email: member?.email || '',
    phone: member?.phone || '',
    optedInSms: member?.optedInSms || false,
    emailVisible: member?.emailVisible || false,
    phoneVisible: member?.phoneVisible || false,
  });
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      const response = await api.patch('/members/me', {
        name: formData.name,
        email: formData.email,
        phone: formData.phone || undefined,
        optedInSms: formData.optedInSms,
        emailVisible: formData.emailVisible,
        phoneVisible: formData.phoneVisible,
      });

      updateMember(response.data);
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
        <h1 className="text-3xl font-bold mb-6" style={{ color: '#121033' }}>
          My profile
        </h1>

        <div className="bg-white rounded-lg shadow p-6">
          {message && (
            <div
              className={`mb-6 p-4 rounded ${
                message.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
              }`}
            >
              {message.text}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-2">
                Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
                required
              />
            </div>

            <div className="border-t pt-6">
              <h2 className="text-lg font-medium text-gray-900 mb-4">Contact information</h2>
              
              <div className="space-y-6">
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                    Email address <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="email"
                    id="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
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
                    <label htmlFor="emailVisible" className="text-sm text-gray-600 select-none cursor-pointer">
                      Show my email in the member directory
                    </label>
                  </div>
                </div>

                <div>
                  <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-2">
                    Phone number
                  </label>
                  <input
                    type="tel"
                    id="phone"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
                  />
                  <div className="mt-2 flex items-start">
                    <input
                      type="checkbox"
                      id="phoneVisible"
                      checked={formData.phoneVisible}
                      onChange={(e) => setFormData({ ...formData, phoneVisible: e.target.checked })}
                      className="mt-1 mr-3 text-primary-teal focus:ring-primary-teal rounded"
                    />
                    <label htmlFor="phoneVisible" className="text-sm text-gray-600 select-none cursor-pointer">
                      Show my phone number in the member directory
                    </label>
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t pt-6">
              <h2 className="text-lg font-medium text-gray-900 mb-4">Notifications</h2>
              
              <div className="bg-blue-50 p-4 rounded-md">
                <div className="flex items-start">
                  <input
                    type="checkbox"
                    id="optedInSms"
                    checked={formData.optedInSms}
                    onChange={(e) => setFormData({ ...formData, optedInSms: e.target.checked })}
                    className="mt-1 mr-3 text-primary-teal focus:ring-primary-teal rounded"
                  />
                  <label htmlFor="optedInSms" className="text-sm select-none cursor-pointer">
                    <span className="font-medium text-gray-900">Receive text message notifications</span>
                    <p className="text-gray-600 mt-1">
                      Get notified via SMS when new spare requests match your availability.
                    </p>
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

