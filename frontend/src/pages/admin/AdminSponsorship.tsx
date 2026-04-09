import { useEffect, useState } from 'react';
import { AppPage, AppPageHeader } from '../../components/AppPage';
import DragHandle from '../../components/dragDrop/DragHandle';
import SortableList from '../../components/dragDrop/SortableList';
import SortableRow from '../../components/dragDrop/SortableRow';
import Layout from '../../components/Layout';
import api from '../../utils/api';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import { useAlert } from '../../contexts/AlertContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { HiChevronDown, HiChevronUp } from 'react-icons/hi2';

type Level = { id: number; name: string; amount: number | null; sortOrder: number };
type Sponsor = {
  id: number;
  name: string;
  websiteUrl: string;
  logoFileId: number | null;
  logoUrl: string | null;
  contactName: string | null;
  contactEmail: string | null;
};
type Sponsorship = {
  id: number;
  sponsorId: number;
  sponsorshipLevelId: number;
  startDate: string | null;
  endDate: string | null;
  sponsorName: string;
  levelName: string;
};
type PublicFile = {
  id: number;
  displayName: string | null;
  originalFilename: string;
  publicUrl: string;
};

export default function AdminSponsorship() {
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [levels, setLevels] = useState<Level[]>([]);
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [sponsorships, setSponsorships] = useState<Sponsorship[]>([]);
  const [logoFiles, setLogoFiles] = useState<PublicFile[]>([]);
  const [logoUploadFile, setLogoUploadFile] = useState<File | null>(null);
  const [expandedSections, setExpandedSections] = useState({
    levels: false,
    sponsors: false,
    sponsorships: false,
  });

  const [levelModalOpen, setLevelModalOpen] = useState(false);
  const [editingLevel, setEditingLevel] = useState<Level | null>(null);
  const [levelForm, setLevelForm] = useState({ name: '', amount: '' });

  const [sponsorModalOpen, setSponsorModalOpen] = useState(false);
  const [editingSponsor, setEditingSponsor] = useState<Sponsor | null>(null);
  const [sponsorForm, setSponsorForm] = useState({
    name: '',
    websiteUrl: '',
    logoFileId: '',
    contactName: '',
    contactEmail: '',
  });

  const [sponsorshipModalOpen, setSponsorshipModalOpen] = useState(false);
  const [editingSponsorship, setEditingSponsorship] = useState<Sponsorship | null>(null);
  const [sponsorshipForm, setSponsorshipForm] = useState({
    sponsorId: '',
    sponsorshipLevelId: '',
    startDate: '',
    endDate: '',
  });

  async function loadAll() {
    setLoading(true);
    try {
      const [levelsRes, sponsorsRes, sponsorshipsRes, filesRes] = await Promise.all([
        api.get<Level[]>('/sponsorship/levels'),
        api.get<Sponsor[]>('/sponsorship/sponsors'),
        api.get<Sponsorship[]>('/sponsorship/sponsorships'),
        api.get<{ items: PublicFile[] }>('/content/files', {
          params: { page: 1, pageSize: 1000, visibility: 'public', type: 'image' },
        }),
      ]);
      setLevels(levelsRes.data);
      setSponsors(sponsorsRes.data);
      setSponsorships(sponsorshipsRes.data);
      setLogoFiles(filesRes.data.items);
    } catch {
      showAlert('Failed to load sponsorship data', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function saveLevel() {
    setSaving(true);
    const trimmedName = levelForm.name.trim();
    const amountValue =
      levelForm.amount.trim() === '' ? null : Number.parseInt(levelForm.amount, 10);
    if (!trimmedName) {
      showAlert('Level name is required', 'warning');
      setSaving(false);
      return;
    }
    if (amountValue !== null && Number.isNaN(amountValue)) {
      showAlert('Amount must be a valid whole number', 'warning');
      setSaving(false);
      return;
    }
    if (amountValue !== null && amountValue < 0) {
      showAlert('Amount cannot be negative', 'warning');
      setSaving(false);
      return;
    }
    try {
      const payload = {
        name: trimmedName,
        amount: amountValue,
      };
      if (editingLevel) {
        await api.patch(`/sponsorship/levels/${editingLevel.id}`, payload);
      } else {
        await api.post('/sponsorship/levels', payload);
      }
      setLevelModalOpen(false);
      await loadAll();
    } catch {
      showAlert('Failed to save level', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function saveSponsor() {
    setSaving(true);
    try {
      let logoFileId = sponsorForm.logoFileId ? Number.parseInt(sponsorForm.logoFileId, 10) : null;

      if (logoUploadFile) {
        setUploadingLogo(true);
        const formData = new FormData();
        formData.append('file', logoUploadFile);
        formData.append(
          'displayName',
          sponsorForm.name.trim() ? `${sponsorForm.name.trim()} logo` : logoUploadFile.name
        );
        formData.append('visibility', 'public');

        const created = await api.post<Array<{ id: number }>>('/content/files', formData, {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        });
        const uploadedId = created.data?.[0]?.id;
        if (!uploadedId) {
          throw new Error('Upload did not return a file id');
        }
        logoFileId = uploadedId;
      }

      const payload = {
        name: sponsorForm.name,
        websiteUrl: sponsorForm.websiteUrl,
        logoFileId,
        contactName: sponsorForm.contactName || null,
        contactEmail: sponsorForm.contactEmail || null,
      };

      if (editingSponsor) {
        await api.patch(`/sponsorship/sponsors/${editingSponsor.id}`, payload);
      } else {
        await api.post('/sponsorship/sponsors', payload);
      }
      setLogoUploadFile(null);
      setSponsorModalOpen(false);
      await loadAll();
    } catch {
      showAlert('Failed to save sponsor', 'error');
    } finally {
      setUploadingLogo(false);
      setSaving(false);
    }
  }

  async function saveSponsorship() {
    setSaving(true);
    const payload = {
      sponsorId: Number.parseInt(sponsorshipForm.sponsorId, 10),
      sponsorshipLevelId: Number.parseInt(sponsorshipForm.sponsorshipLevelId, 10),
      startDate: sponsorshipForm.startDate || null,
      endDate: sponsorshipForm.endDate || null,
    };
    try {
      if (editingSponsorship) {
        await api.patch(`/sponsorship/sponsorships/${editingSponsorship.id}`, payload);
      } else {
        await api.post('/sponsorship/sponsorships', payload);
      }
      setSponsorshipModalOpen(false);
      await loadAll();
    } catch {
      showAlert('Failed to save sponsorship', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function reorderLevels(nextLevels: Level[]) {
    const next = nextLevels.map((level) => level.id);
    setLevels(nextLevels.map((level, idx) => ({ ...level, sortOrder: idx })));
    try {
      await api.post('/sponsorship/levels/reorder', { ids: next });
    } catch {
      showAlert('Failed to reorder levels', 'error');
      await loadAll();
    }
  }

  return (
    <Layout>
      <AppPage>
        <AppPageHeader title="Sponsorship management" description="Manage sponsorship levels, sponsors, and sponsorships." />

        {loading ? (
          <div className="text-gray-500">Loading...</div>
        ) : (
          <div className="space-y-6">
            <section className="app-card">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <h2 className="app-section-title">
                    Sponsorship levels
                  </h2>
                  <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                    Levels define sponsorship tiering. Higher levels appear first on the homepage.
                    Drag rows to reorder ranking.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setExpandedSections((prev) => ({
                      ...prev,
                      levels: !prev.levels,
                    }))
                  }
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600"
                  aria-label={
                    expandedSections.levels
                      ? 'Collapse sponsorship levels'
                      : 'Expand sponsorship levels'
                  }
                  title={expandedSections.levels ? 'Collapse' : 'Expand'}
                >
                  {expandedSections.levels ? (
                    <HiChevronUp className="h-5 w-5" />
                  ) : (
                    <HiChevronDown className="h-5 w-5" />
                  )}
                </button>
              </div>
              {expandedSections.levels ? (
                <div className="mb-4 flex justify-end">
                  <Button
                    onClick={() => {
                      setEditingLevel(null);
                      setLevelForm({ name: '', amount: '' });
                      setLevelModalOpen(true);
                    }}
                  >
                    Add level
                  </Button>
                </div>
              ) : null}
              {expandedSections.levels ? (
                <SortableList
                  items={levels}
                  getId={(level) => level.id}
                  getItemLabel={(level) => level.name}
                  itemNoun="sponsorship level"
                  onReorder={(nextLevels) => void reorderLevels(nextLevels)}
                  renderItem={({ item: level, index: idx, isDragging, isOverlay, dragHandle }) => (
                    <SortableRow
                      isDragging={isDragging}
                      isOverlay={isOverlay}
                      className="border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          {dragHandle}
                          <span className="rounded bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-200">
                            Rank {idx + 1}
                          </span>
                          <div className="font-medium text-gray-900 dark:text-gray-100">
                            {level.name}
                            {level.amount !== null ? ` ($${level.amount.toLocaleString()})` : ''}
                          </div>
                        </div>
                        <div className="space-x-2">
                          <Button
                            variant="secondary"
                            onClick={() => {
                              setEditingLevel(level);
                              setLevelForm({
                                name: level.name,
                                amount: level.amount !== null ? String(level.amount) : '',
                              });
                              setLevelModalOpen(true);
                            }}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="danger"
                            onClick={async () => {
                              if (
                                !(await confirm({
                                  title: 'Delete level',
                                  message: `Delete ${level.name}?`,
                                  confirmText: 'Delete',
                                  variant: 'danger',
                                }))
                              ) {
                                return;
                              }
                              try {
                                await api.delete(`/sponsorship/levels/${level.id}`);
                                await loadAll();
                              } catch {
                                showAlert('Failed to delete level', 'error');
                              }
                            }}
                          >
                            Delete
                          </Button>
                        </div>
                      </div>
                    </SortableRow>
                  )}
                  renderOverlay={(level) => (
                    <SortableRow isDragging isOverlay className="border-primary-teal/60 bg-gray-50 dark:bg-gray-900">
                      <div className="flex items-center gap-3">
                        <DragHandle label={`Reorder ${level.name}`} disabled />
                        <div className="font-medium text-gray-900 dark:text-gray-100">
                          {level.name}
                          {level.amount !== null ? ` ($${level.amount.toLocaleString()})` : ''}
                        </div>
                      </div>
                    </SortableRow>
                  )}
                />
              ) : null}
            </section>

            <section className="app-card">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <h2 className="app-section-title">
                    Sponsors
                  </h2>
                  <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                    Sponsors represent organizations. Add logo and website URL here, then map them
                    to levels using sponsorship records below.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setExpandedSections((prev) => ({
                      ...prev,
                      sponsors: !prev.sponsors,
                    }))
                  }
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600"
                  aria-label={expandedSections.sponsors ? 'Collapse sponsors' : 'Expand sponsors'}
                  title={expandedSections.sponsors ? 'Collapse' : 'Expand'}
                >
                  {expandedSections.sponsors ? (
                    <HiChevronUp className="h-5 w-5" />
                  ) : (
                    <HiChevronDown className="h-5 w-5" />
                  )}
                </button>
              </div>
              {expandedSections.sponsors ? (
                <div className="mb-4 flex justify-end">
                  <Button
                    onClick={() => {
                      setEditingSponsor(null);
                      setSponsorForm({
                        name: '',
                        websiteUrl: '',
                        logoFileId: '',
                        contactName: '',
                        contactEmail: '',
                      });
                      setLogoUploadFile(null);
                      setSponsorModalOpen(true);
                    }}
                  >
                    Add sponsor
                  </Button>
                </div>
              ) : null}
              {expandedSections.sponsors ? (
                <div className="space-y-2">
                  {sponsors.map((sponsor) => (
                    <div
                      key={sponsor.id}
                      className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-900"
                    >
                      <div className="flex items-center gap-3">
                        {sponsor.logoUrl ? (
                          <img
                            src={sponsor.logoUrl}
                            alt={sponsor.name}
                            className="h-10 w-20 rounded bg-white object-contain p-1 dark:bg-gray-100"
                          />
                        ) : (
                          <div className="flex h-10 w-20 items-center justify-center rounded bg-white text-xs text-gray-400 dark:bg-gray-700 dark:text-gray-300">
                            No logo
                          </div>
                        )}
                        <div>
                          <div className="font-medium text-gray-900 dark:text-gray-100">
                            {sponsor.name}
                          </div>
                          <div className="text-xs text-gray-600 dark:text-gray-300">
                            {sponsor.websiteUrl}
                          </div>
                        </div>
                      </div>
                      <div className="space-x-2">
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setEditingSponsor(sponsor);
                            setSponsorForm({
                              name: sponsor.name,
                              websiteUrl: sponsor.websiteUrl,
                              logoFileId: sponsor.logoFileId ? String(sponsor.logoFileId) : '',
                              contactName: sponsor.contactName ?? '',
                              contactEmail: sponsor.contactEmail ?? '',
                            });
                            setLogoUploadFile(null);
                            setSponsorModalOpen(true);
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="danger"
                          onClick={async () => {
                            if (
                              !(await confirm({
                                title: 'Delete sponsor',
                                message: `Delete ${sponsor.name}?`,
                                confirmText: 'Delete',
                                variant: 'danger',
                              }))
                            ) {
                              return;
                            }
                            try {
                              await api.delete(`/sponsorship/sponsors/${sponsor.id}`);
                              await loadAll();
                            } catch {
                              showAlert('Failed to delete sponsor', 'error');
                            }
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>

            <section className="app-card">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <h2 className="app-section-title">
                    Sponsorships
                  </h2>
                  <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                    Sponsorships assign a sponsor to a level and optional date window.
                    Current display is inclusive of start and end dates.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setExpandedSections((prev) => ({
                      ...prev,
                      sponsorships: !prev.sponsorships,
                    }))
                  }
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600"
                  aria-label={
                    expandedSections.sponsorships ? 'Collapse sponsorships' : 'Expand sponsorships'
                  }
                  title={expandedSections.sponsorships ? 'Collapse' : 'Expand'}
                >
                  {expandedSections.sponsorships ? (
                    <HiChevronUp className="h-5 w-5" />
                  ) : (
                    <HiChevronDown className="h-5 w-5" />
                  )}
                </button>
              </div>
              {expandedSections.sponsorships ? (
                <div className="mb-4 flex justify-end">
                  <Button
                    onClick={() => {
                      setEditingSponsorship(null);
                      setSponsorshipForm({
                        sponsorId: '',
                        sponsorshipLevelId: '',
                        startDate: '',
                        endDate: '',
                      });
                      setSponsorshipModalOpen(true);
                    }}
                  >
                    Add sponsorship
                  </Button>
                </div>
              ) : null}
              {expandedSections.sponsorships ? (
                <div className="space-y-2">
                  {sponsorships.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-900"
                    >
                      <div className="text-gray-900 dark:text-gray-100">
                        <span className="font-medium">{s.sponsorName}</span>
                        <span className="text-gray-500 dark:text-gray-400"> - </span>
                        <span>{s.levelName}</span>
                        <div className="text-xs text-gray-600 dark:text-gray-300">
                          {s.startDate || 'No start'} to {s.endDate || 'No end'}
                        </div>
                      </div>
                      <div className="space-x-2">
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setEditingSponsorship(s);
                            setSponsorshipForm({
                              sponsorId: String(s.sponsorId),
                              sponsorshipLevelId: String(s.sponsorshipLevelId),
                              startDate: s.startDate ?? '',
                              endDate: s.endDate ?? '',
                            });
                            setSponsorshipModalOpen(true);
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="danger"
                          onClick={async () => {
                            if (
                              !(await confirm({
                                title: 'Delete sponsorship',
                                message: 'Delete this sponsorship?',
                                confirmText: 'Delete',
                                variant: 'danger',
                              }))
                            ) {
                              return;
                            }
                            try {
                              await api.delete(`/sponsorship/sponsorships/${s.id}`);
                              await loadAll();
                            } catch {
                              showAlert('Failed to delete sponsorship', 'error');
                            }
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
          </div>
        )}
      </AppPage>

      <Modal
        isOpen={levelModalOpen}
        onClose={() => setLevelModalOpen(false)}
        title={editingLevel ? 'Edit level' : 'Add level'}
      >
        <div className="space-y-4">
          <div>
            <label
              htmlFor="level-name"
              className="app-label"
            >
              Level name
            </label>
            <input
              id="level-name"
              className="app-input"
              placeholder="Platinum"
              value={levelForm.name}
              onChange={(e) => setLevelForm((p) => ({ ...p, name: e.target.value }))}
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Used for grouping and display order.
            </p>
          </div>
          <div>
            <label
              htmlFor="level-amount"
              className="app-label"
            >
              Dollar amount
            </label>
            <input
              id="level-amount"
              type="number"
              min={0}
              className="app-input"
              placeholder="5000"
              value={levelForm.amount}
              onChange={(e) => setLevelForm((p) => ({ ...p, amount: e.target.value }))}
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Optional. Leave blank if this level has no fixed dollar amount.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setLevelModalOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={saveLevel} disabled={saving || !levelForm.name.trim()}>
              {saving ? 'Saving...' : 'Save level'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={sponsorModalOpen}
        onClose={() => setSponsorModalOpen(false)}
        title={editingSponsor ? 'Edit sponsor' : 'Add sponsor'}
      >
        <div className="space-y-4">
          <div>
            <label
              htmlFor="sponsor-name"
              className="app-label"
            >
              Sponsor name
            </label>
            <input
              id="sponsor-name"
              className="app-input"
              placeholder="Acme Corp"
              value={sponsorForm.name}
              onChange={(e) => setSponsorForm((p) => ({ ...p, name: e.target.value }))}
            />
          </div>

          <div>
            <label
              htmlFor="sponsor-website"
              className="app-label"
            >
              Website URL
            </label>
            <input
              id="sponsor-website"
              className="app-input"
              placeholder="https://example.com"
              value={sponsorForm.websiteUrl}
              onChange={(e) => setSponsorForm((p) => ({ ...p, websiteUrl: e.target.value }))}
            />
          </div>

          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900">
            <p className="text-sm font-medium text-gray-800 dark:text-gray-100">Logo</p>
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
              Select an existing uploaded image or choose a new file to upload when you save.
            </p>

            <div className="mt-3 space-y-2">
              <label
                htmlFor="sponsor-logo-file"
                className="block text-sm font-medium text-gray-700 dark:text-gray-200"
              >
                Use existing image
              </label>
              <select
                id="sponsor-logo-file"
                className="app-input"
                value={sponsorForm.logoFileId}
                disabled={Boolean(logoUploadFile) || uploadingLogo || saving}
                onChange={(e) => setSponsorForm((p) => ({ ...p, logoFileId: e.target.value }))}
              >
                <option value="">No logo selected</option>
                {logoFiles.map((file) => (
                  <option key={file.id} value={file.id}>
                    {file.displayName || file.originalFilename}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-3">
              <div>
                <label
                  htmlFor="new-sponsor-logo"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-200"
                >
                  Upload new image
                </label>
                <input
                  id="new-sponsor-logo"
                  type="file"
                  accept="image/*"
                  className="mt-1 w-full text-sm text-gray-700 dark:text-gray-200"
                  onChange={(e) => setLogoUploadFile(e.target.files?.[0] ?? null)}
                />
              </div>
              {logoUploadFile ? (
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                  Selected: {logoUploadFile.name}. This file will upload when you click Save
                  sponsor.
                </p>
              ) : null}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="sponsor-contact-name"
                className="app-label"
              >
                Contact name (optional)
              </label>
              <input
                id="sponsor-contact-name"
                className="app-input"
                value={sponsorForm.contactName}
                onChange={(e) => setSponsorForm((p) => ({ ...p, contactName: e.target.value }))}
              />
            </div>
            <div>
              <label
                htmlFor="sponsor-contact-email"
                className="app-label"
              >
                Contact email (optional)
              </label>
              <input
                id="sponsor-contact-email"
                className="app-input"
                value={sponsorForm.contactEmail}
                onChange={(e) =>
                  setSponsorForm((p) => ({
                    ...p,
                    contactEmail: e.target.value,
                  }))
                }
              />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setSponsorModalOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button onClick={saveSponsor} disabled={saving}>
              {saving || uploadingLogo ? 'Saving...' : 'Save sponsor'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={sponsorshipModalOpen}
        onClose={() => setSponsorshipModalOpen(false)}
        title={editingSponsorship ? 'Edit sponsorship' : 'Add sponsorship'}
      >
        <div className="space-y-4">
          <div>
            <label
              htmlFor="sponsorship-sponsor"
              className="app-label"
            >
              Sponsor
            </label>
            <select
              id="sponsorship-sponsor"
              className="app-input"
              value={sponsorshipForm.sponsorId}
              onChange={(e) => setSponsorshipForm((p) => ({ ...p, sponsorId: e.target.value }))}
            >
              <option value="">Choose sponsor</option>
              {sponsors.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="sponsorship-level"
              className="app-label"
            >
              Sponsorship level
            </label>
            <select
              id="sponsorship-level"
              className="app-input"
              value={sponsorshipForm.sponsorshipLevelId}
              onChange={(e) =>
                setSponsorshipForm((p) => ({
                  ...p,
                  sponsorshipLevelId: e.target.value,
                }))
              }
            >
              <option value="">Choose level</option>
              {levels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="sponsorship-start"
                className="app-label"
              >
                Start date (optional)
              </label>
              <input
                id="sponsorship-start"
                type="date"
                className="app-input"
                value={sponsorshipForm.startDate}
                onChange={(e) =>
                  setSponsorshipForm((p) => ({
                    ...p,
                    startDate: e.target.value,
                  }))
                }
              />
            </div>
            <div>
              <label
                htmlFor="sponsorship-end"
                className="app-label"
              >
                End date (optional)
              </label>
              <input
                id="sponsorship-end"
                type="date"
                className="app-input"
                value={sponsorshipForm.endDate}
                onChange={(e) =>
                  setSponsorshipForm((p) => ({
                    ...p,
                    endDate: e.target.value,
                  }))
                }
              />
            </div>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Current status is inclusive: active when today is on/after start date (or no start) and
            on/before end date (or no end).
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setSponsorshipModalOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button onClick={saveSponsorship} disabled={saving}>
              {saving ? 'Saving...' : 'Save sponsorship'}
            </Button>
          </div>
        </div>
      </Modal>
    </Layout>
  );
}
