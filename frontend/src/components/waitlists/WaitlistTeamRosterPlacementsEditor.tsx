import { useEffect, useId, useRef } from 'react';
import ChoiceInput, { type ChoiceOption } from '../ChoiceInput';
import FormField from '../FormField';
import {
  normalizePlacementsForPlacementOptions,
  placementsNeedEntryTypeNormalization,
  type WaitlistTeamMemberPlacement,
  type WaitlistTeamMemberPlacementOptions,
} from './waitlistTeamRosterShared';

const ENTRY_TYPE_OPTIONS: ChoiceOption<'add' | 'replace'>[] = [
  { value: 'add', label: 'Add as an additional league' },
  { value: 'replace', label: 'Replace an existing league' },
];

type Props = {
  placements: WaitlistTeamMemberPlacement[];
  placementOptionsByMemberId: Record<number, WaitlistTeamMemberPlacementOptions | undefined>;
  staffReplaceLeagueOptions?: ChoiceOption<number>[];
  onChange: (next: WaitlistTeamMemberPlacement[]) => void;
};

export default function WaitlistTeamRosterPlacementsEditor({
  placements,
  placementOptionsByMemberId,
  staffReplaceLeagueOptions,
  onChange,
}: Props) {
  const baseId = useId();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!placementsNeedEntryTypeNormalization(placements, placementOptionsByMemberId)) return;
    onChangeRef.current(normalizePlacementsForPlacementOptions(placements, placementOptionsByMemberId));
  }, [placementOptionsByMemberId, placements]);

  const updatePlacement = (
    memberId: number,
    patch: Partial<Pick<WaitlistTeamMemberPlacement, 'entryType' | 'replacesLeagueId'>>,
  ) => {
    onChange(
      placements.map((placement) => {
        if (placement.memberId !== memberId) return placement;
        const entryType = patch.entryType ?? placement.entryType;
        return {
          ...placement,
          entryType,
          replacesLeagueId:
            entryType === 'replace'
              ? patch.replacesLeagueId !== undefined
                ? patch.replacesLeagueId
                : placement.replacesLeagueId
              : null,
        };
      }),
    );
  };

  return (
    <div className="space-y-4">
      {placements.map((placement, index) => {
        const options = placementOptionsByMemberId[placement.memberId];
        const entryTypeId = `${baseId}-entry-type-${placement.memberId}`;
        const replacesLeagueId = `${baseId}-replace-league-${placement.memberId}`;
        const memberEntryTypeOptions = ENTRY_TYPE_OPTIONS.map((option) => {
          if (option.type === 'divider' || !('value' in option) || option.value !== 'add' || options?.addAvailable !== false) {
            return option;
          }
          return {
            ...option,
            disabled: true,
            description: options?.addBlockedReason ?? 'ADD is not available for this member.',
          };
        });
        const replaceLeagueOptions: ChoiceOption<number>[] = staffReplaceLeagueOptions
          ? staffReplaceLeagueOptions
          : (options?.replacementLeagues ?? []).map((league) => ({ value: league.id, label: league.name }));

        return (
          <div
            key={placement.memberId}
            className="rounded-lg border border-gray-200 p-3 dark:border-gray-700"
          >
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              {index + 1}. {placement.memberName}
            </p>
            <div className="mt-3 space-y-3">
              <FormField label="Entry type" htmlFor={entryTypeId}>
                <ChoiceInput<'add' | 'replace'>
                  inputId={entryTypeId}
                  layout="popover"
                  value={placement.entryType}
                  onChange={(next) => {
                    if (next === 'add' || next === 'replace') {
                      updatePlacement(placement.memberId, {
                        entryType: next,
                        replacesLeagueId: next === 'replace' ? placement.replacesLeagueId : null,
                      });
                    }
                  }}
                  options={memberEntryTypeOptions}
                />
              </FormField>
              {placement.entryType === 'replace' ? (
                <FormField label="League to replace" htmlFor={replacesLeagueId} required>
                  <ChoiceInput<number>
                    inputId={replacesLeagueId}
                    layout="popover"
                    value={placement.replacesLeagueId}
                    onChange={(next) => {
                      if (typeof next === 'number') {
                        updatePlacement(placement.memberId, { replacesLeagueId: next });
                      }
                    }}
                    options={replaceLeagueOptions}
                    emptyText="No leagues available to replace."
                  />
                </FormField>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
