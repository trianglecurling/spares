import { useId, useState, type FormEvent } from 'react';
import Button from '../Button';
import FormField from '../FormField';
import { useAlert } from '../../contexts/AlertContext';
import api from '../../utils/api';
import { downloadBlob, filenameFromDisposition, messageFromBlobError } from '../../utils/fileDownload';

type RangeErrors = {
  from?: string;
  to?: string;
};

function validateRange(from: string, to: string): RangeErrors {
  const errors: RangeErrors = {};
  if (!from) errors.from = 'Enter a start date.';
  if (!to) errors.to = 'Enter an end date.';
  if (!errors.from && !errors.to && from > to) {
    errors.to = 'End date must be on or after the start date.';
  }
  return errors;
}

export default function VolunteerReportDownload() {
  const headingId = useId();
  const fromId = useId();
  const toId = useId();
  const { showAlert } = useAlert();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [errors, setErrors] = useState<RangeErrors>({});
  const [downloading, setDownloading] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (downloading) return;
    const nextErrors = validateRange(from, to);
    setErrors(nextErrors);
    if (nextErrors.from || nextErrors.to) return;

    setDownloading(true);
    try {
      const response = await api.get('/volunteering/admin/report', {
        params: { from, to },
        responseType: 'blob',
      });
      downloadBlob(
        new Blob([response.data], { type: 'text/csv;charset=utf-8' }),
        filenameFromDisposition(
          response.headers['content-disposition'],
          `volunteer-report-${from}-to-${to}.csv`
        )
      );
      showAlert('Volunteer report downloaded.', 'success');
    } catch (err) {
      showAlert(await messageFromBlobError(err, 'Unable to download the volunteer report.'), 'error');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <section className="app-card space-y-4 p-5" aria-labelledby={headingId}>
      <div>
        <h2 id={headingId} className="app-section-title">
          Volunteer report
        </h2>
        <p className="app-section-subtitle mt-1">
          Download a CSV of every member who completed a volunteer shift or logged hours in this date
          range. The name is filled in on the first row for each member. Logged hours use the
          description as the role name. When a member filled more than one role on the same shift,
          that shift's hours are listed once.
        </p>
      </div>
      <form noValidate onSubmit={(event) => void handleSubmit(event)} aria-busy={downloading || undefined}>
        <div className="flex flex-wrap items-end gap-3">
          <FormField label="From" htmlFor={fromId} required error={errors.from} className="w-full sm:w-44">
            {({ describedBy, invalid }) => (
              <input
                id={fromId}
                type="date"
                className="app-input"
                value={from}
                max={to || undefined}
                disabled={downloading}
                aria-invalid={invalid || undefined}
                aria-describedby={describedBy}
                onChange={(event) => {
                  const nextFrom = event.target.value;
                  setFrom(nextFrom);
                  setErrors((current) =>
                    current.from || current.to ? validateRange(nextFrom, to) : current
                  );
                }}
              />
            )}
          </FormField>
          <FormField label="To" htmlFor={toId} required error={errors.to} className="w-full sm:w-44">
            {({ describedBy, invalid }) => (
              <input
                id={toId}
                type="date"
                className="app-input"
                value={to}
                min={from || undefined}
                disabled={downloading}
                aria-invalid={invalid || undefined}
                aria-describedby={describedBy}
                onChange={(event) => {
                  const nextTo = event.target.value;
                  setTo(nextTo);
                  setErrors((current) =>
                    current.from || current.to ? validateRange(from, nextTo) : current
                  );
                }}
              />
            )}
          </FormField>
          <Button type="submit" disabled={downloading}>
            {downloading ? 'Downloading…' : 'Download CSV'}
          </Button>
        </div>
      </form>
    </section>
  );
}
