import { useEffect, useState } from 'react';
import { AppPage, AppPageHeader } from '../components/AppPage';
import AppStateCard from '../components/AppStateCard';
import Button from '../components/Button';
import Modal from '../components/Modal';
import { ArticleHtmlBundlePreview, ArticleMarkdownPreview } from './admin/ArticlePreviewDisplay';
import { useAuth } from '../contexts/AuthContext';
import { useAlert } from '../contexts/AlertContext';
import api, { formatApiError } from '../utils/api';
import { memberHasScope } from '../utils/permissions';

type BuildingAccessPageResponse = {
  contentType: 'markdown' | 'html';
  content: string;
  hasAccessCode: boolean;
};

type DialogStep = 'closed' | 'confirm' | 'code';

function hasRenderableContent(contentType: 'markdown' | 'html', content: string): boolean {
  if (!content.trim()) return false;
  if (contentType === 'markdown') return true;
  try {
    const parsed = JSON.parse(content) as { html?: string };
    return Boolean(parsed.html?.trim());
  } catch {
    return Boolean(content.trim());
  }
}

export default function BuildingAccessPage() {
  const { member } = useAuth();
  const { showAlert } = useAlert();
  const isActiveMember = memberHasScope(member, 'member.active');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<BuildingAccessPageResponse | null>(null);
  const [dialogStep, setDialogStep] = useState<DialogStep>('closed');
  const [accessCode, setAccessCode] = useState<string | null>(null);
  const [fetchingCode, setFetchingCode] = useState(false);

  useEffect(() => {
    if (!isActiveMember) {
      setLoading(false);
      return;
    }

    let canceled = false;
    setLoading(true);
    setError(null);
    api
      .get<BuildingAccessPageResponse>('/building-access')
      .then((res) => {
        if (!canceled) {
          setPage(res.data);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (canceled) return;
        setError(formatApiError(err, 'Unable to load building access information.'));
        setLoading(false);
      });

    return () => {
      canceled = true;
    };
  }, [isActiveMember]);

  const closeDialog = () => {
    setDialogStep('closed');
    setAccessCode(null);
    setFetchingCode(false);
  };

  const handleGetCode = async () => {
    setFetchingCode(true);
    try {
      const res = await api.get<{ accessCode: string }>('/building-access/code');
      setAccessCode(res.data.accessCode);
      setDialogStep('code');
    } catch (err: unknown) {
      showAlert(formatApiError(err, 'Unable to retrieve the building access code.'), 'error');
      closeDialog();
    } finally {
      setFetchingCode(false);
    }
  };

  if (!isActiveMember) {
    return (
      <AppPage>
        <AppPageHeader title="Building access" />
        <AppStateCard
          title="Current membership required"
          description="Building access is available only to members with a membership for the current season."
        />
      </AppPage>
    );
  }

  if (loading) {
    return (
      <AppPage>
        <AppPageHeader title="Building access" />
        <AppStateCard title="Loading building access..." />
      </AppPage>
    );
  }

  if (error) {
    return (
      <AppPage>
        <AppPageHeader title="Building access" />
        <AppStateCard title="Unable to load building access" description={error} />
      </AppPage>
    );
  }

  const contentType = page?.contentType ?? 'markdown';
  const content = page?.content ?? '';
  const showContent = hasRenderableContent(contentType, content);

  return (
    <>
      <AppPage>
        <AppPageHeader
          title="Building access"
          description="Read the facility entry and exit instructions before requesting the access code."
        />

        {showContent ? (
          <div className="app-card p-6">
            {contentType === 'html' ? (
              <ArticleHtmlBundlePreview content={content} />
            ) : (
              <ArticleMarkdownPreview markdown={content} />
            )}
          </div>
        ) : (
          <AppStateCard
            title="Instructions coming soon"
            description="Building access instructions have not been published yet. Check back later or contact the club if you need help."
          />
        )}

        <div className="mt-6">
          <Button
            type="button"
            onClick={() => setDialogStep('confirm')}
            disabled={!page?.hasAccessCode}
          >
            Get building access code
          </Button>
          {!page?.hasAccessCode ? (
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              The building access code has not been configured yet.
            </p>
          ) : null}
        </div>
      </AppPage>

      <Modal
        isOpen={dialogStep === 'confirm' || dialogStep === 'code'}
        onClose={closeDialog}
        title={dialogStep === 'code' ? 'Building access code' : 'Before you enter'}
        size="md"
      >
        {dialogStep === 'code' && accessCode ? (
          <div className="space-y-4">
            <p className="text-center font-mono text-4xl font-semibold tracking-[0.35em] text-gray-900 dark:text-gray-100">
              {accessCode}
            </p>
            <ul className="list-disc space-y-2 pl-5 text-sm text-gray-700 dark:text-gray-300">
              <li>
                To unlock the front door, press{' '}
                <span className="font-mono font-semibold">{accessCode}#</span> on the exterior keypad
              </li>
              <li>
                To disarm the alarm, press{' '}
                <span className="font-mono font-semibold">{accessCode}1</span> on the interior keypad
              </li>
              <li>
                If you make a mistake disarming the alarm, retry pressing{' '}
                <span className="font-mono font-semibold">{accessCode}1</span> until the alarm is
                disarmed.
              </li>
            </ul>
            <div className="flex justify-end">
              <Button type="button" variant="secondary" onClick={closeDialog}>
                Close
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300">
              Before attempting entry to the facility, please thoroughly read through all
              instructions on this page. If you are unsure of the process, do not hesitate to
              contact{' '}
              <a
                href="mailto:security@trianglecurling.com"
                className="text-primary-teal-link hover:underline"
              >
                security@trianglecurling.com
              </a>{' '}
              for help.
            </p>
            <p className="text-sm text-gray-700 dark:text-gray-300">
              Do not share the code with anyone. If someone asks for the code, help them learn how to access this page.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button type="button" variant="secondary" onClick={closeDialog} disabled={fetchingCode}>
                Cancel
              </Button>
              <Button type="button" onClick={() => void handleGetCode()} disabled={fetchingCode}>
                {fetchingCode ? 'Getting code…' : 'Get code'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
