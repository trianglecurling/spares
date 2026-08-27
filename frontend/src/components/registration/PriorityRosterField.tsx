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
  /** Teammates already on the registrant's declared team (locked). */
  lockPlayInTeamMembers?: Array<{
    memberId?: number | null;
    memberName?: string | null;
    pendingName?: string | null;
  }>;
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
  lockPlayInTeamMembers,
}: Props) {
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const joinPromptInFlightRef = useRef(false);
  const expectedRosterSize = expectedByotRosterSize(league);
  const lockedExistingMemberIds = useMemo(() => {
    const ids = new Set<number>();
    for (const member of lockPlayInTeamMembers ?? []) {
      if (member.memberId != null && member.memberId !== registeringCurler.id) ids.add(member.memberId);
    }
    return ids;
  }, [lockPlayInTeamMembers, registeringCurler.id]);
  const lockedExistingPendingNames = useMemo(
    () =>
      (lockPlayInTeamMembers ?? [])
        .map((member) => member.pendingName?.trim())
        .filter((name): name is string => Boolean(name)),
    [lockPlayInTeamMembers],
  );
  const teammateCapacity = expectedRosterSize
    ? Math.max(expectedRosterSize - 1 - lockedExistingMemberIds.size - lockedExistingPendingNames.length, 0)
    : undefined;
  const selectedMemberIds = useMemo(
    () =>
      (priority.teamRosterPlacements ?? [])
        .map((placement) => placement.memberId)
        .filter((memberId) => memberId !== registeringCurler.id && !lockedExistingMemberIds.has(memberId)),
    [lockedExistingMemberIds, priority.teamRosterPlacements, registeringCurler.id],
  );
  const pendingNames = useMemo(() => pendingRosterNames(priority.byotTeammateText), [priority.byotTeammateText]);
  const lockedPendingLookup = useMemo(
    () => new Set(lockedExistingPendingNames.map((name) => name.toLowerCase())),
    [lockedExistingPendingNames],
  );
  const addedPendingNames = useMemo(
    () => pendingNames.filter((name) => !lockedPendingLookup.has(name.toLowerCase())),
    [lockedPendingLookup, pendingNames],
  );

  const emitRoster = useCallback(
    (memberIds: number[], nextPendingNames: string[]) => {
      const lockedPlacements = [...lockedExistingMemberIds].map((memberId) => ({ memberId }));
      const addedPlacements = memberIds
        .filter((memberId) => !lockedExistingMemberIds.has(memberId) && memberId !== registeringCurler.id)
        .map((memberId) => ({ memberId }));
      const pending = [...lockedExistingPendingNames, ...nextPendingNames];
      onChange({
        teamRosterPlacements: [...lockedPlacements, ...addedPlacements],
        byotTeammateText: pending.length > 0 ? pending.join('\n') : null,
      });
    },
    [lockedExistingMemberIds, lockedExistingPendingNames, onChange, registeringCurler.id],
  );

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
      const canJoinOtherTeam =
        lockPlayInTeamMembers == null && Boolean(team && playInEntryTeamIsJoinable(team, expectedRosterSize));
      if (canJoinOtherTeam && team) {
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
      emitRoster(
        memberIds.filter((memberId) => alreadySelected.has(memberId) || !committedOtherTeamByMemberId.has(memberId)),
        addedPendingNames,
      );
      return;
    }

    emitRoster(memberIds, addedPendingNames);
  };

  const removePendingName = useCallback(
    (index: number) => {
      emitRoster(
        selectedMemberIds,
        addedPendingNames.filter((_, current) => current !== index),
      );
    },
    [addedPendingNames, emitRoster, selectedMemberIds],
  );

  const addPendingName = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      if (teammateCapacity != null && selectedMemberIds.length + addedPendingNames.length >= teammateCapacity) return;
      const normalized = trimmed.toLowerCase();
      if (pendingNames.some((pending) => pending.toLowerCase() === normalized)) return;
      if (lockedPendingLookup.has(normalized)) return;
      if (registeringCurler.name.trim().toLowerCase() === normalized) return;
      if (selectedMemberIds.some((memberId) => memberNameById.get(memberId)?.trim().toLowerCase() === normalized)) {
        return;
      }
      if (
        [...lockedExistingMemberIds].some(
          (memberId) => memberNameById.get(memberId)?.trim().toLowerCase() === normalized,
        )
      ) {
        return;
      }
      emitRoster(selectedMemberIds, [...addedPendingNames, trimmed]);
    },
    [
      addedPendingNames,
      emitRoster,
      lockedExistingMemberIds,
      lockedPendingLookup,
      memberNameById,
      pendingNames,
      registeringCurler.name,
      selectedMemberIds,
      teammateCapacity,
    ],
  );

  const lockedPills = useMemo(() => {
    const pills: Array<{ key: string; label: string; detail?: string }> = [
      { key: 'registering-curler', label: registeringCurler.name },
    ];
    for (const member of lockPlayInTeamMembers ?? []) {
      if (member.memberId != null && member.memberId === registeringCurler.id) continue;
      if (member.memberId != null) {
        pills.push({
          key: `existing-${member.memberId}`,
          label: member.memberName ?? memberNameById.get(member.memberId) ?? 'Teammate',
        });
        continue;
      }
      const pendingName = member.pendingName?.trim();
      if (pendingName) {
        pills.push({
          key: `existing-pending-${pendingName}`,
          label: pendingName,
          detail: 'Not yet registered',
        });
      }
    }
    return pills;
  }, [lockPlayInTeamMembers, memberNameById, registeringCurler.id, registeringCurler.name]);

  const pendingPills = useMemo(
    () =>
      addedPendingNames.map((name, index) => ({
        key: `pending-${index}-${name}`,
        label: name,
        detail: 'Not yet registered',
        onRemove: () => removePendingName(index),
      })),
    [addedPendingNames, removePendingName],
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
        filterOption={(option) => option.id !== registeringCurler.id && !lockedExistingMemberIds.has(option.id)}
        lockedPills={lockedPills}
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
