import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { HiBars3, HiChevronDown, HiChevronRight } from 'react-icons/hi2';
import Layout from '../../components/Layout';
import api from '../../utils/api';
import { useAlert } from '../../contexts/AlertContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import ArticleAutocomplete from '../../components/ArticleAutocomplete';

type Tab = 'site' | 'home' | 'articles' | 'showcase' | 'menus' | 'files';
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
type ManagedFile = {
  id: number;
  originalFilename: string;
  displayName: string | null;
  description: string | null;
  mimeType: string;
  byteSize: number;
  visibility: 'public' | 'authenticated';
  suspectedOrphan: boolean;
  publicUrl: string;
  authenticatedUrl: string;
  thumbnailPublicUrl: string | null;
  thumbnailAuthenticatedUrl: string | null;
  createdAt: string;
};

type FilesListResponse = {
  items: ManagedFile[];
  total: number;
  page: number;
  pageSize: number;
};

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

const VALID_TABS: Tab[] = ['site', 'home', 'menus', 'articles', 'showcase', 'files'];

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
  } | null>(null);
  const [articles, setArticles] = useState<Article[]>([]);
  const [featuredHomeArticles, setFeaturedHomeArticles] = useState<Article[]>([]);
  const [selectedFeaturedArticleId, setSelectedFeaturedArticleId] = useState<number | null>(null);
  const [menuArticleOptions, setMenuArticleOptions] = useState<Article[]>([]);
  const [articleSearch, setArticleSearch] = useState('');
  const [articleSort, setArticleSort] = useState<'updatedAt' | 'title' | 'slug' | 'publishedAt' | 'createdAt'>('updatedAt');
  const [articleSortOrder, setArticleSortOrder] = useState<'asc' | 'desc'>('desc');
  const [articlePage, setArticlePage] = useState(1);
  const [articlePageSize, setArticlePageSize] = useState(25);
  const [articleTotal, setArticleTotal] = useState(0);
  const [showcaseImages, setShowcaseImages] = useState<ShowcaseImage[]>([]);
  const [showcaseSelectableFiles, setShowcaseSelectableFiles] = useState<ManagedFile[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [files, setFiles] = useState<ManagedFile[]>([]);
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

  const menuDragRef = useRef<{ id: number; parentId: number | null } | null>(null);
  const menuDropTargetRef = useRef<{ targetId: number; insertBefore: boolean } | null>(null);
  const [menuDragOver, setMenuDragOver] = useState<{ targetId: number; insertBefore: boolean } | null>(null);
  const [menuExpandedIds, setMenuExpandedIds] = useState<Set<number>>(new Set());
  const featuredDragRef = useRef<number | null>(null);
  const featuredDropTargetRef = useRef<{ targetId: number; insertBefore: boolean } | null>(null);
  const [featuredDragOver, setFeaturedDragOver] = useState<{ targetId: number; insertBefore: boolean } | null>(null);

  // Files
  const [selectedUploadFiles, setSelectedUploadFiles] = useState<File[]>([]);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [fileUploadForm, setFileUploadForm] = useState({
    displayName: '',
    description: '',
    visibility: 'public' as 'public' | 'authenticated',
  });
  const [fileOrphanFilter, setFileOrphanFilter] = useState<'all' | 'suspected'>('all');
  const [fileVisibilityFilter, setFileVisibilityFilter] = useState<'all' | 'public' | 'authenticated'>('all');
  const [fileTypeFilter, setFileTypeFilter] = useState<'all' | 'image' | 'video' | 'audio' | 'document' | 'other'>('all');
  const [fileSearch, setFileSearch] = useState('');
  const [fileSort, setFileSort] = useState<'createdAt' | 'name' | 'size' | 'type' | 'updatedAt'>('createdAt');
  const [fileSortOrder, setFileSortOrder] = useState<'asc' | 'desc'>('desc');
  const [filePage, setFilePage] = useState(1);
  const [filePageSize, setFilePageSize] = useState(25);
  const [fileTotal, setFileTotal] = useState(0);
  const [selectedFileIds, setSelectedFileIds] = useState<number[]>([]);
  const [fileModalOpen, setFileModalOpen] = useState(false);
  const [fileModalTab, setFileModalTab] = useState<'details' | 'resize' | 'cropRotate'>('details');
  const [editingFile, setEditingFile] = useState<ManagedFile | null>(null);
  const [fileEditForm, setFileEditForm] = useState({
    displayName: '',
    description: '',
    visibility: 'public' as 'public' | 'authenticated',
    suspectedOrphan: false,
  });
  const [imageToolsBusy, setImageToolsBusy] = useState(false);
  const [imagePreviewVersion, setImagePreviewVersion] = useState(0);
  const [previewNaturalSize, setPreviewNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const previewImageRef = useRef<HTMLImageElement | null>(null);
  const [resizeMode, setResizeMode] = useState<'preset' | 'custom'>('preset');
  const [resizeForm, setResizeForm] = useState({
    preset: 'medium' as 'thumbnail' | 'small' | 'medium' | 'large',
    width: '',
    height: '',
    keepOriginal: true,
  });
  const [rotateDegrees, setRotateDegrees] = useState(0);
  const [convertFormat, setConvertFormat] = useState<'jpg' | 'png' | 'gif'>('jpg');
  const [cropSelection, setCropSelection] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const cropDragStartRef = useRef<{ x: number; y: number } | null>(null);
  const uploadedPublicImages = showcaseSelectableFiles.filter((file) => file.visibility === 'public' && file.mimeType.startsWith('image/'));

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const articleParams: Record<string, string | number> = {
        page: articlePage,
        pageSize: articlePageSize,
        sort: articleSort,
        order: articleSortOrder,
      };
      if (articleSearch.trim()) articleParams.search = articleSearch.trim();
      const filesParams: Record<string, string | number> = {
        page: filePage,
        pageSize: filePageSize,
        sort: fileSort,
        order: fileSortOrder,
      };
      if (fileSearch.trim()) filesParams.search = fileSearch.trim();
      if (fileOrphanFilter === 'suspected') filesParams.suspectedOrphan = 'true';
      if (fileVisibilityFilter !== 'all') filesParams.visibility = fileVisibilityFilter;
      if (fileTypeFilter !== 'all') filesParams.type = fileTypeFilter;
      const [configRes, articlesRes, featuredHomeRes, menuArticlesRes, showcaseRes, menuRes, filesRes, showcaseFilesRes] = await Promise.all([
        api.get('/content/site-config'),
        api.get<ArticlesListResponse>('/content/articles', { params: articleParams }),
        api.get<Article[]>('/content/homepage/featured-articles'),
        api.get<ArticlesListResponse>('/content/articles', { params: { page: 1, pageSize: 1000, sort: 'title', order: 'asc' } }),
        api.get('/content/showcase-images'),
        api.get('/content/menu-items', { params: { menuType: 'navbar' } }),
        api.get<FilesListResponse>('/content/files', { params: filesParams }),
        api.get<FilesListResponse>('/content/files', { params: { page: 1, pageSize: 1000, visibility: 'public', type: 'image' } }),
      ]);
      setSiteConfig(configRes.data);
      setArticles(articlesRes.data.items);
      setFeaturedHomeArticles(featuredHomeRes.data);
      setArticleTotal(articlesRes.data.total);
      setArticlePage(articlesRes.data.page);
      setArticlePageSize(articlesRes.data.pageSize);
      setMenuArticleOptions(menuArticlesRes.data.items);
      setShowcaseImages(showcaseRes.data);
      setMenuItems(menuRes.data);
      setFiles(filesRes.data.items);
      setFileTotal(filesRes.data.total);
      setFilePage(filesRes.data.page);
      setFilePageSize(filesRes.data.pageSize);
      setShowcaseSelectableFiles(showcaseFilesRes.data.items);
    } catch {
      showAlert('Failed to load content', 'error');
    } finally {
      setLoading(false);
    }
  }, [
    articlePage,
    articlePageSize,
    articleSearch,
    articleSort,
    articleSortOrder,
    fileOrphanFilter,
    filePage,
    filePageSize,
    fileSearch,
    fileSort,
    fileSortOrder,
    fileTypeFilter,
    fileVisibilityFilter,
    showAlert,
  ]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    setArticlePage(1);
  }, [articleSearch, articlePageSize]);

  useEffect(() => {
    setFilePage(1);
  }, [fileSearch, fileOrphanFilter, fileVisibilityFilter, fileTypeFilter, filePageSize]);

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
      loadData();
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
      await loadData();
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

  const handleFeaturedReorder = async (draggedId: number, targetId: number, insertBefore: boolean) => {
    if (draggedId === targetId) return;
    const fromIdx = featuredHomeArticles.findIndex((a) => a.id === draggedId);
    const toIdx = featuredHomeArticles.findIndex((a) => a.id === targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    const reordered = [...featuredHomeArticles];
    const [dragged] = reordered.splice(fromIdx, 1);
    let nextIdx = reordered.findIndex((a) => a.id === targetId);
    if (!insertBefore) nextIdx += 1;
    reordered.splice(nextIdx, 0, dragged);
    setFeaturedHomeArticles(reordered);
    setSaving(true);
    try {
      await api.patch('/content/homepage/featured-articles/reorder', {
        ids: reordered.map((a) => a.id),
      });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      showAlert(msg || 'Failed to reorder featured articles', 'error');
      await loadData();
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
      loadData();
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
      loadData();
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
    const siblings = items
      .filter((m) => m.parentId === dragged.parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
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
      loadData();
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
      loadData();
    } catch {
      showAlert('Failed to remove image', 'error');
    } finally {
      setSaving(false);
    }
  };

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
      loadData();
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

  const openFileModal = (file: ManagedFile) => {
    setEditingFile(file);
    setFileModalTab('details');
    setFileEditForm({
      displayName: file.displayName ?? '',
      description: file.description ?? '',
      visibility: file.visibility,
      suspectedOrphan: file.suspectedOrphan,
    });
    setResizeMode('preset');
    setResizeForm({
      preset: 'medium',
      width: '',
      height: '',
      keepOriginal: true,
    });
    setRotateDegrees(0);
    setConvertFormat('jpg');
    setCropSelection(null);
    cropDragStartRef.current = null;
    setImagePreviewVersion((v) => v + 1);
    setPreviewNaturalSize(null);
    setFileModalOpen(true);
  };

  const closeFileModal = () => {
    setFileModalOpen(false);
    setEditingFile(null);
    setCropSelection(null);
    cropDragStartRef.current = null;
  };

  const handleSaveFileMetadata = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingFile) return;
    setSaving(true);
    try {
      await api.patch(`/content/files/${editingFile.id}`, {
        displayName: fileEditForm.displayName.trim() || null,
        description: fileEditForm.description.trim() || null,
        visibility: fileEditForm.visibility,
        suspectedOrphan: fileEditForm.suspectedOrphan,
      });
      showAlert('File updated', 'success');
      closeFileModal();
      loadData();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      showAlert(msg || 'Failed to update file', 'error');
    } finally {
      setSaving(false);
    }
  };

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
      loadData();
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
  const getImagePreviewUrl = (file: ManagedFile) => {
    const baseUrl = file.visibility === 'public' ? file.publicUrl : file.authenticatedUrl;
    return `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}v=${imagePreviewVersion}`;
  };
  const getImageThumbnailUrl = (file: ManagedFile) => {
    const baseUrl =
      (file.visibility === 'public' ? file.thumbnailPublicUrl : file.thumbnailAuthenticatedUrl)
      || (file.visibility === 'public' ? file.publicUrl : file.authenticatedUrl);
    return `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}v=${imagePreviewVersion}`;
  };

  const toImageRelativePointFromClient = (clientX: number, clientY: number) => {
    const img = previewImageRef.current;
    if (!img) return null;
    const rect = img.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, clientY - rect.top));
    return { x, y, rect };
  };

  const handleCropMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (fileModalTab !== 'cropRotate' || imageToolsBusy) return;
    const point = toImageRelativePointFromClient(event.clientX, event.clientY);
    if (!point) return;
    cropDragStartRef.current = { x: point.x, y: point.y };
    setCropSelection({ x: point.x, y: point.y, width: 0, height: 0 });
  };

  const handleCropMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    const dragStart = cropDragStartRef.current;
    if (!dragStart) return;
    const point = toImageRelativePointFromClient(event.clientX, event.clientY);
    if (!point) return;
    const left = Math.min(dragStart.x, point.x);
    const top = Math.min(dragStart.y, point.y);
    const width = Math.abs(point.x - dragStart.x);
    const height = Math.abs(point.y - dragStart.y);
    setCropSelection({ x: left, y: top, width, height });
  };

  const handleCropMouseUp = () => {
    cropDragStartRef.current = null;
    setCropSelection((current) => {
      if (!current) return null;
      if (current.width < 2 || current.height < 2) return null;
      return current;
    });
  };

  useEffect(() => {
    const handleWindowMouseMove = (event: MouseEvent) => {
      const dragStart = cropDragStartRef.current;
      if (!dragStart) return;
      const point = toImageRelativePointFromClient(event.clientX, event.clientY);
      if (!point) return;
      const left = Math.min(dragStart.x, point.x);
      const top = Math.min(dragStart.y, point.y);
      const width = Math.abs(point.x - dragStart.x);
      const height = Math.abs(point.y - dragStart.y);
      setCropSelection({ x: left, y: top, width, height });
    };

    const handleWindowMouseUp = () => {
      if (!cropDragStartRef.current) return;
      handleCropMouseUp();
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  });

  const handleResizeImage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingFile) return;
    if (resizeMode === 'custom' && !resizeForm.width.trim() && !resizeForm.height.trim()) {
      showAlert('Provide width and/or height for custom resize', 'error');
      return;
    }
    setImageToolsBusy(true);
    try {
      const payload =
        resizeMode === 'preset'
          ? {
              preset: resizeForm.preset,
              keepOriginal: resizeForm.keepOriginal,
            }
          : {
              width: resizeForm.width.trim() ? Number.parseInt(resizeForm.width, 10) : undefined,
              height: resizeForm.height.trim() ? Number.parseInt(resizeForm.height, 10) : undefined,
              keepOriginal: resizeForm.keepOriginal,
            };
      const res = await api.post<ManagedFile>(`/content/files/${editingFile.id}/resize`, payload);
      if (!resizeForm.keepOriginal) {
        setEditingFile(res.data);
        setImagePreviewVersion((v) => v + 1);
      }
      showAlert('Image resized', 'success');
      await loadData();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      showAlert(msg || 'Failed to resize image', 'error');
    } finally {
      setImageToolsBusy(false);
    }
  };

  const handleApplyCropRotate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingFile) return;
    const img = previewImageRef.current;
    const natural = previewNaturalSize;
    if (!img || !natural) {
      showAlert('Image preview not ready', 'error');
      return;
    }
    const rect = img.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      showAlert('Image preview not ready', 'error');
      return;
    }
    const isQuarterTurn = Math.abs(rotateDegrees) % 180 !== 0;
    const previewScale = isQuarterTurn
      ? Math.min(rect.width / rect.height, rect.height / rect.width)
      : 1;
    const rotatedDisplayWidth = isQuarterTurn ? rect.height * previewScale : rect.width * previewScale;
    const rotatedDisplayHeight = isQuarterTurn ? rect.width * previewScale : rect.height * previewScale;
    const offsetX = (rect.width - rotatedDisplayWidth) / 2;
    const offsetY = (rect.height - rotatedDisplayHeight) / 2;
    const rotatedNaturalWidth = isQuarterTurn ? natural.height : natural.width;
    const rotatedNaturalHeight = isQuarterTurn ? natural.width : natural.height;

    const payload: {
      degrees: number;
      x?: number;
      y?: number;
      width?: number;
      height?: number;
    } = {
      degrees: rotateDegrees,
    };

    if (cropSelection && cropSelection.width >= 2 && cropSelection.height >= 2) {
      const normalizedLeft = Math.max(0, (cropSelection.x - offsetX) / rotatedDisplayWidth);
      const normalizedTop = Math.max(0, (cropSelection.y - offsetY) / rotatedDisplayHeight);
      const normalizedRight = Math.min(1, (cropSelection.x + cropSelection.width - offsetX) / rotatedDisplayWidth);
      const normalizedBottom = Math.min(1, (cropSelection.y + cropSelection.height - offsetY) / rotatedDisplayHeight);

      if (normalizedRight <= normalizedLeft || normalizedBottom <= normalizedTop) {
        showAlert('Crop rectangle is outside the transformed preview', 'error');
        return;
      }

      payload.x = Math.max(0, Math.floor(normalizedLeft * rotatedNaturalWidth));
      payload.y = Math.max(0, Math.floor(normalizedTop * rotatedNaturalHeight));
      payload.width = Math.max(1, Math.floor((normalizedRight - normalizedLeft) * rotatedNaturalWidth));
      payload.height = Math.max(1, Math.floor((normalizedBottom - normalizedTop) * rotatedNaturalHeight));
    }

    setImageToolsBusy(true);
    try {
      const res = await api.post<ManagedFile>(`/content/files/${editingFile.id}/crop-rotate`, payload);
      setEditingFile(res.data);
      setCropSelection(null);
      setImagePreviewVersion((v) => v + 1);
      showAlert('Image transformed', 'success');
      await loadData();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      showAlert(msg || 'Failed to transform image', 'error');
    } finally {
      setImageToolsBusy(false);
    }
  };

  const getCropOutputDimensions = (): { width: number; height: number } | null => {
    const img = previewImageRef.current;
    if (!img || !previewNaturalSize || !cropSelection || cropSelection.width < 2 || cropSelection.height < 2) {
      return null;
    }
    const width = img.clientWidth || 0;
    const height = img.clientHeight || 0;
    if (width === 0 || height === 0) return null;

    const isQuarterTurn = Math.abs(rotateDegrees) % 180 !== 0;
    const previewScale = isQuarterTurn ? Math.min(width / height, height / width) : 1;
    const rotatedDisplayWidth = isQuarterTurn ? height * previewScale : width * previewScale;
    const rotatedDisplayHeight = isQuarterTurn ? width * previewScale : height * previewScale;
    const offsetX = (width - rotatedDisplayWidth) / 2;
    const offsetY = (height - rotatedDisplayHeight) / 2;
    const rotatedNaturalWidth = isQuarterTurn ? previewNaturalSize.height : previewNaturalSize.width;
    const rotatedNaturalHeight = isQuarterTurn ? previewNaturalSize.width : previewNaturalSize.height;

    const normalizedLeft = Math.max(0, (cropSelection.x - offsetX) / rotatedDisplayWidth);
    const normalizedTop = Math.max(0, (cropSelection.y - offsetY) / rotatedDisplayHeight);
    const normalizedRight = Math.min(1, (cropSelection.x + cropSelection.width - offsetX) / rotatedDisplayWidth);
    const normalizedBottom = Math.min(1, (cropSelection.y + cropSelection.height - offsetY) / rotatedDisplayHeight);

    if (normalizedRight <= normalizedLeft || normalizedBottom <= normalizedTop) return null;

    return {
      width: Math.max(1, Math.floor((normalizedRight - normalizedLeft) * rotatedNaturalWidth)),
      height: Math.max(1, Math.floor((normalizedBottom - normalizedTop) * rotatedNaturalHeight)),
    };
  };

  const getCropRotatePreviewTransform = (): CSSProperties | undefined => {
    if (fileModalTab !== 'cropRotate') return undefined;
    const img = previewImageRef.current;
    if (!img) {
      return rotateDegrees !== 0 ? { transform: `rotate(${rotateDegrees}deg)` } : undefined;
    }
    const width = img.clientWidth || 1;
    const height = img.clientHeight || 1;
    const isQuarterTurn = Math.abs(rotateDegrees) % 180 !== 0;
    const scale = isQuarterTurn ? Math.min(width / height, height / width) : 1;
    return {
      transform: `rotate(${rotateDegrees}deg) scale(${scale})`,
      transformOrigin: 'center center',
    };
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: 'site', label: 'Site config' },
    { id: 'home', label: 'Home page' },
    { id: 'menus', label: 'Navigation' },
    { id: 'articles', label: 'Articles' },
    { id: 'showcase', label: 'Showcase images' },
    { id: 'files', label: 'Files' },
  ];

  const handleConvertImageType = async () => {
    if (!editingFile) return;
    setImageToolsBusy(true);
    try {
      const res = await api.post<ManagedFile>(`/content/files/${editingFile.id}/convert`, {
        format: convertFormat,
      });
      setEditingFile(res.data);
      setImagePreviewVersion((v) => v + 1);
      showAlert('File type converted', 'success');
      await loadData();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      showAlert(msg || 'Failed to convert file type', 'error');
    } finally {
      setImageToolsBusy(false);
    }
  };

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
      await loadData();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      showAlert(msg || 'Failed to delete files', 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggleFileSort = (column: 'createdAt' | 'name' | 'size' | 'type' | 'updatedAt') => {
    if (fileSort === column) {
      setFileSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setFileSort(column);
    setFileSortOrder(column === 'name' ? 'asc' : 'desc');
  };
  const toggleArticleSort = (column: 'updatedAt' | 'title' | 'slug' | 'publishedAt' | 'createdAt') => {
    if (articleSort === column) {
      setArticleSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setArticleSort(column);
    setArticleSortOrder(column === 'title' || column === 'slug' ? 'asc' : 'desc');
  };
  const cropOutputDimensions = getCropOutputDimensions();

  return (
    <Layout>
      <div className="max-w-6xl mx-auto">
        <h1 className="text-2xl font-semibold mb-6">Manage content</h1>

        <div className="flex gap-2 border-b border-gray-200 dark:border-gray-700 mb-6">
          {tabs.map((tab) => {
            const to = `/admin/content/${tab.id}`;
            const isActive = activeTab === tab.id;
            return (
              <Link
                key={tab.id}
                to={to}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                  isActive
                    ? 'border-primary-teal text-primary-teal'
                    : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>

        {loading ? (
          <p className="text-gray-500">Loading...</p>
        ) : (
          <>
            {activeTab === 'site' && siteConfig && (
              <form onSubmit={handleSaveSiteConfig} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Club name</label>
                  <input
                    type="text"
                    value={siteConfig.clubName ?? ''}
                    onChange={(e) => setSiteConfig({ ...siteConfig, clubName: e.target.value || null })}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 bg-white dark:bg-gray-800"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Logo URL</label>
                  <input
                    type="url"
                    value={siteConfig.logoUrl ?? ''}
                    onChange={(e) => setSiteConfig({ ...siteConfig, logoUrl: e.target.value || null })}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 bg-white dark:bg-gray-800"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Contact email</label>
                  <input
                    type="email"
                    value={siteConfig.contactEmail ?? ''}
                    onChange={(e) => setSiteConfig({ ...siteConfig, contactEmail: e.target.value || null })}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 bg-white dark:bg-gray-800"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Contact phone</label>
                  <input
                    type="text"
                    value={siteConfig.contactPhone ?? ''}
                    onChange={(e) => setSiteConfig({ ...siteConfig, contactPhone: e.target.value || null })}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 bg-white dark:bg-gray-800"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Footer (Markdown)</label>
                  <textarea
                    value={siteConfig.footerMarkdown ?? ''}
                    onChange={(e) => setSiteConfig({ ...siteConfig, footerMarkdown: e.target.value || null })}
                    rows={4}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 bg-white dark:bg-gray-800"
                  />
                </div>
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
                <ul>
                  {(() => {
                    const roots = menuItems
                      .filter((m) => !m.parentId)
                      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
                    const byParent = new Map<number | null, MenuItem[]>();
                    for (const m of menuItems) {
                      const pid = m.parentId ?? null;
                      if (!byParent.has(pid)) byParent.set(pid, []);
                      byParent.get(pid)!.push(m);
                    }
                    for (const [, items] of byParent) {
                      items.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
                    }
                    const result: { item: MenuItem; depth: number }[] = [];
                    const added = new Set<number>();
                    const markDescendantsAdded = (parentId: number) => {
                      for (const child of byParent.get(parentId) ?? []) {
                        added.add(child.id);
                        markDescendantsAdded(child.id);
                      }
                    };
                    const addWithChildren = (parent: MenuItem, depth: number) => {
                      if (added.has(parent.id)) return;
                      added.add(parent.id);
                      result.push({ item: parent, depth });
                      if (!menuExpandedIds.has(parent.id)) {
                        markDescendantsAdded(parent.id);
                        return;
                      }
                      const children = byParent.get(parent.id) ?? [];
                      for (const child of children) addWithChildren(child, depth + 1);
                    };
                    for (const root of roots) addWithChildren(root, 0);
                    const orphans = menuItems.filter((m) => !added.has(m.id));
                    orphans.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
                    orphans.forEach((m) => result.push({ item: m, depth: 0 }));
                    const toggleMenuExpanded = (id: number) => {
                      setMenuExpandedIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(id)) next.delete(id);
                        else next.add(id);
                        return next;
                      });
                    };
                    const isLastChildOfParent = (idx: number) => {
                      if (idx < 0) return false;
                      const { item } = result[idx];
                      const sibs = (item.parentId !== null ? byParent.get(item.parentId) : byParent.get(null)) ?? [];
                      const lastSib = sibs[sibs.length - 1];
                      return lastSib?.id === item.id;
                    };
                    type SlotOrItem = { type: 'slot'; parentId: number | null; insertBeforeId: number | null; depth: number } | { type: 'item'; item: MenuItem; depth: number };
                    const elements: SlotOrItem[] = [];
                    for (let i = 0; i < result.length; i++) {
                      const prev = i > 0 ? result[i - 1] : null;
                      const curr = result[i];
                      const useAfterSlot =
                        prev &&
                        isLastChildOfParent(i - 1) &&
                        prev.item.parentId !== curr.item.parentId;
                      if (useAfterSlot) {
                        elements.push({ type: 'slot', parentId: prev.item.parentId, insertBeforeId: null, depth: prev.depth });
                      } else {
                        elements.push({ type: 'slot', parentId: curr.item.parentId, insertBeforeId: curr.item.id, depth: curr.depth });
                      }
                      elements.push({ type: 'item', item: curr.item, depth: curr.depth });
                    }
                    if (result.length > 0) {
                      const last = result[result.length - 1];
                      elements.push({ type: 'slot', parentId: last.item.parentId, insertBeforeId: null, depth: last.depth });
                    } else {
                      elements.push({ type: 'slot', parentId: null, insertBeforeId: null, depth: 0 });
                    }
                    return elements.map((el, idx) => {
                      if (el.type === 'slot') {
                        return (
                          <li
                            key={`slot-${el.insertBeforeId ?? 'end'}-${idx}`}
                            className="group h-6 -mt-1.5 -mb-1.5 shrink-0 flex items-center justify-center relative cursor-pointer"
                            style={{ paddingLeft: el.depth * 24 }}
                            onClick={() => openMenuModalForAdd(el.parentId, el.insertBeforeId)}
                          >
                            <div
                              className="absolute right-0 top-[6px] h-1 bg-primary-teal opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none"
                              style={{ left: el.depth * 24 }}
                            />
                            <button
                              type="button"
                              onClick={() => openMenuModalForAdd(el.parentId, el.insertBeforeId)}
                              className="relative z-10 px-3 py-1 rounded border-2 border-primary-teal bg-gray-50 dark:bg-gray-900 text-primary-teal text-xs opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                            >
                              + Add item
                            </button>
                          </li>
                        );
                      }
                      const { item, depth } = el;
                      const siblings = (item.parentId !== null ? byParent.get(item.parentId) : byParent.get(null)) ?? [];
                      const canDrop = siblings.length > 1;
                      const hasChildren = (byParent.get(item.id)?.length ?? 0) > 0;
                      const isExpanded = menuExpandedIds.has(item.id);
                      const showDropAbove = menuDragOver?.targetId === item.id && menuDragOver.insertBefore;
                      const showDropBelow = menuDragOver?.targetId === item.id && !menuDragOver.insertBefore;
                      return (
                        <li
                          key={item.id}
                          className={`relative flex items-center justify-between min-h-[2.5rem] py-2 border-b border-gray-100 dark:border-gray-800 ${canDrop ? 'cursor-grab active:cursor-grabbing' : ''}`}
                          style={depth > 0 ? { paddingLeft: depth * 24 } : undefined}
                          draggable={canDrop}
                          onDragStart={(e) => {
                            if (!canDrop) return;
                            menuDragRef.current = { id: item.id, parentId: item.parentId };
                            e.dataTransfer.setData('application/json', JSON.stringify({ id: item.id, parentId: item.parentId }));
                            e.dataTransfer.effectAllowed = 'move';
                          }}
                          onDragEnd={() => {
                            menuDragRef.current = null;
                            menuDropTargetRef.current = null;
                            setMenuDragOver(null);
                          }}
                          onDragOver={(e) => {
                            if (!canDrop) return;
                            const dragged = menuDragRef.current;
                            if (!dragged || dragged.parentId !== item.parentId) return;
                            e.preventDefault();
                            e.dataTransfer.dropEffect = 'move';
                            const rect = e.currentTarget.getBoundingClientRect();
                            const insertBefore = e.clientY < rect.top + rect.height / 2;
                            menuDropTargetRef.current = { targetId: item.id, insertBefore };
                            setMenuDragOver({ targetId: item.id, insertBefore });
                          }}
                          onDragLeave={() => {
                            setMenuDragOver((prev) =>
                              prev?.targetId === item.id ? null : prev
                            );
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            const data = e.dataTransfer.getData('application/json');
                            const target = menuDropTargetRef.current;
                            menuDropTargetRef.current = null;
                            setMenuDragOver(null);
                            if (!data || !target) return;
                            try {
                              const { id: draggedId } = JSON.parse(data);
                              if (draggedId !== target.targetId)
                                handleMenuReorder(draggedId, target.targetId, target.insertBefore);
                            } catch {
                              // ignore
                            }
                          }}
                        >
                          {showDropAbove && (
                            <div
                              className="absolute left-0 right-0 top-0 h-0.5 bg-primary-teal z-10 pointer-events-none"
                              style={{ left: depth * 24 }}
                              aria-hidden
                            />
                          )}
                          {showDropBelow && (
                            <div
                              className="absolute left-0 right-0 bottom-0 h-0.5 bg-primary-teal z-10 pointer-events-none"
                              style={{ left: depth * 24 }}
                              aria-hidden
                            />
                          )}
                          <div className="flex items-center gap-2 min-w-0">
                            {hasChildren ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleMenuExpanded(item.id);
                                }}
                                className="p-0.5 -m-0.5 rounded text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 shrink-0"
                                aria-label={isExpanded ? 'Collapse' : 'Expand'}
                              >
                                {isExpanded ? (
                                  <HiChevronDown className="w-4 h-4" />
                                ) : (
                                  <HiChevronRight className="w-4 h-4" />
                                )}
                              </button>
                            ) : (
                              <span className="w-4 shrink-0" aria-hidden />
                            )}
                            {canDrop && (
                              <HiBars3 className="text-gray-400 shrink-0 w-4 h-4" aria-hidden />
                            )}
                            <div className="min-w-0">
                              <span className="font-medium">{item.label}</span>
                              {item.linkType && item.url && (
                                <span className="text-gray-500 text-sm ml-2">
                                  ({item.linkType === 'internal' ? 'Article' : 'Other'}: {item.url}{item.linkType === 'external' ? (item.openInNewTab ? ' — new tab' : ' — same tab') : ''})
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex gap-2 shrink-0">
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
                              className="text-sm text-red-600 dark:text-red-400 hover:underline"
                            >
                              Delete
                            </button>
                          </div>
                        </li>
                      );
                    });
                  })()}
                </ul>
                {menuItems.length === 0 && (
                  <p className="text-gray-500 py-2 text-sm">
                    No menu items yet. Click above to add. When empty, default links (Home, Articles) are shown.
                  </p>
                )}

                <Modal
                  isOpen={menuModalOpen}
                  onClose={closeMenuModal}
                  title={editingMenuItem ? 'Edit menu item' : 'Add menu item'}
                >
                  <form onSubmit={handleSaveMenuItem} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium mb-1">Link type</label>
                      <select
                        value={menuForm.linkType ?? ''}
                        onChange={(e) => {
                          const linkType = (e.target.value || null) as 'internal' | 'external' | null;
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
                        className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 bg-white dark:bg-gray-800 dark:text-gray-100"
                      >
                        <option value="">— None (dropdown parent only) —</option>
                        <option value="internal">Article</option>
                        <option value="external">Other (custom URL)</option>
                      </select>
                    </div>
                    {menuForm.linkType === 'internal' && (
                      <div>
                        <label className="block text-sm font-medium mb-1">Article</label>
                        <ArticleAutocomplete
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
                      </div>
                    )}
                    {menuForm.linkType === 'external' && (
                      <>
                        <div>
                          <label className="block text-sm font-medium mb-1">URL</label>
                          <input
                            type="text"
                            value={menuForm.url}
                            onChange={(e) => setMenuForm((f) => ({ ...f, url: e.target.value }))}
                            placeholder="https://example.com or /calendar/public"
                            className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 bg-white dark:bg-gray-800 dark:text-gray-100"
                            required
                          />
                        </div>
                        <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                          <input
                            type="checkbox"
                            checked={menuForm.openInNewTab}
                            onChange={(e) =>
                              setMenuForm((f) => ({ ...f, openInNewTab: e.target.checked }))
                            }
                            className="rounded border-gray-300 dark:border-gray-600"
                          />
                          Open in a new tab
                        </label>
                      </>
                    )}
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        Label {menuForm.linkType === 'internal' && menuForm.selectedArticleId && !menuForm.labelOverridden && '(from article)'}
                      </label>
                      <input
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
                        className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 bg-white dark:bg-gray-800 dark:text-gray-100"
                        required={
                          !(
                            menuForm.linkType === 'internal' &&
                            menuForm.selectedArticleId &&
                            !menuForm.labelOverridden
                          )
                        }
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Parent</label>
                      <select
                        value={menuForm.parentId ?? ''}
                        onChange={(e) =>
                          setMenuForm((f) => ({
                            ...f,
                            parentId: e.target.value ? parseInt(e.target.value, 10) : null,
                          }))
                        }
                        className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 bg-white dark:bg-gray-800 dark:text-gray-100"
                      >
                        <option value="">— None (top level) —</option>
                        {(() => {
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
                          const flatten = (parentId: number | null, depth: number): { item: MenuItem; depth: number }[] => {
                            const items = byParent.get(parentId) ?? [];
                            const result: { item: MenuItem; depth: number }[] = [];
                            for (const m of items) {
                              if (excludeIds.has(m.id)) continue;
                              result.push({ item: m, depth });
                              result.push(...flatten(m.id, depth + 1));
                            }
                            return result;
                          };
                          return flatten(null, 0).map(({ item: m, depth }) => (
                            <option key={m.id} value={m.id}>
                              {depth > 0 ? '\u00A0\u00A0'.repeat(depth) + '- ' : ''}{m.label}
                            </option>
                          ));
                        })()}
                      </select>
                    </div>
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
              <div>
                <div className="mb-4 flex flex-wrap items-end gap-3">
                  <div className="min-w-[280px]">
                    <label className="block text-sm font-medium mb-1">Add featured article</label>
                    <ArticleAutocomplete
                      value={menuArticleOptions.find((article) => article.id === selectedFeaturedArticleId) ?? null}
                      onChange={(selected) => setSelectedFeaturedArticleId(selected?.id ?? null)}
                      excludeIds={featuredHomeArticles.map((article) => article.id)}
                      placeholder="Search for an article to feature"
                    />
                  </div>
                  <Button
                    type="button"
                    disabled={!selectedFeaturedArticleId || saving}
                    onClick={() => {
                      if (!selectedFeaturedArticleId) return;
                      void handleSetFeatured(selectedFeaturedArticleId, true);
                      setSelectedFeaturedArticleId(null);
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
                  <ul className="space-y-2">
                    {featuredHomeArticles.map((article) => {
                      const showDropAbove = featuredDragOver?.targetId === article.id && featuredDragOver.insertBefore;
                      const showDropBelow = featuredDragOver?.targetId === article.id && !featuredDragOver.insertBefore;
                      return (
                        <li
                          key={article.id}
                          className="relative flex items-center justify-between gap-3 rounded border border-gray-200 dark:border-gray-700 px-3 py-2 cursor-grab active:cursor-grabbing"
                          draggable
                          onDragStart={(e) => {
                            featuredDragRef.current = article.id;
                            e.dataTransfer.setData('text/plain', String(article.id));
                            e.dataTransfer.effectAllowed = 'move';
                          }}
                          onDragEnd={() => {
                            featuredDragRef.current = null;
                            featuredDropTargetRef.current = null;
                            setFeaturedDragOver(null);
                          }}
                          onDragOver={(e) => {
                            const draggedId = featuredDragRef.current;
                            if (!draggedId || draggedId === article.id) return;
                            e.preventDefault();
                            const rect = e.currentTarget.getBoundingClientRect();
                            const insertBefore = e.clientY < rect.top + rect.height / 2;
                            featuredDropTargetRef.current = { targetId: article.id, insertBefore };
                            setFeaturedDragOver({ targetId: article.id, insertBefore });
                          }}
                          onDragLeave={() => {
                            setFeaturedDragOver((prev) => (prev?.targetId === article.id ? null : prev));
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            const draggedIdRaw = e.dataTransfer.getData('text/plain');
                            const target = featuredDropTargetRef.current;
                            featuredDropTargetRef.current = null;
                            setFeaturedDragOver(null);
                            const draggedId = Number.parseInt(draggedIdRaw, 10);
                            if (!Number.isFinite(draggedId) || !target || draggedId === target.targetId) return;
                            void handleFeaturedReorder(draggedId, target.targetId, target.insertBefore);
                          }}
                        >
                          {showDropAbove && <div className="absolute left-0 right-0 top-0 h-0.5 bg-primary-teal" aria-hidden />}
                          {showDropBelow && <div className="absolute left-0 right-0 bottom-0 h-0.5 bg-primary-teal" aria-hidden />}
                          <div className="min-w-0">
                            <div className="font-medium truncate">{article.title}</div>
                            <div className="text-xs text-gray-500 truncate">/articles/{article.slug}</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => void handleSetFeatured(article.id, false)}
                            className="text-sm text-red-600 dark:text-red-400 hover:underline"
                          >
                            Remove
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}

            {activeTab === 'articles' && (
              <div>
                <div className="mb-4 flex flex-wrap items-end gap-3">
                  <div className="min-w-[240px]">
                    <label className="block text-sm font-medium mb-1">Search</label>
                    <input
                      type="text"
                      value={articleSearch}
                      onChange={(e) => setArticleSearch(e.target.value)}
                      placeholder="Find by title"
                      className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 bg-white dark:bg-gray-800"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Page size</label>
                    <select
                      value={articlePageSize}
                      onChange={(e) => setArticlePageSize(Number.parseInt(e.target.value, 10))}
                      className="border border-gray-300 dark:border-gray-600 rounded px-3 py-2 bg-white dark:bg-gray-800"
                    >
                      {[10, 25, 50, 100].map((size) => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="ml-auto">
                    <p className="text-gray-500 text-sm mb-1">
                      Showing {articles.length} of {articleTotal}
                    </p>
                  </div>
                  <Button onClick={() => navigate('/admin/content/articles/new')}>Add article</Button>
                </div>

                <div className="overflow-x-auto border border-gray-200 dark:border-gray-700 rounded-lg">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-gray-900">
                      <tr>
                        <th className="px-3 py-2 text-left cursor-pointer" onClick={() => toggleArticleSort('title')}>Title</th>
                        <th className="px-3 py-2 text-left cursor-pointer" onClick={() => toggleArticleSort('slug')}>Slug</th>
                        <th className="px-3 py-2 text-left">Published</th>
                        <th className="px-3 py-2 text-left cursor-pointer" onClick={() => toggleArticleSort('updatedAt')}>Last edited</th>
                        <th className="px-3 py-2 text-left cursor-pointer" onClick={() => toggleArticleSort('publishedAt')}>Publish date</th>
                        <th className="px-3 py-2 text-left">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {articles.map((a) => (
                        <tr key={a.id} className="border-t border-gray-100 dark:border-gray-800">
                          <td className="px-3 py-2 min-w-[220px]">
                            <div className="font-medium truncate">{a.title}</div>
                          </td>
                          <td className="px-3 py-2 text-gray-500">
                            <a
                              href={`/articles/${a.slug}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary-teal hover:underline"
                            >
                              /articles/{a.slug}
                            </a>
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center">
                              <button
                                type="button"
                                role="switch"
                                aria-checked={!!a.publishedAt}
                                onClick={() => handleTogglePublished(a)}
                                disabled={togglingArticleId === a.id}
                                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-primary-teal focus:ring-offset-2 dark:focus:ring-offset-gray-900 ${
                                  a.publishedAt ? 'bg-primary-teal' : 'bg-gray-200 dark:bg-gray-600'
                                } ${togglingArticleId === a.id ? 'opacity-60 cursor-not-allowed' : ''}`}
                              >
                                <span
                                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition ${
                                    a.publishedAt ? 'translate-x-5' : 'translate-x-1'
                                  }`}
                                  aria-hidden
                                />
                              </button>
                            </div>
                          </td>
                          <td className="px-3 py-2">{a.updatedAt ? new Date(a.updatedAt).toLocaleDateString() : '-'}</td>
                          <td className="px-3 py-2">{a.publishedAt ? new Date(a.publishedAt).toLocaleDateString() : '-'}</td>
                          <td className="px-3 py-2">
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => navigate(`/admin/content/articles/${a.id}`)}
                                className="text-primary-teal hover:underline"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteArticle(a)}
                                className="text-red-600 dark:text-red-400 hover:underline"
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex items-center justify-between mt-3">
                  <p className="text-sm text-gray-500">
                    Showing {articles.length} of {articleTotal}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setArticlePage((p) => Math.max(1, p - 1))}
                      disabled={articlePage <= 1}
                    >
                      Previous
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setArticlePage((p) => p + 1)}
                      disabled={articlePage * articlePageSize >= articleTotal}
                    >
                      Next
                    </Button>
                  </div>
                </div>
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
                    <div>
                      <label className="block text-sm font-medium mb-1">Image source</label>
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
                    </div>
                    <div>
                      {showcaseSourceMode === 'uploaded' ? (
                        <>
                          <label className="block text-sm font-medium mb-1">Uploaded image</label>
                          {uploadedPublicImages.length > 0 ? (
                            <select
                              value={selectedShowcaseFileId ?? ''}
                              onChange={(e) => {
                                const fileId = Number(e.target.value);
                                const selectedFile = uploadedPublicImages.find((file) => file.id === fileId);
                                setSelectedShowcaseFileId(Number.isFinite(fileId) ? fileId : null);
                                setShowcaseForm((f) => ({ ...f, url: selectedFile?.publicUrl ?? '' }));
                              }}
                              className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 bg-white dark:bg-gray-800 dark:text-gray-100"
                              required
                            >
                              {uploadedPublicImages.map((file) => (
                                <option key={file.id} value={file.id}>
                                  {file.displayName || file.originalFilename}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <p className="text-sm text-gray-600 dark:text-gray-300">
                              No uploaded public images available. Upload an image in the Files tab, or use an external URL.
                            </p>
                          )}
                        </>
                      ) : (
                        <>
                          <label className="block text-sm font-medium mb-1">Image URL</label>
                          <input
                            type="url"
                            value={showcaseForm.url}
                            onChange={(e) => setShowcaseForm((f) => ({ ...f, url: e.target.value }))}
                            className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 bg-white dark:bg-gray-800 dark:text-gray-100"
                            required
                          />
                        </>
                      )}
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Caption</label>
                      <input
                        type="text"
                        value={showcaseForm.caption}
                        onChange={(e) => setShowcaseForm((f) => ({ ...f, caption: e.target.value }))}
                        className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 bg-white dark:bg-gray-800 dark:text-gray-100"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Sort order</label>
                      <input
                        type="number"
                        value={showcaseForm.sortOrder}
                        onChange={(e) => setShowcaseForm((f) => ({ ...f, sortOrder: parseInt(e.target.value, 10) || 0 }))}
                        className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 bg-white dark:bg-gray-800 dark:text-gray-100"
                      />
                    </div>
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
                <div className="flex flex-wrap gap-3 items-end justify-between">
                  <Button type="button" onClick={() => setUploadModalOpen(true)}>Upload file</Button>
                  {selectedFileIds.length > 0 && (
                    <Button type="button" variant="danger" onClick={handleBulkDeleteFiles} disabled={saving}>
                      Delete selected ({selectedFileIds.length})
                    </Button>
                  )}
                </div>

                <div className="flex flex-wrap gap-3 items-end">
                  <div>
                    <label className="block text-sm font-medium mb-1">Orphan status</label>
                    <select
                      value={fileOrphanFilter}
                      onChange={(e) => setFileOrphanFilter(e.target.value as 'all' | 'suspected')}
                      className="border border-gray-300 dark:border-gray-600 rounded px-3 py-2 bg-white dark:bg-gray-800"
                    >
                      <option value="all">All files</option>
                      <option value="suspected">Suspected orphan</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Visibility</label>
                    <select
                      value={fileVisibilityFilter}
                      onChange={(e) => setFileVisibilityFilter(e.target.value as 'all' | 'public' | 'authenticated')}
                      className="border border-gray-300 dark:border-gray-600 rounded px-3 py-2 bg-white dark:bg-gray-800"
                    >
                      <option value="all">All</option>
                      <option value="public">Public</option>
                      <option value="authenticated">Authenticated</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">File type</label>
                    <select
                      value={fileTypeFilter}
                      onChange={(e) => setFileTypeFilter(e.target.value as 'all' | 'image' | 'video' | 'audio' | 'document' | 'other')}
                      className="border border-gray-300 dark:border-gray-600 rounded px-3 py-2 bg-white dark:bg-gray-800"
                    >
                      <option value="all">All</option>
                      <option value="image">Image</option>
                      <option value="video">Video</option>
                      <option value="audio">Audio</option>
                      <option value="document">Document</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div className="min-w-[240px]">
                    <label className="block text-sm font-medium mb-1">Search</label>
                    <input
                      type="text"
                      value={fileSearch}
                      onChange={(e) => setFileSearch(e.target.value)}
                      placeholder="Name, description, filename"
                      className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 bg-white dark:bg-gray-800"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Page size</label>
                    <select
                      value={filePageSize}
                      onChange={(e) => setFilePageSize(Number.parseInt(e.target.value, 10))}
                      className="border border-gray-300 dark:border-gray-600 rounded px-3 py-2 bg-white dark:bg-gray-800"
                    >
                      {[10, 25, 50, 100].map((size) => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="overflow-x-auto border border-gray-200 dark:border-gray-700 rounded-lg">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-gray-900">
                      <tr>
                        <th className="px-3 py-2 text-left">
                          <input
                            type="checkbox"
                            checked={files.length > 0 && files.every((f) => selectedFileIds.includes(f.id))}
                            onChange={(e) => {
                              if (e.target.checked) setSelectedFileIds(files.map((f) => f.id));
                              else setSelectedFileIds([]);
                            }}
                          />
                        </th>
                        <th className="px-3 py-2 text-left">Preview</th>
                        <th className="px-3 py-2 text-left cursor-pointer" onClick={() => toggleFileSort('name')}>Name</th>
                        <th className="px-3 py-2 text-left cursor-pointer w-40" onClick={() => toggleFileSort('type')}>Type</th>
                        <th className="px-3 py-2 text-left cursor-pointer" onClick={() => toggleFileSort('size')}>Size</th>
                        <th className="px-3 py-2 text-left">Visibility</th>
                        <th className="px-3 py-2 text-left cursor-pointer" onClick={() => toggleFileSort('createdAt')}>Created</th>
                        <th className="px-3 py-2 text-left">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {files.map((file) => (
                        <tr key={file.id} className="border-t border-gray-100 dark:border-gray-800">
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={selectedFileIds.includes(file.id)}
                              onChange={(e) => {
                                setSelectedFileIds((prev) =>
                                  e.target.checked ? [...prev, file.id] : prev.filter((id) => id !== file.id)
                                );
                              }}
                            />
                          </td>
                          <td className="px-3 py-2">
                            {isImageFile(file) ? (
                              <img
                                src={getImageThumbnailUrl(file)}
                                alt=""
                                className="w-10 h-10 object-cover rounded border border-gray-200 dark:border-gray-700"
                              />
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </td>
                          <td className="px-3 py-2 min-w-[240px]">
                            <div className="font-medium truncate">{file.displayName || file.originalFilename}</div>
                            <div className="text-xs text-gray-500 truncate">{file.originalFilename}</div>
                            {file.suspectedOrphan && (
                              <span className="inline-block mt-1 text-[11px] px-2 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                                Suspected orphan
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 max-w-[10rem]">
                            <span className="block truncate" title={file.mimeType}>
                              {file.mimeType}
                            </span>
                          </td>
                          <td className="px-3 py-2">{Math.max(1, Math.round(file.byteSize / 1024))} KB</td>
                          <td className="px-3 py-2">{file.visibility}</td>
                          <td className="px-3 py-2">{new Date(file.createdAt).toLocaleDateString()}</td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <button type="button" onClick={() => handleCopyFileUrl(file)} className="text-primary-teal hover:underline">Copy URL</button>
                              <button type="button" onClick={() => openFileModal(file)} className="text-primary-teal hover:underline">Edit</button>
                              <button type="button" onClick={() => handleDeleteFile(file)} className="text-red-600 dark:text-red-400 hover:underline">Delete</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex items-center justify-between">
                  <p className="text-sm text-gray-500">
                    Showing {files.length} of {fileTotal}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setFilePage((p) => Math.max(1, p - 1))}
                      disabled={filePage <= 1}
                    >
                      Previous
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setFilePage((p) => p + 1)}
                      disabled={filePage * filePageSize >= fileTotal}
                    >
                      Next
                    </Button>
                  </div>
                </div>

                <Modal isOpen={uploadModalOpen} onClose={() => setUploadModalOpen(false)} title="Upload file">
                  <form onSubmit={handleUploadFile} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium mb-1">Files</label>
                      <input
                        type="file"
                        multiple
                        onChange={(e) => setSelectedUploadFiles(e.target.files ? Array.from(e.target.files) : [])}
                        className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 bg-white dark:bg-gray-800"
                      />
                    </div>
                    {selectedUploadFiles.length === 1 && (
                      <>
                        <div>
                          <label className="block text-sm font-medium mb-1">Display name (optional)</label>
                          <input
                            type="text"
                            value={fileUploadForm.displayName}
                            onChange={(e) => setFileUploadForm((f) => ({ ...f, displayName: e.target.value }))}
                            className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 bg-white dark:bg-gray-800"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-1">Description (optional)</label>
                          <textarea
                            value={fileUploadForm.description}
                            onChange={(e) => setFileUploadForm((f) => ({ ...f, description: e.target.value }))}
                            rows={3}
                            className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 bg-white dark:bg-gray-800"
                          />
                        </div>
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
                    <div>
                      <label className="block text-sm font-medium mb-1">Visibility</label>
                      <select
                        value={fileUploadForm.visibility}
                        onChange={(e) => setFileUploadForm((f) => ({ ...f, visibility: e.target.value as 'public' | 'authenticated' }))}
                        className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 bg-white dark:bg-gray-800"
                      >
                        <option value="public">Public</option>
                        <option value="authenticated">Logged-in users only</option>
                      </select>
                    </div>
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

                <Modal isOpen={fileModalOpen} onClose={closeFileModal} title="Edit file" size={editingFile && isImageFile(editingFile) ? 'xl' : 'md'}>
                  {editingFile && (
                    <div className="space-y-4">
                      {isImageFile(editingFile) && (
                        <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 p-1 bg-gray-50 dark:bg-gray-900">
                          <button
                            type="button"
                            onClick={() => setFileModalTab('details')}
                            className={`px-3 py-1.5 text-sm rounded-md ${fileModalTab === 'details' ? 'bg-white dark:bg-gray-800 text-primary-teal shadow-sm' : 'text-gray-600 dark:text-gray-400'}`}
                          >
                            File details
                          </button>
                          <button
                            type="button"
                            onClick={() => setFileModalTab('resize')}
                            className={`px-3 py-1.5 text-sm rounded-md ${fileModalTab === 'resize' ? 'bg-white dark:bg-gray-800 text-primary-teal shadow-sm' : 'text-gray-600 dark:text-gray-400'}`}
                          >
                            Resize
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setFileModalTab('cropRotate');
                              setRotateDegrees(0);
                            }}
                            className={`px-3 py-1.5 text-sm rounded-md ${fileModalTab === 'cropRotate' ? 'bg-white dark:bg-gray-800 text-primary-teal shadow-sm' : 'text-gray-600 dark:text-gray-400'}`}
                          >
                            Crop & Rotate
                          </button>
                        </div>
                      )}

                      {isImageFile(editingFile) && (
                        <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 bg-gray-50 dark:bg-gray-900">
                          <div className="text-xs text-gray-500 mb-2">
                            {previewNaturalSize ? `Image: ${previewNaturalSize.width} × ${previewNaturalSize.height}` : 'Loading image preview...'}
                          </div>
                          <div
                            className={`relative inline-block max-w-full overflow-hidden rounded ${fileModalTab === 'cropRotate' ? 'cursor-crosshair' : ''}`}
                            onMouseDown={handleCropMouseDown}
                            onMouseMove={handleCropMouseMove}
                            onMouseUp={handleCropMouseUp}
                          >
                            <img
                              ref={previewImageRef}
                              src={getImagePreviewUrl(editingFile)}
                              alt={editingFile.displayName || editingFile.originalFilename}
                              className="max-h-[70vh] max-w-full rounded border border-gray-200 dark:border-gray-700 select-none"
                              draggable={false}
                              onLoad={(e) => {
                                const target = e.currentTarget;
                                setPreviewNaturalSize({
                                  width: target.naturalWidth,
                                  height: target.naturalHeight,
                                });
                              }}
                              style={getCropRotatePreviewTransform()}
                            />
                            {fileModalTab === 'cropRotate' && cropSelection && cropSelection.width > 0 && cropSelection.height > 0 && (
                              <div
                                className="absolute border-2 border-primary-teal bg-primary-teal/15 pointer-events-none"
                                style={{
                                  left: `${cropSelection.x}px`,
                                  top: `${cropSelection.y}px`,
                                  width: `${cropSelection.width}px`,
                                  height: `${cropSelection.height}px`,
                                }}
                              />
                            )}
                          </div>
                        </div>
                      )}

                      {fileModalTab === 'resize' && isImageFile(editingFile) ? (
                        <form onSubmit={handleResizeImage} className="space-y-4">
                          <div className="flex gap-4">
                            <button
                              type="button"
                              onClick={() => setResizeMode('preset')}
                              className={`px-3 py-2 text-sm rounded-md border ${
                                resizeMode === 'preset'
                                  ? 'border-primary-teal text-primary-teal bg-primary-teal/10'
                                  : 'border-gray-300 dark:border-gray-600'
                              }`}
                            >
                              Presets
                            </button>
                            <button
                              type="button"
                              onClick={() => setResizeMode('custom')}
                              className={`px-3 py-2 text-sm rounded-md border ${
                                resizeMode === 'custom'
                                  ? 'border-primary-teal text-primary-teal bg-primary-teal/10'
                                  : 'border-gray-300 dark:border-gray-600'
                              }`}
                            >
                              Custom
                            </button>
                          </div>

                          {resizeMode === 'preset' ? (
                            <div className="grid grid-cols-2 gap-2">
                              {([
                                { key: 'thumbnail', label: 'Thumbnail', value: '320px' },
                                { key: 'small', label: 'Small', value: '640px' },
                                { key: 'medium', label: 'Medium', value: '1024px' },
                                { key: 'large', label: 'Large', value: '1600px' },
                              ] as const).map((preset) => (
                                <button
                                  key={preset.key}
                                  type="button"
                                  onClick={() =>
                                    setResizeForm((f) => ({
                                      ...f,
                                      preset: preset.key,
                                    }))
                                  }
                                  className={`text-left p-3 rounded-md border ${
                                    resizeForm.preset === preset.key
                                      ? 'border-primary-teal bg-primary-teal/10'
                                      : 'border-gray-300 dark:border-gray-600'
                                  }`}
                                >
                                  <div className="font-medium text-sm">{preset.label}</div>
                                  <div className="text-xs text-gray-500">{preset.value} max side</div>
                                </button>
                              ))}
                            </div>
                          ) : (
                            <div className="grid grid-cols-2 gap-2">
                              <input
                                type="number"
                                min={1}
                                placeholder="Width"
                                value={resizeForm.width}
                                onChange={(e) => setResizeForm((f) => ({ ...f, width: e.target.value }))}
                                className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 bg-white dark:bg-gray-800"
                              />
                              <input
                                type="number"
                                min={1}
                                placeholder="Height"
                                value={resizeForm.height}
                                onChange={(e) => setResizeForm((f) => ({ ...f, height: e.target.value }))}
                                className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 bg-white dark:bg-gray-800"
                              />
                            </div>
                          )}

                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={resizeForm.keepOriginal}
                              onChange={(e) =>
                                setResizeForm((f) => ({
                                  ...f,
                                  keepOriginal: e.target.checked,
                                }))
                              }
                            />
                            Keep original image
                          </label>

                          <Button type="submit" disabled={imageToolsBusy}>
                            {imageToolsBusy ? 'Working...' : 'Apply resize'}
                          </Button>
                        </form>
                      ) : fileModalTab === 'cropRotate' && isImageFile(editingFile) ? (
                        <form onSubmit={handleApplyCropRotate} className="space-y-3 border border-gray-200 dark:border-gray-700 rounded p-3">
                          <p className="font-medium">Crop & Rotate</p>
                          <p className="text-xs text-gray-500">
                            Choose rotation, optionally draw a crop rectangle on preview, then apply once.
                          </p>
                          <div className="flex gap-2">
                            {[0, 90, 180, 270].map((deg) => (
                              <button
                                key={deg}
                                type="button"
                                onClick={() => setRotateDegrees(deg)}
                                className={`px-3 py-2 rounded-md border text-sm ${
                                  rotateDegrees === deg
                                    ? 'border-primary-teal text-primary-teal bg-primary-teal/10'
                                    : 'border-gray-300 dark:border-gray-600'
                                }`}
                              >
                                {deg}°
                              </button>
                            ))}
                          </div>
                          {cropOutputDimensions ? (
                            <p className="text-xs text-gray-500">
                              Crop output: {cropOutputDimensions.width} × {cropOutputDimensions.height} px
                            </p>
                          ) : (
                            <p className="text-xs text-gray-500">No crop selection: rotation only will be applied.</p>
                          )}
                          <div className="flex gap-2">
                            <Button type="submit" disabled={imageToolsBusy}>
                              {imageToolsBusy ? 'Working...' : 'Apply crop & rotate'}
                            </Button>
                            <Button
                              type="button"
                              variant="secondary"
                              onClick={() => setCropSelection(null)}
                              disabled={imageToolsBusy}
                            >
                              Clear cropping
                            </Button>
                          </div>
                        </form>
                      ) : (
                        <form onSubmit={handleSaveFileMetadata} className="space-y-4">
                          <div>
                            <label className="block text-sm font-medium mb-1">Display name</label>
                            <input
                              type="text"
                              value={fileEditForm.displayName}
                              onChange={(e) => setFileEditForm((f) => ({ ...f, displayName: e.target.value }))}
                              className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 bg-white dark:bg-gray-800"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium mb-1">Description</label>
                            <textarea
                              value={fileEditForm.description}
                              onChange={(e) => setFileEditForm((f) => ({ ...f, description: e.target.value }))}
                              rows={3}
                              className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 bg-white dark:bg-gray-800"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium mb-1">Visibility</label>
                            <select
                              value={fileEditForm.visibility}
                              onChange={(e) => setFileEditForm((f) => ({ ...f, visibility: e.target.value as 'public' | 'authenticated' }))}
                              className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 bg-white dark:bg-gray-800"
                            >
                              <option value="public">Public</option>
                              <option value="authenticated">Authenticated users only</option>
                            </select>
                          </div>
                          {isImageFile(editingFile) && (
                            <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
                              <div>
                                <label className="block text-sm font-medium mb-1">Convert image type</label>
                                <select
                                  value={convertFormat}
                                  onChange={(e) => setConvertFormat(e.target.value as 'jpg' | 'png' | 'gif')}
                                  className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 bg-white dark:bg-gray-800"
                                >
                                  <option value="jpg">JPG</option>
                                  <option value="png">PNG</option>
                                  <option value="gif">GIF</option>
                                </select>
                              </div>
                              <Button type="button" variant="secondary" onClick={handleConvertImageType} disabled={imageToolsBusy}>
                                {imageToolsBusy ? 'Working...' : 'Convert'}
                              </Button>
                            </div>
                          )}
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={fileEditForm.suspectedOrphan}
                              onChange={(e) => setFileEditForm((f) => ({ ...f, suspectedOrphan: e.target.checked }))}
                            />
                            <span className="text-sm">Mark as suspected orphan</span>
                          </label>
                          <div className="flex justify-end gap-2 pt-2">
                            <Button type="button" variant="secondary" onClick={closeFileModal}>
                              Cancel
                            </Button>
                            <Button type="submit" disabled={saving}>
                              {saving ? 'Saving...' : 'Save'}
                            </Button>
                          </div>
                        </form>
                      )}
                    </div>
                  )}
                </Modal>
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
