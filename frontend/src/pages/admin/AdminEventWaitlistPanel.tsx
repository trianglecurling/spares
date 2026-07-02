import axios from 'axios';
import { FormEvent, useCallback, useEffect, useId, useState } from 'react';
import AppPageControlsRow from '../../components/AppPageControlsRow';
import Button from '../../components/Button';
import FormField from '../../components/FormField';
import InlineStateMessage from '../../components/InlineStateMessage';
import MemberAutocomplete from '../../components/MemberAutocomplete';
import Modal from '../../components/Modal';
import SortableList from '../../components/dragDrop/SortableList';
import api, { getApiErrorMessage } from '../../utils/api';
import { useAlert } from '../../contexts/AlertContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import type { MemberPickerOption } from '../../types/memberPicker';

type WaitlistOffer = {
  id: number;
  status: 'pending' | 'accepted' | 'declined' | 'superseded';
  expiresAt: string;
  expired: boolean;
  createdAt: string;
};

type WaitlistEntry = {
  registrationId: number;
  contactName: string;
  contactEmail: string;
  memberId: number | null;
  groupSize: number;
  position: number;
  joinedAt: string;
  offer: WaitlistOffer | null;
};

type WaitlistResponse = {
  summary: {
    waitlistLength: number;
    openSpots: number | null;
    pendingOffers: number;
    capacity: number | null;
  };
  entries: WaitlistEntry[];
};

type AdminEventWaitlistPanelProps = {
  eventId: number;
  isActive: boolean;
  onSummaryChange?: (summary: WaitlistResponse['summary']) => void;
};

function getApiErrorCode(error: unknown): string | null {
  if (axios.isAxiosError(error)) {
    const details = error.response?.data?.details;
    if (details && typeof details === 'object' && 'code' in details) {
      const code = (details as { code?: unknown }).code;
      return typeof code === 'string' ? code : null;
    }
  }
  return null;
}

