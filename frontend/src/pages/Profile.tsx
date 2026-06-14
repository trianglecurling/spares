import { useEffect, useRef, useState, FormEvent, useId } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import { AppPage, AppPageHeader } from '../components/AppPage';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { get, patch, put } from '../api/client';
import { getApiErrorMessage } from '../utils/api';
import Button from '../components/Button';
import FormField from '../components/FormField';
import FormSection from '../components/FormSection';
import FormCheckbox from '../components/FormCheckbox';
import MemberMultiSelect from '../components/MemberMultiSelect';
import MemberDemographicsFields from '../components/MemberDemographicsFields';
import PageTabs, { type PageTabItem } from '../components/PageTabs';
import InlineStateMessage from '../components/InlineStateMessage';
import ProfilePaymentHistoryTab from '../components/profile/ProfilePaymentHistoryTab';
import {
  emptyMemberDemographicsForm,
  memberDemographicsFormFromProfile,
  memberDemographicsFormIsComplete,
  memberDemographicsEmergencyFormIsComplete,
  memberDemographicsPersonalFormIsComplete,
  memberDemographicsPayloadForSave,
  memberDemographicsSignInEmailIsComplete,
  type MemberDemographicsFormFields,
} from '../utils/memberDemographicsForm';
import type { MemberProfileResponse } from '../../../backend/src/api/types';
import {
  emptyMemberGuardianForm,
  isMemberMinor,
  memberGuardianFormFromProfile,
  memberGuardianFormIsComplete,
  memberGuardianPayloadForSave,
  type MemberGuardianFormFields,
} from '../utils/memberGuardianForm';

const PROFILE_BASE_PATH = '/profile';

const PROFILE_TAB_SLUGS = [
  'preferences',
  'personal-information',
  'emergency-contact',
  'parent-information',
  'delegated-access',
  'payment-history',
] as const;

type ProfileTabSlug = (typeof PROFILE_TAB_SLUGS)[number];

const DEFAULT_PROFILE_TAB: ProfileTabSlug = 'preferences';

function isProfileTabSlug(value: string | undefined): value is ProfileTabSlug {
  return value !== undefined && PROFILE_TAB_SLUGS.includes(value as ProfileTabSlug);
}

