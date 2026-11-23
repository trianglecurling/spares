import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import axios from 'axios';
import { get, patch } from '../../api/client';
import { formatApiError } from '../../utils/api';
import { useAlert } from '../../contexts/AlertContext';
import { AppPage, AppPageHeader } from '../../components/AppPage';
import AppStateCard from '../../components/AppStateCard';
import Button from '../../components/Button';
import FormField from '../../components/FormField';
import FormSection from '../../components/FormSection';
import { setCachedSpareSettings, type SpareSettings } from '../../hooks/useSpareSettings';

type SettingKey = keyof SpareSettings;
type FormValues = Record<SettingKey, string>;
type FieldErrors = Partial<Record<SettingKey, string>>;

const LIMITS: Record<SettingKey, { min: number; max: number }> = {
  notificationDelaySeconds: { min: 1, max: 3600 },
  byePriorityWindowMinutes: { min: 0, max: 1440 },
  urgentThresholdHours: { min: 0, max: 168 },
  reissueCooldownHours: { min: 0, max: 720 },
};

const SETTING_KEYS = Object.keys(LIMITS) as SettingKey[];

function toFormValues(settings: SpareSettings): FormValues {
  return {
    notificationDelaySeconds: String(settings.notificationDelaySeconds),
    byePriorityWindowMinutes: String(settings.byePriorityWindowMinutes),
    urgentThresholdHours: String(settings.urgentThresholdHours),
    reissueCooldownHours: String(settings.reissueCooldownHours),
  };
}

function validate(values: FormValues): { errors: FieldErrors; parsed: SpareSettings | null } {
  const errors: FieldErrors = {};
  const parsed = {} as SpareSettings;
  for (const key of SETTING_KEYS) {
    const raw = values[key].trim();
    const { min, max } = LIMITS[key];
    if (!/^\d+$/.test(raw)) {
      errors[key] = 'Enter a whole number.';
      continue;
    }
    const value = Number(raw);
    if (value < min || value > max) {
      errors[key] = `Enter a number from ${min} to ${max}.`;
      continue;
    }
    parsed[key] = value;
  }
  return { errors, parsed: Object.keys(errors).length === 0 ? parsed : null };
}

function serverFieldErrors(error: unknown): FieldErrors {
  if (!axios.isAxiosError(error)) return {};
  const details = (error.response?.data as { details?: { fieldErrors?: FieldErrors } } | undefined)
    ?.details;
  return details?.fieldErrors ?? {};
}

export default function AdminSparing() {
  const fieldId = useId();
  const { showAlert } = useAlert();
  const [values, setValues] = useState<FormValues | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const settings = await get('/public/spare-settings');
      setValues(toFormValues(settings));
    } catch (error) {
      console.error('Failed to load sparing settings:', error);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const updateValue = (key: SettingKey, next: string) => {
    setValues((prev) => (prev ? { ...prev, [key]: next } : prev));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!values) return;
    const { errors: nextErrors, parsed } = validate(values);
    setErrors(nextErrors);
    if (!parsed) {
      showAlert('Please fix the highlighted settings.', 'warning');
      return;
    }
    setSaving(true);
    try {
      const saved = await patch('/spare-settings', parsed);
      setCachedSpareSettings(saved);
      setValues(toFormValues(saved));
      showAlert('Sparing settings saved.', 'success');
    } catch (error) {
      setErrors(serverFieldErrors(error));
      showAlert(formatApiError(error, 'Failed to save sparing settings'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const renderNumberField = (
    key: SettingKey,
    label: string,
    unit: string,
    helperText: string,
  ) => {
    const id = `${fieldId}-${key}`;
    const { min, max } = LIMITS[key];
    return (
      <FormField label={label} htmlFor={id} required helperText={helperText} error={errors[key]}>
        {({ describedBy, invalid }) => (
          <div className="flex items-center gap-2">
            <input
              id={id}
              type="number"
              inputMode="numeric"
              min={min}
              max={max}
              step={1}
              value={values?.[key] ?? ''}
              onChange={(e) => updateValue(key, e.target.value)}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              className="app-input max-w-[8rem]"
            />
            <span className="text-sm text-gray-600 dark:text-gray-400" aria-hidden="true">
              {unit}
            </span>
          </div>
        )}
      </FormField>
    );
  };

  return (
    <AppPage narrow>
      <AppPageHeader
        title="Manage sparing"
        description="Timing rules for spare request notifications. Changes apply to new and in-progress requests."
      />

      {loading ? <AppStateCard title="Loading sparing settings…" /> : null}

      {!loading && loadError ? (
        <AppStateCard
          title="Could not load sparing settings"
          description="Please try again in a moment."
          action={
            <Button type="button" variant="secondary" onClick={() => void load()}>
              Try again
            </Button>
          }
        />
      ) : null}

      {!loading && !loadError && values ? (
        <form onSubmit={handleSubmit} className="app-card space-y-8 p-6" noValidate>
          <FormSection
            title="Players on bye"
            description="Players whose team has a bye that week hear about public requests first."
          >
            {renderNumberField(
              'byePriorityWindowMinutes',
              'Exclusive window for players on bye',
              'minutes',
              'How long players on bye have the request to themselves before everyone else is notified. Enter 0 to skip the exclusive window.',
            )}
          </FormSection>

          <FormSection
            title="Notification timing"
            description="After the bye window, public requests go out to one member at a time so the first people notified have a fair chance to accept."
          >
            {renderNumberField(
              'notificationDelaySeconds',
              'Delay between notifications',
              'seconds',
              'Time between each member notification for a public request.',
            )}
            {renderNumberField(
              'urgentThresholdHours',
              'Urgent request threshold',
              'hours',
              'Requests for games starting within this many hours skip the exclusive window and the delay, and everyone is notified at once. Enter 0 to turn this off.',
            )}
          </FormSection>

          <FormSection title="Re-issuing requests">
            {renderNumberField(
              'reissueCooldownHours',
              'Re-issue cooldown',
              'hours',
              'How long after notifications go out before the requester can re-issue an unfilled request. Requesters can always re-issue right away if someone cancels.',
            )}
          </FormSection>

          <div className="flex justify-end">
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      ) : null}
    </AppPage>
  );
}
