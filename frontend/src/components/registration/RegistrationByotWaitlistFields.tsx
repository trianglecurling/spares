import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Button from '../Button';
import FormField from '../FormField';
import MemberMultiSelect from '../MemberMultiSelect';
import WaitlistTeamRosterPlacementsEditor from '../waitlists/WaitlistTeamRosterPlacementsEditor';
import type { WaitlistTeamMemberPlacement, WaitlistTeamMemberPlacementOptions } from '../waitlists/waitlistTeamRosterShared';
import api from '../../utils/api';
import {
  byotRosterMemberIds,
  expectedByotRosterSize,
  hydrateByotWaitlistPlacements,
  pendingByotRosterNames,
  type LeagueCatalogItem,
  type RegistrationSelectionInput,
  updateByotRosterMembers,
  updatePendingByotRosterNames,
  updateTeamRosterPlacements,
} from './registrationViewEditShared';

type Props = {
  league: LeagueCatalogItem;
  selection: RegistrationSelectionInput;
  inputId: string;
  tone?: 'public';
  registeringCurler: { id: number | null; name: string };
  memberOptionById: Map<number, { name: string }>;
  memberOptionIdByName: Map<string, number>;
  placementOptionsByMemberId: Record<number, WaitlistTeamMemberPlacementOptions | undefined>;
  onPlacementOptionsLoaded: (options: Record<number, WaitlistTeamMemberPlacementOptions>) => void;
  onSelectionsChange: (updater: (current: RegistrationSelectionInput[]) => RegistrationSelectionInput[]) => void;
  /** When true, show an intro and button before the roster editor (registration join flow). */
  revealRosterOnDemand?: boolean;
};

function hasByotRosterProgress(
  selection: RegistrationSelectionInput,
  selectedMemberIds: number[],
  memberOptionIdByName: Map<string, number>,
  registeringCurlerMemberId: number | null,
): boolean {
  return (
    selectedMemberIds.length > 0 ||
    pendingByotRosterNames(selection, memberOptionIdByName, registeringCurlerMemberId).length > 0 ||
    Boolean(selection.teamRosterPlacements?.length)
  );
}

