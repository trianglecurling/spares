import type { ReactNode } from 'react';
import { HiXMark } from 'react-icons/hi2';
import Button from '../Button';
import ChoiceInput from '../ChoiceInput';
import FormField from '../FormField';
import SortableList from '../dragDrop/SortableList';
import SortableRow from '../dragDrop/SortableRow';
import {
  buildReplaceableLeagueOptions,
  formatWaitlistPositionSuffix,
  getActiveWaitlistLeagueIds,
  moveWaitlistOrder,
  updateWaitlistEntryDetails,
  waitlistEntryTypeChoices,
  waitlistEntryTypeFromSelection,
  waitlistReplaceUnavailableReason,
  type LeagueCatalogItem,
  type RegistrationSelectionInput,
  type WaitlistEntryIntent,
  type WaitlistOfferPreference,
} from './registrationViewEditShared';

export type RegistrationWaitlistDisplayedEntry = {
  leagueId: number;
  entryType: WaitlistEntryIntent;
  replacesLeagueId?: number | null;
  selection?: RegistrationSelectionInput;
  isExisting: boolean;
  position?: number | null;
  declineCount?: number | null;
};

export type WaitlistConfirmationPreference = WaitlistOfferPreference | 'remove';

type RegistrationWaitlistEntriesEditorProps = {
  entries: RegistrationWaitlistDisplayedEntry[];
  selections: RegistrationSelectionInput[];
  activeLeagueIds: number[];
  existingEntries?: Array<{ leagueId: number; entryType: WaitlistEntryIntent; status?: string | null }>;
  /** Unified order of all active waitlists (ADD and REPLACE). */
  waitlistOrder: number[];
  leagues: LeagueCatalogItem[];
  leagueName: (leagueId: number | null | undefined) => string;
  selectionLabel?: (selection: RegistrationSelectionInput) => string;
  leagueCatalogItem: (leagueId: number) => LeagueCatalogItem | undefined;
  preferenceFromSelection: (selection: RegistrationSelectionInput | undefined) => WaitlistConfirmationPreference | null;
  preferenceOptions: Array<{ value: WaitlistConfirmationPreference; label: string }>;
  autoDeclineWarning: (declineCount: number | null | undefined) => string;
  tone?: 'public' | 'app';
  onSelectionsChange: (updater: (current: RegistrationSelectionInput[]) => RegistrationSelectionInput[]) => void;
  onOrderChange: (orderLeagueIds: number[]) => void;
  onPreferenceChange?: (leagueId: number, preference: WaitlistConfirmationPreference) => void;
  onRemove?: (leagueId: number) => void;
  renderByotFields?: (selection: RegistrationSelectionInput, league: LeagueCatalogItem, inputId: string) => ReactNode;
};

const ENTRY_TYPE_LABELS: Record<WaitlistEntryIntent, string> = {
  add: 'ADD — add this league to your schedule',
  replace: 'REPLACE — replace a league in your schedule with this one',
};

function cardClassName(tone: 'public' | 'app'): string {
  return tone === 'public'
    ? 'rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm'
    : 'space-y-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700';
}

