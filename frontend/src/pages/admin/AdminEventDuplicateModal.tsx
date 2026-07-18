import { useEffect, useId, useState, type FormEvent } from 'react';
import { post } from '../../api/client';
import Button from '../../components/Button';
import FormCheckbox from '../../components/FormCheckbox';
import FormField from '../../components/FormField';
import FormSection from '../../components/FormSection';
import InlineStateMessage from '../../components/InlineStateMessage';
import MemberMultiSelect from '../../components/MemberMultiSelect';
import Modal from '../../components/Modal';
import api, { formatApiError } from '../../utils/api';

type DuplicateSourceEvent = {
  id: number;
  title: string;
};

type EventDuplicateSourceDetails = {
  pointOfContact?: string | null;
  ownerMemberIds?: number[];
};

export type EventDuplicatePayload = {
  title: string;
  slug?: string;
  published: boolean;
  registrationStart: string | null;
  registrationCutoff: string | null;
  cancellationCutoff: string | null;
  pointOfContact: string;
  ownerMemberIds: number[];
  timespans: Array<{ startDt: string; endDt: string }>;
};

type Props = {
  sourceEvent: DuplicateSourceEvent | null;
  onClose: () => void;
  onDuplicated: (eventId: number) => void;
};

function slugFromTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function toIsoOrNull(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

export default function AdminEventDuplicateModal({ sourceEvent, onClose, onDuplicated }: Props) {
  const titleInputId = useId();
  const slugInputId = useId();
  const startInputId = useId();
  const endInputId = useId();
  const registrationStartInputId = useId();
  const registrationCutoffInputId = useId();
  const cancellationCutoffInputId = useId();
  const pointOfContactInputId = useId();
  const ownersInputId = useId();

  const [loading, setLoading] = useState(false);
  const [loadedSourceEventId, setLoadedSourceEventId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [slugWasEdited, setSlugWasEdited] = useState(false);
  const [startDt, setStartDt] = useState('');
  const [endDt, setEndDt] = useState('');
  const [registrationStart, setRegistrationStart] = useState('');
  const [registrationCutoff, setRegistrationCutoff] = useState('');
  const [cancellationCutoff, setCancellationCutoff] = useState('');
  const [published, setPublished] = useState(false);
  const [pointOfContact, setPointOfContact] = useState('');
  const [ownerMemberIds, setOwnerMemberIds] = useState<number[]>([]);

  useEffect(() => {
    if (!sourceEvent) return;

    const defaultTitle = `${sourceEvent.title} (Copy)`;
    setTitle(defaultTitle);
    setSlug(slugFromTitle(defaultTitle));
    setSlugWasEdited(false);
    setStartDt('');
    setEndDt('');
    setRegistrationStart('');
    setRegistrationCutoff('');
    setCancellationCutoff('');
    setPublished(false);
    setPointOfContact('');
    setOwnerMemberIds([]);
    setLoadError('');
    setSubmitError('');
    setLoadedSourceEventId(null);
    setLoading(true);

    let cancelled = false;
    api
      .get<EventDuplicateSourceDetails>(`/events/${sourceEvent.id}`)
      .then((response) => {
        if (cancelled) return;
        setPointOfContact(response.data.pointOfContact?.trim() ?? '');
        setOwnerMemberIds(response.data.ownerMemberIds ?? []);
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadError(formatApiError(error, 'Failed to load event details'));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadedSourceEventId(sourceEvent.id);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [sourceEvent]);

  const handleTitleChange = (nextTitle: string) => {
    setTitle(nextTitle);
    if (!slugWasEdited) setSlug(slugFromTitle(nextTitle));
  };

  const handleClose = () => {
    if (!submitting) {
      setLoadedSourceEventId(null);
      onClose();
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sourceEvent || loading || loadedSourceEventId !== sourceEvent.id || loadError) return;

    setSubmitError('');
    if (new Date(endDt).getTime() <= new Date(startDt).getTime()) {
      setSubmitError('Event end must be after event start.');
      return;
    }
    if (
      registrationStart &&
      registrationCutoff &&
      new Date(registrationCutoff).getTime() < new Date(registrationStart).getTime()
    ) {
      setSubmitError('Registration cutoff must be after registration opens.');
      return;
    }

    const payload: EventDuplicatePayload = {
      title: title.trim(),
      slug: slug.trim() || undefined,
      published,
      registrationStart: toIsoOrNull(registrationStart),
      registrationCutoff: toIsoOrNull(registrationCutoff),
      cancellationCutoff: toIsoOrNull(cancellationCutoff),
      pointOfContact: pointOfContact.trim(),
      ownerMemberIds,
      timespans: [
        {
          startDt: new Date(startDt).toISOString(),
          endDt: new Date(endDt).toISOString(),
        },
      ],
    };

    setSubmitting(true);
    try {
      const response = await post('/events/{id}/duplicate', payload, { id: String(sourceEvent.id) });
      onDuplicated(response.id);
    } catch (error) {
      setSubmitError(formatApiError(error, 'Failed to duplicate event'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={sourceEvent != null}
      onClose={handleClose}
      title={sourceEvent ? `Duplicate ${sourceEvent.title}` : 'Duplicate event'}
      size="lg"
      verticalAlign="start"
    >
      {sourceEvent && (loading || loadedSourceEventId !== sourceEvent.id) ? (
        <InlineStateMessage title="Loading event details..." />
      ) : loadError ? (
        <div className="space-y-4">
          <InlineStateMessage title={loadError} tone="error" />
          <div className="flex justify-end">
            <Button type="button" variant="secondary" onClick={handleClose}>
              Close
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Review the new event identity, schedule, publishing state, and contacts. Other event settings will be
            copied from the source event.
          </p>

          <FormSection title="New event" surface="panel">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Title" htmlFor={titleInputId} required className="sm:col-span-2">
                <input
                  id={titleInputId}
                  type="text"
                  required
                  maxLength={300}
                  value={title}
                  onChange={(event) => handleTitleChange(event.target.value)}
                  className="app-input"
                />
              </FormField>
              <FormField
                label="Slug"
                htmlFor={slugInputId}
                required
                className="sm:col-span-2"
                helperText="Generated from the title. It may receive a numeric suffix if another event already uses it."
              >
                <input
                  id={slugInputId}
                  type="text"
                  required
                  maxLength={200}
                  value={slug}
                  onChange={(event) => {
                    setSlug(event.target.value);
                    setSlugWasEdited(true);
                  }}
                  className="app-input"
                />
              </FormField>
            </div>
            <FormCheckbox
              label="Published"
              checked={published}
              onChange={setPublished}
              helperText="Leave unpublished until the copied event is ready to appear in event listings."
            />
          </FormSection>

          <FormSection
            title="Schedule"
            description="Source dates are not copied. Enter a new event start and end."
            surface="panel"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Event start" htmlFor={startInputId} required>
                <input
                  id={startInputId}
                  type="datetime-local"
                  required
                  value={startDt}
                  onChange={(event) => setStartDt(event.target.value)}
                  className="app-input"
                />
              </FormField>
              <FormField label="Event end" htmlFor={endInputId} required>
                <input
                  id={endInputId}
                  type="datetime-local"
                  required
                  value={endDt}
                  onChange={(event) => setEndDt(event.target.value)}
                  className="app-input"
                />
              </FormField>
              <FormField label="Registration opens" htmlFor={registrationStartInputId} optional>
                <input
                  id={registrationStartInputId}
                  type="datetime-local"
                  value={registrationStart}
                  onChange={(event) => setRegistrationStart(event.target.value)}
                  className="app-input"
                />
              </FormField>
              <FormField label="Registration cutoff" htmlFor={registrationCutoffInputId} optional>
                <input
                  id={registrationCutoffInputId}
                  type="datetime-local"
                  value={registrationCutoff}
                  onChange={(event) => setRegistrationCutoff(event.target.value)}
                  className="app-input"
                />
              </FormField>
              <FormField
                label="Cancellation cutoff"
                htmlFor={cancellationCutoffInputId}
                optional
                className="sm:col-span-2"
              >
                <input
                  id={cancellationCutoffInputId}
                  type="datetime-local"
                  value={cancellationCutoff}
                  onChange={(event) => setCancellationCutoff(event.target.value)}
                  className="app-input"
                />
              </FormField>
            </div>
          </FormSection>

          <FormSection
            title="Contacts and access"
            description="Confirm who receives event inquiries and who can manage the new event."
            surface="panel"
          >
            <FormField
              label="Point of contact"
              htmlFor={pointOfContactInputId}
              required
              helperText="Email address for event inquiries."
            >
              <input
                id={pointOfContactInputId}
                type="email"
                required
                maxLength={320}
                autoComplete="email"
                value={pointOfContact}
                onChange={(event) => setPointOfContact(event.target.value)}
                className="app-input"
              />
            </FormField>
            <FormField
              label="Event owners"
              htmlFor={ownersInputId}
              helperText="Owners can manage the event and its registrations."
            >
              <MemberMultiSelect
                inputId={ownersInputId}
                selectedIds={ownerMemberIds}
                onChange={setOwnerMemberIds}
                placeholder="Search members..."
              />
            </FormField>
          </FormSection>

          {submitError ? <InlineStateMessage title={submitError} tone="error" /> : null}

          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={handleClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Duplicating...' : 'Duplicate event'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