export default function Profile() {
  const { tab: tabParam } = useParams<{ tab: string }>();
  const navigate = useNavigate();
  const { member, updateMember } = useAuth();
  const { theme, setTheme } = useTheme();
  const activeTab: ProfileTabSlug = isProfileTabSlug(tabParam) ? tabParam : DEFAULT_PROFILE_TAB;
  const signInEmailFieldId = useId();
  const [loading, setLoading] = useState(false);
  const [profileLoading, setProfileLoading] = useState(true);
  const [smsDisabled, setSmsDisabled] = useState<boolean | null>(null);
  const [demographics, setDemographics] = useState<MemberDemographicsFormFields>(emptyMemberDemographicsForm);
  const [guardian, setGuardian] = useState<MemberGuardianFormFields>(emptyMemberGuardianForm);
  const [profileIsMinor, setProfileIsMinor] = useState(false);
  const [dateOfBirthIsSet, setDateOfBirthIsSet] = useState(false);
  const profileLoadSeqRef = useRef(0);
  const [formData, setFormData] = useState({
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

  useEffect(() => {
    if (tabParam && !isProfileTabSlug(tabParam)) {
      navigate(`${PROFILE_BASE_PATH}/${DEFAULT_PROFILE_TAB}`, { replace: true });
      return;
    }
    if (tabParam === 'parent-information' && profileLoading === false && !profileIsMinor) {
      navigate(`${PROFILE_BASE_PATH}/${DEFAULT_PROFILE_TAB}`, { replace: true });
      return;
    }
    if (tabParam === 'emergency-contact' && profileLoading === false && profileIsMinor) {
      navigate(`${PROFILE_BASE_PATH}/parent-information`, { replace: true });
    }
  }, [tabParam, navigate, profileLoading, profileIsMinor]);

  const normalizeThemePreference = (value?: string | null): 'light' | 'dark' | 'system' => {
    if (value === 'light' || value === 'dark' || value === 'system') return value;
    return 'system';
  };

  const applyProfileToForm = (profile: MemberProfileResponse) => {
    setDemographics(memberDemographicsFormFromProfile(profile));
    setGuardian(memberGuardianFormFromProfile(profile));
    setProfileIsMinor(profile.isMinor ?? isMemberMinor(profile.dateOfBirth));
    setDateOfBirthIsSet(Boolean(profile.dateOfBirth));
    setFormData({
      optedInSms: profile.optedInSms,
      emailVisible: profile.emailVisible,
      phoneVisible: profile.phoneVisible,
    });
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
    const seq = ++profileLoadSeqRef.current;
    const loadProfile = async () => {
      try {
        const profile = await get('/members/me');
        if (cancelled || seq !== profileLoadSeqRef.current) return;
        applyProfileToForm(profile);
      } catch {
        if (cancelled || seq !== profileLoadSeqRef.current) return;
        if (member) {
          setDemographics(
            memberDemographicsFormFromProfile({
              id: member.id,
              name: member.name,
              email: member.email,
              phone: member.phone,
              firstName: null,
              lastName: null,
              dateOfBirth: null,
              mailingAddress: null,
              emergencyContactName: null,
              emergencyContactPhone: null,
              guardianFirstName: null,
              guardianLastName: null,
              guardianEmail: null,
              guardianPhone: null,
              isMinor: false,
              isAdmin: member.isAdmin,
              isServerAdmin: member.isServerAdmin,
              optedInSms: member.optedInSms,
              emailSubscribed: member.emailSubscribed,
              emailVisible: member.emailVisible,
              phoneVisible: member.phoneVisible,
              themePreference: member.themePreference,
            }),
          );
        }
        setMessage({ type: 'error', text: 'Could not load your full profile. Showing saved session data.' });
      } finally {
        if (!cancelled && seq === profileLoadSeqRef.current) {
          setProfileLoading(false);
        }
      }
    };
    void loadProfile();
    return () => {
      cancelled = true;
    };
  }, [member?.id]);

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

  const validateDemographicsForTab = (tab: 'personal-information' | 'emergency-contact'): string | null => {
    if (tab === 'personal-information' && !memberDemographicsPersonalFormIsComplete(demographics)) {
      return 'Enter your full personal information and mailing address before saving.';
    }
    if (tab === 'emergency-contact' && !memberDemographicsEmergencyFormIsComplete(demographics)) {
      return 'Enter your emergency contact name and phone before saving.';
    }
    if (!memberDemographicsFormIsComplete(demographics)) {
      if (!memberDemographicsSignInEmailIsComplete(demographics)) {
        return 'Enter your sign-in email on the Profile tab before saving.';
      }
      if (!memberDemographicsPersonalFormIsComplete(demographics)) {
        return 'Complete your personal information on the Personal information tab before saving.';
      }
      return 'Complete your emergency contact on the Emergency contact tab before saving.';
    }
    return null;
  };

  const saveProfileTab = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    if (!memberDemographicsSignInEmailIsComplete(demographics)) {
      setMessage({ type: 'error', text: 'Enter the email address you use to sign in before saving.' });
      setLoading(false);
      return;
    }

    try {
      const response = await patch('/members/me', {
        email: demographics.email.trim(),
        optedInSms: smsDisabled ? false : formData.optedInSms,
        emailVisible: formData.emailVisible,
        phoneVisible: formData.phoneVisible,
      });

      updateMember({
        ...member!,
        email: response.email,
        optedInSms: response.optedInSms,
        emailVisible: response.emailVisible,
        phoneVisible: response.phoneVisible,
      } as import('../../../backend/src/types').AuthenticatedMember);
      applyProfileToForm(response);
      setMessage({ type: 'success', text: 'Profile updated successfully.' });
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

  const saveGuardian = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    if (!memberGuardianFormIsComplete(guardian)) {
      setMessage({ type: 'error', text: 'Enter the parent or guardian contact information before saving.' });
      setLoading(false);
      return;
    }
    try {
      const response = await patch('/members/me', memberGuardianPayloadForSave(guardian));
      applyProfileToForm(response);
      setMessage({ type: 'success', text: 'Parent information updated successfully.' });
    } catch (error) {
      setMessage({
        type: 'error',
        text: getApiErrorMessage(error, 'Could not update parent information. Please try again.'),
      });
    } finally {
      setLoading(false);
    }
  };

  const saveDemographics = async (e: FormEvent, tab: 'personal-information' | 'emergency-contact') => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    const validationError = validateDemographicsForTab(tab);
    if (validationError) {
      setMessage({ type: 'error', text: validationError });
      setLoading(false);
      return;
    }

    try {
      const response = await patch('/members/me', {
        ...memberDemographicsPayloadForSave(demographics),
        optedInSms: smsDisabled ? false : formData.optedInSms,
        emailVisible: formData.emailVisible,
        phoneVisible: formData.phoneVisible,
      });

      updateMember({
        ...member!,
        name: response.name,
        email: response.email,
        phone: response.phone,
        themePreference: normalizeThemePreference(response.themePreference),
        optedInSms: response.optedInSms,
        emailVisible: response.emailVisible,
        phoneVisible: response.phoneVisible,
      } as import('../../../backend/src/types').AuthenticatedMember);
      applyProfileToForm(response);
      setMessage({ type: 'success', text: 'Profile updated successfully.' });
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

  const profileTabs: PageTabItem[] = [
    {
      key: 'preferences',
      label: 'Profile',
      to: `${PROFILE_BASE_PATH}/preferences`,
      isActive: activeTab === 'preferences',
    },
    {
      key: 'personal-information',
      label: 'Personal information',
      to: `${PROFILE_BASE_PATH}/personal-information`,
      isActive: activeTab === 'personal-information',
    },
    ...(!profileIsMinor
      ? [
          {
            key: 'emergency-contact' as const,
            label: 'Emergency contact',
            to: `${PROFILE_BASE_PATH}/emergency-contact`,
            isActive: activeTab === 'emergency-contact',
          },
        ]
      : []),
    ...(profileIsMinor
      ? [
          {
            key: 'parent-information' as const,
            label: 'Parent information',
            to: `${PROFILE_BASE_PATH}/parent-information`,
            isActive: activeTab === 'parent-information',
          },
        ]
      : []),
    {
      key: 'delegated-access',
      label: 'Delegated access',
      to: `${PROFILE_BASE_PATH}/delegated-access`,
      isActive: activeTab === 'delegated-access',
    },
    {
      key: 'payment-history',
      label: 'Payment history',
      to: `${PROFILE_BASE_PATH}/payment-history`,
      isActive: activeTab === 'payment-history',
    },
  ];

  return (
    <Layout>
      <AppPage narrow>
        <AppPageHeader title="My profile" />

        {message &&
          activeTab !== 'delegated-access' &&
          activeTab !== 'payment-history' && (
          <div className={message.type === 'success' ? 'app-alert-success' : 'app-alert-error'}>
            {message.text}
          </div>
        )}

        <div className="app-card">
          <PageTabs items={profileTabs} className="mb-0" />

          {activeTab === 'payment-history' ? (
            <ProfilePaymentHistoryTab />
          ) : activeTab === 'delegated-access' ? (
            <>
              {accessMessage && (
                <div
                  className={accessMessage.type === 'success' ? 'app-alert-success' : 'app-alert-error'}
                >
                  {accessMessage.text}
                </div>
              )}
              <FormSection
                title="Let others access my account"
                description="If you want to let someone else access your account, for example a spouse or parent, you can add them here."
              >
                {accessLoading ? (
                  <InlineStateMessage title="Loading account access…" />
                ) : (
                  <div className="space-y-4">
                    {implicitAccessIds.length > 0 && (
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        You have other member accounts that share your email address. Those accounts can already sign in
                        as one another. That access is automatic and cannot be changed here.
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
                          implicitAccessIds.includes(opt.id) ? 'Already has access (same email)' : undefined
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
            </>
          ) : profileLoading ? (
            <InlineStateMessage title="Loading profile…" />
          ) : activeTab === 'preferences' ? (
            <form onSubmit={saveProfileTab} className="space-y-6">
              <FormSection title="Sign-in email">
                <FormField
                  label="Email address"
                  htmlFor={signInEmailFieldId}
                  required
                  helperText="This is the email address you use to sign in to your account."
                >
                  <input
                    id={signInEmailFieldId}
                    type="email"
                    value={demographics.email}
                    onChange={(event) =>
                      setDemographics((current) => ({ ...current, email: event.target.value }))
                    }
                    autoComplete="email"
                    className="app-input"
                    required
                  />
                </FormField>
              </FormSection>

              <FormSection
                title="Contact visibility"
                description="Choose whether your email and phone appear in the member directory."
              >
                <div className="space-y-4">
                  <FormCheckbox
                    label="Show my email in the member directory"
                    checked={formData.emailVisible}
                    onChange={(emailVisible) => setFormData({ ...formData, emailVisible })}
                  />
                  <FormCheckbox
                    label="Show my phone number in the member directory"
                    checked={formData.phoneVisible}
                    onChange={(phoneVisible) => setFormData({ ...formData, phoneVisible })}
                  />
                </div>
              </FormSection>

              {smsDisabled === false && (
                <FormSection title="Notifications">
                  <FormCheckbox
                    label="Receive text message notifications"
                    checked={formData.optedInSms}
                    onChange={(optedInSms) => setFormData({ ...formData, optedInSms })}
                    helperText="Receive text message notifications when new spare requests match your availability and when someone has responded to your request. Message and data rates may apply. Reply STOP to any message to unsubscribe."
                  />
                </FormSection>
              )}

              <FormSection title="Appearance">
                <div className="space-y-3">
                  <p className="app-label">Theme</p>
                  <div className="space-y-2" role="radiogroup" aria-label="Theme">
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
              </FormSection>

              <div>
                <Button type="submit" disabled={loading}>
                  {loading ? 'Saving…' : 'Save changes'}
                </Button>
              </div>
            </form>
          ) : activeTab === 'personal-information' ? (
            <form
              onSubmit={(e) => {
                void saveDemographics(e, 'personal-information');
              }}
              className="space-y-6"
            >
              <FormSection
                title="Personal information"
                description="Your name, date of birth, phone number, and mailing address."
              >
                <MemberDemographicsFields
                  value={demographics}
                  onChange={setDemographics}
                  idPrefix="profile"
                  section="personal"
                  lockDateOfBirth={dateOfBirthIsSet}
                />
              </FormSection>
              <div>
                <Button type="submit" disabled={loading}>
                  {loading ? 'Saving…' : 'Save changes'}
                </Button>
              </div>
            </form>
          ) : activeTab === 'parent-information' ? (
            <form
              onSubmit={(e) => {
                void saveGuardian(e);
              }}
              className="space-y-6"
            >
              <FormSection
                title="Parent information"
                description="Parent or guardian contact information for this member under 18. It is also used as the emergency contact."
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  {(
                    [
                      ['guardianFirstName', 'First name'],
                      ['guardianLastName', 'Last name'],
                      ['guardianEmail', 'Email address'],
                      ['guardianPhone', 'Phone number'],
                    ] as const
                  ).map(([field, label]) => {
                    const fieldId = `profile-guardian-${field}`;
                    return (
                      <FormField key={field} label={label} htmlFor={fieldId} required>
                        <input
                          id={fieldId}
                          type={field === 'guardianEmail' ? 'email' : field === 'guardianPhone' ? 'tel' : 'text'}
                          value={guardian[field]}
                          onChange={(event) =>
                            setGuardian((current) => ({ ...current, [field]: event.target.value }))
                          }
                          className="app-input"
                          required
                        />
                      </FormField>
                    );
                  })}
                </div>
              </FormSection>
              <div>
                <Button type="submit" disabled={loading}>
                  {loading ? 'Saving…' : 'Save changes'}
                </Button>
              </div>
            </form>
          ) : (
            <form
              onSubmit={(e) => {
                void saveDemographics(e, 'emergency-contact');
              }}
              className="space-y-6"
            >
              <FormSection title="Emergency contact">
                <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
                  Your emergency contact info will be available to all members.
                </p>
                <MemberDemographicsFields
                  value={demographics}
                  onChange={setDemographics}
                  idPrefix="profile-emergency"
                  section="emergency"
                />
              </FormSection>
              <div>
                <Button type="submit" disabled={loading}>
                  {loading ? 'Saving…' : 'Save changes'}
                </Button>
              </div>
            </form>
          )}
        </div>
      </AppPage>
    </Layout>
  );
}
