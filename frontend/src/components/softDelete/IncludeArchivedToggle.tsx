import FormCheckbox from '../FormCheckbox';

type IncludeArchivedToggleProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
};

export default function IncludeArchivedToggle({
  checked,
  onChange,
  disabled = false,
}: IncludeArchivedToggleProps) {
  return (
    <FormCheckbox
      label="Include archived items"
      checked={checked}
      onChange={onChange}
      disabled={disabled}
    />
  );
}