export default function RegistrationByotWaitlistFields({
  league,
  selection,
  inputId,
  tone,
  registeringCurler,
  memberOptionById,
  memberOptionIdByName,
  placementOptionsByMemberId,
  onPlacementOptionsLoaded,
  onSelectionsChange,
  revealRosterOnDemand = false,
}: Props) {
  const expectedRosterSize = expectedByotRosterSize(league);
  const additionalTeammateCount = expectedRosterSize ? Math.max(expectedRosterSize - 1, 0) : undefined;
  const selectedMemberIds = byotRosterMemberIds(selection, memberOptionIdByName, registeringCurler.id);
  const pendingNames = useMemo(
    () => pendingByotRosterNames(selection, memberOptionIdByName, registeringCurler.id),
    [memberOptionIdByName, registeringCurler.id, selection],
  );
  const rosterHasProgress = hasByotRosterProgress(
    selection,
    selectedMemberIds,
    memberOptionIdByName,
    registeringCurler.id,
  );
  const [rosterExpanded, setRosterExpanded] = useState(() => !revealRosterOnDemand || rosterHasProgress);

  useEffect(() => {
    if (rosterHasProgress) {
      setRosterExpanded(true);
    }
  }, [rosterHasProgress]);

  const placements = useMemo(
    () => hydrateByotWaitlistPlacements(selection, memberOptionById, memberOptionIdByName, registeringCurler),
    [memberOptionById, memberOptionIdByName, registeringCurler, selection],
  );

  const curlerPlacement = useMemo(() => {
    if (registeringCurler.id == null) return null;
    return (
      placements.find((placement) => placement.memberId === registeringCurler.id) ?? {
        memberId: registeringCurler.id,
        memberName: registeringCurler.name,
        entryType:
          selection.selectionType === 'waitlist_replace' ||
          (selection.selectionType === 'play_in_request' && selection.replacesLeagueId != null)
            ? ('replace' as const)
            : ('add' as const),
        replacesLeagueId:
          selection.selectionType === 'waitlist_replace' ||
          (selection.selectionType === 'play_in_request' && selection.replacesLeagueId != null)
            ? selection.replacesLeagueId ?? null
            : null,
      }
    );
  }, [placements, registeringCurler, selection.replacesLeagueId, selection.selectionType]);

  const teammatePlacements = useMemo(() => {
    if (registeringCurler.id == null) return placements;
    return placements.filter((placement) => placement.memberId !== registeringCurler.id);
  }, [placements, registeringCurler.id]);

  const teammateMemberIds = useMemo(
    () => teammatePlacements.map((placement) => placement.memberId),
    [teammatePlacements],
  );

  const teammateMemberIdsKey = teammateMemberIds.join(',');

  const onPlacementOptionsLoadedRef = useRef(onPlacementOptionsLoaded);
  onPlacementOptionsLoadedRef.current = onPlacementOptionsLoaded;

  useEffect(() => {
    if (!rosterExpanded || teammateMemberIds.length === 0 || selection.leagueId == null) return;
    let cancelled = false;
    void api
      .get<Record<number, WaitlistTeamMemberPlacementOptions>>(
        `/registration/leagues/${selection.leagueId}/team-member-placement-options`,
        { params: { memberIds: teammateMemberIdsKey } },
      )
      .then((response) => {
        if (!cancelled) onPlacementOptionsLoadedRef.current(response.data);
      })
      .catch(() => {
        if (!cancelled) onPlacementOptionsLoadedRef.current({});
      });
    return () => {
      cancelled = true;
    };
  }, [rosterExpanded, teammateMemberIds.length, teammateMemberIdsKey, selection.leagueId]);

  const memberNameById = useMemo(
    () => new Map(Array.from(memberOptionById.entries()).map(([id, option]) => [id, option.name])),
    [memberOptionById],
  );

  const updateRosterMembers = (memberIds: number[]) => {
    if (selection.leagueId == null) return;
    onSelectionsChange((current) =>
      updateByotRosterMembers(
        current,
        selection.leagueId as number,
        memberIds,
        memberNameById,
        registeringCurler,
        memberOptionIdByName,
      ),
    );
  };

  const updatePlacements = (nextTeammatePlacements: WaitlistTeamMemberPlacement[]) => {
    if (selection.leagueId == null) return;
    const fullPlacements = curlerPlacement ? [curlerPlacement, ...nextTeammatePlacements] : nextTeammatePlacements;
    onSelectionsChange((current) =>
      updateTeamRosterPlacements(current, selection.leagueId as number, fullPlacements, registeringCurler.id),
    );
  };

  const removePendingName = useCallback(
    (index: number) => {
      if (selection.leagueId == null) return;
      const next = pendingNames.filter((_, currentIndex) => currentIndex !== index);
      onSelectionsChange((current) =>
        updatePendingByotRosterNames(current, selection.leagueId as number, next, registeringCurler),
      );
    },
    [onSelectionsChange, pendingNames, selection.leagueId],
  );

  const addPendingName = useCallback(
    (name: string) => {
      if (selection.leagueId == null || additionalTeammateCount == null) return;
      const trimmed = name.trim();
      if (!trimmed) return;
      if (selectedMemberIds.length + pendingNames.length >= additionalTeammateCount) return;
      const normalized = trimmed.toLowerCase();
      if (pendingNames.some((pending) => pending.toLowerCase() === normalized)) return;
      if (registeringCurler.name.trim().toLowerCase() === normalized) return;
      if (selectedMemberIds.some((memberId) => memberNameById.get(memberId)?.trim().toLowerCase() === normalized)) {
        return;
      }
      onSelectionsChange((current) =>
        updatePendingByotRosterNames(
          current,
          selection.leagueId as number,
          [...pendingNames, trimmed],
          registeringCurler,
        ),
      );
    },
    [
      additionalTeammateCount,
      memberNameById,
      onSelectionsChange,
      pendingNames,
      registeringCurler.name,
      selectedMemberIds,
      selection.leagueId,
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

  if (revealRosterOnDemand && !rosterExpanded) {
    return (
      <div className="mt-4 space-y-3">
        <p className="text-sm text-gray-600">
          Entries for the {league.name} require a full team roster.
        </p>
        <Button type="button" variant="secondary" onClick={() => setRosterExpanded(true)}>
          Add team roster
        </Button>
      </div>
    );
  }

  return (
    <div className={revealRosterOnDemand ? 'mt-4 space-y-4' : 'space-y-4'}>
      <FormField label="Team roster" htmlFor={inputId} tone={tone} required>
        <MemberMultiSelect
          inputId={inputId}
          selectedIds={selectedMemberIds}
          onChange={updateRosterMembers}
          maxSelections={additionalTeammateCount}
          placeholder="Search members..."
          filterOption={(option) => option.id !== registeringCurler.id}
          lockedPills={[
            {
              key: 'registering-curler',
              label: registeringCurler.name,
            },
          ]}
          extraPills={pendingPills}
          manualNameEntry={{
            linkLabel: 'Manually add by name',
            inputPlaceholder: 'Full name',
            addButtonLabel: 'Add',
            onAdd: addPendingName,
          }}
          helperText="Teammates who are not club members must register individually. We will collect their league placement when they sign up."
        />
      </FormField>
      {teammatePlacements.length > 0 ? (
        <FormField label="Team member placements" htmlFor={`${inputId}-placements`} tone={tone} required>
          <WaitlistTeamRosterPlacementsEditor
            placements={teammatePlacements}
            placementOptionsByMemberId={placementOptionsByMemberId}
            onChange={updatePlacements}
          />
        </FormField>
      ) : null}
    </div>
  );
}
