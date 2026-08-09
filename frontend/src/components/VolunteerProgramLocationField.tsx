import ChoiceInput from './ChoiceInput';
import FormField from './FormField';
import {
  VOLUNTEER_LOCATION_CLUB,
  type VolunteerLocationChoice,
} from '../utils/volunteering';

type Props = {
  id: string;
  clubName: string;
  value: VolunteerLocationChoice;
  onChange: (value: VolunteerLocationChoice) => void;
  optional?: boolean;
};

export default function VolunteerProgramLocationField({
  id,
  clubName,
  value,
  onChange,
  optional = false,
}: Props) {
  return (
    <FormField label="Location" labelId={id} optional={optional}>
      <ChoiceInput<string>
        layout="block"
        name={id}
        ariaLabelledBy={id}
        options={[{ value: VOLUNTEER_LOCATION_CLUB, label: clubName }]}
        value={value}
        onChange={(next) => onChange(typeof next === 'string' ? next : null)}
        allowCustomValue
        createCustomValue={(raw) => raw.trim() || null}
        placeholder="Venue or address"
      />
    </FormField>
  );
}
