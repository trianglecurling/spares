import { useEffect, useId, useState, type ReactNode } from 'react';
import FormField from '../FormField';
import {
  VOLUNTEER_HOUR_LOG_DESCRIPTION_MAX,
  VOLUNTEER_HOUR_LOG_MIN,
  VOLUNTEER_HOUR_LOG_STEP,
  commitVolunteerHourLogHours,
  type VolunteerHourLogFieldErrors,
  type VolunteerHourLogFormValues,
} from '../../utils/volunteering';

type VolunteerHourLogFormProps = {
  values: VolunteerHourLogFormValues;
  onChange: (values: VolunteerHourLogFormValues) => void;
  errors?: VolunteerHourLogFieldErrors;
  disabled?: boolean;
  maxDate: string;
  memberField?: ReactNode;
};

export default function VolunteerHourLogForm({
  values,
  onChange,
  errors,
  disabled = false,
  maxDate,
  memberField,
}: VolunteerHourLogFormProps) {
  const dateId = useId();
  const hoursId = useId();
  const descriptionId = useId();
  const [hoursText, setHoursText] = useState(() => (values.hours === '' ? '' : String(values.hours)));
  const [localHoursError, setLocalHoursError] = useState<string | undefined>();

  useEffect(() => {
    setHoursText(values.hours === '' ? '' : String(values.hours));
  }, [values.hours]);

  const commitHours = () => {
    const next = commitVolunteerHourLogHours(hoursText);
    if (next.hours !== '') {
      onChange({ ...values, hours: next.hours });
      setHoursText(String(next.hours));
    }
    setLocalHoursError(next.error);
  };

  return (
    <div className="space-y-4">
      {memberField}
      <FormField
        label="Date of volunteering"
        htmlFor={dateId}
        required
        error={errors?.volunteerDate}
      >
        {({ describedBy, invalid }) => (
          <div className="max-w-xs">
            <input
              id={dateId}
              type="date"
              className="app-input"
              value={values.volunteerDate}
              max={maxDate}
              disabled={disabled}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              onChange={(event) => onChange({ ...values, volunteerDate: event.target.value })}
            />
          </div>
        )}
      </FormField>
      <FormField
        label="Number of hours"
        htmlFor={hoursId}
        required
        error={localHoursError ?? errors?.hours}
      >
        {({ describedBy, invalid }) => (
          <div className="max-w-[8rem]">
            <input
              id={hoursId}
              type="number"
              inputMode="decimal"
              className="app-input"
              min={VOLUNTEER_HOUR_LOG_MIN}
              step={VOLUNTEER_HOUR_LOG_STEP}
              value={hoursText}
              disabled={disabled}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              onChange={(event) => {
                const raw = event.target.value;
                setHoursText(raw);
                if (raw === '') {
                  onChange({ ...values, hours: '' });
                  return;
                }
                const parsed = Number(raw);
                if (!Number.isFinite(parsed)) return;
                onChange({ ...values, hours: parsed });
                const committed = commitVolunteerHourLogHours(parsed);
                setLocalHoursError(committed.error);
              }}
              onBlur={commitHours}
            />
          </div>
        )}
      </FormField>
      <FormField
        label="How did you volunteer your time?"
        htmlFor={descriptionId}
        required
        error={errors?.description}
      >
        {({ describedBy, invalid }) => (
          <textarea
            id={descriptionId}
            className="app-input"
            rows={4}
            maxLength={VOLUNTEER_HOUR_LOG_DESCRIPTION_MAX}
            value={values.description}
            disabled={disabled}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            onChange={(event) => onChange({ ...values, description: event.target.value })}
          />
        )}
      </FormField>
    </div>
  );
}
