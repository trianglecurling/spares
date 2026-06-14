import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { HiChevronDown, HiChevronRight, HiClipboardDocument, HiPencilSquare, HiTrash } from 'react-icons/hi2';
import AppPageControlsRow from '../../components/AppPageControlsRow';
import AppStateCard from '../../components/AppStateCard';
import Layout from '../../components/Layout';
import api from '../../utils/api';
import { useAlert } from '../../contexts/AlertContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import Button from '../../components/Button';
import DragHandle from '../../components/dragDrop/DragHandle';
import SortableList from '../../components/dragDrop/SortableList';
import SortableRow from '../../components/dragDrop/SortableRow';
import SortableTree from '../../components/dragDrop/SortableTree';
import ContentFileEditModal, { type ManagedFile } from '../../components/ContentFileEditModal';
import Modal from '../../components/Modal';
import PageTabs from '../../components/PageTabs';
import ArticleAutocomplete, { type ArticleOption } from '../../components/ArticleAutocomplete';
import DataTable from '../../components/table/DataTable';
import type { DataTableColumn } from '../../components/table/tableTypes';
import useTableQueryState from '../../hooks/useTableQueryState';
import FormCheckbox from '../../components/FormCheckbox';
import FormField from '../../components/FormField';
import FormSection from '../../components/FormSection';
import ChoiceInput, { type ChoiceOption } from '../../components/ChoiceInput';
import AdminContentPermalinksPanel, { type PermalinkAdminRow } from './AdminContentPermalinksPanel';

type Tab = 'site' | 'home' | 'articles' | 'showcase' | 'menus' | 'files' | 'permalinks';
type MenuItem = {
  id: number;
  menuType: string;
  parentId: number | null;
  label: string;
  sortOrder: number;
  linkType: 'internal' | 'external' | null;
  url: string | null;
  openInNewTab: boolean;
  articleId: number | null;
  useArticleTitleForLabel: boolean;
};
type Article = {
  id: number;
  title: string;
  slug: string;
  snippet: string | null;
  featured: boolean;
  featuredSortOrder?: number;
  publishedAt: string | null;
  createdAt?: string;
  updatedAt?: string;
};
type ArticlesListResponse = {
  items: Article[];
  total: number;
  page: number;
  pageSize: number;
};
type ShowcaseImage = { id: number; url: string; caption: string | null; sortOrder: number };

type FilesListResponse = {
  items: ManagedFile[];
  total: number;
  page: number;
  pageSize: number;
};

type ArticleSortKey = 'updatedAt' | 'title' | 'slug' | 'publishedAt' | 'createdAt';
type FileSortKey = 'createdAt' | 'name' | 'size' | 'type' | 'updatedAt';
type FileOrphanFilter = 'all' | 'suspected';
type FileVisibilityFilter = 'all' | 'public' | 'authenticated';
type FileTypeFilter = 'all' | 'image' | 'video' | 'audio' | 'document' | 'other';

type MenuLinkTypeChoice = 'none' | 'internal' | 'external';

const MENU_LINK_TYPE_CHOICES: ChoiceOption<MenuLinkTypeChoice>[] = [
  { value: 'none', label: '— None (dropdown parent only) —' },
  { value: 'internal', label: 'Article' },
  { value: 'external', label: 'Other (custom URL)' },
];

const FILE_ORPHAN_FILTER_OPTIONS: ChoiceOption<FileOrphanFilter>[] = [
  { value: 'all', label: 'All files' },
  { value: 'suspected', label: 'Suspected orphan' },
];

const FILE_VISIBILITY_FILTER_OPTIONS: ChoiceOption<FileVisibilityFilter>[] = [
  { value: 'all', label: 'All' },
  { value: 'public', label: 'Public' },
  { value: 'authenticated', label: 'Authenticated' },
];

const FILE_TYPE_FILTER_OPTIONS: ChoiceOption<FileTypeFilter>[] = [
  { value: 'all', label: 'All' },
  { value: 'image', label: 'Image' },
  { value: 'video', label: 'Video' },
  { value: 'audio', label: 'Audio' },
  { value: 'document', label: 'Document' },
  { value: 'other', label: 'Other' },
];

const FILE_VISIBILITY_STRICT_OPTIONS: ChoiceOption<'public' | 'authenticated'>[] = [
  { value: 'public', label: 'Public' },
  { value: 'authenticated', label: 'Logged-in users only' },
];

function buildMenuParentChoiceOptions(
  menuItems: MenuItem[],
  editingMenuItem: MenuItem | null
): ChoiceOption<number>[] {
  const byParent = new Map<number | null, MenuItem[]>();
  for (const m of menuItems) {
    const pid = m.parentId ?? null;
    if (!byParent.has(pid)) byParent.set(pid, []);
    byParent.get(pid)!.push(m);
  }
  for (const [, items] of byParent) {
    items.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  }
  const excludeIds = new Set<number>();
  if (editingMenuItem) {
    excludeIds.add(editingMenuItem.id);
    const collectDescendants = (id: number) => {
      for (const c of byParent.get(id) ?? []) {
        excludeIds.add(c.id);
        collectDescendants(c.id);
      }
    };
    collectDescendants(editingMenuItem.id);
  }
  const flatten = (parentId: number | null, depth: number): ChoiceOption<number>[] => {
    const items = byParent.get(parentId) ?? [];
    const result: ChoiceOption<number>[] = [];
    for (const m of items) {
      if (excludeIds.has(m.id)) continue;
      const prefix = depth > 0 ? '\u00A0\u00A0'.repeat(depth) + '- ' : '';
      result.push({ value: m.id, label: `${prefix}${m.label}` });
      result.push(...flatten(m.id, depth + 1));
    }
    return result;
  };
  return flatten(null, 0);
}

const ARTICLES_PAGE_SIZE = 25;
const ARTICLE_SORT_KEYS = ['updatedAt', 'title', 'slug', 'publishedAt', 'createdAt'] as const;
const FILES_PAGE_SIZE = 25;
const FILE_SORT_KEYS = ['createdAt', 'name', 'size', 'type', 'updatedAt'] as const;
const FILE_ORPHAN_VALUES = ['all', 'suspected'] as const;
const FILE_VISIBILITY_VALUES = ['all', 'public', 'authenticated'] as const;
const FILE_TYPE_VALUES = ['all', 'image', 'video', 'audio', 'document', 'other'] as const;

function parseEnumValue<Value extends string>(
  raw: string | null,
  values: readonly Value[],
  fallback: Value
): Value {
  return raw && values.includes(raw as Value) ? (raw as Value) : fallback;
}

function sortByOrder<T extends { sortOrder: number; id: number }>(a: T, b: T) {
  return a.sortOrder - b.sortOrder || a.id - b.id;
}

