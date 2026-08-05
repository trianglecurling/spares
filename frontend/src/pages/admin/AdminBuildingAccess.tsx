import { useCallback, useEffect, useId, useRef, useState } from 'react';
import api, { formatApiError } from '../../utils/api';
import { useAlert } from '../../contexts/AlertContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useTheme } from '../../contexts/ThemeContext';
import AppStateCard from '../../components/AppStateCard';
import Button from '../../components/Button';
import ContentFormatToggle, { type ContentFormat } from '../../components/ContentFormatToggle';
import FormField from '../../components/FormField';
import HtmlCodeEditor, { type HtmlCodeEditorRef } from '../../components/HtmlCodeEditor';
import MarkdownDescriptionEditor, {
  type MarkdownDescriptionEditorRef,
} from '../../components/MarkdownDescriptionEditor';
import {
  buildArticleHtmlContentFromMarkdown,
  isArticleHtmlContentEmpty,
} from '../../utils/articleHtmlContent';
import { storeArticleDraftPreview } from '../../utils/articleDraftPreviewSession';

type BuildingAccessAdminResponse = {
  accessCode: string;
  contentType: 'markdown' | 'html';
  content: string;
  updatedAt: string | null;
};

type UploadedFile = { id: number; publicUrl: string };

function extensionFromMimeType(mimeType: string): string {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/gif') return 'gif';
  if (mimeType === 'image/webp') return 'webp';
  return 'png';
}

function nextBuildingAccessImageFilename(markdown: string, mimeType: string): string {
  const pattern = /building-access-image-(\d{3})\.[a-z0-9]+/gi;
  let highest = 0;
  let match = pattern.exec(markdown);
  while (match) {
    const current = Number.parseInt(match[1] ?? '0', 10);
    if (Number.isFinite(current)) highest = Math.max(highest, current);
    match = pattern.exec(markdown);
  }
  const next = String(highest + 1).padStart(3, '0');
  return `building-access-image-${next}.${extensionFromMimeType(mimeType)}`;
}

