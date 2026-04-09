import { useId, type ReactNode } from 'react';
import FormFieldMessage, { type FormFieldTone } from './FormFieldMessage';

export type FormFieldState = 'default' | 'disabled' | 'readonly' | 'hidden';

type FormFieldRenderProps = {
  describedBy?: string;
  invalid: boolean;
};

type FormFieldProps = {
  label?: ReactNode;
  htmlFor?: string;
  required?: boolean;
  optional?: boolean;
  helperText?: ReactNode;
  error?: ReactNode;
  state?: FormFieldState;
  stateMessage?: ReactNode;
  tone?: FormFieldTone;
  className?: string;
  labelClassName?: string;
  children: ReactNode | ((props: FormFieldRenderProps) => ReactNode);
};

function joinClasses(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

const labelToneClasses: Record<FormFieldTone, string> = {
  app: 'text-sm font-medium text-gray-700 dark:text-gray-300',
  public: 'text-sm font-medium text-gray-700',
};

const markerToneClasses: Record<FormFieldTone, string> = {
  app: 'text-xs font-medium text-gray-500 dark:text-gray-400',
  public: 'text-xs font-medium text-gray-500',
};

export default function FormField({
  label,
  htmlFor,
  required = false,
  optional = false,
  helperText,
  error,
  state = 'default',
  stateMessage,
  tone = 'app',
  className,
  labelClassName,
  children,
}: FormFieldProps) {
  const generatedId = useId();

  if (state === 'hidden') {
    return null;
  }

  const helperId = helperText ? `${generatedId}-helper` : undefined;
  const errorId = error ? `${generatedId}-error` : undefined;
  const stateId = stateMessage ? `${generatedId}-state` : undefined;
  const describedBy = [helperId, stateId, errorId].filter(Boolean).join(' ') || undefined;
  const invalid = Boolean(error);
  const markerText = required ? 'Required' : optional ? 'Optional' : null;
  const labelContent = label ? (
    <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
      {htmlFor ? (
        <label
          htmlFor={htmlFor}
          className={joinClasses(labelToneClasses[tone], labelClassName)}
        >
          {label}
        </label>
      ) : (
        <div className={joinClasses(labelToneClasses[tone], labelClassName)}>{label}</div>
      )}
      {markerText ? <span className={markerToneClasses[tone]}>{markerText}</span> : null}
    </div>
  ) : null;

  return (
    <div className={joinClasses('space-y-1.5', className)}>
      {labelContent}
      <div>
        {typeof children === 'function'
          ? children({ describedBy, invalid })
          : children}
      </div>
      {stateMessage ? (
        <FormFieldMessage id={stateId} tone={tone} intent="state">
          {stateMessage}
        </FormFieldMessage>
      ) : null}
      {helperText ? (
        <FormFieldMessage id={helperId} tone={tone} intent="helper">
          {helperText}
        </FormFieldMessage>
      ) : null}
      {error ? (
        <FormFieldMessage id={errorId} tone={tone} intent="error">
          {error}
        </FormFieldMessage>
      ) : null}
    </div>
  );
}
