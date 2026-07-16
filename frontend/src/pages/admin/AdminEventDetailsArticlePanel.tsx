import { useCallback, useEffect, useId, useRef, useState } from 'react';
import api, { formatApiError } from '../../utils/api';
import { useAlert } from '../../contexts/AlertContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useTheme } from '../../contexts/ThemeContext';
import MarkdownDescriptionEditor, {
  type MarkdownDescriptionEditorRef,
  READ_MORE_MARKER,
} from '../../components/MarkdownDescriptionEditor';
import ContentFormatToggle, { type ContentFormat } from '../../components/ContentFormatToggle';
import HtmlCodeEditor, { type HtmlCodeEditorRef } from '../../components/HtmlCodeEditor';
import Button from '../../components/Button';
import FormCheckbox from '../../components/FormCheckbox';
import FormField from '../../components/FormField';
import Modal from '../../components/Modal';
import InlineStateMessage from '../../components/InlineStateMessage';
import { storeArticleDraftPreview } from '../../utils/articleDraftPreviewSession';
import {
  buildArticleHtmlContentFromMarkdown,
  isArticleHtmlContentEmpty,
} from '../../utils/articleHtmlContent';

type UploadedFile = { id: number; publicUrl: string };
type ArticleResponse = {
  id: number;
  title: string;
  slug: string;
  contentType?: 'markdown' | 'html';
  content: string;
  snippet: string | null;
  featured: boolean;
  publishedAt: string | null;
};
type ArticleVersion = {
  id: number;
  versionNumber: number;
  title: string;
  slug: string;
  contentType: 'markdown' | 'html';
  revisionNote: string | null;
  isSmallEdit: boolean;
  snippet: string | null;
  featured: boolean;
  publishedAt: string | null;
  savedByMemberId: number | null;
  savedByName: string | null;
  createdAt: string;
};

function getRevisionLabel(version: ArticleVersion): string {
  if (version.isSmallEdit) return `${version.savedByName ?? 'Someone'} made a small edit`;
  if (version.revisionNote?.trim()) return version.revisionNote.trim();
  return 'Saved revision';
}

function slugFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function extensionFromMimeType(mimeType: string): string {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/gif') return 'gif';
  if (mimeType === 'image/webp') return 'webp';
  return 'png';
}

function nextArticleImageFilename(articleSlug: string, markdown: string, mimeType: string): string {
  const safeSlug =
    (articleSlug || 'article')
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'article';
  const pattern = new RegExp(`${safeSlug}-image-(\\d{3})\\.[a-z0-9]+`, 'gi');
  let highest = 0;
  let match = pattern.exec(markdown);
  while (match) {
    const current = Number.parseInt(match[1] ?? '0', 10);
    if (Number.isFinite(current)) highest = Math.max(highest, current);
    match = pattern.exec(markdown);
  }
  const next = String(highest + 1).padStart(3, '0');
  return `${safeSlug}-image-${next}.${extensionFromMimeType(mimeType)}`;
}

export type AdminEventDetailsArticlePanelProps = {
  eventId: number;
  eventTitle: string;
  eventSlug: string;
  articleId: number | null;
  onArticleIdChange: (id: number | null) => void;
};