export default function AdminBuildingAccess() {
  const fieldId = useId();
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const { resolvedTheme } = useTheme();
  const editorRef = useRef<MarkdownDescriptionEditorRef>(null);
  const htmlEditorRef = useRef<HtmlCodeEditorRef>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [accessCode, setAccessCode] = useState('');
  const [accessCodeError, setAccessCodeError] = useState<string | null>(null);
  const [contentType, setContentType] = useState<ContentFormat>('markdown');
  const [content, setContent] = useState('');
  const [htmlContent, setHtmlContent] = useState('');
  const [editorRevision, setEditorRevision] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<BuildingAccessAdminResponse>('/building-access/admin');
      const data = res.data;
      const nextType = data.contentType === 'html' ? 'html' : 'markdown';
      setAccessCode(data.accessCode ?? '');
      setContentType(nextType);
      setContent(nextType === 'markdown' ? (data.content ?? '') : '');
      setHtmlContent(nextType === 'html' ? (data.content ?? '') : '');
      setEditorRevision((v) => v + 1);
      setAccessCodeError(null);
    } catch (err: unknown) {
      showAlert(formatApiError(err, 'Failed to load building access settings'), 'error');
    } finally {
      setLoading(false);
    }
  }, [showAlert]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleContentFormatChange = async (next: ContentFormat) => {
    if (next === contentType) return;

    if (next === 'markdown') {
      setContentType('markdown');
      setHtmlContent(
        contentType === 'html' && htmlEditorRef.current
          ? JSON.stringify(htmlEditorRef.current.getValue())
          : htmlContent,
      );
      return;
    }

    const markdown = editorRef.current?.getMarkdown?.() ?? content;
    let nextHtml = htmlContent;
    if (isArticleHtmlContentEmpty(nextHtml) && markdown.trim()) {
      const shouldConvert = await confirm({
        title: 'Convert markdown to HTML?',
        message: 'Would you like to convert the existing markdown content to HTML?',
        confirmText: 'Yes, convert',
        cancelText: 'No',
        variant: 'info',
      });
      if (shouldConvert) {
        nextHtml = await buildArticleHtmlContentFromMarkdown(markdown);
      }
    }

    setContent(markdown);
    setHtmlContent(nextHtml);
    setContentType('html');
    setEditorRevision((v) => v + 1);
  };

  const getCurrentEditorContent = () =>
    contentType === 'markdown'
      ? (editorRef.current?.getMarkdown?.() ?? content)
      : JSON.stringify(htmlEditorRef.current?.getValue?.() ?? { html: '', css: '', js: '' });

  const handleDraftPreview = () => {
    const previewContent = getCurrentEditorContent();
    const k = storeArticleDraftPreview({
      title: 'Building access',
      slug: 'building-access',
      contentType,
      content: previewContent,
      snippet: null,
    });
    if (!k) {
      showAlert('Could not open preview. Allow storage for this site or try again.', 'error');
      return;
    }
    const url = `/admin/content/articles/draft-preview?k=${encodeURIComponent(k)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleUploadMarkdownImage = async (
    blob: Blob,
  ): Promise<{ url: string; altText?: string } | null> => {
    const mimeType = blob.type || 'image/png';
    if (!mimeType.startsWith('image/')) {
      showAlert('Only image paste is supported', 'error');
      return null;
    }
    const markdown = editorRef.current?.getMarkdown?.() ?? content;
    const filename = nextBuildingAccessImageFilename(markdown, mimeType);
    const file = new File([blob], filename, { type: mimeType });
    const formData = new FormData();
    formData.append('file', file);
    formData.append('displayName', filename);
    formData.append('visibility', 'public');
    try {
      const res = await api.post<UploadedFile[]>('/content/files', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const uploaded = Array.isArray(res.data) ? res.data[0] : null;
      if (!uploaded?.publicUrl) {
        showAlert('Image uploaded, but URL was missing', 'error');
        return null;
      }
      return { url: uploaded.publicUrl, altText: 'Building access image' };
    } catch (err: unknown) {
      showAlert(formatApiError(err, 'Failed to upload image'), 'error');
      return null;
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedCode = accessCode.trim();
    if (!/^\d{4}$/.test(trimmedCode)) {
      setAccessCodeError('Enter a 4-digit building access code.');
      return;
    }
    setAccessCodeError(null);
    setSaving(true);
    try {
      const payload = {
        accessCode: trimmedCode,
        contentType,
        content: getCurrentEditorContent(),
      };
      const res = await api.put<BuildingAccessAdminResponse>('/building-access/admin', payload);
      const data = res.data;
      const nextType = data.contentType === 'html' ? 'html' : 'markdown';
      setAccessCode(data.accessCode ?? '');
      setContentType(nextType);
      setContent(nextType === 'markdown' ? (data.content ?? '') : '');
      setHtmlContent(nextType === 'html' ? (data.content ?? '') : '');
      showAlert('Building access settings saved', 'success');
    } catch (err: unknown) {
      showAlert(formatApiError(err, 'Failed to save building access settings'), 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <AppStateCard title="Loading building access settings..." />;
  }

  return (
    <form
      onSubmit={handleSave}
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return;
        const popup = document.activeElement?.closest('.toastui-editor-popup');
        if (!popup) return;
        e.preventDefault();
        const okBtn = popup.querySelector('.toastui-editor-ok-button') as HTMLButtonElement | null;
        if (okBtn && !okBtn.disabled) okBtn.click();
      }}
      className="space-y-6"
    >
      <div className="app-card space-y-4 p-6">
        <FormField
          label="Building access code"
          htmlFor={`${fieldId}-code`}
          required
          helperText="Members see this code only after confirming they have read the instructions."
          error={accessCodeError}
        >
          {({ describedBy }) => (
            <input
              id={`${fieldId}-code`}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              pattern="[0-9]{4}"
              value={accessCode}
              onChange={(e) => {
                const next = e.target.value.replace(/\D/g, '').slice(0, 4);
                setAccessCode(next);
                if (accessCodeError) setAccessCodeError(null);
              }}
              aria-describedby={describedBy}
              aria-invalid={Boolean(accessCodeError)}
              className="app-input max-w-[10rem] font-mono text-lg tracking-widest"
            />
          )}
        </FormField>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="app-section-title">Page content</h2>
          <div className="flex flex-wrap items-center gap-2">
            <ContentFormatToggle
              value={contentType}
              onChange={(next) => {
                void handleContentFormatChange(next);
              }}
            />
            <Button type="button" variant="secondary" onClick={handleDraftPreview}>
              Preview
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Shown on the member Building access page above the button to reveal the code.
        </p>
        <div className="flex min-h-[360px] flex-col overflow-hidden rounded-lg border border-gray-300 dark:border-gray-600">
          {contentType === 'markdown' ? (
            <MarkdownDescriptionEditor
              key={`md-${editorRevision}`}
              ref={editorRef}
              initialValue={content}
              dark={resolvedTheme === 'dark'}
              fill
              includeHiddenContactRecipients
              enableManagedFileImageEdit
              onUploadImage={handleUploadMarkdownImage}
            />
          ) : (
            <HtmlCodeEditor
              key={`html-${editorRevision}`}
              ref={htmlEditorRef}
              initialValue={htmlContent || undefined}
              dark={resolvedTheme === 'dark'}
              fill
            />
          )}
        </div>
      </div>
    </form>
  );
}
