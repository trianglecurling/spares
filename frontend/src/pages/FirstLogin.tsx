import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../utils/api';
import Button from '../components/Button';

export default function FirstLogin() {
  const { member, updateMember } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [name, setName] = useState(member?.name || '');
  const [email, setEmail] = useState(member?.email || '');
  const [phone, setPhone] = useState(member?.phone || '');
  const [optedInSms, setOptedInSms] = useState(false);
  const [emailVisible, setEmailVisible] = useState(false);
  const [phoneVisible, setPhoneVisible] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (member?.firstLoginCompleted) {
      navigate('/');
    }
  }, [member, navigate]);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await api.patch('/members/me', {
        name,
        email,
        phone: phone || undefined,
        optedInSms,
        emailVisible,
        phoneVisible,
      });

      updateMember(response.data);
      setStep(2);
    } catch (error) {
      console.error('Failed to update profile:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleComplete = async () => {
    setLoading(true);

    try {
      await api.post('/members/me/complete-first-login');
      updateMember({ ...member!, firstLoginCompleted: true });
      navigate('/availability');
    } catch (error) {
      console.error('Failed to complete first login:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-2xl w-full">
        <div className="bg-white rounded-lg shadow-md p-8">
          <h1 className="text-3xl font-bold mb-2" style={{ color: '#121033' }}>
            Welcome to Triangle Curling Spares!
          </h1>
          <p className="text-gray-600 mb-8">
            Let's get your profile set up so you can start finding and offering spares.
          </p>

          {step === 1 && (
            <form onSubmit={handleUpdateProfile} className="space-y-6">
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-2">
                  Your name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
                  placeholder="The name most people know you by"
                  required
                />
                <p className="text-sm text-gray-500 mt-1">
                  Use the name that most people in the club know you by
                </p>
              </div>

              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                  Email address <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  id="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
                  placeholder="your.email@example.com"
                  required
                />
                
                <div className="mt-2 flex items-start">
                  <input
                    type="checkbox"
                    id="emailVisible"
                    checked={emailVisible}
                    onChange={(e) => setEmailVisible(e.target.checked)}
                    className="mt-1 mr-3"
                  />
                  <label htmlFor="emailVisible" className="text-sm text-gray-600">
                    Make my email address visible to other club members in the directory
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
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
                  placeholder="(555) 123-4567"
                />

                <div className="mt-2 flex items-start">
                  <input
                    type="checkbox"
                    id="phoneVisible"
                    checked={phoneVisible}
                    onChange={(e) => setPhoneVisible(e.target.checked)}
                    className="mt-1 mr-3"
                  />
                  <label htmlFor="phoneVisible" className="text-sm text-gray-600">
                    Make my phone number visible to other club members in the directory
                  </label>
                </div>
              </div>

              <div className="bg-blue-50 p-4 rounded-md">
                <div className="flex items-start">
                  <input
                    type="checkbox"
                    id="optedInSms"
                    checked={optedInSms}
                    onChange={(e) => setOptedInSms(e.target.checked)}
                    className="mt-1 mr-3"
                  />
                  <label htmlFor="optedInSms" className="text-sm">
                    <span className="font-medium">Opt in to text messages</span>
                    <p className="text-gray-600 mt-1">
                      Receive text message notifications when new spare requests match your
                      availability. You can change this later.
                    </p>
                  </label>
                </div>
              </div>

              <Button type="submit" disabled={loading} className="w-full">
                {loading ? 'Saving...' : 'Continue'}
              </Button>
            </form>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <div className="text-center">
                <div className="text-6xl mb-4">🥌</div>
                <h2 className="text-2xl font-bold mb-2" style={{ color: '#121033' }}>
                  You're all set!
                </h2>
                <p className="text-gray-600">
                  Now let's set your sparing availability so others can find you when they need a
                  spare.
                </p>
              </div>

              <Button onClick={handleComplete} disabled={loading} className="w-full">
                {loading ? 'Loading...' : 'Set my availability'}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