export default function AdminEventDetailsArticlePanel({
  eventId,
  eventTitle,
  eventSlug,
  articleId,
  onArticleIdChange,
}: AdminEventDetailsArticlePanelProps) {
  const fieldId = useId();
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const { resolvedTheme } = useTheme();
  const [loading, setLoading] = useState(articleId != null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [versions, setVersions] = useState<ArticleVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [restoringVersionId, setRestoringVersionId] = useState<number | null>(null);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveRevisionNote, setSaveRevisionNote] = useState('');
  const [saveSmallEdit, setSaveSmallEdit] = useState(false);
  const [form, setForm] = useState({
    title: '',
    contentType: 'markdown' as 'markdown' | 'html',
    content: '',
    htmlContent: '',
    snippet: '',
  });
  const editorRef = useRef<MarkdownDescriptionEditorRef>(null);
  const htmlEditorRef = useRef<HtmlCodeEditorRef>(null);
  const [editorRevision, setEditorRevision] = useState(0);
  const [hasReadMoreMarker, setHasReadMoreMarker] = useState(false);
  const savedSnapshotRef = useRef<string | null>(null);
  const hasCustomSnippet = form.snippet.trim().length > 0;

  const applyArticleToForm = useCallback((article: ArticleResponse) => {
    const contentType = article.contentType ?? 'markdown';
    let content = article.content ?? '';
    if (contentType === 'markdown') {
      content = content.replace(/<!--more-->/gi, READ_MORE_MARKER);
    }
    setForm({
      title: article.title,
      contentType,
      content: contentType === 'markdown' ? content : '',
      htmlContent: contentType === 'html' ? content : '',
      snippet: article.snippet ?? '',
    });
    setHasReadMoreMarker(content.includes(READ_MORE_MARKER));
    setEditorRevision((v) => v + 1);
    savedSnapshotRef.current = JSON.stringify({
      title: article.title,
      contentType,
      content,
      htmlContent: contentType === 'html' ? (article.content ?? '') : '',
      snippet: article.snippet ?? '',
    });
  }, []);

  const loadVersions = useCallback(
    async (id: number) => {
      setVersionsLoading(true);
      try {
        const res = await api.get<ArticleVersion[]>(`/content/articles/${id}/versions`);
        setVersions(res.data);
      } catch {
        showAlert('Failed to load version history', 'error');
      } finally {
        setVersionsLoading(false);
      }
    },
    [showAlert],
  );

  useEffect(() => {
    if (articleId != null) return;
    setLoading(false);
    setVersions([]);
    setForm({
      title: eventTitle,
      contentType: 'markdown',
      content: '',
      htmlContent: '',
      snippet: '',
    });
    setHasReadMoreMarker(false);
    setSaveRevisionNote('Initial version');
    setSaveSmallEdit(false);
    savedSnapshotRef.current = null;
  }, [articleId, eventTitle, eventSlug]);

  useEffect(() => {
    if (articleId == null) return;
    setLoading(true);
    Promise.all([
      api.get<ArticleResponse>(`/content/articles/${articleId}`),
      api.get<ArticleVersion[]>(`/content/articles/${articleId}/versions`),
    ])
      .then(([articleRes, versionsRes]) => {
        applyArticleToForm(articleRes.data);
        setVersions(versionsRes.data);
        setSaveRevisionNote('');
        setSaveSmallEdit(false);
      })
      .catch(() => showAlert('Failed to load event page content', 'error'))
      .finally(() => setLoading(false));
  }, [articleId, applyArticleToForm, showAlert]);

  const handleTitleChange = (title: string) => {
    setForm((f) => ({ ...f, title }));
  };

  const handleContentFormatChange = async (next: ContentFormat) => {
    if (next === form.contentType) return;

    if (next === 'markdown') {
      setForm((f) => ({
        ...f,
        contentType: 'markdown',
        htmlContent:
          form.contentType === 'html' && htmlEditorRef.current
            ? JSON.stringify(htmlEditorRef.current.getValue())
            : f.htmlContent,
      }));
      return;
    }

    const markdown = editorRef.current?.getMarkdown?.() ?? form.content;
    let htmlContent = form.htmlContent;
    if (isArticleHtmlContentEmpty(htmlContent) && markdown.trim()) {
      const shouldConvert = await confirm({
        title: 'Convert markdown to HTML?',
        message: 'Would you like to convert the existing markdown content to HTML?',
        confirmText: 'Yes, convert',
        cancelText: 'No',
        variant: 'info',
      });
      if (shouldConvert) {
        htmlContent = await buildArticleHtmlContentFromMarkdown(markdown);
      }
    }

    setForm((f) => ({
      ...f,
      contentType: 'html',
      content: markdown,
      htmlContent,
    }));
    setEditorRevision((v) => v + 1);
  };

  const getCurrentEditorContent = () =>
    form.contentType === 'markdown'
      ? (editorRef.current?.getMarkdown?.() ?? form.content)
      : JSON.stringify(htmlEditorRef.current?.getValue?.() ?? { html: '', css: '', js: '' });

  const handleDraftPreview = () => {
    const content = getCurrentEditorContent();
    const k = storeArticleDraftPreview({
      title: form.title,
      slug: eventSlug.trim() || slugFromName(form.title) || `event-${eventId}`,
      contentType: form.contentType,
      content,
      snippet: form.snippet.trim() || null,
    });
    if (!k) {
      showAlert('Could not open preview. Allow storage for this site or try again.', 'error');
      return;
    }
    const url = `/admin/content/articles/draft-preview?k=${encodeURIComponent(k)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleSave = async (options?: { settingsOnly?: boolean }) => {
    if (articleId == null) return;
    const settingsOnly = options?.settingsOnly === true;
    if (!settingsOnly && !form.title.trim()) {
      showAlert('Title is required', 'error');
      return;
    }
    const content = getCurrentEditorContent();
    if (!settingsOnly && !saveSmallEdit && !saveRevisionNote.trim()) {
      showAlert('Revision note is required unless this is a small edit', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = settingsOnly
        ? {
            snippet: form.snippet.trim() || null,
            publishedAt: null,
          }
        : {
            title: form.title.trim(),
            contentType: form.contentType,
            content,
            revisionNote: saveSmallEdit ? null : saveRevisionNote.trim() || null,
            smallEdit: saveSmallEdit,
            snippet: form.snippet.trim() || null,
            publishedAt: null,
          };
      await api.patch(`/content/articles/${articleId}`, payload);
      showAlert('Event page content updated', 'success');
      await loadVersions(articleId);
      savedSnapshotRef.current = JSON.stringify({
        title: form.title,
        contentType: form.contentType,
        content,
        htmlContent: form.htmlContent,
        snippet: form.snippet,
      });
      if (!settingsOnly) {
        setSaveRevisionNote('');
        setSaveSmallEdit(false);
        setSaveDialogOpen(false);
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      showAlert(msg || 'Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (articleId == null) return;
    const hasVersionRelevantChanges = (() => {
      if (!savedSnapshotRef.current) return true;
      try {
        const previous = JSON.parse(savedSnapshotRef.current) as {
          title?: string;
          contentType?: 'markdown' | 'html';
          content?: string;
        };
        const current = {
          title: form.title,
          contentType: form.contentType,
          content: getCurrentEditorContent(),
        };
        return (
          (previous.title ?? '') !== current.title ||
          (previous.contentType ?? 'markdown') !== current.contentType ||
          (previous.content ?? '') !== current.content
        );
      } catch {
        return true;
      }
    })();

    if (!hasVersionRelevantChanges) {
      setSaveRevisionNote('');
      setSaveSmallEdit(false);
      void handleSave({ settingsOnly: true });
      return;
    }
    setSaveDialogOpen(true);
  };

  const handleRestoreVersion = async (version: ArticleVersion) => {
    if (articleId == null) return;
    const revisionLabel = getRevisionLabel(version);
    const ok = await confirm({
      title: 'Restore version',
      message: `Restore "${revisionLabel}"? This will replace the current live version.`,
      variant: 'warning',
      confirmText: 'Restore',
    });
    if (!ok) return;

    setRestoringVersionId(version.id);
    try {
      const res = await api.post<ArticleResponse>(
        `/content/articles/${articleId}/versions/${version.id}/restore`,
      );
      applyArticleToForm(res.data);
      await loadVersions(articleId);
      setSaveRevisionNote('');
      setSaveSmallEdit(false);
      showAlert(`Restored "${revisionLabel}"`, 'success');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      showAlert(msg || 'Failed to restore version', 'error');
    } finally {
      setRestoringVersionId(null);
    }
  };

  const handleUploadMarkdownImage = async (
    blob: Blob,
  ): Promise<{ url: string; altText?: string } | null> => {
    const mimeType = blob.type || 'image/png';
    if (!mimeType.startsWith('image/')) {
      showAlert('Only image paste is supported', 'error');
      return null;
    }
    const currentMarkdown = editorRef.current?.getMarkdown?.() ?? form.content ?? '';
    const currentSlug =
      eventSlug.trim() || slugFromName(form.title.trim()) || `event-${eventId}` || 'article';
    const filename = nextArticleImageFilename(currentSlug, currentMarkdown, mimeType);
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
      return { url: uploaded.publicUrl, altText: form.title.trim() || 'Image' };
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      showAlert(msg || 'Failed to upload pasted image', 'error');
      return null;
    }
  };

  const postArticleWithSlug = async (trySlug: string) => {
    return api.post('/content/articles', {
      title: eventTitle.trim() || form.title.trim() || 'Event',
      slug: trySlug,
      contentType: 'markdown',
      content: '',
      revisionNote: 'Initial version',
      snippet: null,
      featured: false,
      publishedAt: null,
      eventId,
    });
  };

  const handleCreateArticle = async () => {
    setCreating(true);
    const baseSlug = (eventSlug.trim() || slugFromName(eventTitle) || slugFromName(form.title)).replace(
      /^-+|-+$/g,
      '',
    );
    const primarySlug = baseSlug || `event-${eventId}`;
    const slugCandidates = [
      primarySlug,
      `${primarySlug}-details`,
      `event-${eventId}`,
      `${primarySlug}-e${eventId}`,
    ];
    const trySlugs = [...new Set(slugCandidates.map((s) => s.replace(/^-+|-+$/g, '')).filter((s) => s.length > 0))];
    try {
      let lastErr: unknown;
      for (const trySlug of trySlugs) {
        try {
          const res = await postArticleWithSlug(trySlug);
          const newId = res.data?.id as number;
          if (!Number.isFinite(newId)) {
            showAlert('Created article but id was missing', 'error');
            return;
          }
          onArticleIdChange(newId);
          showAlert('Event page content created', 'success');
          return;
        } catch (err) {
          lastErr = err;
          const status = (err as { response?: { status?: number } })?.response?.status;
          if (status === 409) continue;
          showAlert(formatApiError(err, 'Failed to create event page content'), 'error');
          return;
        }
      }
      showAlert(formatApiError(lastErr, 'Failed to create event page content'), 'error');
    } finally {
      setCreating(false);
    }
  };

  if (articleId == null) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:p-6">
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
          Add rich text or HTML for the public event page. It appears on{' '}
          <span className="font-mono text-xs">
            /events/{eventSlug.trim() || '…'}
          </span>{' '}
          below the registration summary. Publish the event from the Settings tab when you are ready for it to go live.
        </p>
        <InlineStateMessage
          tone="neutral"
          title="No event page content yet"
          description="Create an article that is linked to this event. Editing works like a normal article, including version history."
        />
        <div className="mt-4">
          <Button type="button" onClick={() => void handleCreateArticle()} disabled={creating}>
            {creating ? 'Creating…' : 'Create event page content'}
          </Button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading event page content…</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800 overflow-hidden">
      <form
        id={`event-article-form-${eventId}`}
        onSubmit={handleSubmit}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          const popup = document.activeElement?.closest('.toastui-editor-popup');
          if (!popup) return;
          e.preventDefault();
          const okBtn = popup.querySelector('.toastui-editor-ok-button') as HTMLButtonElement | null;
          if (okBtn && !okBtn.disabled) okBtn.click();
        }}
        className="flex flex-col"
      >
        <div className="p-4 sm:p-6 max-h-[min(85vh,1200px)] flex flex-col min-h-[480px]">
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-4 shrink-0">
            Shown on <span className="font-mono text-xs">/events/{eventSlug.trim() || '…'}</span>. Visibility follows
            the event publish setting on the Settings tab.
          </p>
          <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-x-4 gap-y-3 lg:grid-rows-[auto_auto_minmax(0,1fr)]">
            <FormField label="Title" htmlFor={`${fieldId}-title`} className="shrink-0 lg:col-span-1">
              <input
                id={`${fieldId}-title`}
                type="text"
                value={form.title}
                onChange={(e) => handleTitleChange(e.target.value)}
                className="app-input"
                required
              />
            </FormField>

            <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2 lg:col-start-1 lg:row-start-2">
              <ContentFormatToggle
                value={form.contentType}
                onChange={(next) => {
                  void handleContentFormatChange(next);
                }}
              />
            </div>

            <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2 lg:col-start-2 lg:row-start-2">
              <Button type="button" variant="secondary" onClick={handleDraftPreview}>
                Preview
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </div>

            <div className="min-h-0 flex min-w-0 flex-col lg:col-start-1 lg:row-start-3">
              <div className="flex min-h-[360px] flex-1 flex-col overflow-hidden rounded-lg border border-gray-300 dark:border-gray-600">
                {form.contentType === 'markdown' ? (
                  <MarkdownDescriptionEditor
                    key={`md-${articleId}-${editorRevision}`}
                    ref={editorRef}
                    initialValue={form.content}
                    dark={resolvedTheme === 'dark'}
                    fill
                    readMoreInToolbar
                    readMoreDisabled={hasCustomSnippet}
                    onReadMoreMarkerChange={setHasReadMoreMarker}
                    includeHiddenContactRecipients
                    enableManagedFileImageEdit
                    onUploadImage={handleUploadMarkdownImage}
                  />
                ) : (
                  <HtmlCodeEditor
                    key={`html-${articleId}-${editorRevision}`}
                    ref={htmlEditorRef}
                    initialValue={form.htmlContent || undefined}
                    dark={resolvedTheme === 'dark'}
                    fill
                  />
                )}
              </div>
            </div>

            <aside className="h-fit min-h-0 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/40 lg:col-start-2 lg:row-start-3 lg:max-h-full lg:overflow-auto">
              <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">Page settings</h2>
              <div className="space-y-4">
                <FormField
                  label={
                    <>
                      Custom snippet ({form.contentType === 'markdown' ? 'Markdown' : 'plain text'}, optional)
                    </>
                  }
                  optional
                  htmlFor={`${fieldId}-snippet`}
                  state={hasReadMoreMarker ? 'disabled' : 'default'}
                  stateMessage={
                    hasReadMoreMarker
                      ? `Remove the read more marker (${READ_MORE_MARKER}) from the article to use a custom snippet.`
                      : undefined
                  }
                >
                  {({ describedBy }) => (
                    <textarea
                      id={`${fieldId}-snippet`}
                      value={form.snippet}
                      onChange={(e) => setForm((f) => ({ ...f, snippet: e.target.value }))}
                      rows={5}
                      placeholder="Overrides content above the read-more marker"
                      disabled={hasReadMoreMarker}
                      aria-describedby={describedBy}
                      className="app-input min-h-[7.5rem] text-sm"
                    />
                  )}
                </FormField>
                <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
                  <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2">Version history</h3>
                  {versionsLoading ? (
                    <p className="text-sm text-gray-500">Loading versions…</p>
                  ) : versions.length === 0 ? (
                    <p className="text-sm text-gray-500">No saved versions yet.</p>
                  ) : (
                    <ul className="space-y-2 max-h-64 overflow-auto pr-1">
                      {versions.map((version, index) => {
                        const isCurrentLive = index === 0;
                        return (
                          <li
                            key={version.id}
                            className="border border-gray-200 dark:border-gray-700 rounded p-2 bg-white dark:bg-gray-800"
                          >
                            <p className="text-xs font-medium">{getRevisionLabel(version)}</p>
                            <p className="text-xs text-gray-500 mt-1">
                              {new Date(version.createdAt).toLocaleString()}
                              {version.savedByName ? ` by ${version.savedByName}` : ''}
                            </p>
                            {isCurrentLive ? (
                              <p className="mt-2 text-xs text-gray-500">Current live version</p>
                            ) : !version.isSmallEdit ? (
                              <div className="mt-2 flex items-center gap-3 flex-wrap">
                                <a
                                  href={`/admin/content/articles/${articleId}/versions/${version.id}/preview`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs text-primary-teal hover:underline"
                                >
                                  Preview
                                </a>
                                <button
                                  type="button"
                                  onClick={() => void handleRestoreVersion(version)}
                                  disabled={restoringVersionId === version.id}
                                  className="text-xs text-primary-teal hover:underline disabled:opacity-50"
                                >
                                  {restoringVersionId === version.id ? 'Restoring…' : 'Restore this version'}
                                </button>
                              </div>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            </aside>
          </div>
        </div>
      </form>

      <Modal
        isOpen={saveDialogOpen}
        onClose={() => {
          if (saving) return;
          setSaveDialogOpen(false);
        }}
        title="Save event page content"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-300">Add a revision note for this save.</p>
          <FormCheckbox
            label="This is a small edit (e.g. typo fix)"
            checked={saveSmallEdit}
            onChange={(checked) => {
              setSaveSmallEdit(checked);
              if (checked) setSaveRevisionNote('');
            }}
          />
          <FormField label="Revision note" htmlFor={`${fieldId}-revision-note`}>
            <input
              id={`${fieldId}-revision-note`}
              type="text"
              value={saveRevisionNote}
              onChange={(e) => setSaveRevisionNote(e.target.value)}
              maxLength={500}
              disabled={saveSmallEdit}
              placeholder={
                saveSmallEdit ? 'Disabled for small edits' : 'e.g. Updated schedule description and links'
              }
              className="app-input text-sm disabled:opacity-60"
            />
          </FormField>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setSaveDialogOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || (!saveSmallEdit && !saveRevisionNote.trim())}
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
