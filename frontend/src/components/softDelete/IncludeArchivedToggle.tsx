import FormCheckbox from '../FormCheckbox';

type IncludeArchivedToggleProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
};

export default function IncludeArchivedToggle({
  checked,
  onChange,
  disabled = false,
  label = 'Include archived items',
}: IncludeArchivedToggleProps) {
  return (
    <FormCheckbox
      label={label}
      checked={checked}
      onChange={onChange}
      disabled={disabled}
    />
  );
}
