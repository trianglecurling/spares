import type { ReactNode } from 'react';
import type { FormFieldTone } from './FormFieldMessage';

type FormSectionProps = {
  title?: ReactNode;
  description?: ReactNode;
  tone?: FormFieldTone;
  surface?: 'plain' | 'panel';
  className?: string;
  children: ReactNode;
};

function joinClasses(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

const titleToneClasses: Record<FormFieldTone, string> = {
  app: 'app-section-title text-lg',
  public: 'text-lg font-semibold tracking-tight text-gray-900',
};

const descriptionToneClasses: Record<FormFieldTone, string> = {
  app: 'text-sm text-gray-600 dark:text-gray-400',
  public: 'text-sm leading-relaxed text-gray-600',
};

const surfaceClasses: Record<FormFieldTone, Record<'plain' | 'panel', string>> = {
  app: {
    plain: 'space-y-4',
    panel:
      'space-y-5 rounded-xl border border-gray-200/90 bg-gray-50/60 p-5 shadow-sm dark:border-gray-700 dark:bg-gray-900/30',
  },
  public: {
    plain: 'space-y-4',
    panel: 'space-y-5 rounded-2xl border border-gray-200 bg-gray-50/70 p-5',
  },
};

export default function FormSection({
  title,
  description,
  tone = 'app',
  surface = 'plain',
  className,
  children,
}: FormSectionProps) {
  return (
    <section className={joinClasses(surfaceClasses[tone][surface], className)}>
      {title || description ? (
        <div className="space-y-1">
          {title ? <h2 className={titleToneClasses[tone]}>{title}</h2> : null}
          {description ? (
            <p className={descriptionToneClasses[tone]}>{description}</p>
          ) : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