function formatJoinedAt(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatOfferExpiry(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function offerStatusLabel(offer: WaitlistOffer): string {
  if (offer.status === 'pending' && offer.expired) return 'Pending – expired';
  if (offer.status === 'pending') return 'Pending';
  if (offer.status === 'accepted') return 'Accepted';
  if (offer.status === 'declined') return 'Declined';
  if (offer.status === 'superseded') return 'Superseded';
  return offer.status;
}

function offerBadgeClasses(offer: WaitlistOffer): string {
  if (offer.status === 'pending' && offer.expired) {
    return 'bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200';
  }
  if (offer.status === 'pending') {
    return 'bg-blue-100 text-blue-900 dark:bg-blue-950/40 dark:text-blue-200';
  }
  if (offer.status === 'accepted') {
    return 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200';
  }
  if (offer.status === 'declined') {
    return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200';
  }
  return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
}

function splitMemberName(name: string): { firstName: string; lastName: string } {
  const trimmed = name.trim();
  const space = trimmed.indexOf(' ');
  if (space <= 0) return { firstName: trimmed, lastName: '' };
  return { firstName: trimmed.slice(0, space), lastName: trimmed.slice(space + 1).trim() };
}

export default function AdminEventWaitlistPanel({
  eventId,
  isActive,
  onSummaryChange,
}: AdminEventWaitlistPanelProps) {
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();

  const [data, setData] = useState<WaitlistResponse | null>(null);
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addFirstName, setAddFirstName] = useState('');
  const [addLastName, setAddLastName] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addMemberId, setAddMemberId] = useState<number | ''>('');
  const [addSubmitting, setAddSubmitting] = useState(false);

  const [promoteTarget, setPromoteTarget] = useState<WaitlistEntry | null>(null);
  const [respondByDays, setRespondByDays] = useState('3');
  const [promoteSubmitting, setPromoteSubmitting] = useState(false);

  const addFirstNameId = useId();
  const addLastNameId = useId();
  const addEmailId = useId();
  const addMemberFieldId = useId();
  const respondByDaysId = useId();

  const loadWaitlist = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await api.get<WaitlistResponse>(`/events/${eventId}/waitlist`);
      setData(res.data);
      setEntries(res.data.entries);
      onSummaryChange?.(res.data.summary);
      setLoaded(true);
    } catch (error) {
      setLoadError(getApiErrorMessage(error, 'Failed to load waitlist.'));
    } finally {
      setLoading(false);
    }
  }, [eventId, onSummaryChange]);

  useEffect(() => {
    if (!isActive || loaded) return;
    void loadWaitlist();
  }, [isActive, loaded, loadWaitlist]);

  useEffect(() => {
    setData(null);
    setEntries([]);
    setLoaded(false);
    setLoadError(null);
  }, [eventId]);

  const handleReorder = async (nextEntries: WaitlistEntry[]) => {
    const nextIds = nextEntries.map((entry) => entry.registrationId);
    setEntries(nextEntries.map((entry, index) => ({ ...entry, position: index + 1 })));
    try {
      await api.post(`/events/${eventId}/waitlist/reorder`, { registrationIds: nextIds });
    } catch {
      showAlert('Failed to save waitlist order. Reloading…', 'error');
      await loadWaitlist();
    }
  };

  const handleRemove = async (entry: WaitlistEntry) => {
    const confirmed = await confirm({
      title: 'Remove from waitlist?',
      message: `${entry.contactName} will be removed from the waitlist. Any pending offer will be declined.`,
      confirmText: 'Remove',
      variant: 'danger',
    });
    if (!confirmed) return;

    try {
      await api.delete(`/events/${eventId}/waitlist/${entry.registrationId}`);
      showAlert('Removed from waitlist', 'success');
      await loadWaitlist();
    } catch (error) {
      showAlert(getApiErrorMessage(error, 'Unable to remove from waitlist.'), 'error');
    }
  };

  const handleForceDecline = async (entry: WaitlistEntry) => {
    if (!entry.offer) return;
    const confirmed = await confirm({
      title: 'Force decline offer?',
      message: `Decline the pending offer for ${entry.contactName}. They will remain on the waitlist.`,
      confirmText: 'Force decline',
      variant: 'danger',
    });
    if (!confirmed) return;

    try {
      await api.post(`/events/${eventId}/waitlist/offers/${entry.offer.id}/force-decline`, {});
      showAlert('Offer declined', 'success');
      await loadWaitlist();
    } catch (error) {
      showAlert(getApiErrorMessage(error, 'Unable to force decline offer.'), 'error');
    }
  };

  const handlePromote = async (event: FormEvent) => {
    event.preventDefault();
    if (!promoteTarget || promoteSubmitting) return;

    const days = Number.parseInt(respondByDays, 10);
    if (!Number.isFinite(days) || days < 1 || days > 30) {
      showAlert('Time to respond must be between 1 and 30 days.', 'warning');
      return;
    }

    setPromoteSubmitting(true);
    try {
      await api.post(`/events/${eventId}/waitlist/${promoteTarget.registrationId}/promote`, {
        respondByDays: days,
      });
      showAlert('Promotion offer sent', 'success');
      setPromoteTarget(null);
      setRespondByDays('3');
      await loadWaitlist();
    } catch (error) {
      if (getApiErrorCode(error) === 'capacity_held_by_pending_offers') {
        showAlert(
          'Open spots are currently held by pending offers. Force decline an expired or unwanted offer first, then try again.',
          'error',
        );
      } else {
        showAlert(getApiErrorMessage(error, 'Unable to promote waitlist entry.'), 'error');
      }
    } finally {
      setPromoteSubmitting(false);
    }
  };

  const handleMemberSelect = (option: MemberPickerOption) => {
    const { firstName, lastName } = splitMemberName(option.name);
    setAddFirstName(firstName);
    setAddLastName(lastName);
    if (option.email) setAddEmail(option.email);
    setAddMemberId(option.id);
  };

  const resetAddForm = () => {
    setAddFirstName('');
    setAddLastName('');
    setAddEmail('');
    setAddMemberId('');
  };

  const handleAddSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (addSubmitting) return;
    if (!addFirstName.trim() || !addLastName.trim() || !addEmail.trim()) {
      showAlert('First name, last name, and email are required.', 'warning');
      return;
    }

    setAddSubmitting(true);
    try {
      await api.post(`/events/${eventId}/waitlist`, {
        contactFirstName: addFirstName.trim(),
        contactLastName: addLastName.trim(),
        contactEmail: addEmail.trim(),
        ...(addMemberId !== '' ? { memberId: addMemberId } : {}),
      });
      showAlert('Added to waitlist', 'success');
      setAddModalOpen(false);
      resetAddForm();
      await loadWaitlist();
    } catch (error) {
      showAlert(getApiErrorMessage(error, 'Unable to add to waitlist.'), 'error');
    } finally {
      setAddSubmitting(false);
    }
  };

  if (!isActive) return null;

  if (loading && !loaded) {
    return <InlineStateMessage title="Loading waitlist..." />;
  }

  if (loadError && !data) {
    return (
      <InlineStateMessage
        tone="error"
        title="Unable to load waitlist"
        description={loadError}
        action={
          <Button type="button" variant="secondary" onClick={() => void loadWaitlist()}>
            Retry
          </Button>
        }
      />
    );
  }

  const summary = data?.summary;

  return (
    <div className="space-y-4">
      {summary ? (
        <p className="text-sm text-gray-600 dark:text-gray-400">
          <span className="font-medium text-gray-900 dark:text-gray-100">{summary.waitlistLength}</span> on waitlist
          {summary.openSpots != null ? (
            <>
              {' '}
              ·{' '}
              <span className="font-medium text-gray-900 dark:text-gray-100">{summary.openSpots}</span> open spots
            </>
          ) : null}
          {' '}
          ·{' '}
          <span className="font-medium text-gray-900 dark:text-gray-100">{summary.pendingOffers}</span> pending offers
        </p>
      ) : null}

      <AppPageControlsRow
        left={<p className="text-sm text-gray-600 dark:text-gray-400">Drag entries to reorder the waitlist.</p>}
        right={
          <Button type="button" onClick={() => setAddModalOpen(true)}>
            Add to waitlist
          </Button>
        }
      />

      {entries.length === 0 ? (
        <InlineStateMessage title="No one is on the waitlist yet." />
      ) : (
        <SortableList
          items={entries}
          getId={(entry) => entry.registrationId}
          getItemLabel={(entry) => entry.contactName}
          onReorder={(next) => void handleReorder(next)}
          itemClassName="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900"
          renderItem={({ item, index, dragHandle }) => {
            const pendingOffer = item.offer?.status === 'pending' ? item.offer : null;
            return (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 flex-1 gap-3">
                  {dragHandle}
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-gray-500 dark:text-gray-400">#{index + 1}</span>
                      <span className="font-medium text-gray-900 dark:text-gray-100">{item.contactName}</span>
                      {item.groupSize > 1 ? (
                        <span className="text-xs text-gray-500 dark:text-gray-400">Group of {item.groupSize}</span>
                      ) : null}
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-400 break-all">{item.contactEmail}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-500">Joined {formatJoinedAt(item.joinedAt)}</p>
                    {item.offer ? (
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${offerBadgeClasses(item.offer)}`}
                        >
                          {offerStatusLabel(item.offer)}
                        </span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          Expires {formatOfferExpiry(item.offer.expiresAt)}
                        </span>
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 sm:justify-end">
                  {pendingOffer ? (
                    <Button type="button" variant="outline-danger" onClick={() => void handleForceDecline(item)}>
                      Force decline offer
                    </Button>
                  ) : (
                    <Button type="button" variant="secondary" onClick={() => setPromoteTarget(item)}>
                      Promote
                    </Button>
                  )}
                  <Button type="button" variant="outline-danger" onClick={() => void handleRemove(item)}>
                    Remove
                  </Button>
                </div>
              </div>
            );
          }}
        />
      )}

      <Modal
        isOpen={addModalOpen}
        onClose={() => {
          setAddModalOpen(false);
          resetAddForm();
        }}
        title="Add to waitlist"
        size="md"
      >
        <form onSubmit={(event) => void handleAddSubmit(event)} className="space-y-4">
          <FormField label="Member (optional)" htmlFor={addMemberFieldId}>
            <MemberAutocomplete
              inputId={addMemberFieldId}
              value={addMemberId}
              onChange={setAddMemberId}
              onSelectOption={handleMemberSelect}
              placeholder="Search to prefill contact details"
            />
          </FormField>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="First name" htmlFor={addFirstNameId} required>
              <input
                id={addFirstNameId}
                type="text"
                className="app-input"
                value={addFirstName}
                onChange={(event) => setAddFirstName(event.target.value)}
                required
              />
            </FormField>
            <FormField label="Last name" htmlFor={addLastNameId} required>
              <input
                id={addLastNameId}
                type="text"
                className="app-input"
                value={addLastName}
                onChange={(event) => setAddLastName(event.target.value)}
                required
              />
            </FormField>
          </div>
          <FormField label="Email" htmlFor={addEmailId} required>
            <input
              id={addEmailId}
              type="email"
              className="app-input"
              value={addEmail}
              onChange={(event) => setAddEmail(event.target.value)}
              required
            />
          </FormField>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setAddModalOpen(false);
                resetAddForm();
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={addSubmitting}>
              {addSubmitting ? 'Adding...' : 'Add to waitlist'}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={promoteTarget != null}
        onClose={() => {
          setPromoteTarget(null);
          setRespondByDays('3');
        }}
        title="Promote waitlist entry"
        size="sm"
      >
        {promoteTarget ? (
          <form onSubmit={(event) => void handlePromote(event)} className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Send a spot offer to <span className="font-medium text-gray-900 dark:text-gray-100">{promoteTarget.contactName}</span>.
            </p>
            <FormField
              label="Time to respond (days)"
              htmlFor={respondByDaysId}
              helperText="Between 1 and 30 days."
              required
            >
              <input
                id={respondByDaysId}
                type="number"
                min={1}
                max={30}
                className="app-input"
                value={respondByDays}
                onChange={(event) => setRespondByDays(event.target.value)}
                required
              />
            </FormField>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setPromoteTarget(null);
                  setRespondByDays('3');
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={promoteSubmitting}>
                {promoteSubmitting ? 'Sending...' : 'Send offer'}
              </Button>
            </div>
          </form>
        ) : null}
      </Modal>
    </div>
  );
}