function extractReferencedFileIds(content: string): number[] {
  const ids = new Set<number>();
  const pattern = /(?:\/api)?\/public\/files\/(\d+)(?:\/[^\s)"']*)?/gi;
  let match = pattern.exec(content);
  while (match) {
    const id = Number.parseInt(match[1] ?? '', 10);
    if (Number.isFinite(id) && id > 0) ids.add(id);
    match = pattern.exec(content);
  }
  return Array.from(ids.values());
}

const VALID_TABS: Tab[] = ['site', 'home', 'menus', 'articles', 'showcase', 'files', 'permalinks'];

/** ISO timestamp -> value for a `datetime-local` input in the admin's local time zone. */
function isoToLocalDateTimeInput(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function localDateTimeInputToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export default function AdminContent() {
  const { tab: tabParam } = useParams<{ tab: string }>();
  const navigate = useNavigate();
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const activeTab: Tab =
    tabParam && VALID_TABS.includes(tabParam as Tab) ? (tabParam as Tab) : 'site';
  const [siteConfig, setSiteConfig] = useState<{
    clubName: string | null;
    logoUrl: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    footerMarkdown: string | null;
    heroBadge: string | null;
    heroTitle: string | null;
    heroSubtitle: string | null;
    announcementMarkdown: string | null;
    announcementExpiresAt: string | null;
  } | null>(null);
  const [articles, setArticles] = useState<Article[]>([]);
  const [featuredHomeArticles, setFeaturedHomeArticles] = useState<Article[]>([]);
  /** Resolved from lookup selection; do not derive from `menuArticleOptions` (articles list is capped server-side). */
  const [pendingFeaturedArticle, setPendingFeaturedArticle] = useState<ArticleOption | null>(null);
  const [menuArticleOptions, setMenuArticleOptions] = useState<Article[]>([]);
  const [articleTotal, setArticleTotal] = useState(0);
  const [articlesLoaded, setArticlesLoaded] = useState(false);
  const [articleLoading, setArticleLoading] = useState(false);
  const [articleError, setArticleError] = useState<string | null>(null);
  const [showcaseImages, setShowcaseImages] = useState<ShowcaseImage[]>([]);
  const [showcaseSelectableFiles, setShowcaseSelectableFiles] = useState<ManagedFile[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [files, setFiles] = useState<ManagedFile[]>([]);
  const [permalinks, setPermalinks] = useState<PermalinkAdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);

  // Showcase modal
  const [showcaseModalOpen, setShowcaseModalOpen] = useState(false);
  const [editingShowcase, setEditingShowcase] = useState<ShowcaseImage | null>(null);
  const [showcaseForm, setShowcaseForm] = useState({ url: '', caption: '', sortOrder: 0 });
  const [showcaseSourceMode, setShowcaseSourceMode] = useState<'uploaded' | 'url'>('uploaded');
  const [selectedShowcaseFileId, setSelectedShowcaseFileId] = useState<number | null>(null);

  // Menu modal
  const [menuModalOpen, setMenuModalOpen] = useState(false);
  const [editingMenuItem, setEditingMenuItem] = useState<MenuItem | null>(null);
  const [menuForm, setMenuForm] = useState({
    label: '',
    parentId: null as number | null,
    linkType: null as 'internal' | 'external' | null,
    url: '',
    openInNewTab: false,
    selectedArticleId: null as number | null,
    selectedArticleTitle: '',
    selectedArticleSlug: '',
    labelOverridden: false,
  });
  const [menuInsertBeforeId, setMenuInsertBeforeId] = useState<number | null>(null);

  const [menuExpandedIds, setMenuExpandedIds] = useState<Set<number>>(new Set());
  const loadDataRequestIdRef = useRef(0);

  /** Stable id prefix for FormField htmlFor / control ids across this page */
  const formFieldId = useId();

  // Files
  const [selectedUploadFiles, setSelectedUploadFiles] = useState<File[]>([]);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [fileUploadForm, setFileUploadForm] = useState({
    displayName: '',
    description: '',
    visibility: 'public' as 'public' | 'authenticated',
  });
  const [fileTotal, setFileTotal] = useState(0);
  const [selectedFileIds, setSelectedFileIds] = useState<number[]>([]);
  const [filesLoaded, setFilesLoaded] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [fileModalOpen, setFileModalOpen] = useState(false);
  const [fileModalTarget, setFileModalTarget] = useState<ManagedFile | null>(null);
  const [imagePreviewVersion, setImagePreviewVersion] = useState(0);
  const uploadedPublicImages = showcaseSelectableFiles.filter((file) => file.visibility === 'public' && file.mimeType.startsWith('image/'));
  const fileFilterConfig = useMemo(
    () => ({
      orphanStatus: {
        queryKey: 'orphan',
        defaultValue: 'all' as FileOrphanFilter,
        parse: (raw: string | null) => parseEnumValue(raw, FILE_ORPHAN_VALUES, 'all'),
      },
      visibility: {
        queryKey: 'visibility',
        defaultValue: 'all' as FileVisibilityFilter,
        parse: (raw: string | null) => parseEnumValue(raw, FILE_VISIBILITY_VALUES, 'all'),
      },
      fileType: {
        queryKey: 'type',
        defaultValue: 'all' as FileTypeFilter,
        parse: (raw: string | null) => parseEnumValue(raw, FILE_TYPE_VALUES, 'all'),
      },
      search: {
        queryKey: 'search',
        defaultValue: '',
        debounceMs: 250,
      },
    }),
    []
  );
  const {
    page: filePage,
    sort: fileSort,
    filters: fileFilters,
    draftFilters: fileDraftFilters,
    setPage: setFilePage,
    setSort: setFileSort,
    setFilter: setFileFilter,
    setDraftFilter: setFileDraftFilter,
  } = useTableQueryState<
    FileSortKey,
    {
      orphanStatus: FileOrphanFilter;
      visibility: FileVisibilityFilter;
      fileType: FileTypeFilter;
      search: string;
    }
  >({
    defaultSort: { key: 'createdAt', direction: 'desc' },
    sortKeys: FILE_SORT_KEYS,
    filterConfig: fileFilterConfig,
  });
  const articleFilterConfig = useMemo(
    () => ({
      query: {
        queryKey: 'articleQuery',
        defaultValue: '',
        debounceMs: 250,
      },
    }),
    []
  );
  const {
    page: articlePage,
    sort: articleSort,
    filters: articleFilters,
    draftFilters: articleDraftFilters,
    setPage: setArticlePage,
    setSort: setArticleSort,
    setDraftFilter: setArticleDraftFilter,
  } = useTableQueryState<ArticleSortKey, { query: string }>({
    defaultSort: { key: 'updatedAt', direction: 'desc' },
    sortKeys: ARTICLE_SORT_KEYS,
    pageParam: 'articlePage',
    sortParam: 'articleSort',
    orderParam: 'articleOrder',
    filterConfig: articleFilterConfig,
  });

  const loadContentData = useCallback(async () => {
    const requestId = loadDataRequestIdRef.current + 1;
    loadDataRequestIdRef.current = requestId;
    setLoading(true);
    try {
      const [
        configRes,
        featuredHomeRes,
        menuArticlesRes,
        showcaseRes,
        menuRes,
        showcaseFilesRes,
        permalinksRes,
      ] = await Promise.all([
        api.get('/content/site-config'),
        api.get<Article[]>('/content/homepage/featured-articles'),
        api.get<ArticlesListResponse>('/content/articles', { params: { page: 1, pageSize: 1000, sort: 'title', order: 'asc' } }),
        api.get('/content/showcase-images'),
        api.get('/content/menu-items', { params: { menuType: 'navbar' } }),
        api.get<FilesListResponse>('/content/files', { params: { page: 1, pageSize: 1000, visibility: 'public', type: 'image' } }),
        api.get<PermalinkAdminRow[]>('/content/permalinks'),
      ]);
      if (requestId !== loadDataRequestIdRef.current) return;
      setSiteConfig(configRes.data);
      setFeaturedHomeArticles(featuredHomeRes.data);
      setMenuArticleOptions(menuArticlesRes.data.items);
      setShowcaseImages(showcaseRes.data);
      setMenuItems(menuRes.data);
      setShowcaseSelectableFiles(showcaseFilesRes.data.items);
      setPermalinks(permalinksRes.data);
    } catch {
      if (requestId !== loadDataRequestIdRef.current) return;
      showAlert('Failed to load content', 'error');
    } finally {
      if (requestId === loadDataRequestIdRef.current) {
        setLoading(false);
      }
    }
  }, [showAlert]);

  useEffect(() => {
    loadContentData();
  }, [loadContentData]);

  const loadArticles = useCallback(async () => {
    setArticleLoading(true);
    setArticleError(null);
    try {
      const articleParams: Record<string, string | number> = {
        page: articlePage,
        pageSize: ARTICLES_PAGE_SIZE,
        sort: articleSort.key,
        order: articleSort.direction,
      };
      if (articleFilters.query.trim()) articleParams.search = articleFilters.query.trim();
      const articlesRes = await api.get<ArticlesListResponse>('/content/articles', { params: articleParams });
      setArticles(articlesRes.data.items);
      setArticleTotal(articlesRes.data.total);
      setArticlesLoaded(true);

      if (articlesRes.data.page !== articlePage) {
        setArticlePage(articlesRes.data.page, { replace: true });
      }
    } catch {
      setArticleError('Failed to load articles.');
      setArticlesLoaded(true);
    } finally {
      setArticleLoading(false);
    }
  }, [articleFilters.query, articlePage, articleSort.direction, articleSort.key, setArticlePage]);

  useEffect(() => {
    if (activeTab !== 'articles') return;
    void loadArticles();
  }, [activeTab, loadArticles]);

  const loadFiles = useCallback(async () => {
    setFilesError(null);
    try {
      const filesParams: Record<string, string | number> = {
        page: filePage,
        pageSize: FILES_PAGE_SIZE,
        sort: fileSort.key,
        order: fileSort.direction,
      };
      if (fileFilters.search.trim()) filesParams.search = fileFilters.search.trim();
      if (fileFilters.orphanStatus === 'suspected') filesParams.suspectedOrphan = 'true';
      if (fileFilters.visibility !== 'all') filesParams.visibility = fileFilters.visibility;
      if (fileFilters.fileType !== 'all') filesParams.type = fileFilters.fileType;

      const filesRes = await api.get<FilesListResponse>('/content/files', { params: filesParams });
      setFiles(filesRes.data.items);
      setFileTotal(filesRes.data.total);
      setFilesLoaded(true);

      if (filesRes.data.page !== filePage) {
        setFilePage(filesRes.data.page, { replace: true });
      }
    } catch {
      setFilesError('Failed to load files.');
      setFilesLoaded(true);
    }
  }, [
    fileFilters.fileType,
    fileFilters.orphanStatus,
    fileFilters.search,
    fileFilters.visibility,
    filePage,
    fileSort.direction,
    fileSort.key,
    setFilePage,
  ]);

  useEffect(() => {
    if (activeTab !== 'files') return;
    void loadFiles();
  }, [activeTab, loadFiles]);

  useEffect(() => {
    setSelectedFileIds([]);
  }, [
    fileFilters.fileType,
    fileFilters.orphanStatus,
    fileFilters.search,
    fileFilters.visibility,
    filePage,
    fileSort.direction,
    fileSort.key,
  ]);

  useEffect(() => {
    if (tabParam && !VALID_TABS.includes(tabParam as Tab)) {
      navigate('/admin/content/site', { replace: true });
    }
  }, [tabParam, navigate]);

  const handleDeleteArticle = async (art: Article) => {
    const ok = await confirm({
      title: 'Delete article',
      message: `Delete "${art.title}"? This cannot be undone.`,
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    setSaving(true);
    try {
      let linkedImageFileIds: number[] = [];
      try {
        const articleRes = await api.get<{ content?: string }>(`/content/articles/${art.id}`);
        const linkedFileIds = extractReferencedFileIds(articleRes.data?.content ?? '');
        if (linkedFileIds.length > 0) {
          const checked = await Promise.all(
            linkedFileIds.map(async (fileId) => {
              try {
                const fileRes = await api.get<{ mimeType?: string }>(`/content/files/${fileId}`);
                return fileRes.data?.mimeType?.startsWith('image/') ? fileId : null;
              } catch {
                return null;
              }
            })
          );
          linkedImageFileIds = checked.filter((id): id is number => id !== null);
        }
      } catch {
        // If inspection fails, continue with normal delete flow.
      }

      let deleteLinkedImages = false;
      if (linkedImageFileIds.length > 0) {
        deleteLinkedImages = await confirm({
          title: 'Delete associated uploaded images?',
          message: `This article references ${linkedImageFileIds.length} uploaded image${linkedImageFileIds.length === 1 ? '' : 's'}. Do you also want to delete those files from the file manager?`,
          confirmText: 'Delete images too',
          variant: 'warning',
        });
      }

      await api.delete(`/content/articles/${art.id}`);
      if (deleteLinkedImages && linkedImageFileIds.length > 0) {
        await api.post('/content/files/bulk-delete', { ids: linkedImageFileIds });
      }
      showAlert('Article deleted', 'success');
      await Promise.all([loadContentData(), loadArticles()]);
    } catch {
      showAlert('Failed to delete article', 'error');
    } finally {
      setSaving(false);
    }
  };

  const [togglingArticleId, setTogglingArticleId] = useState<number | null>(null);
  const handleTogglePublished = async (art: Article) => {
    const willBePublished = !art.publishedAt;
    const newPublishedAt = willBePublished ? new Date().toISOString() : null;
    setTogglingArticleId(art.id);
    try {
      await api.patch(`/content/articles/${art.id}`, { publishedAt: newPublishedAt });
      setArticles((prev) =>
        prev.map((a) => (a.id === art.id ? { ...a, publishedAt: newPublishedAt } : a))
      );
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      showAlert(msg || 'Failed to update article', 'error');
    } finally {
      setTogglingArticleId(null);
    }
  };

  const handleSetFeatured = async (articleId: number, featured: boolean) => {
    setSaving(true);
    try {
      await api.patch(`/content/articles/${articleId}`, { featured });
      await loadContentData();
      if (!featured) {
        showAlert('Featured designation removed', 'success');
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      showAlert(msg || 'Failed to update featured status', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleFeaturedReorder = async (reordered: Article[]) => {
    setFeaturedHomeArticles(reordered);
    setSaving(true);
    try {
      await api.patch('/content/homepage/featured-articles/reorder', {
        ids: reordered.map((a) => a.id),
      });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      showAlert(msg || 'Failed to reorder featured articles', 'error');
      await loadContentData();
    } finally {
      setSaving(false);
    }
  };

  const openShowcaseModal = (img?: ShowcaseImage) => {
    const normalizeUrl = (value: string) => value.split('?')[0];
    const findMatchingUploadedImage = (url: string) =>
      uploadedPublicImages.find((file) => normalizeUrl(file.publicUrl) === normalizeUrl(url));

    if (img) {
      setEditingShowcase(img);
      setShowcaseForm({ url: img.url, caption: img.caption ?? '', sortOrder: img.sortOrder });
      const matchedFile = findMatchingUploadedImage(img.url);
      if (matchedFile) {
        setShowcaseSourceMode('uploaded');
        setSelectedShowcaseFileId(matchedFile.id);
        setShowcaseForm((form) => ({ ...form, url: matchedFile.publicUrl }));
      } else {
        setShowcaseSourceMode('url');
        setSelectedShowcaseFileId(null);
      }
    } else {
      setEditingShowcase(null);
      const firstUploadedImage = uploadedPublicImages[0] ?? null;
      setShowcaseSourceMode(firstUploadedImage ? 'uploaded' : 'url');
      setSelectedShowcaseFileId(firstUploadedImage?.id ?? null);
      setShowcaseForm({
        url: firstUploadedImage?.publicUrl ?? '',
        caption: '',
        sortOrder: showcaseImages.length,
      });
    }
    setShowcaseModalOpen(true);
  };

  const closeShowcaseModal = () => {
    setShowcaseModalOpen(false);
    setEditingShowcase(null);
  };

  const handleSaveShowcase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (showcaseSourceMode === 'uploaded' && !selectedShowcaseFileId) {
      showAlert('Select an uploaded image', 'error');
      return;
    }
    if (!showcaseForm.url.trim()) {
      showAlert('URL is required', 'error');
      return;
    }
    setSaving(true);
    try {
      if (editingShowcase) {
        await api.patch(`/content/showcase-images/${editingShowcase.id}`, {
          url: showcaseForm.url.trim(),
          caption: showcaseForm.caption.trim() || null,
          sortOrder: showcaseForm.sortOrder,
        });
        showAlert('Image updated', 'success');
      } else {
        await api.post('/content/showcase-images', {
          url: showcaseForm.url.trim(),
          caption: showcaseForm.caption.trim() || null,
          sortOrder: showcaseForm.sortOrder,
        });
        showAlert('Image added', 'success');
      }
      closeShowcaseModal();
      loadContentData();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      showAlert(msg || 'Failed to save image', 'error');
    } finally {
      setSaving(false);
    }
  };

  const openMenuModal = (item: MenuItem) => {
    setEditingMenuItem(item);
    setMenuInsertBeforeId(null);
    const article = item.articleId
      ? menuArticleOptions.find((a) => a.id === item.articleId)
      : item.linkType === 'internal' && item.url
        ? menuArticleOptions.find((a) => item.url === `/article/${a.slug}`)
        : null;
    setMenuForm({
      label: item.useArticleTitleForLabel ? '' : item.label,
      parentId: item.parentId,
      linkType: item.linkType,
      url: item.url ?? '',
      openInNewTab: item.openInNewTab ?? false,
      selectedArticleId: article?.id ?? item.articleId ?? null,
      selectedArticleTitle: article?.title ?? item.label,
      selectedArticleSlug: article?.slug ?? (item.url?.startsWith('/article/') ? item.url.replace('/article/', '') : ''),
      labelOverridden: !item.useArticleTitleForLabel,
    });
    setMenuModalOpen(true);
  };

  const openMenuModalForAdd = (parentId: number | null, insertBeforeId: number | null) => {
    setEditingMenuItem(null);
    setMenuInsertBeforeId(insertBeforeId);
    setMenuForm({
      label: '',
      parentId,
      linkType: null,
      url: '',
      openInNewTab: false,
      selectedArticleId: null,
      selectedArticleTitle: '',
      selectedArticleSlug: '',
      labelOverridden: false,
    });
    setMenuModalOpen(true);
  };

  const closeMenuModal = () => {
    setMenuModalOpen(false);
    setEditingMenuItem(null);
    setMenuInsertBeforeId(null);
  };

  const handleSaveMenuItem = async (e: React.FormEvent) => {
    e.preventDefault();
    const article = menuForm.selectedArticleId
      ? {
          id: menuForm.selectedArticleId,
          title: menuForm.selectedArticleTitle,
          slug: menuForm.selectedArticleSlug,
        }
      : null;
    const useArticleTitleForLabel = Boolean(
      menuForm.linkType === 'internal' && article && !menuForm.labelOverridden
    );
    if (!useArticleTitleForLabel && !menuForm.label.trim()) {
      showAlert('Label is required', 'error');
      return;
    }
    if (menuForm.linkType === 'internal') {
      if (!article || !article.slug.trim() || !article.title.trim()) {
        showAlert('Please select an article', 'error');
        return;
      }
    } else if (menuForm.linkType === 'external' && !menuForm.url.trim()) {
      showAlert('URL is required for "Other" links', 'error');
      return;
    }
    setSaving(true);
    try {
      const url =
        menuForm.linkType === 'internal' && article
          ? `/article/${article.slug}`
          : menuForm.linkType === 'external'
            ? menuForm.url.trim()
            : null;
      const labelToSend = useArticleTitleForLabel ? article!.title : menuForm.label.trim();
      if (editingMenuItem) {
        await api.patch(`/content/menu-items/${editingMenuItem.id}`, {
          label: labelToSend,
          parentId: menuForm.parentId,
          linkType: menuForm.linkType,
          url,
          openInNewTab: menuForm.linkType === 'external' ? menuForm.openInNewTab : false,
          articleId: menuForm.linkType === 'internal' ? menuForm.selectedArticleId : null,
          useArticleTitleForLabel,
        });
        setMenuItems((prev) =>
          prev.map((m) =>
            m.id === editingMenuItem.id
              ? { ...m, label: labelToSend, parentId: menuForm.parentId, linkType: menuForm.linkType, url, openInNewTab: menuForm.linkType === 'external' ? menuForm.openInNewTab : false, articleId: menuForm.linkType === 'internal' ? menuForm.selectedArticleId : null, useArticleTitleForLabel }
              : m
          )
        );
      } else {
        const res = await api.post<MenuItem>('/content/menu-items', {
          menuType: 'navbar',
          label: labelToSend,
          parentId: menuForm.parentId,
          linkType: menuForm.linkType,
          url,
          sortOrder: 0,
          openInNewTab: menuForm.linkType === 'external' ? menuForm.openInNewTab : false,
          articleId: menuForm.linkType === 'internal' ? menuForm.selectedArticleId : null,
          useArticleTitleForLabel,
        });
        const newItem = res.data;
        const itemsWithNew = [...menuItems, newItem];
        if (menuInsertBeforeId != null) {
          await handleMenuReorder(newItem.id, menuInsertBeforeId, true, itemsWithNew);
        } else {
          const siblings = menuItems
            .filter((m) => m.parentId === menuForm.parentId)
            .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
          const lastSibling = siblings[siblings.length - 1];
          if (lastSibling) {
            await handleMenuReorder(newItem.id, lastSibling.id, false, itemsWithNew);
          } else {
            setMenuItems(itemsWithNew);
          }
        }
      }
      closeMenuModal();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      showAlert(msg || 'Failed to save menu item', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteMenuItem = async (item: MenuItem) => {
    const ok = await confirm({
      title: 'Delete menu item',
      message: `Delete "${item.label}"? Child items will also be removed.`,
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    setSaving(true);
    try {
      await api.delete(`/content/menu-items/${item.id}`);
      showAlert('Menu item deleted', 'success');
      loadContentData();
    } catch {
      showAlert('Failed to delete menu item', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleMenuReorder = async (
    draggedId: number,
    targetId: number,
    insertBefore: boolean,
    itemsOverride?: MenuItem[]
  ) => {
    const items = itemsOverride ?? menuItems;
    const dragged = items.find((m) => m.id === draggedId);
    const target = items.find((m) => m.id === targetId);
    if (!dragged || !target || dragged.parentId !== target.parentId) return;
    const siblings = items.filter((m) => m.parentId === dragged.parentId).sort(sortByOrder);
    const fromIdx = siblings.findIndex((m) => m.id === draggedId);
    const toIdx = siblings.findIndex((m) => m.id === targetId);
    if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
    const reordered = [...siblings];
    const [removed] = reordered.splice(fromIdx, 1);
    let newIdx = reordered.findIndex((m) => m.id === targetId);
    if (!insertBefore) newIdx += 1;
    reordered.splice(newIdx, 0, removed);
    setMenuItems((prev) => {
      const base = itemsOverride ?? prev;
      return base.map((m) => {
        const idx = reordered.findIndex((r) => r.id === m.id);
        return idx >= 0 ? { ...m, sortOrder: idx } : m;
      });
    });
    setSaving(true);
    try {
      await api.patch('/content/menu-items/reorder', {
        updates: reordered.map((item, i) => ({ id: item.id, sortOrder: i })),
      });
    } catch {
      showAlert('Failed to update order', 'error');
      loadContentData();
    } finally {
      setSaving(false);
    }
  };

  const persistMenuSiblingOrder = async (
    reordered: MenuItem[],
    parentId: number | null,
    itemsOverride?: MenuItem[]
  ) => {
    setMenuItems((prev) => {
      const base = itemsOverride ?? prev;
      return base.map((item) => {
        if (item.parentId !== parentId) return item;
        const nextIndex = reordered.findIndex((candidate) => candidate.id === item.id);
        return nextIndex >= 0 ? { ...item, sortOrder: nextIndex } : item;
      });
    });

    setSaving(true);
    try {
      await api.patch('/content/menu-items/reorder', {
        updates: reordered.map((item, index) => ({ id: item.id, sortOrder: index })),
      });
    } catch {
      showAlert('Failed to update order', 'error');
      loadContentData();
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteShowcase = async (img: ShowcaseImage) => {
    const ok = await confirm({
      title: 'Remove image',
      message: 'Remove this image from the showcase?',
      confirmText: 'Remove',
      variant: 'danger',
    });
    if (!ok) return;
    setSaving(true);
    try {
      await api.delete(`/content/showcase-images/${img.id}`);
      showAlert('Image removed', 'success');
      loadContentData();
    } catch {
      showAlert('Failed to remove image', 'error');
    } finally {
      setSaving(false);
    }
  };

  const loadShowcaseSelectableFiles = useCallback(async () => {
    const response = await api.get<FilesListResponse>('/content/files', {
      params: { page: 1, pageSize: 1000, visibility: 'public', type: 'image' },
    });
    setShowcaseSelectableFiles(response.data.items);
  }, []);

  const handleSaveSiteConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!siteConfig) return;
    setSaving(true);
    try {
      await api.patch('/content/site-config', siteConfig);
      showAlert('Site config saved', 'success');
    } catch {
      showAlert('Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleUploadFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedUploadFiles.length === 0) {
      showAlert('Please choose one or more files to upload', 'error');
      return;
    }
    setUploadingFile(true);
    try {
      const formData = new FormData();
      selectedUploadFiles.forEach((file) => {
        formData.append('file', file);
      });
      if (selectedUploadFiles.length === 1) {
        if (fileUploadForm.displayName.trim()) formData.append('displayName', fileUploadForm.displayName.trim());
        if (fileUploadForm.description.trim()) formData.append('description', fileUploadForm.description.trim());
      }
      formData.append('visibility', fileUploadForm.visibility);
      await api.post('/content/files', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      setSelectedUploadFiles([]);
      setFileUploadForm({ displayName: '', description: '', visibility: 'public' });
      setUploadModalOpen(false);
      showAlert(`${selectedUploadFiles.length} file${selectedUploadFiles.length === 1 ? '' : 's'} uploaded`, 'success');
      await Promise.all([loadFiles(), loadShowcaseSelectableFiles()]);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      showAlert(msg || 'Failed to upload file', 'error');
    } finally {
      setUploadingFile(false);
    }
  };

  const removeSelectedUploadFile = (index: number) => {
    setSelectedUploadFiles((files) => files.filter((_, fileIndex) => fileIndex !== index));
  };

  const openFileModal = useCallback((file: ManagedFile) => {
    setFileModalTarget(file);
    setFileModalOpen(true);
  }, []);

  const closeFileModal = useCallback(() => {
    setFileModalOpen(false);
    setFileModalTarget(null);
  }, []);

  const refreshFileLibrary = useCallback(async () => {
    await Promise.all([loadFiles(), loadShowcaseSelectableFiles()]);
    setImagePreviewVersion((v) => v + 1);
  }, [loadFiles, loadShowcaseSelectableFiles]);

  const handleDeleteFile = async (file: ManagedFile) => {
    const ok = await confirm({
      title: 'Delete file',
      message: `Delete "${file.displayName || file.originalFilename}"? This cannot be undone.`,
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    setSaving(true);
    try {
      await api.delete(`/content/files/${file.id}`);
      showAlert('File deleted', 'success');
      await Promise.all([loadFiles(), loadShowcaseSelectableFiles()]);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      showAlert(msg || 'Failed to delete file', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleCopyFileUrl = async (file: ManagedFile) => {
    const urlPath = file.visibility === 'public' ? file.publicUrl : file.authenticatedUrl;
    const fullUrl = new URL(urlPath, window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(fullUrl);
      showAlert('URL copied', 'success');
    } catch {
      showAlert('Failed to copy URL', 'error');
    }
  };

  const isImageFile = (file: ManagedFile) => file.mimeType.startsWith('image/');
  const getImageThumbnailUrl = (file: ManagedFile) => {
    const baseUrl =
      (file.visibility === 'public' ? file.thumbnailPublicUrl : file.thumbnailAuthenticatedUrl)
      || (file.visibility === 'public' ? file.publicUrl : file.authenticatedUrl);
    return `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}v=${imagePreviewVersion}`;
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: 'site', label: 'Site config' },
    { id: 'home', label: 'Home page' },
    { id: 'menus', label: 'Navigation' },
    { id: 'articles', label: 'Articles' },
    { id: 'showcase', label: 'Showcase images' },
    { id: 'files', label: 'Files' },
    { id: 'permalinks', label: 'Permalinks' },
  ];

  const handleBulkDeleteFiles = async () => {
    if (selectedFileIds.length === 0) return;
    const ok = await confirm({
      title: 'Delete selected files',
      message: `Delete ${selectedFileIds.length} selected file${selectedFileIds.length === 1 ? '' : 's'}? This cannot be undone.`,
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    setSaving(true);
    try {
      await api.post('/content/files/bulk-delete', { ids: selectedFileIds });
      setSelectedFileIds([]);
      showAlert('Files deleted', 'success');
      await Promise.all([loadFiles(), loadShowcaseSelectableFiles()]);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      showAlert(msg || 'Failed to delete files', 'error');
    } finally {
      setSaving(false);
    }
  };

  const fileColumns: Array<DataTableColumn<ManagedFile, FileSortKey>> = useMemo(
    () => [
      {
        id: 'preview',
        header: 'Preview',
        cellClassName: 'w-16',
        renderCell: (file) =>
          isImageFile(file) ? (
            <img
              src={getImageThumbnailUrl(file)}
              alt=""
              className="h-10 w-10 rounded border border-gray-200 object-cover dark:border-gray-700"
            />
          ) : (
            <span className="text-gray-400 dark:text-gray-500">-</span>
          ),
      },
      {
        id: 'name',
        header: 'Name',
        sortable: true,
        sortKey: 'name',
        defaultSortDirection: 'asc',
        cellClassName: 'min-w-[18rem]',
        renderCell: (file) => (
          <div className="min-w-0 space-y-1">
            <button
              type="button"
              onClick={() => openFileModal(file)}
              className="block max-w-full truncate text-left font-medium text-gray-900 transition-colors hover:text-primary-teal hover:underline dark:text-gray-100"
            >
              {file.displayName || file.originalFilename}
            </button>
            <div className="truncate text-xs text-gray-500 dark:text-gray-400">
              {file.originalFilename}
            </div>
            {file.suspectedOrphan ? (
              <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                Suspected orphan
              </span>
            ) : null}
          </div>
        ),
      },
      {
        id: 'type',
        header: 'Type',
        sortable: true,
        sortKey: 'type',
        defaultSortDirection: 'desc',
        headerClassName: 'w-40',
        cellClassName: 'max-w-[12rem]',
        renderCell: (file) => (
          <span className="block truncate" title={file.mimeType}>
            {file.mimeType}
          </span>
        ),
      },
      {
        id: 'size',
        header: 'Size',
        sortable: true,
        sortKey: 'size',
        defaultSortDirection: 'desc',
        renderCell: (file) => `${Math.max(1, Math.round(file.byteSize / 1024))} KB`,
      },
      {
        id: 'visibility',
        header: 'Visibility',
        renderCell: (file) => <span className="capitalize">{file.visibility}</span>,
      },
      {
        id: 'createdAt',
        header: 'Created',
        sortable: true,
        sortKey: 'createdAt',
        defaultSortDirection: 'desc',
        renderCell: (file) => new Date(file.createdAt).toLocaleDateString(),
      },
    ],
    [openFileModal, imagePreviewVersion]
  );

  const articleColumns: Array<DataTableColumn<Article, ArticleSortKey>> = useMemo(
    () => [
      {
        id: 'title',
        header: 'Title',
        sortable: true,
        sortKey: 'title',
        defaultSortDirection: 'asc',
        cellClassName: 'min-w-[14rem]',
        renderCell: (article) => <div className="truncate font-medium">{article.title}</div>,
      },
      {
        id: 'slug',
        header: 'Slug',
        sortable: true,
        sortKey: 'slug',
        defaultSortDirection: 'asc',
        cellClassName: 'text-gray-500',
        renderCell: (article) => (
          <a
            href={`/articles/${article.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-teal hover:underline"
          >
            /articles/{article.slug}
          </a>
        ),
      },
      {
        id: 'published',
        header: 'Published',
        renderCell: (article) => (
          <div className="flex items-center">
            <button
              type="button"
              role="switch"
              aria-checked={Boolean(article.publishedAt)}
              onClick={() => handleTogglePublished(article)}
              disabled={togglingArticleId === article.id}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-primary-teal focus:ring-offset-2 dark:focus:ring-offset-gray-900 ${
                article.publishedAt ? 'bg-primary-teal' : 'bg-gray-200 dark:bg-gray-600'
              } ${togglingArticleId === article.id ? 'cursor-not-allowed opacity-60' : ''}`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition ${
                  article.publishedAt ? 'translate-x-5' : 'translate-x-1'
                }`}
                aria-hidden
              />
            </button>
          </div>
        ),
      },
      {
        id: 'updatedAt',
        header: 'Last edited',
        sortable: true,
        sortKey: 'updatedAt',
        defaultSortDirection: 'desc',
        renderCell: (article) => (article.updatedAt ? new Date(article.updatedAt).toLocaleDateString() : '-'),
      },
      {
        id: 'publishedAt',
        header: 'Publish date',
        sortable: true,
        sortKey: 'publishedAt',
        defaultSortDirection: 'desc',
        renderCell: (article) => (article.publishedAt ? new Date(article.publishedAt).toLocaleDateString() : '-'),
      },
    ],
    [togglingArticleId]
  );

  return (
    <Layout>
      <div className="max-w-6xl mx-auto">
        <h1 className="app-page-title mb-6">Manage content</h1>

        <PageTabs
          items={tabs.map((tab) => ({
            key: tab.id,
            label: tab.label,
            to: `/admin/content/${tab.id}`,
            isActive: activeTab === tab.id,
          }))}
        />

        {activeTab !== 'files' && loading ? (
          <p className="text-gray-500">Loading...</p>
        ) : (
          <>
            {activeTab === 'site' && siteConfig && (
              <form onSubmit={handleSaveSiteConfig} className="space-y-4">
                <FormField label="Club name" htmlFor={`${formFieldId}-site-club-name`}>
                  <input
                    id={`${formFieldId}-site-club-name`}
                    type="text"
                    value={siteConfig.clubName ?? ''}
                    onChange={(e) => setSiteConfig({ ...siteConfig, clubName: e.target.value || null })}
                    className="app-input"
                  />
                </FormField>
                <FormField label="Logo URL" htmlFor={`${formFieldId}-site-logo-url`}>
                  <input
                    id={`${formFieldId}-site-logo-url`}
                    type="text"
                    value={siteConfig.logoUrl ?? ''}
                    onChange={(e) => setSiteConfig({ ...siteConfig, logoUrl: e.target.value || null })}
                    placeholder="https://example.com/logo.png or /images/logo.png"
                    className="app-input"
                  />
                </FormField>
                <FormField label="Contact email" htmlFor={`${formFieldId}-site-contact-email`}>
                  <input
                    id={`${formFieldId}-site-contact-email`}
                    type="email"
                    value={siteConfig.contactEmail ?? ''}
                    onChange={(e) => setSiteConfig({ ...siteConfig, contactEmail: e.target.value || null })}
                    className="app-input"
                  />
                </FormField>
                <FormField label="Contact phone" htmlFor={`${formFieldId}-site-contact-phone`}>
                  <input
                    id={`${formFieldId}-site-contact-phone`}
                    type="text"
                    value={siteConfig.contactPhone ?? ''}
                    onChange={(e) => setSiteConfig({ ...siteConfig, contactPhone: e.target.value || null })}
                    className="app-input"
                  />
                </FormField>
                <FormField label="Footer (Markdown)" htmlFor={`${formFieldId}-site-footer-markdown`}>
                  <textarea
                    id={`${formFieldId}-site-footer-markdown`}
                    value={siteConfig.footerMarkdown ?? ''}
                    onChange={(e) => setSiteConfig({ ...siteConfig, footerMarkdown: e.target.value || null })}
                    rows={4}
                    className="app-input"
                  />
                </FormField>
                <Button type="submit" disabled={saving}>
                  {saving ? 'Saving...' : 'Save'}
                </Button>
              </form>
            )}

            {activeTab === 'menus' && (
              <div>
                <p className="text-gray-500 mb-4">
                  Navbar menu items. Hover between items to add. Click the arrow to expand or collapse nested items. Drag to reorder within the same level.
                </p>
                {(() => {
                  const byParent = new Map<number | null, MenuItem[]>();
                  for (const item of menuItems) {
                    const parentId = item.parentId ?? null;
                    if (!byParent.has(parentId)) byParent.set(parentId, []);
                    byParent.get(parentId)!.push(item);
                  }
                  for (const [, siblings] of byParent) siblings.sort(sortByOrder);

                  const toggleMenuExpanded = (id: number) => {
                    setMenuExpandedIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(id)) next.delete(id);
                      else next.add(id);
                      return next;
                    });
                  };

                  return (
                    <SortableTree
                      items={menuItems}
                      getId={(item) => item.id}
                      getParentId={(item) => item.parentId}
                      getItemLabel={(item) => item.label}
                      sortSiblings={(siblings) => siblings.sort(sortByOrder)}
                      isExpanded={(item) => menuExpandedIds.has(item.id)}
                      canDragItem={(_, siblings) => siblings.length > 1}
                      itemNoun="menu item"
                      rootListClassName="space-y-2"
                      childListClassName="ml-6 space-y-2"
                      onReorder={({ parentId, reorderedSiblings }) =>
                        void persistMenuSiblingOrder(reorderedSiblings, (parentId as number | null) ?? null)
                      }
                      renderGap={({ parentId, insertBeforeId, depth }) => (
                        <li
                          key={`slot-${parentId ?? 'root'}-${insertBeforeId ?? 'end'}-${depth}`}
                          className="group relative -my-1.5 flex h-6 shrink-0 items-center justify-center"
                          onClick={() =>
                            openMenuModalForAdd(
                              (parentId as number | null) ?? null,
                              (insertBeforeId as number | null) ?? null
                            )
                          }
                        >
                          <div className="pointer-events-none absolute inset-x-0 top-[6px] h-1 bg-primary-teal opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
                          <button
                            type="button"
                            onClick={() =>
                              openMenuModalForAdd(
                                (parentId as number | null) ?? null,
                                (insertBeforeId as number | null) ?? null
                              )
                            }
                            className="relative z-10 rounded border-2 border-primary-teal bg-gray-50 px-3 py-1 text-xs text-primary-teal opacity-0 transition-opacity duration-150 group-hover:opacity-100 dark:bg-gray-900"
                          >
                            + Add item
                          </button>
                        </li>
                      )}
                      renderItem={({ item, isDragging, isOverlay, canDrag, dragHandle }) => {
                        const hasChildren = (byParent.get(item.id)?.length ?? 0) > 0;
                        const isExpanded = menuExpandedIds.has(item.id);

                        return (
                          <SortableRow
                            isDragging={isDragging}
                            isOverlay={isOverlay}
                            className="border-gray-100 px-3 py-2 dark:border-gray-800"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex min-w-0 items-center gap-2">
                                {hasChildren ? (
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.preventDefault();
                                      toggleMenuExpanded(item.id);
                                    }}
                                    className="shrink-0 rounded p-0.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                                    aria-label={isExpanded ? 'Collapse' : 'Expand'}
                                  >
                                    {isExpanded ? (
                                      <HiChevronDown className="h-4 w-4" />
                                    ) : (
                                      <HiChevronRight className="h-4 w-4" />
                                    )}
                                  </button>
                                ) : (
                                  <span className="w-5 shrink-0" aria-hidden />
                                )}
                                {canDrag ? dragHandle : <span className="w-8 shrink-0" aria-hidden />}
                                <div className="min-w-0">
                                  <span className="font-medium">{item.label}</span>
                                  {item.linkType && item.url && (
                                    <span className="ml-2 text-sm text-gray-500">
                                      ({item.linkType === 'internal' ? 'Article' : 'Other'}: {item.url}
                                      {item.linkType === 'external'
                                        ? item.openInNewTab
                                          ? ' - new tab'
                                          : ' - same tab'
                                        : ''}
                                      )
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="flex shrink-0 gap-2">
                                <button
                                  type="button"
                                  onClick={() => openMenuModal(item)}
                                  className="text-sm text-primary-teal hover:underline"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteMenuItem(item)}
                                  className="text-sm text-red-600 hover:underline dark:text-red-400"
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                          </SortableRow>
                        );
                      }}
                      renderOverlay={(item) => (
                        <SortableRow isDragging isOverlay className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <DragHandle label={`Reorder ${item.label}`} disabled />
                            <div className="min-w-0">
                              <span className="font-medium">{item.label}</span>
                              {item.linkType && item.url ? (
                                <span className="ml-2 text-sm text-gray-500">
                                  ({item.linkType === 'internal' ? 'Article' : 'Other'}: {item.url})
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </SortableRow>
                      )}
                      emptyState={
                        <p className="py-2 text-sm text-gray-500">
                          No menu items yet. Click above to add. When empty, default links (Home, Articles) are shown.
                        </p>
                      }
                    />
                  );
                })()}
                <Modal
                  isOpen={menuModalOpen}
                  onClose={closeMenuModal}
                  title={editingMenuItem ? 'Edit menu item' : 'Add menu item'}
                >
                  <form onSubmit={handleSaveMenuItem} className="space-y-4">
                    <FormField label="Link type" htmlFor={`${formFieldId}-menu-link-type`}>
                      <ChoiceInput<MenuLinkTypeChoice>
                        inputId={`${formFieldId}-menu-link-type`}
                        options={MENU_LINK_TYPE_CHOICES}
                        value={
                          menuForm.linkType === null
                            ? 'none'
                            : menuForm.linkType === 'internal'
                              ? 'internal'
                              : 'external'
                        }
                        onChange={(next) => {
                          if (next == null || Array.isArray(next)) return;
                          const linkType = next === 'none' ? null : next;
                          setMenuForm((f) => ({
                            ...f,
                            linkType,
                            url: linkType === 'external' ? f.url : '',
                            openInNewTab: linkType === 'external' ? f.openInNewTab : false,
                            selectedArticleId: linkType === 'internal' ? f.selectedArticleId : null,
                            selectedArticleTitle: linkType === 'internal' ? f.selectedArticleTitle : '',
                            selectedArticleSlug: linkType === 'internal' ? f.selectedArticleSlug : '',
                          }));
                        }}
                        listboxLabel="Link type"
                      />
                    </FormField>
                    {menuForm.linkType === 'internal' && (
                      <FormField label="Article" htmlFor={`${formFieldId}-menu-article`}>
                        <ArticleAutocomplete
                          inputId={`${formFieldId}-menu-article`}
                          value={
                            menuForm.selectedArticleId
                              ? {
                                  id: menuForm.selectedArticleId,
                                  title: menuForm.selectedArticleTitle || 'Selected article',
                                  slug: menuForm.selectedArticleSlug || '',
                                }
                              : null
                          }
                          onChange={(selected) => {
                            setMenuForm((f) => ({
                              ...f,
                              selectedArticleId: selected?.id ?? null,
                              selectedArticleTitle: selected?.title ?? '',
                              selectedArticleSlug: selected?.slug ?? '',
                              url: selected ? `/article/${selected.slug}` : '',
                              label: !f.labelOverridden ? '' : f.label,
                            }));
                          }}
                          placeholder="Search for an article"
                        />
                      </FormField>
                    )}
                    {menuForm.linkType === 'external' && (
                      <>
                        <FormField label="URL" htmlFor={`${formFieldId}-menu-url`}>
                          <input
                            id={`${formFieldId}-menu-url`}
                            type="text"
                            value={menuForm.url}
                            onChange={(e) => setMenuForm((f) => ({ ...f, url: e.target.value }))}
                            placeholder="https://example.com or /calendar/public"
                            className="app-input"
                            required
                          />
                        </FormField>
                        <FormCheckbox
                          label="Open in a new tab"
                          checked={menuForm.openInNewTab}
                          onChange={(checked) => setMenuForm((f) => ({ ...f, openInNewTab: checked }))}
                        />
                      </>
                    )}
                    <FormField
                      label={
                        <>
                          Label{' '}
                          {menuForm.linkType === 'internal' &&
                            menuForm.selectedArticleId &&
                            !menuForm.labelOverridden &&
                            '(from article)'}
                        </>
                      }
                      htmlFor={`${formFieldId}-menu-label`}
                    >
                      <input
                        id={`${formFieldId}-menu-label`}
                        type="text"
                        value={menuForm.label}
                        onChange={(e) => {
                          const value = e.target.value;
                          setMenuForm((f) => ({
                            ...f,
                            label: value,
                            labelOverridden: value.trim() !== '',
                          }));
                        }}
                        placeholder={
                          menuForm.linkType === 'internal' && menuForm.selectedArticleId
                            ? 'Override to use custom label'
                            : 'e.g. Home, Articles'
                        }
                        className="app-input"
                        required={
                          !(
                            menuForm.linkType === 'internal' &&
                            menuForm.selectedArticleId &&
                            !menuForm.labelOverridden
                          )
                        }
                      />
                    </FormField>
                    <FormField label="Parent" htmlFor={`${formFieldId}-menu-parent`}>
                      <ChoiceInput<number>
                        inputId={`${formFieldId}-menu-parent`}
                        options={buildMenuParentChoiceOptions(menuItems, editingMenuItem)}
                        value={menuForm.parentId}
                        onChange={(next) =>
                          setMenuForm((f) => ({
                            ...f,
                            parentId: next == null || Array.isArray(next) ? null : next,
                          }))
                        }
                        placeholder="— None (top level) —"
                        listboxLabel="Parent menu item"
                      />
                    </FormField>
                    <div className="flex justify-end gap-2 pt-2">
                      <Button type="button" variant="secondary" onClick={closeMenuModal}>
                        Cancel
                      </Button>
                      <Button type="submit" disabled={saving}>
                        {saving ? 'Saving...' : 'Save'}
                      </Button>
                    </div>
                  </form>
                </Modal>
              </div>
            )}

            {activeTab === 'home' && (
              <div className="space-y-8">
                {siteConfig && (
                  <form onSubmit={handleSaveSiteConfig} className="space-y-6">
                    <FormSection
                      title="Hero copy"
                      description="Shown in the large banner at the top of the public homepage. Leave a field empty to use the built-in default."
                      surface="panel"
                    >
                      <FormField label="Badge line (location or tagline)" htmlFor={`${formFieldId}-home-hero-badge`}>
                        <input
                          id={`${formFieldId}-home-hero-badge`}
                          type="text"
                          value={siteConfig.heroBadge ?? ''}
                          onChange={(e) => setSiteConfig({ ...siteConfig, heroBadge: e.target.value || null })}
                          placeholder="Raleigh, Durham, and Chapel Hill area of North Carolina"
                          className="app-input"
                        />
                      </FormField>
                      <FormField label="Headline" htmlFor={`${formFieldId}-home-hero-title`}>
                        <input
                          id={`${formFieldId}-home-hero-title`}
                          type="text"
                          value={siteConfig.heroTitle ?? ''}
                          onChange={(e) => setSiteConfig({ ...siteConfig, heroTitle: e.target.value || null })}
                          placeholder="Curling in the Triangle"
                          className="app-input"
                        />
                      </FormField>
                      <FormField label="Subtitle" htmlFor={`${formFieldId}-home-hero-subtitle`}>
                        <textarea
                          id={`${formFieldId}-home-hero-subtitle`}
                          value={siteConfig.heroSubtitle ?? ''}
                          onChange={(e) => setSiteConfig({ ...siteConfig, heroSubtitle: e.target.value || null })}
                          rows={2}
                          className="app-input"
                        />
                      </FormField>
                    </FormSection>
                    <FormSection
                      title="Announcement banner"
                      description="Optional banner shown above the homepage hero. Supports Markdown, including links. Leave empty to hide."
                      surface="panel"
                    >
                      <FormField label="Announcement (Markdown)" htmlFor={`${formFieldId}-home-announcement`}>
                        <textarea
                          id={`${formFieldId}-home-announcement`}
                          value={siteConfig.announcementMarkdown ?? ''}
                          onChange={(e) =>
                            setSiteConfig({ ...siteConfig, announcementMarkdown: e.target.value || null })
                          }
                          rows={3}
                          placeholder="The club is closed for ice maintenance July 8-14. [Read more](/articles/ice-maintenance)"
                          className="app-input"
                        />
                      </FormField>
                      <FormField
                        label="Optional expiration (your local time)"
                        htmlFor={`${formFieldId}-home-announcement-expires`}
                      >
                        <input
                          id={`${formFieldId}-home-announcement-expires`}
                          type="datetime-local"
                          value={isoToLocalDateTimeInput(siteConfig.announcementExpiresAt)}
                          onChange={(e) =>
                            setSiteConfig({
                              ...siteConfig,
                              announcementExpiresAt: localDateTimeInputToIso(e.target.value),
                            })
                          }
                          className="app-input"
                        />
                      </FormField>
                    </FormSection>
                    <Button type="submit" disabled={saving}>
                      {saving ? 'Saving...' : 'Save homepage content'}
                    </Button>
                  </form>
                )}

                <FormSection
                  title="Featured articles"
                  description="Shown in the latest updates section of the homepage."
                  surface="plain"
                >
                <div className="mb-4 flex flex-wrap items-end gap-3">
                  <FormField
                    label="Add featured article"
                    htmlFor={`${formFieldId}-home-featured-article`}
                    className="min-w-[280px]"
                  >
                    <ArticleAutocomplete
                      inputId={`${formFieldId}-home-featured-article`}
                      value={pendingFeaturedArticle}
                      onChange={setPendingFeaturedArticle}
                      excludeIds={featuredHomeArticles.map((article) => article.id)}
                      placeholder="Search for an article to feature"
                    />
                  </FormField>
                  <Button
                    type="button"
                    disabled={!pendingFeaturedArticle || saving}
                    onClick={() => {
                      if (!pendingFeaturedArticle) return;
                      void handleSetFeatured(pendingFeaturedArticle.id, true);
                      setPendingFeaturedArticle(null);
                    }}
                  >
                    Add as featured
                  </Button>
                </div>
                <p className="text-sm text-gray-500 mb-3">
                  Drag featured articles to reorder how they appear on the home page.
                </p>
                {featuredHomeArticles.length === 0 ? (
                  <p className="text-sm text-gray-500">No featured articles selected.</p>
                ) : (
                  <SortableList
                    items={featuredHomeArticles}
                    getId={(article) => article.id}
                    getItemLabel={(article) => article.title}
                    itemNoun="featured article"
                    onReorder={(nextArticles) => void handleFeaturedReorder(nextArticles)}
                    renderItem={({ item: article, isDragging, isOverlay, dragHandle }) => (
                      <SortableRow
                        isDragging={isDragging}
                        isOverlay={isOverlay}
                        className="border-gray-200 px-3 py-2 dark:border-gray-700"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-3">
                            {dragHandle}
                            <div className="min-w-0">
                              <div className="truncate font-medium">{article.title}</div>
                              <div className="truncate text-xs text-gray-500">/articles/{article.slug}</div>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => void handleSetFeatured(article.id, false)}
                            className="text-sm text-red-600 dark:text-red-400 hover:underline"
                          >
                            Remove
                          </button>
                        </div>
                      </SortableRow>
                    )}
                    renderOverlay={(article) => (
                      <SortableRow isDragging isOverlay className="px-3 py-2">
                        <div className="flex items-center gap-3">
                          <DragHandle label={`Reorder ${article.title}`} disabled />
                          <div className="min-w-0">
                            <div className="truncate font-medium">{article.title}</div>
                            <div className="truncate text-xs text-gray-500">/articles/{article.slug}</div>
                          </div>
                        </div>
                      </SortableRow>
                    )}
                  />
                )}
                </FormSection>
              </div>
            )}

            {activeTab === 'articles' && (
              <div>
                <AppPageControlsRow
                  className="mb-4"
                  left={(
                    <FormField
                      label="Filter"
                      htmlFor={`${formFieldId}-articles-query`}
                      className="min-w-[16rem] flex-1"
                    >
                      <input
                        id={`${formFieldId}-articles-query`}
                        type="search"
                        value={articleDraftFilters.query}
                        onChange={(e) => setArticleDraftFilter('query', e.target.value)}
                        placeholder="Search title or slug"
                        className="app-input"
                      />
                    </FormField>
                  )}
                  right={(
                    <Button onClick={() => navigate('/admin/content/articles/new')}>Add article</Button>
                  )}
                />
                <DataTable
                  rows={articles}
                  rowKey={(article) => article.id}
                  columns={articleColumns}
                  sort={articleSort}
                  onSortChange={setArticleSort}
                  loading={!articlesLoaded || articleLoading}
                  error={articleError ? <AppStateCard compact title={articleError} /> : undefined}
                  actions={{
                    widthClassName: 'w-[7rem]',
                    renderActions: (article) => (
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => navigate(`/admin/content/articles/${article.id}`)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-primary-teal focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/40 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-primary-teal"
                          aria-label={`Edit ${article.title}`}
                          title="Edit"
                        >
                          <HiPencilSquare className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteArticle(article)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/40 dark:text-gray-400 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                          aria-label={`Delete ${article.title}`}
                          title="Delete"
                        >
                          <HiTrash className="h-4 w-4" />
                        </button>
                      </div>
                    ),
                  }}
                  pagination={{
                    page: articlePage,
                    pageSize: ARTICLES_PAGE_SIZE,
                    totalRecords: articleTotal,
                    currentCount: articles.length,
                    onPageChange: setArticlePage,
                  }}
                  emptyState={
                    <AppStateCard
                      compact
                      title={articleFilters.query ? 'No articles match those filters.' : 'No articles found.'}
                    />
                  }
                />
              </div>
            )}

            {activeTab === 'showcase' && (
              <div>
                <div className="flex justify-between items-center mb-4">
                  <p className="text-gray-500">
                    {showcaseImages.length} image{showcaseImages.length !== 1 ? 's' : ''}.
                  </p>
                  <Button onClick={() => openShowcaseModal()}>Add image</Button>
                </div>
                <ul className="space-y-2">
                  {showcaseImages.map((img) => (
                    <li key={img.id} className="flex items-center justify-between gap-4 py-2 border-b border-gray-100 dark:border-gray-800">
                      <div className="flex items-center gap-4">
                        <img src={img.url} alt="" className="w-16 h-16 object-cover rounded" />
                        <div>
                          <p className="text-sm truncate max-w-md">{img.url}</p>
                          {img.caption && <p className="text-gray-500 text-sm">{img.caption}</p>}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => openShowcaseModal(img)}
                          className="text-sm text-primary-teal hover:underline"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteShowcase(img)}
                          className="text-sm text-red-600 dark:text-red-400 hover:underline"
                        >
                          Remove
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>

                <Modal
                  isOpen={showcaseModalOpen}
                  onClose={closeShowcaseModal}
                  title={editingShowcase ? 'Edit image' : 'Add image'}
                >
                  <form onSubmit={handleSaveShowcase} className="space-y-4">
                    <fieldset className="m-0 min-w-0 space-y-2 border-0 p-0">
                      <legend className="app-label float-none w-full px-0">Image source</legend>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setShowcaseSourceMode('uploaded');
                            const fallbackFile = uploadedPublicImages.find((file) => file.id === selectedShowcaseFileId) ?? uploadedPublicImages[0];
                            if (fallbackFile) {
                              setSelectedShowcaseFileId(fallbackFile.id);
                              setShowcaseForm((f) => ({ ...f, url: fallbackFile.publicUrl }));
                            }
                          }}
                          className={`rounded border px-3 py-2 text-sm ${
                            showcaseSourceMode === 'uploaded'
                              ? 'border-primary-teal bg-primary-teal/10 text-primary-teal'
                              : 'border-gray-300 dark:border-gray-600'
                          }`}
                        >
                          Uploaded file
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowcaseSourceMode('url')}
                          className={`rounded border px-3 py-2 text-sm ${
                            showcaseSourceMode === 'url'
                              ? 'border-primary-teal bg-primary-teal/10 text-primary-teal'
                              : 'border-gray-300 dark:border-gray-600'
                          }`}
                        >
                          External URL
                        </button>
                      </div>
                    </fieldset>
                    <div>
                      {showcaseSourceMode === 'uploaded' ? (
                        <>
                          {uploadedPublicImages.length > 0 ? (
                            <FormField label="Uploaded image" htmlFor={`${formFieldId}-showcase-uploaded-file`}>
                              <ChoiceInput<number>
                                inputId={`${formFieldId}-showcase-uploaded-file`}
                                options={uploadedPublicImages.map((file) => ({
                                  value: file.id,
                                  label: file.displayName || file.originalFilename,
                                }))}
                                value={selectedShowcaseFileId}
                                onChange={(next) => {
                                  const fileId = next == null || Array.isArray(next) ? null : next;
                                  const selectedFile = uploadedPublicImages.find((file) => file.id === fileId);
                                  setSelectedShowcaseFileId(fileId);
                                  setShowcaseForm((f) => ({ ...f, url: selectedFile?.publicUrl ?? '' }));
                                }}
                                listboxLabel="Uploaded image"
                                required
                              />
                            </FormField>
                          ) : (
                            <>
                              <div className="mb-1 text-sm font-medium text-gray-700 dark:text-gray-300">
                                Uploaded image
                              </div>
                              <p className="text-sm text-gray-600 dark:text-gray-300">
                                No uploaded public images available. Upload an image in the Files tab, or use an external URL.
                              </p>
                            </>
                          )}
                        </>
                      ) : (
                        <FormField label="Image URL" htmlFor={`${formFieldId}-showcase-image-url`}>
                          <input
                            id={`${formFieldId}-showcase-image-url`}
                            type="url"
                            value={showcaseForm.url}
                            onChange={(e) => setShowcaseForm((f) => ({ ...f, url: e.target.value }))}
                            className="app-input"
                            required
                          />
                        </FormField>
                      )}
                    </div>
                    <FormField label="Caption" htmlFor={`${formFieldId}-showcase-caption`}>
                      <input
                        id={`${formFieldId}-showcase-caption`}
                        type="text"
                        value={showcaseForm.caption}
                        onChange={(e) => setShowcaseForm((f) => ({ ...f, caption: e.target.value }))}
                        className="app-input"
                      />
                    </FormField>
                    <FormField label="Sort order" htmlFor={`${formFieldId}-showcase-sort`}>
                      <input
                        id={`${formFieldId}-showcase-sort`}
                        type="number"
                        value={showcaseForm.sortOrder}
                        onChange={(e) => setShowcaseForm((f) => ({ ...f, sortOrder: parseInt(e.target.value, 10) || 0 }))}
                        className="app-input"
                      />
                    </FormField>
                    <div className="flex justify-end gap-2 pt-2">
                      <Button type="button" variant="secondary" onClick={closeShowcaseModal}>
                        Cancel
                      </Button>
                      <Button type="submit" disabled={saving}>
                        {saving ? 'Saving...' : 'Save'}
                      </Button>
                    </div>
                  </form>
                </Modal>
              </div>
            )}

            {activeTab === 'files' && (
              <div className="space-y-6">
                <AppPageControlsRow
                  left={
                    <>
                      <FormField label="Orphan status" htmlFor={`${formFieldId}-files-filter-orphan`}>
                        <ChoiceInput<FileOrphanFilter>
                          inputId={`${formFieldId}-files-filter-orphan`}
                          options={FILE_ORPHAN_FILTER_OPTIONS}
                          value={fileFilters.orphanStatus}
                          onChange={(next) => {
                            if (next != null && !Array.isArray(next))
                              setFileFilter('orphanStatus', next);
                          }}
                          listboxLabel="Orphan status"
                        />
                      </FormField>
                      <FormField label="Visibility" htmlFor={`${formFieldId}-files-filter-visibility`}>
                        <ChoiceInput<FileVisibilityFilter>
                          inputId={`${formFieldId}-files-filter-visibility`}
                          options={FILE_VISIBILITY_FILTER_OPTIONS}
                          value={fileFilters.visibility}
                          onChange={(next) => {
                            if (next != null && !Array.isArray(next))
                              setFileFilter('visibility', next);
                          }}
                          listboxLabel="File visibility filter"
                        />
                      </FormField>
                      <FormField label="File type" htmlFor={`${formFieldId}-files-filter-type`}>
                        <ChoiceInput<FileTypeFilter>
                          inputId={`${formFieldId}-files-filter-type`}
                          options={FILE_TYPE_FILTER_OPTIONS}
                          value={fileFilters.fileType}
                          onChange={(next) => {
                            if (next != null && !Array.isArray(next))
                              setFileFilter('fileType', next);
                          }}
                          listboxLabel="File type filter"
                        />
                      </FormField>
                      <FormField
                        label="Search"
                        htmlFor={`${formFieldId}-files-filter-search`}
                        className="min-w-[16rem] flex-1"
                      >
                        <input
                          id={`${formFieldId}-files-filter-search`}
                          type="text"
                          value={fileDraftFilters.search}
                          onChange={(event) =>
                            setFileDraftFilter('search', event.target.value)
                          }
                          placeholder="Name, description, filename"
                          className="app-input"
                        />
                      </FormField>
                    </>
                  }
                  right={
                    <>
                      {selectedFileIds.length > 0 && (
                        <div className="flex items-center gap-3">
                          <span className="text-sm text-gray-600 dark:text-gray-300">
                            {selectedFileIds.length} selected
                          </span>
                          <Button
                            type="button"
                            variant="danger"
                            onClick={handleBulkDeleteFiles}
                            disabled={saving}
                          >
                            Delete selected ({selectedFileIds.length})
                          </Button>
                        </div>
                      )}
                      <Button type="button" onClick={() => setUploadModalOpen(true)}>
                        Upload file
                      </Button>
                    </>
                  }
                />

                {filesError && files.length > 0 ? (
                  <div className="app-alert-error">
                    {filesError}
                  </div>
                ) : null}

                <DataTable
                  rows={files}
                  rowKey={(file) => file.id}
                  columns={fileColumns}
                  sort={fileSort}
                  onSortChange={setFileSort}
                  selection={{
                    selectedIds: selectedFileIds,
                    onToggleRow: (file, checked) => {
                      setSelectedFileIds((prev) =>
                        checked
                          ? Array.from(new Set([...prev, file.id]))
                          : prev.filter((id) => id !== file.id)
                      );
                    },
                    onTogglePage: (pageRows, checked) => {
                      setSelectedFileIds(checked ? pageRows.map((file) => file.id) : []);
                    },
                    getRowLabel: (file) => file.displayName || file.originalFilename,
                  }}
                  actions={{
                    widthClassName: 'w-[8.5rem]',
                    renderActions: (file) => (
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => void handleCopyFileUrl(file)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-primary-teal focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/40 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-primary-teal"
                          aria-label={`Copy URL for ${file.displayName || file.originalFilename}`}
                          title="Copy URL"
                        >
                          <HiClipboardDocument className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openFileModal(file)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-primary-teal focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/40 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-primary-teal"
                          aria-label={`Edit ${file.displayName || file.originalFilename}`}
                          title="Edit"
                        >
                          <HiPencilSquare className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteFile(file)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/40 dark:text-gray-400 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                          aria-label={`Delete ${file.displayName || file.originalFilename}`}
                          title="Delete"
                        >
                          <HiTrash className="h-4 w-4" />
                        </button>
                      </div>
                    ),
                  }}
                  pagination={{
                    page: filePage,
                    pageSize: FILES_PAGE_SIZE,
                    totalRecords: fileTotal,
                    currentCount: files.length,
                    onPageChange: (page) => setFilePage(page),
                  }}
                  loading={!filesLoaded}
                  error={
                    filesError && files.length === 0 ? (
                      <AppStateCard compact title="Couldn't load files" description={filesError} />
                    ) : undefined
                  }
                  emptyState={
                    <AppStateCard
                      compact
                      title={
                        fileFilters.search.trim() ||
                        fileFilters.orphanStatus !== 'all' ||
                        fileFilters.visibility !== 'all' ||
                        fileFilters.fileType !== 'all'
                          ? 'No files match these filters.'
                          : 'No files uploaded yet.'
                      }
                      description={
                        fileFilters.search.trim() ||
                        fileFilters.orphanStatus !== 'all' ||
                        fileFilters.visibility !== 'all' ||
                        fileFilters.fileType !== 'all'
                          ? 'Try changing the search or filters.'
                          : 'Upload a file to start managing your media library.'
                      }
                    />
                  }
                />

                <Modal isOpen={uploadModalOpen} onClose={() => setUploadModalOpen(false)} title="Upload file">
                  <form onSubmit={handleUploadFile} className="space-y-4">
                    <FormField label="Files" htmlFor={`${formFieldId}-upload-files`}>
                      <input
                        id={`${formFieldId}-upload-files`}
                        type="file"
                        multiple
                        onChange={(e) => setSelectedUploadFiles(e.target.files ? Array.from(e.target.files) : [])}
                        className="app-input"
                      />
                    </FormField>
                    {selectedUploadFiles.length === 1 && (
                      <>
                        <FormField label="Display name (optional)" optional htmlFor={`${formFieldId}-upload-display-name`}>
                          <input
                            id={`${formFieldId}-upload-display-name`}
                            type="text"
                            value={fileUploadForm.displayName}
                            onChange={(e) => setFileUploadForm((f) => ({ ...f, displayName: e.target.value }))}
                            className="app-input"
                          />
                        </FormField>
                        <FormField label="Description (optional)" optional htmlFor={`${formFieldId}-upload-description`}>
                          <textarea
                            id={`${formFieldId}-upload-description`}
                            value={fileUploadForm.description}
                            onChange={(e) => setFileUploadForm((f) => ({ ...f, description: e.target.value }))}
                            rows={3}
                            className="app-input"
                          />
                        </FormField>
                      </>
                    )}
                    {selectedUploadFiles.length > 0 && (
                      <div className="border border-gray-200 dark:border-gray-700 rounded p-2">
                        <p className="text-sm font-medium mb-2">Selected files</p>
                        <ul className="space-y-1">
                          {selectedUploadFiles.map((file, index) => (
                            <li key={`${file.name}-${file.lastModified}-${index}`} className="flex items-center justify-between gap-3 text-sm">
                              <span className="truncate">{file.name}</span>
                              <button
                                type="button"
                                onClick={() => removeSelectedUploadFile(index)}
                                className="text-red-600 dark:text-red-400 hover:underline shrink-0"
                              >
                                Remove
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <FormField label="Visibility" htmlFor={`${formFieldId}-upload-visibility`}>
                      <ChoiceInput<'public' | 'authenticated'>
                        inputId={`${formFieldId}-upload-visibility`}
                        options={FILE_VISIBILITY_STRICT_OPTIONS}
                        value={fileUploadForm.visibility}
                        onChange={(next) => {
                          if (next != null && !Array.isArray(next))
                            setFileUploadForm((f) => ({ ...f, visibility: next }));
                        }}
                        listboxLabel="Upload visibility"
                      />
                    </FormField>
                    <div className="flex justify-end gap-2 pt-2">
                      <Button type="button" variant="secondary" onClick={() => setUploadModalOpen(false)}>
                        Cancel
                      </Button>
                      <Button type="submit" disabled={uploadingFile || selectedUploadFiles.length === 0}>
                        {uploadingFile ? 'Uploading...' : 'Upload'}
                      </Button>
                    </div>
                  </form>
                </Modal>

                <ContentFileEditModal
                  isOpen={fileModalOpen}
                  file={fileModalTarget}
                  onClose={closeFileModal}
                  onLibraryChanged={refreshFileLibrary}
                />
              </div>
            )}

            {activeTab === 'permalinks' && (
              <AdminContentPermalinksPanel rows={permalinks} loading={false} onRefresh={loadContentData} />
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