export default function RegistrationWaitlistEntriesEditor({
  entries,
  selections,
  activeLeagueIds,
  existingEntries,
  waitlistOrder,
  leagues,
  leagueName,
  selectionLabel,
  leagueCatalogItem,
  preferenceFromSelection,
  preferenceOptions,
  autoDeclineWarning,
  tone = 'public',
  onSelectionsChange,
  onOrderChange,
  onPreferenceChange,
  onRemove,
  renderByotFields,
}: RegistrationWaitlistEntriesEditorProps) {
  const excludedReplaceLeagueIds = leagues
    .filter((league) => league.isPlayInBased === true)
    .map((league) => league.id);
  const replaceOptions = buildReplaceableLeagueOptions({
    activeLeagueIds,
    selections,
    leagueName,
    selectionLabel,
    existingEntries,
    excludedLeagueIds: excludedReplaceLeagueIds,
  });

  const activeEntries = entries.filter(
    (entry) => preferenceFromSelection(entry.selection) !== 'remove',
  );
  const effectiveOrder = getActiveWaitlistLeagueIds({
    selections,
    existingEntries,
    orderLeagueIds: waitlistOrder.length > 0 ? waitlistOrder : activeEntries.map((entry) => entry.leagueId),
  });
  const canReorder = effectiveOrder.length >= 2;

  const orderedEntries = [...activeEntries].sort((a, b) => {
    const aIndex = effectiveOrder.indexOf(a.leagueId);
    const bIndex = effectiveOrder.indexOf(b.leagueId);
    return (aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex) - (bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex);
  });

  // Keep removed existing entries visible so confirmation can still be changed.
  const removedExistingEntries = entries.filter(
    (entry) => entry.isExisting && preferenceFromSelection(entry.selection) === 'remove',
  );
  const displayEntries = [...orderedEntries, ...removedExistingEntries];

  const renderEntry = (
    waitlist: RegistrationWaitlistDisplayedEntry,
    options?: { dragHandle?: ReactNode; isDragging?: boolean; isOverlay?: boolean },
  ) => {
    const league = leagues.find((item) => item.id === waitlist.leagueId);
    const preference = preferenceFromSelection(waitlist.selection);
    const waitlistSelection = selections.find((selection) => selection.leagueId === waitlist.leagueId);
    const entryType = waitlistEntryTypeFromSelection(waitlistSelection, waitlist.entryType);
    const replacesLeagueId = waitlistSelection?.replacesLeagueId ?? waitlist.replacesLeagueId ?? null;
    const typeChoices = waitlistEntryTypeChoices({
      activeLeagueIds,
      selections,
      existingEntries,
      leagueId: waitlist.leagueId,
      replaceOptions,
    });
    const effectiveTypeChoices =
      typeChoices.length === 0
        ? [entryType]
        : typeChoices.includes(entryType)
          ? typeChoices
          : [...typeChoices, entryType];
    const showTypeControl = effectiveTypeChoices.length > 1 && preference !== 'remove';
    const replaceUnavailableReason =
      !showTypeControl && entryType === 'add' && preference !== 'remove'
        ? waitlistReplaceUnavailableReason({
            activeLeagueIds,
            selections,
            existingEntries,
            leagueId: waitlist.leagueId,
            replaceOptions,
          })
        : null;
    const showReplaceControl =
      entryType === 'replace' && preference !== 'remove' && replaceOptions.length > 1;
    const soleReplaceLabel =
      entryType === 'replace' && preference !== 'remove' && replaceOptions.length === 1
        ? leagueName(replaceOptions[0].value)
        : entryType === 'replace' && replacesLeagueId != null
          ? leagueName(replacesLeagueId)
          : null;
    const positionSuffix = formatWaitlistPositionSuffix({
      isExisting: waitlist.isExisting,
      position: waitlist.position,
      activeWaitlistEntryCount: leagueCatalogItem(waitlist.leagueId)?.activeWaitlistEntryCount,
    });
    const orderIndex = effectiveOrder.indexOf(waitlist.leagueId);
    const typeFieldId = `waitlist-entry-type-${waitlist.leagueId}`;
    const replaceFieldId = `waitlist-replace-league-${waitlist.leagueId}`;
    const preferenceFieldId = `waitlist-preference-${waitlist.leagueId}`;

    const body = (
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              {preference !== 'remove' ? options?.dragHandle : null}
              <p className="text-base font-semibold text-[#121033] dark:text-white">
                {canReorder && preference !== 'remove' && orderIndex >= 0 ? `${orderIndex + 1}. ` : null}
                {leagueName(waitlist.leagueId)}
              </p>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {entryType === 'replace'
                ? `Waitlist: REPLACE${soleReplaceLabel && !showReplaceControl ? ` — would replace ${soleReplaceLabel}` : ''}`
                : 'Waitlist: ADD'}
              {positionSuffix ? ` ${positionSuffix}` : ''}
            </p>
          </div>
          {!waitlist.isExisting && onRemove ? (
            <button
              type="button"
              className="shrink-0 rounded-md p-1 text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:hover:bg-gray-700 dark:hover:text-gray-100"
              aria-label={`Remove ${leagueName(waitlist.leagueId)} waitlist`}
              onClick={() => onRemove(waitlist.leagueId)}
            >
              <HiXMark className="h-5 w-5" aria-hidden />
            </button>
          ) : null}
        </div>

        {showTypeControl ? (
          <FormField
            label="Waitlist type"
            htmlFor={typeFieldId}
            tone={tone}
            required
            helperText="In the event you are entered into this league, how should this affect your other leagues?"
            helperPlacement="after-label"
          >
            <ChoiceInput
              inputId={typeFieldId}
              layout="block"
              value={entryType}
              onChange={(next) => {
                if (next !== 'add' && next !== 'replace') return;
                const nextReplaceId =
                  next === 'replace'
                    ? replacesLeagueId ?? (replaceOptions.length === 1 ? replaceOptions[0].value : null)
                    : null;
                // Type changes must not reshuffle list order.
                onSelectionsChange((current) =>
                  updateWaitlistEntryDetails(current, waitlist.leagueId, {
                    entryType: next,
                    replacesLeagueId: nextReplaceId,
                  }),
                );
              }}
              options={effectiveTypeChoices.map((value) => ({
                value,
                label: value === 'add' ? 'ADD' : 'REPLACE',
                description: ENTRY_TYPE_LABELS[value],
              }))}
            />
          </FormField>
        ) : replaceUnavailableReason ? (
          <p className="text-sm text-gray-600 dark:text-gray-300">{replaceUnavailableReason}</p>
        ) : null}

        {showReplaceControl ? (
          <FormField label="League to replace" htmlFor={replaceFieldId} tone={tone} required>
            <ChoiceInput
              inputId={replaceFieldId}
              layout="block"
              value={replacesLeagueId}
              onChange={(next) => {
                if (typeof next !== 'number') return;
                onSelectionsChange((current) =>
                  updateWaitlistEntryDetails(current, waitlist.leagueId, {
                    entryType: 'replace',
                    replacesLeagueId: next,
                  }),
                );
              }}
              options={replaceOptions}
            />
          </FormField>
        ) : null}

        {waitlist.isExisting && onPreferenceChange ? (
          <div>
            <FormField label="Waitlist confirmation" htmlFor={preferenceFieldId} tone={tone} required>
              <ChoiceInput
                inputId={preferenceFieldId}
                layout="block"
                value={preference}
                onChange={(next) => {
                  if (next == null) return;
                  onPreferenceChange(waitlist.leagueId, next as WaitlistConfirmationPreference);
                }}
                options={preferenceOptions}
              />
            </FormField>
            {preference === 'auto_decline' ? (
              <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
                {autoDeclineWarning(waitlist.declineCount)}
              </p>
            ) : null}
          </div>
        ) : null}

        {canReorder && preference !== 'remove' ? (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={orderIndex <= 0}
              onClick={() => onOrderChange(moveWaitlistOrder(effectiveOrder, waitlist.leagueId, 'up'))}
              aria-label={`Move ${leagueName(waitlist.leagueId)} up in priority`}
            >
              Move up
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={orderIndex < 0 || orderIndex >= effectiveOrder.length - 1}
              onClick={() => onOrderChange(moveWaitlistOrder(effectiveOrder, waitlist.leagueId, 'down'))}
              aria-label={`Move ${leagueName(waitlist.leagueId)} down in priority`}
            >
              Move down
            </Button>
          </div>
        ) : null}

        {!waitlist.isExisting &&
        league?.leagueType === 'bring_your_own_team' &&
        waitlistSelection &&
        preference !== 'remove' &&
        renderByotFields
          ? renderByotFields(waitlistSelection, league, `waitlist-roster-${league.id}`)
          : null}
      </div>
    );

    if (options?.dragHandle != null || options?.isOverlay) {
      return (
        <SortableRow
          isDragging={options.isDragging}
          isOverlay={options.isOverlay}
          className={tone === 'public' ? 'border-emerald-100' : undefined}
        >
          {body}
        </SortableRow>
      );
    }

    return (
      <div key={`waitlist-entry-${waitlist.leagueId}`} className={cardClassName(tone)}>
        {body}
      </div>
    );
  };

  if (displayEntries.length === 0) return null;

  if (canReorder) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-sky-100 bg-sky-50 px-4 py-3 text-sm text-sky-950 dark:border-sky-900/40 dark:bg-sky-950/30 dark:text-sky-100">
          <p className="font-medium">Priority order</p>
          <p className="mt-1">
            Drag the handle or use Move up / Move down. If more than one waitlist spot opens at once, higher-priority
            waitlists are preferred.
          </p>
        </div>
        <SortableList
          items={orderedEntries}
          getId={(item) => item.leagueId}
          getItemLabel={(item) => leagueName(item.leagueId)}
          itemNoun="waitlist"
          onReorder={(nextItems) => onOrderChange(nextItems.map((item) => item.leagueId))}
          renderItem={({ item, dragHandle, isDragging, isOverlay }) =>
            renderEntry(item, { dragHandle, isDragging, isOverlay })
          }
        />
        {removedExistingEntries.length > 0 ? (
          <div className="space-y-4">{removedExistingEntries.map((entry) => renderEntry(entry))}</div>
        ) : null}
      </div>
    );
  }

  return <div className="space-y-4">{displayEntries.map((entry) => renderEntry(entry))}</div>;
}
