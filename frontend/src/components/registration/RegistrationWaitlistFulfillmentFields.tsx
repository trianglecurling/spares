import Button from '../Button';
import FormField from '../FormField';
import ChoiceInput from '../ChoiceInput';
import {
  defaultDesiredAddWaitlistLeagueCount,
  moveAddWaitlistPriority,
  remainingFirstTwoLeagueSlots,
  requiresWaitlistFulfillmentPreferences,
  type RegistrationSelectionInput,
} from './registrationViewEditShared';

type RegistrationWaitlistFulfillmentFieldsProps = {
  selections: RegistrationSelectionInput[];
  activeLeagueIds: number[];
  desiredAddWaitlistLeagueCount: number | null;
  addWaitlistPriority: number[];
  leagueName: (leagueId: number) => string;
  onDesiredCountChange: (count: number) => void;
  onPriorityChange: (priorityLeagueIds: number[]) => void;
  tone?: 'public' | 'app';
};

export default function RegistrationWaitlistFulfillmentFields({
  selections,
  activeLeagueIds,
  desiredAddWaitlistLeagueCount,
  addWaitlistPriority,
  leagueName,
  onDesiredCountChange,
  onPriorityChange,
  tone = 'public',
}: RegistrationWaitlistFulfillmentFieldsProps) {
  if (!requiresWaitlistFulfillmentPreferences(selections)) return null;

  const remainingSlots = remainingFirstTwoLeagueSlots(activeLeagueIds, selections);
  const showCountQuestion = remainingSlots >= 2;
  const resolvedCount =
    desiredAddWaitlistLeagueCount ??
    defaultDesiredAddWaitlistLeagueCount(activeLeagueIds, selections) ??
    Math.min(remainingSlots, 2);
  const countFieldId = 'waitlist-fulfillment-count';

  return (
    <div className="space-y-4 rounded-2xl border border-sky-100 bg-sky-50 p-4">
      <div>
        <h2 className="text-base font-semibold text-[#121033]">Waitlist preferences</h2>
        <p className="mt-1 text-sm text-gray-700">
          {showCountQuestion
            ? 'If more than one waitlist spot opens, tell us how many leagues to place this curler in and which waitlists to prefer.'
            : 'You have one league already, so we will use this order to choose your second league if multiple waitlist spots open.'}
        </p>
      </div>

      {showCountQuestion ? (
        <FormField
          label="If more than one waitlist spot opens, how many leagues should we place you in?"
          htmlFor={countFieldId}
          tone={tone}
          required
        >
          <ChoiceInput
            inputId={countFieldId}
            layout="block"
            value={resolvedCount}
            onChange={(next) => {
              if (typeof next !== 'number') return;
              onDesiredCountChange(next);
            }}
            options={[
              { value: 1, label: '1 league', description: 'Take only the highest-priority waitlist that opens.' },
              { value: 2, label: '2 leagues', description: 'Fill up to two waitlist spots using the priority order below.' },
            ]}
          />
        </FormField>
      ) : null}

      <div className="space-y-3">
        <p className="text-sm font-medium text-[#121033]">Priority order</p>
        {addWaitlistPriority.map((leagueId, index) => (
          <div
            key={`waitlist-priority-${leagueId}`}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white p-3 text-sm shadow-sm"
          >
            <div>
              <p className="font-medium text-[#121033]">
                {index + 1}. {leagueName(leagueId)}
              </p>
              <p className="text-gray-600">ADD waitlist</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={index === 0}
                onClick={() => onPriorityChange(moveAddWaitlistPriority(addWaitlistPriority, leagueId, 'up'))}
                aria-label={`Move ${leagueName(leagueId)} up`}
              >
                Move up
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={index === addWaitlistPriority.length - 1}
                onClick={() => onPriorityChange(moveAddWaitlistPriority(addWaitlistPriority, leagueId, 'down'))}
                aria-label={`Move ${leagueName(leagueId)} down`}
              >
                Move down
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
