import { useEffect, useId, useState } from 'react';
import { del, get, patch, post } from '../../api/client';
import { getApiErrorMessage } from '../../utils/api';
import {
  browserSupportsWebAuthn,
  createPasskey,
  isWebAuthnCanceled,
} from '../../utils/passkeys';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';
import Button from '../Button';
import FormField from '../FormField';
import FormSection from '../FormSection';
import InlineStateMessage from '../InlineStateMessage';
import { useAlert } from '../../contexts/AlertContext';
import { useAuth } from '../../contexts/AuthContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import type { MemberPasskeySummary } from '../../../../backend/src/api/types';

function formatPasskeyDate(value: string | null): string {
  if (!value) return 'Never';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function PasskeyRow({
  passkey,
  disabled,
  onRenamed,
  onRemoved,
}: {
  passkey: MemberPasskeySummary;
  disabled: boolean;
  onRenamed: (passkey: MemberPasskeySummary) => void;
  onRemoved: (passkeyId: number) => void;
}) {
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const nameFieldId = useId();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(passkey.name);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    setName(passkey.name);
  }, [passkey.name]);

  const saveName = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      showAlert('Enter a name for this passkey.', 'error');
      return;
    }
    setSaving(true);
    try {
      const updated = await patch(
        '/members/me/passkeys/{passkeyId}',
        { name: trimmed },
        { passkeyId: String(passkey.id) }
      );
      onRenamed(updated);
      setRenaming(false);
      showAlert('Passkey name saved.', 'success');
    } catch (error) {
      showAlert(getApiErrorMessage(error, 'Could not rename that passkey. Please try again.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const removePasskey = async () => {
    const confirmed = await confirm({
      title: 'Remove passkey?',
      message: `This will remove "${passkey.name}". You will no longer be able to sign in with this passkey.`,
      confirmText: 'Remove passkey',
      variant: 'danger',
    });
    if (!confirmed) return;
    setRemoving(true);
    try {
      await del('/members/me/passkeys/{passkeyId}', undefined, { passkeyId: String(passkey.id) });
      onRemoved(passkey.id);
      showAlert('Passkey removed.', 'success');
    } catch (error) {
      showAlert(getApiErrorMessage(error, 'Could not remove that passkey. Please try again.'), 'error');
    } finally {
      setRemoving(false);
    }
  };

  return (
    <li className="py-4 first:pt-0 last:pb-0">
      {renaming ? (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void saveName();
          }}
        >
          <FormField label="Passkey name" htmlFor={nameFieldId} required>
            <input
              id={nameFieldId}
              className="app-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              required
              autoComplete="off"
              disabled={saving || disabled}
            />
          </FormField>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={saving || disabled}>
              {saving ? 'Saving…' : 'Save name'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={saving}
              onClick={() => {
                setName(passkey.name);
                setRenaming(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="font-medium text-gray-900 dark:text-gray-100">{passkey.name}</p>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Added {formatPasskeyDate(passkey.createdAt)} · Last used {formatPasskeyDate(passkey.lastUsedAt)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={disabled || removing}
              onClick={() => setRenaming(true)}
            >
              Rename
            </Button>
            <Button
              type="button"
              variant="outline-danger"
              disabled={disabled || removing}
              aria-label={`Remove ${passkey.name}`}
              onClick={() => {
                void removePasskey();
              }}
            >
              {removing ? 'Removing…' : 'Remove'}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

export default function ProfileSecurityTab() {
  const { isImpersonating } = useAuth();
  const { showAlert } = useAlert();
  const nameFieldId = useId();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [passkeys, setPasskeys] = useState<MemberPasskeySummary[]>([]);
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const supportsPasskeys = browserSupportsWebAuthn();

  useEffect(() => {
    let canceled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await get('/members/me/passkeys');
        if (!canceled) setPasskeys(response.passkeys);
      } catch (loadError) {
        if (!canceled) {
          setError(getApiErrorMessage(loadError, 'Could not load passkeys. Please try again.'));
        }
      } finally {
        if (!canceled) setLoading(false);
      }
    };
    void load();
    return () => {
      canceled = true;
    };
  }, []);

  const addPasskey = async () => {
    if (!supportsPasskeys) return;
    setAdding(true);
    try {
      const ceremony = await post('/members/me/passkeys/registration/options', {});
      const credential = await createPasskey(
        ceremony.options as unknown as PublicKeyCredentialCreationOptionsJSON
      );
      const created = await post('/members/me/passkeys/registration/verify', {
        challengeId: ceremony.challengeId,
        credential: credential as unknown as Record<string, unknown>,
        ...(newName.trim() ? { name: newName.trim() } : {}),
      });
      setPasskeys((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      setNewName('');
      showAlert('Passkey added. You can use it the next time you sign in.', 'success');
    } catch (addError) {
      if (isWebAuthnCanceled(addError)) {
        return;
      }
      showAlert(getApiErrorMessage(addError, 'Could not add that passkey. Please try again.'), 'error');
    } finally {
      setAdding(false);
    }
  };

  const canManage = !isImpersonating && supportsPasskeys;

  return (
    <FormSection
      title="Passkeys"
      description="Passkeys let you sign in with your fingerprint, face, or device PIN instead of a login code."
    >
      {isImpersonating ? (
        <InlineStateMessage
          title="Passkeys can't be changed while using another member's account"
          description="Return to your own account to add or remove passkeys."
          tone="warning"
        />
      ) : null}

      {!supportsPasskeys ? (
        <InlineStateMessage
          title="Passkeys are not available in this browser"
          description="Try a current version of Chrome, Safari, Edge, or Firefox, and use a secure (https) connection."
          tone="warning"
        />
      ) : null}

      {loading ? (
        <InlineStateMessage title="Loading passkeys…" />
      ) : error ? (
        <InlineStateMessage title={error} tone="error" />
      ) : passkeys.length === 0 ? (
        <InlineStateMessage
          title="No passkeys yet"
          description="Add a passkey on this device to sign in without waiting for an email code."
        />
      ) : (
        <ul className="divide-y divide-gray-200 dark:divide-gray-700">
          {passkeys.map((passkey) => (
            <PasskeyRow
              key={passkey.id}
              passkey={passkey}
              disabled={!canManage}
              onRenamed={(updated) => {
                setPasskeys((current) => current.map((item) => (item.id === updated.id ? updated : item)));
              }}
              onRemoved={(passkeyId) => {
                setPasskeys((current) => current.filter((item) => item.id !== passkeyId));
              }}
            />
          ))}
        </ul>
      )}

      {canManage ? (
        <div className="space-y-3">
          <FormField
            label="New passkey name"
            htmlFor={nameFieldId}
            optional
            helperText="For example, iPhone or laptop. You can rename it later."
          >
            <input
              id={nameFieldId}
              className="app-input"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              maxLength={80}
              autoComplete="off"
              disabled={adding}
            />
          </FormField>
          <Button
            type="button"
            disabled={adding}
            onClick={() => {
              void addPasskey();
            }}
          >
            {adding ? 'Waiting for this device…' : 'Add passkey'}
          </Button>
        </div>
      ) : null}
    </FormSection>
  );
}
