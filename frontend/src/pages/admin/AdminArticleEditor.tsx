import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useBeforeUnload, useNavigate, useParams } from 'react-router-dom';
import { marked } from 'marked';
import Layout from '../../components/Layout';
import api from '../../utils/api';
import { useAlert } from '../../contexts/AlertContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useTheme } from '../../contexts/ThemeContext';
import MarkdownDescriptionEditor, {
  type MarkdownDescriptionEditorRef,
  READ_MORE_MARKER,
} from '../../components/MarkdownDescriptionEditor';
import BackButton from '../../components/BackButton';
import HtmlCodeEditor, { type HtmlCodeEditorRef } from '../../components/HtmlCodeEditor';
import Button from '../../components/Button';
import FormCheckbox from '../../components/FormCheckbox';
import FormField from '../../components/FormField';
import Modal from '../../components/Modal';
import { storeArticleDraftPreview } from '../../utils/articleDraftPreviewSession';
import { htmlReplaceYoutubeMarkdownImagesWithEmbeds } from '../../utils/youtubeMarkdown';

type UploadedFile = { id: number; publicUrl: string };
type ArticleResponse = {
  id: number;
  title: string;
  slug: string;
  contentType?: 'markdown' | 'html';
  content: string;
  snippet: string | null;
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

/** Convert UTC ISO string to local YYYY-MM-DDTHH:mm for datetime-local input. */
function isoToDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function AdminArticleEditor() {
  const articleFieldId = useId();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const { resolvedTheme } = useTheme();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [versions, setVersions] = useState<ArticleVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [restoringVersionId, setRestoringVersionId] = useState<number | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveRevisionNote, setSaveRevisionNote] = useState('');
  const [saveSmallEdit, setSaveSmallEdit] = useState(false);
  const [form, setForm] = useState({
    title: '',
    slug: '',
    contentType: 'markdown' as 'markdown' | 'html',
    content: '',
    htmlContent: '',
    snippet: '',
    publishedAt: '',
  });
  const editorRef = useRef<MarkdownDescriptionEditorRef>(null);
  const htmlEditorRef = useRef<HtmlCodeEditorRef>(null);
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [editorRevision, setEditorRevision] = useState(0);
  const savedSnapshotRef = useRef<string | null>(null);

  const isNew = id === 'new';

  const applyArticleToForm = useCallback((article: ArticleResponse) => {
    const contentType = article.contentType ?? 'markdown';
    let content = article.content ?? '';
    if (contentType === 'markdown') {
      content = content.replace(/<!--more-->/gi, READ_MORE_MARKER); // migrate old marker
    }
    setForm({
      title: article.title,
      slug: article.slug,
      contentType,
      content: contentType === 'markdown' ? content : '',
      htmlContent: contentType === 'html' ? content : '',
      snippet: article.snippet ?? '',
      publishedAt: article.publishedAt ? isoToDatetimeLocal(article.publishedAt) : '',
    });
    setEditorRevision((v) => v + 1);
    savedSnapshotRef.current = JSON.stringify({
      title: article.title,
      slug: article.slug,
      contentType,
      content,
      htmlContent: contentType === 'html' ? (article.content ?? '') : '',
      snippet: article.snippet ?? '',
      publishedAt: article.publishedAt ? isoToDatetimeLocal(article.publishedAt) : '',
    });
  }, []);

  const loadVersions = useCallback(
    async (articleId: number) => {
      setVersionsLoading(true);
      try {
        const res = await api.get<ArticleVersion[]>(`/content/articles/${articleId}/versions`);
        setVersions(res.data);
      } catch {
        showAlert('Failed to load version history', 'error');
      } finally {
        setVersionsLoading(false);
      }
    },
    [showAlert]
  );

  useEffect(() => {
    if (isNew) {
      setForm({
        title: '',
        slug: '',
        contentType: 'markdown',
        content: '',
        htmlContent: '',
        snippet: '',
        publishedAt: '',
      });
      setSlugManuallyEdited(false);
      setSaveRevisionNote('Initial version');
      setSaveSmallEdit(false);
      setVersions([]);
      setLoading(false);
      savedSnapshotRef.current = JSON.stringify({
        title: '',
        slug: '',
        contentType: 'markdown',
        content: '',
        htmlContent: '',
        snippet: '',
        publishedAt: '',
      });
      return;
    }
    const numId = parseInt(id!, 10);
    if (isNaN(numId)) {
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.all([
      api.get<ArticleResponse>(`/content/articles/${numId}`),
      api.get<ArticleVersion[]>(`/content/articles/${numId}/versions`),
    ])
      .then(([articleRes, versionsRes]) => {
        applyArticleToForm(articleRes.data);
        setVersions(versionsRes.data);
        setSaveRevisionNote('');
        setSaveSmallEdit(false);
      })
      .catch(() => showAlert('Failed to load article', 'error'))
      .finally(() => setLoading(false));
  }, [applyArticleToForm, id, isNew, showAlert]);

  const handleTitleChange = (title: string) => {
    setForm((f) => {
      const newSlug = isNew && !slugManuallyEdited ? slugFromName(title) : f.slug;
      return { ...f, title, slug: newSlug };
    });
  };

  const handleConvertToHtml = async () => {
    const ok = await confirm({
      title: 'Convert Markdown to HTML',
      message:
        'This will convert your Markdown content to HTML and switch to HTML/CSS/JS mode. Any existing HTML, CSS, or JavaScript will be overwritten. Continue?',
      variant: 'warning',
      confirmText: 'Convert',
    });
    if (!ok) return;
    const markdown = editorRef.current?.getMarkdown?.() ?? form.content;
    let html = (await marked.parse(markdown)) as string;
    html = htmlReplaceYoutubeMarkdownImagesWithEmbeds(html);
    const defaultCss = `/* Basic typography - edit as needed */
.content { max-width: 42rem; margin: 0 auto; }
h1 { font-size: 1.5rem; font-weight: 700; margin: 1em 0 0.5em; }
h2 { font-size: 1.25rem; font-weight: 600; margin: 1em 0 0.5em; }
h3 { font-size: 1.125rem; font-weight: 600; margin: 0.75em 0 0.5em; }
p { line-height: 1.6; margin: 0.5em 0; }
ul, ol { margin: 0.5em 0; padding-left: 1.5rem; }
ul { list-style-type: disc; }
ol { list-style-type: decimal; }
a { color: #0d9488; text-decoration: underline; }
table { border-collapse: collapse; width: 100%; margin: 1em 0; }
th, td { border: 1px solid #d1d5db; padding: 0.5rem 1rem; text-align: left; }
th { font-weight: 600; background: #f3f4f6; }
.markdown-youtube-embed { display: block; width: 100%; max-width: 560px; margin: 1rem 0; min-width: 0; }
.markdown-youtube-inner { position: relative; width: 100%; height: 0; padding-bottom: 56.25%; overflow: hidden; border-radius: 0.5rem; background: #111827; }
.markdown-youtube-inner iframe { position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: 0; }
`;
    setForm((f) => ({
      ...f,
      contentType: 'html',
      content: markdown,
      htmlContent: JSON.stringify({
        html: `<div class="content">\n${html}\n</div>`,
        css: defaultCss,
        js: '// Optional JavaScript\n',
      }),
    }));
  };

  const getCurrentEditorContent = () =>
    form.contentType === 'markdown'
      ? (editorRef.current?.getMarkdown?.() ?? form.content)
      : JSON.stringify(htmlEditorRef.current?.getValue?.() ?? { html: '', css: '', js: '' });

  const handleDraftPreview = () => {
    const content = getCurrentEditorContent();
    const k = storeArticleDraftPreview({
      title: form.title,
      slug: form.slug,
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

  const hasUnsavedChanges = useCallback(() => {
    if (savedSnapshotRef.current === null) return false;
    const currentSnapshot = JSON.stringify({
      title: form.title,
      slug: form.slug,
      contentType: form.contentType,
      content: getCurrentEditorContent(),
      htmlContent: form.htmlContent,
      snippet: form.snippet,
      publishedAt: form.publishedAt,
    });
    return currentSnapshot !== savedSnapshotRef.current;
  }, [form]);

  /** Toast UI can normalize markdown vs the API snapshot; align baseline once the editor is ready. */
  const reconcileMarkdownBaselineFromEditor = useCallback(() => {
    if (form.contentType !== 'markdown' || savedSnapshotRef.current === null) return;
    try {
      const parsed = JSON.parse(savedSnapshotRef.current) as Record<string, unknown>;
      const md = editorRef.current?.getMarkdown?.();
      if (md === undefined) return;
      parsed.content = md;
      savedSnapshotRef.current = JSON.stringify(parsed);
      setIsDirty(false);
    } catch {
      /* ignore */
    }
  }, [form.contentType]);

  const hasVersionRelevantChanges = useCallback(() => {
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
  }, [form.contentType, form.title, form.content]);

  const confirmDiscardChanges = useCallback(async () => {
    if (!hasUnsavedChanges()) return true;
    return confirm({
      title: 'Discard unsaved changes?',
      message: 'You have unsaved changes. Leave this page and discard them?',
      confirmText: 'Discard changes',
      cancelText: 'Keep editing',
      variant: 'warning',
    });
  }, [confirm, hasUnsavedChanges]);

  useEffect(() => {
    const syncDirty = () => setIsDirty(hasUnsavedChanges());
    syncDirty();
    const interval = window.setInterval(syncDirty, 500);
    return () => window.clearInterval(interval);
  }, [hasUnsavedChanges]);

  const handleSave = async (options?: { settingsOnly?: boolean }) => {
    const settingsOnly = options?.settingsOnly === true;
    if (!settingsOnly && (!form.title.trim() || !form.slug.trim())) {
      showAlert('Title and slug are required', 'error');
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
            slug: form.slug.trim(),
            snippet: form.snippet.trim() || null,
            publishedAt: form.publishedAt ? new Date(form.publishedAt).toISOString() : null,
          }
        : {
            title: form.title.trim(),
            slug: form.slug.trim(),
            contentType: form.contentType,
            content,
            revisionNote: saveSmallEdit ? null : saveRevisionNote.trim() || null,
            smallEdit: !isNew && saveSmallEdit,
            snippet: form.snippet.trim() || null,
            publishedAt: form.publishedAt ? new Date(form.publishedAt).toISOString() : null,
          };
      if (isNew) {
        const res = await api.post('/content/articles', payload);
        showAlert('Article created', 'success');
        navigate(`/admin/content/articles/${res.data.id}`, { replace: true });
      } else {
        await api.patch(`/content/articles/${id}`, payload);
        showAlert('Article updated', 'success');
        const articleId = Number.parseInt(id!, 10);
        if (Number.isFinite(articleId)) {
          await loadVersions(articleId);
        }
      }
      savedSnapshotRef.current = JSON.stringify({
        title: form.title,
        slug: form.slug,
        contentType: form.contentType,
        content,
        htmlContent: form.htmlContent,
        snippet: form.snippet,
        publishedAt: form.publishedAt,
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
    if (isNew && !saveRevisionNote.trim()) {
      setSaveRevisionNote('Initial version');
    }
    if (isNew) {
      setSaveSmallEdit(false);
      setSaveDialogOpen(true);
      return;
    }
    if (!hasVersionRelevantChanges()) {
      setSaveRevisionNote('');
      setSaveSmallEdit(false);
      void handleSave({ settingsOnly: true });
      return;
    }
    setSaveDialogOpen(true);
  };

  const handleBackToContent = async () => {
    if (!(await confirmDiscardChanges())) return;
    navigate('/admin/content/articles');
  };

  const handleRestoreVersion = async (version: ArticleVersion) => {
    if (isNew || !id) return;
    const articleId = Number.parseInt(id, 10);
    if (!Number.isFinite(articleId)) return;
    if (!(await confirmDiscardChanges())) return;
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
        `/content/articles/${articleId}/versions/${version.id}/restore`
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

  useBeforeUnload(
    useCallback(
      (event) => {
        if (!hasUnsavedChanges()) return;
        event.preventDefault();
        event.returnValue = '';
      },
      [hasUnsavedChanges]
    )
  );

  useEffect(() => {
    if (!isDirty) return;
    const handleDocumentClick = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;
      const target = event.target as Element | null;
      const anchor = target?.closest('a[href]') as HTMLAnchorElement | null;
      if (!anchor) return;
      if (anchor.target && anchor.target !== '_self') return;
      if (anchor.hasAttribute('download')) return;
      const rawHref = anchor.getAttribute('href');
      if (
        !rawHref ||
        rawHref.startsWith('#') ||
        rawHref.startsWith('mailto:') ||
        rawHref.startsWith('tel:')
      )
        return;
      const destination = new URL(anchor.href, window.location.href);
      const current = new URL(window.location.href);
      if (destination.origin !== current.origin) return;
      if (
        destination.pathname === current.pathname &&
        destination.search === current.search &&
        destination.hash === current.hash
      ) {
        return;
      }
      event.preventDefault();
      void (async () => {
        const shouldLeave = await confirmDiscardChanges();
        if (!shouldLeave) return;
        navigate(`${destination.pathname}${destination.search}${destination.hash}`);
      })();
    };
    document.addEventListener('click', handleDocumentClick, true);
    return () => document.removeEventListener('click', handleDocumentClick, true);
  }, [confirmDiscardChanges, isDirty, navigate]);

  const handleUploadMarkdownImage = async (
    blob: Blob
  ): Promise<{ url: string; altText?: string } | null> => {
    const mimeType = blob.type || 'image/png';
    if (!mimeType.startsWith('image/')) {
      showAlert('Only image paste is supported', 'error');
      return null;
    }
    const currentMarkdown = editorRef.current?.getMarkdown?.() ?? form.content ?? '';
    const currentSlug = form.slug.trim() || slugFromName(form.title.trim()) || 'article';
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

  if (loading) {
    return (
      <Layout fullWidth>
        <div className="p-6">
          <div className="text-gray-500">Loading...</div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout fullWidth>
      <div className="h-[calc(100vh-4rem)] flex flex-col">
        <div className="flex-shrink-0">
          <div className="max-w-[1600px] mx-auto px-4 pt-4 pb-2 flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <label htmlFor={`${articleFieldId}-title`} className="sr-only">
                Title (required)
              </label>
              <input
                id={`${articleFieldId}-title`}
                form="article-form"
                type="text"
                value={form.title}
                onChange={(e) => handleTitleChange(e.target.value)}
                placeholder={isNew ? 'New article' : 'Article title'}
                required
                className="w-full min-w-0 rounded-md border border-transparent bg-transparent px-1 py-1 -mx-1 text-xl font-semibold text-gray-900 placeholder:text-gray-400 outline-none hover:border-gray-200 dark:text-gray-100 dark:placeholder:text-gray-500 dark:hover:border-gray-600 focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-primary-teal/40"
              />
            </div>
            <BackButton label="Content" onClick={handleBackToContent} className="shrink-0" />
          </div>
        </div>

        <form
          id="article-form"
          onSubmit={handleSubmit}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            const popup = document.activeElement?.closest('.toastui-editor-popup');
            if (!popup) return;
            e.preventDefault();
            const okBtn = popup.querySelector(
              '.toastui-editor-ok-button'
            ) as HTMLButtonElement | null;
            if (okBtn && !okBtn.disabled) okBtn.click();
          }}
          className="flex-1 min-h-0 flex flex-col overflow-hidden"
        >
          <div className="flex-1 min-h-0 max-w-[1600px] mx-auto w-full px-4 py-4">
            <div className="h-full grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-4">
              <div className="min-h-0 flex flex-col">
                <div
                  role="group"
                  aria-labelledby={`${articleFieldId}-content-label`}
                  className="flex min-h-0 min-w-0 flex-1 flex-col"
                >
                  <div className="mb-2 flex flex-shrink-0 items-center justify-between">
                    <span id={`${articleFieldId}-content-label`} className="app-label mb-0">
                      Content
                    </span>
                    <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          contentType: 'markdown',
                          htmlContent:
                            form.contentType === 'html' && htmlEditorRef.current
                              ? JSON.stringify(htmlEditorRef.current.getValue())
                              : f.htmlContent,
                        }))
                      }
                      className={`px-3 py-1 text-sm rounded ${
                        form.contentType === 'markdown'
                          ? 'bg-primary-teal text-white'
                          : 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-500'
                      }`}
                    >
                      Markdown
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          contentType: 'html',
                          content:
                            form.contentType === 'markdown'
                              ? (editorRef.current?.getMarkdown?.() ?? f.content)
                              : f.content,
                        }))
                      }
                      className={`px-3 py-1 text-sm rounded ${
                        form.contentType === 'html'
                          ? 'bg-primary-teal text-white'
                          : 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-500'
                      }`}
                    >
                      HTML/CSS/JS
                    </button>
                    {form.contentType === 'markdown' && (
                      <button
                        type="button"
                        onClick={handleConvertToHtml}
                        className="px-3 py-1 text-sm rounded bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 hover:bg-amber-200 dark:hover:bg-amber-900/50"
                      >
                        Convert to HTML
                      </button>
                    )}
                  </div>
                  </div>

                <div className="flex min-h-[460px] flex-1 flex-col overflow-hidden rounded-lg border border-gray-300 dark:border-gray-600">
                  {form.contentType === 'markdown' ? (
                    <MarkdownDescriptionEditor
                      key={`md-${id ?? 'new'}-${editorRevision}`}
                      ref={editorRef}
                      initialValue={form.content}
                      dark={resolvedTheme === 'dark'}
                      fill
                      readMoreInToolbar
                      enableManagedFileImageEdit
                      onUploadImage={handleUploadMarkdownImage}
                      onWysiwygReady={reconcileMarkdownBaselineFromEditor}
                    />
                  ) : (
                    <HtmlCodeEditor
                      key={`html-${id ?? 'new'}-${editorRevision}`}
                      ref={htmlEditorRef}
                      initialValue={form.htmlContent || undefined}
                      dark={resolvedTheme === 'dark'}
                      fill
                    />
                  )}
                </div>

                <div className="mt-3 flex flex-shrink-0 justify-end gap-2">
                  <Button type="button" variant="secondary" onClick={handleDraftPreview}>
                    Preview
                  </Button>
                  <Button type="submit" disabled={saving}>
                    {saving ? 'Saving...' : 'Save article'}
                  </Button>
                </div>
                </div>
              </div>

              <aside className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-gray-900 h-fit lg:max-h-full lg:overflow-auto">
                <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">
                  Settings
                </h2>
                <div className="space-y-4">
                  <FormField label="Slug (URL)" htmlFor={`${articleFieldId}-slug`}>
                    <input
                      id={`${articleFieldId}-slug`}
                      type="text"
                      value={form.slug}
                      onChange={(e) => {
                        setSlugManuallyEdited(true);
                        setForm((f) => ({ ...f, slug: e.target.value }));
                      }}
                      className="app-input font-mono text-sm"
                      pattern="[-a-z0-9]+"
                      required
                    />
                  </FormField>
                  <FormField label="Publish date (empty = draft)" htmlFor={`${articleFieldId}-published`}>
                    <input
                      id={`${articleFieldId}-published`}
                      type="datetime-local"
                      value={form.publishedAt}
                      onChange={(e) => setForm((f) => ({ ...f, publishedAt: e.target.value }))}
                      className="app-input"
                    />
                  </FormField>
                  <FormField
                    label={
                      <>
                        Custom snippet ({form.contentType === 'markdown' ? 'Markdown' : 'plain text'},
                        optional)
                      </>
                    }
                    optional
                    htmlFor={`${articleFieldId}-snippet`}
                  >
                    <textarea
                      id={`${articleFieldId}-snippet`}
                      value={form.snippet}
                      onChange={(e) => setForm((f) => ({ ...f, snippet: e.target.value }))}
                      rows={5}
                      placeholder="Overrides content above the read-more marker"
                      className="app-input min-h-[7.5rem] text-sm"
                    />
                  </FormField>
                  {!isNew && (
                    <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
                      <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2">
                        Version history
                      </h3>
                      {versionsLoading ? (
                        <p className="text-sm text-gray-500">Loading versions...</p>
                      ) : versions.length === 0 ? (
                        <p className="text-sm text-gray-500">No saved versions yet.</p>
                      ) : (
                        <ul className="space-y-2 max-h-96 overflow-auto pr-1">
                          {versions.map((version, index) => {
                            const isCurrentLive = index === 0;
                            return (
                              <li
                                key={version.id}
                                className="border border-gray-200 dark:border-gray-700 rounded p-2"
                              >
                                <p className="text-xs font-medium">{getRevisionLabel(version)}</p>
                                <p className="text-xs text-gray-500 mt-1">
                                  {new Date(version.createdAt).toLocaleString()}
                                  {version.savedByName ? ` by ${version.savedByName}` : ''}
                                </p>
                                {isCurrentLive ? (
                                  <p className="mt-2 text-xs text-gray-500">Current live version</p>
                                ) : !version.isSmallEdit ? (
                                  <div className="mt-2 flex items-center gap-3">
                                    <a
                                      href={`/admin/content/articles/${id}/versions/${version.id}/preview`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-xs text-primary-teal hover:underline"
                                    >
                                      Preview
                                    </a>
                                    <button
                                      type="button"
                                      onClick={() => handleRestoreVersion(version)}
                                      disabled={restoringVersionId === version.id}
                                      className="text-xs text-primary-teal hover:underline disabled:opacity-50"
                                    >
                                      {restoringVersionId === version.id
                                        ? 'Restoring...'
                                        : 'Restore this version'}
                                    </button>
                                  </div>
                                ) : null}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  )}
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
          title="Save article"
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Add a revision note for this save.
            </p>
            {!isNew && (
              <FormCheckbox
                label="This is a small edit (e.g. typo fix)"
                checked={saveSmallEdit}
                onChange={(checked) => {
                  setSaveSmallEdit(checked);
                  if (checked) setSaveRevisionNote('');
                }}
              />
            )}
            <FormField label="Revision note" htmlFor={`${articleFieldId}-revision-note`}>
              <input
                id={`${articleFieldId}-revision-note`}
                type="text"
                value={saveRevisionNote}
                onChange={(e) => setSaveRevisionNote(e.target.value)}
                maxLength={500}
                disabled={saveSmallEdit}
                placeholder={
                  saveSmallEdit
                    ? 'Disabled for small edits'
                    : 'e.g. Updated homepage links and dates'
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
                {saving ? 'Saving...' : 'Save article'}
              </Button>
            </div>
          </div>
        </Modal>
      </div>
    </Layout>
  );
}
