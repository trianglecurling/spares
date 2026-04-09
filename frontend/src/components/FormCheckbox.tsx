import type { ReactNode } from 'react';
import FormFieldMessage, { type FormFieldTone } from './FormFieldMessage';

type FormCheckboxProps = {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  helperText?: ReactNode;
  disabled?: boolean;
  className?: string;
  tone?: FormFieldTone;
};

function joinClasses(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

const labelToneClasses: Record<FormFieldTone, string> = {
  app: 'text-sm font-medium text-gray-700 dark:text-gray-300',
  public: 'text-sm font-medium text-gray-700',
};

const wrapperToneClasses: Record<FormFieldTone, string> = {
  app: 'space-y-1.5',
  public: 'space-y-1.5',
};

export default function FormCheckbox({
  label,
  checked,
  onChange,
  helperText,
  disabled = false,
  className,
  tone = 'app',
}: FormCheckboxProps) {
  return (
    <div className={joinClasses(wrapperToneClasses[tone], className)}>
      <label
        className={joinClasses(
          'flex items-start gap-2 cursor-pointer',
          disabled && 'cursor-not-allowed opacity-80'
        )}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          disabled={disabled}
          className="mt-0.5 rounded"
        />
        <span className={labelToneClasses[tone]}>{label}</span>
      </label>
      {helperText ? (
        <FormFieldMessage tone={tone} intent="helper" className="pl-6">
          {helperText}
        </FormFieldMessage>
      ) : null}
    </div>
  );
}
