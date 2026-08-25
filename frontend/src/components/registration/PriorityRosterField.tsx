import { useCallback, useMemo, useRef } from 'react';
import FormField from '../FormField';
import MemberMultiSelect from '../MemberMultiSelect';
import { useAlert } from '../../contexts/AlertContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import {
  playInCommittedMemberConflictMessage,
  playInEntryTeamIsJoinable,
  playInJoinExistingTeamConfirmMessage,
  playInJoinableTeamRosterUpdate,
} from './RegistrationPlayInEntryPanel';
import {
  expectedByotRosterSize,
  pendingRosterNames,
  type LeaguePriorityInput,
} from './leaguePriorityShared';
import type {
  LeagueCatalogItem,
  RegistrationPlayInCommittedOtherMemberTeam,
} from './registrationViewEditShared';

type Props = {
  league: LeagueCatalogItem;
  priority: LeaguePriorityInput;
  inputId: string;
  registeringCurler: { id: number | null; name: string };
  memberNameById: Map<number, string>;
  onChange: (update: Partial<Pick<LeaguePriorityInput, 'byotTeammateText' | 'teamRosterPlacements'>>) => void;
  helperText?: string;
  required?: boolean;
  /** Play-in only: members already committed to another declared entry team. */
  playInCommittedOtherMemberTeams?: RegistrationPlayInCommittedOtherMemberTeam[];
  playInCommittedOtherMemberIds?: number[];
};

/**
 * Declares the team for one bring-your-own-team or play-in entry on the priority
 * list. Unlike the old waitlist roster editor there is no per-teammate ADD or
 * REPLACE choice: each teammate states their own intent through their own
 * priority list when they register.
 */
export default function PriorityRosterField({
  league,
  priority,
  inputId,
  registeringCurler,
  memberNameById,
  onChange,
  helperText,
  required = true,
  playInCommittedOtherMemberTeams,
  playInCommittedOtherMemberIds,
}: Props) {
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const joinPromptInFlightRef = useRef(false);
  const expectedRosterSize = expectedByotRosterSize(league);
  const teammateCapacity = expectedRosterSize ? Math.max(expectedRosterSize - 1, 0) : undefined;
  const selectedMemberIds = useMemo(
    () =>
      (priority.teamRosterPlacements ?? [])
        .map((placement) => placement.memberId)
        .filter((memberId) => memberId !== registeringCurler.id),
    [priority.teamRosterPlacements, registeringCurler.id],
  );
  const pendingNames = useMemo(() => pendingRosterNames(priority.byotTeammateText), [priority.byotTeammateText]);

  const committedOtherTeamByMemberId = useMemo(() => {
    const map = new Map<number, RegistrationPlayInCommittedOtherMemberTeam['team'] | null>();
    for (const memberId of playInCommittedOtherMemberIds ?? []) map.set(memberId, null);
    for (const entry of playInCommittedOtherMemberTeams ?? []) map.set(entry.memberId, entry.team);
    return map;
  }, [playInCommittedOtherMemberIds, playInCommittedOtherMemberTeams]);

  const memberDisplayName = (memberId: number, team: RegistrationPlayInCommittedOtherMemberTeam['team'] | null) =>
    memberNameById.get(memberId) ??
    team?.members.find((teamMember) => teamMember.memberId === memberId)?.memberName ??
    'That member';

  const updateMembers = (memberIds: number[]) => {
    if (joinPromptInFlightRef.current) return;
    const alreadySelected = new Set(selectedMemberIds);
    const newlyAddedCommittedId = memberIds.find(
      (memberId) => !alreadySelected.has(memberId) && committedOtherTeamByMemberId.has(memberId),
    );

    if (newlyAddedCommittedId != null) {
      const team = committedOtherTeamByMemberId.get(newlyAddedCommittedId) ?? null;
      const memberName = memberDisplayName(newlyAddedCommittedId, team);
      if (team && playInEntryTeamIsJoinable(team, expectedRosterSize)) {
        joinPromptInFlightRef.current = true;
        void confirm({
          title: 'Join this team?',
          message: playInJoinExistingTeamConfirmMessage({ memberName, team }),
          confirmText: 'Yes',
          cancelText: 'No',
          variant: 'info',
        })
          .then((accepted) => {
            if (!accepted) return;
            onChange(playInJoinableTeamRosterUpdate({ team, registeringMemberId: registeringCurler.id }));
          })
          .finally(() => {
            joinPromptInFlightRef.current = false;
          });
        return;
      }
      showAlert(playInCommittedMemberConflictMessage({ memberName, team }), 'warning', 'Already on another team');
      onChange({
        teamRosterPlacements: memberIds
          .filter((memberId) => alreadySelected.has(memberId) || !committedOtherTeamByMemberId.has(memberId))
          .map((memberId) => ({ memberId })),
      });
      return;
    }

    onChange({ teamRosterPlacements: memberIds.map((memberId) => ({ memberId })) });
  };

  const removePendingName = useCallback(
    (index: number) => {
      onChange({ byotTeammateText: pendingNames.filter((_, current) => current !== index).join('\n') || null });
    },
    [onChange, pendingNames],
  );

  const addPendingName = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      if (teammateCapacity != null && selectedMemberIds.length + pendingNames.length >= teammateCapacity) return;
      const normalized = trimmed.toLowerCase();
      if (pendingNames.some((pending) => pending.toLowerCase() === normalized)) return;
      if (registeringCurler.name.trim().toLowerCase() === normalized) return;
      if (selectedMemberIds.some((memberId) => memberNameById.get(memberId)?.trim().toLowerCase() === normalized)) {
        return;
      }
      onChange({ byotTeammateText: [...pendingNames, trimmed].join('\n') });
    },
    [
      memberNameById,
      onChange,
      pendingNames,
      registeringCurler.name,
      selectedMemberIds,
      teammateCapacity,
    ],
  );

  const pendingPills = useMemo(
    () =>
      pendingNames.map((name, index) => ({
        key: `pending-${index}-${name}`,
        label: name,
        detail: 'Not yet registered',
        onRemove: () => removePendingName(index),
      })),
    [pendingNames, removePendingName],
  );

  return (
    <FormField
      label="Team roster"
      htmlFor={inputId}
      tone="public"
      required={required}
      helperText={helperText}
      helperPlacement="after-label"
    >
      <MemberMultiSelect
        inputId={inputId}
        selectedIds={selectedMemberIds}
        onChange={updateMembers}
        maxSelections={teammateCapacity}
        placeholder="Search members..."
        filterOption={(option) => option.id !== registeringCurler.id}
        lockedPills={[{ key: 'registering-curler', label: registeringCurler.name }]}
        extraPills={pendingPills}
        manualNameEntry={{
          linkLabel: 'Manually add by name',
          inputPlaceholder: 'Full name',
          addButtonLabel: 'Add',
          onAdd: addPendingName,
        }}
      />
    </FormField>
  );
}
