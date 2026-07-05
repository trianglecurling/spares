import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import EventRegistrationFormContent from '../../components/eventRegistration/EventRegistrationFormContent';
import PublicLayout from '../../components/PublicLayout';
import SeoMeta from '../../components/SeoMeta';
import { readEventRegistrationPreviewOnce, type EventRegistrationPreviewPayloadV1 } from '../../utils/eventRegistrationPreviewSession';

function useRegistrationPreviewData(): { data: EventRegistrationPreviewPayloadV1 | null; error: string | null } {
  const [searchParams] = useSearchParams();
  const k = searchParams.get('k')?.trim() ?? '';
  return useMemo(() => {
    if (!k) {
      return { data: null, error: 'Missing preview link. Use Preview from the event editor.' };
    }
    const payload = readEventRegistrationPreviewOnce(k);
    if (!payload) {
      return {
        data: null,
        error:
          'Preview data is missing or was already shown. Close this tab and click Preview again from the editor (page refresh clears registration preview).',
      };
    }
    return { data: payload, error: null };
  }, [k]);
}

export default function AdminEventRegistrationPreview() {
  const { data, error } = useRegistrationPreviewData();

  if (error) {
    return (
      <PublicLayout>
        <section className="public-section">
          <div className="public-container">
            <div className="public-content">
              <div className="public-card p-6 text-red-700">{error}</div>
            </div>
          </div>
        </section>
      </PublicLayout>
    );
  }

  const title = data!.title.trim() || 'Untitled event';

  return (
    <PublicLayout>
      <SeoMeta
        title={`Registration preview: ${title} | Triangle Curling Club`}
        description="Preview of the public event registration form."
      />
      <div className="border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
        <p className="max-w-2xl mx-auto font-medium">Registration preview</p>
        <p className="max-w-2xl mx-auto mt-1 text-amber-900 dark:text-amber-200/90">
          This shows how the registration form will look to the public. Submitting registration is disabled here.
        </p>
      </div>
      <EventRegistrationFormContent
        preview
        showBackLink={false}
        event={{
          title,
          feeMinor: data!.feeMinor,
          memberFeeMinor: data!.memberFeeMinor,
          yourFeeMinor: data!.memberFeeMinor ?? undefined,
          currency: data!.currency,
          allowGroupRegistration: data!.allowGroupRegistration ? 1 : 0,
          maxGroupSize: data!.maxGroupSize,
          registrationFields: data!.registrationFields,
        }}
      />
    </PublicLayout>
  );
}
