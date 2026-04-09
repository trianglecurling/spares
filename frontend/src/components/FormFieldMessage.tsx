import type { ReactNode } from 'react';

export type FormFieldTone = 'app' | 'public';
export type FormFieldMessageIntent = 'helper' | 'error' | 'state';

type FormFieldMessageProps = {
  id?: string;
  tone?: FormFieldTone;
  intent?: FormFieldMessageIntent;
  className?: string;
  children: ReactNode;
};

function joinClasses(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

const toneClasses: Record<FormFieldTone, Record<FormFieldMessageIntent, string>> = {
  app: {
    helper: 'text-sm text-gray-500 dark:text-gray-400',
    error: 'text-sm text-red-600 dark:text-red-400',
    state: 'text-sm text-gray-500 dark:text-gray-400',
  },
  public: {
    helper: 'text-sm text-gray-500',
    error: 'text-sm text-red-600',
    state: 'text-sm text-gray-500',
  },
};

export default function FormFieldMessage({
  id,
  tone = 'app',
  intent = 'helper',
  className,
  children,
}: FormFieldMessageProps) {
  return (
    <p id={id} className={joinClasses(toneClasses[tone][intent], className)}>
      {children}
    </p>
  );
}
