import { useEffect, useState } from 'react';
import { HiOutlineInformationCircle, HiXMark } from 'react-icons/hi2';
import Button from './Button';
import FormCheckbox from './FormCheckbox';
import { useAuth } from '../contexts/AuthContext';
import { useAlert } from '../contexts/AlertContext';
import api, { getApiErrorMessage } from '../utils/api';

type ContactSettingsNudgePayload = {
  visible: boolean;
  emailVisible: boolean;
  phoneVisible: boolean;
};

type ConfirmResponse = {
  success: boolean;
  emailVisible: boolean;
  phoneVisible: boolean;
};

export default function DashboardContactSettingsNudge() {
  const { member, updateMember } = useAuth();
  const { showAlert } = useAlert();
  const [data, setData] = useState<ContactSettingsNudgePayload | null>(null);
  const [emailVisible, setEmailVisible] = useState(false);
  const [phoneVisible, setPhoneVisible] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!member?.id) {
      setData(null);
      return;
    }

    let canceled = false;

    async function load() {
      try {
        const response = await api.get<ContactSettingsNudgePayload>('/members/me/contact-settings-nudge');
        if (canceled) return;
        setData(response.data);
        setEmailVisible(response.data.emailVisible);
        setPhoneVisible(response.data.phoneVisible);
      } catch (err) {
        if (!canceled) {
          console.error(getApiErrorMessage(err, 'Unable to load contact settings reminder.'));
          setData(null);
        }
      }
    }

    void load();
    return () => {
      canceled = true;
    };
  }, [member?.id]);

  const reload = async () => {
    try {
      const response = await api.get<ContactSettingsNudgePayload>('/members/me/contact-settings-nudge');
      setData(response.data);
      setEmailVisible(response.data.emailVisible);
      setPhoneVisible(response.data.phoneVisible);
    } catch {
      setData(null);
    }
  };

  const confirm = async () => {
    if (saving || !member) return;
    setSaving(true);
    setData((prev) => (prev ? { ...prev, visible: false } : prev));
    try {
      const response = await api.post<ConfirmResponse>('/members/me/contact-settings-nudge/confirm', {
        emailVisible,
        phoneVisible,
      });
      updateMember({
        ...member,
        emailVisible: response.data.emailVisible,
        phoneVisible: response.data.phoneVisible,
      });
      showAlert('Contact settings saved', 'success');
    } catch (err) {
      showAlert(getApiErrorMessage(err, 'Unable to save contact settings.'), 'error');
      await reload();
    } finally {
      setSaving(false);
    }
  };

  const dismiss = async () => {
    if (saving) return;
    setSaving(true);
    setData((prev) => (prev ? { ...prev, visible: false } : prev));
    try {
      await api.post('/members/me/contact-settings-nudge/dismiss');
    } catch (err) {
      console.error(getApiErrorMessage(err, 'Unable to dismiss contact settings reminder.'));
      await reload();
    } finally {
      setSaving(false);
    }
  };

  if (!data?.visible) return null;

  return (
    <div
      className="app-alert border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-800 dark:bg-sky-900/20 dark:text-sky-100"
      role="status"
    >
      <div className="flex items-start gap-3">
        <HiOutlineInformationCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <p className="font-semibold">Confirm your contact settings</p>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                void dismiss();
              }}
              disabled={saving}
              aria-label="Dismiss contact settings reminder"
            >
              <span className="inline-flex items-center gap-1.5">
                <HiXMark className="h-4 w-4" aria-hidden="true" />
                Dismiss
              </span>
            </Button>
          </div>
          <div className="space-y-3">
            <FormCheckbox
              label="Show my email in the member directory"
              checked={emailVisible}
              onChange={setEmailVisible}
              disabled={saving}
            />
            <FormCheckbox
              label="Show my phone number in the member directory"
              checked={phoneVisible}
              onChange={setPhoneVisible}
              disabled={saving}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              onClick={() => {
                void confirm();
              }}
              disabled={saving}
            >
              Confirm
            </Button>
            <p className="text-sm">You can change these settings any time in your user profile.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
