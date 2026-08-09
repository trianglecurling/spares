import FormField from '../FormField';
import ChoiceInput from '../ChoiceInput';
import {
  defaultDesiredAddWaitlistLeagueCount,
  remainingFirstTwoLeagueSlots,
  requiresWaitlistFulfillmentPreferences,
  type RegistrationSelectionInput,
} from './registrationViewEditShared';

type RegistrationWaitlistFulfillmentFieldsProps = {
  selections: RegistrationSelectionInput[];
  activeLeagueIds: number[];
  desiredAddWaitlistLeagueCount: number | null;
  onDesiredCountChange: (count: number) => void;
  tone?: 'public' | 'app';
};

export default function RegistrationWaitlistFulfillmentFields({
  selections,
  activeLeagueIds,
  desiredAddWaitlistLeagueCount,
  onDesiredCountChange,
  tone = 'public',
}: RegistrationWaitlistFulfillmentFieldsProps) {
  if (!requiresWaitlistFulfillmentPreferences(selections)) return null;

  const remainingSlots = remainingFirstTwoLeagueSlots(activeLeagueIds, selections);
  // Only ask when both 1 and 2 are meaningful choices.
  if (remainingSlots < 2) return null;

  const resolvedCount =
    desiredAddWaitlistLeagueCount ??
    defaultDesiredAddWaitlistLeagueCount(activeLeagueIds, selections) ??
    Math.min(remainingSlots, 2);
  const countFieldId = 'waitlist-fulfillment-count';

  return (
    <div className="space-y-4 rounded-2xl border border-sky-100 bg-sky-50 p-4 dark:border-sky-900/40 dark:bg-sky-950/30">
      <div>
        <h2 className="text-base font-semibold text-[#121033] dark:text-white">Waitlist preferences</h2>
        <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
          If more than one waitlist spot opens, tell us how many leagues to place you in. Use the priority order above
          when you only want one.
        </p>
      </div>

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
            { value: 2, label: '2 leagues', description: 'Fill up to two waitlist spots using the priority order above.' },
          ]}
        />
      </FormField>
    </div>
  );
}
