import { useEffect, useState } from 'react';
import Layout from '../../components/Layout';
import { del, get, patch, post } from '../../api/client';
import { formatApiError } from '../../utils/api';
import { useAlert } from '../../contexts/AlertContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import Button from '../../components/Button';
import Modal from '../../components/Modal';

interface Sheet {
  id: number;
  name: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export default function AdminSheets() {
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSheet, setEditingSheet] = useState<Sheet | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    sortOrder: 0,
    isActive: true,
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadSheets();
  }, []);

  const loadSheets = async () => {
    try {
      const response = await get('/sheets');
      setSheets(response);
    } catch (error) {
      console.error('Failed to load sheets:', error);
      showAlert('Failed to load sheets', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenModal = (sheet?: Sheet) => {
    if (sheet) {
      setEditingSheet(sheet);
      setFormData({
        name: sheet.name,
        sortOrder: sheet.sortOrder,
        isActive: sheet.isActive,
      });
    } else {
      setEditingSheet(null);
      setFormData({
        name: '',
        sortOrder: sheets.length,
        isActive: true,
      });
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingSheet(null);
    setFormData({
      name: '',
      sortOrder: 0,
      isActive: true,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const payload = {
        name: formData.name,
        sortOrder: formData.sortOrder,
        isActive: formData.isActive,
      };

      if (editingSheet) {
        await patch('/sheets/{id}', payload, { id: String(editingSheet.id) });
      } else {
        await post('/sheets', payload);
      }

      await loadSheets();
      handleCloseModal();
    } catch (error: unknown) {
      console.error('Failed to save sheet:', error);
      showAlert(formatApiError(error, 'Failed to save sheet'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (sheet: Sheet) => {
    const confirmed = await confirm({
      title: 'Delete sheet',
      message: `Are you sure you want to delete ${sheet.name}? This action cannot be undone.`,
      variant: 'danger',
      confirmText: 'Delete',
    });

    if (!confirmed) return;

    try {
      await del('/sheets/{id}', undefined, { id: String(sheet.id) });
      setSheets((prev) => prev.filter((s) => s.id !== sheet.id));
    } catch (error: unknown) {
      console.error('Failed to delete sheet:', error);
      showAlert(formatApiError(error, 'Failed to delete sheet'), 'error');
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-bold text-[#121033] dark:text-gray-100">Manage sheets</h1>
          <Button onClick={() => handleOpenModal()}>Add sheet</Button>
        </div>

        {loading ? (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400">Loading...</div>
        ) : sheets.length === 0 ? (
          <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg shadow">
            <p className="text-gray-600 dark:text-gray-400 text-lg mb-4">
              No sheets configured yet.
            </p>
            <Button onClick={() => handleOpenModal()}>Create your first sheet</Button>
          </div>
        ) : (
          <div className="grid gap-4">
            {sheets.map((sheet) => (
              <div key={sheet.id} className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <h3 className="text-xl font-semibold mb-2 dark:text-gray-100">{sheet.name}</h3>
                    <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                      <p>
                        <span className="font-medium dark:text-gray-300">Sort order:</span>{' '}
                        {sheet.sortOrder}
                      </p>
                      <p>
                        <span className="font-medium dark:text-gray-300">Status:</span>{' '}
                        {sheet.isActive ? 'Active' : 'Inactive'}
                      </p>
                    </div>
                  </div>

                  <div className="flex space-x-2">
                    <Button onClick={() => handleOpenModal(sheet)} variant="secondary">
                      Edit
                    </Button>
                    <Button onClick={() => handleDelete(sheet)} variant="danger">
                      Delete
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        title={editingSheet ? 'Edit sheet' : 'Add sheet'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="name"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
            >
              Sheet name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
              required
            />
          </div>

          <div>
            <label
              htmlFor="sortOrder"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
            >
              Sort order
            </label>
            <input
              type="number"
              id="sortOrder"
              value={formData.sortOrder}
              onChange={(e) =>
                setFormData({ ...formData, sortOrder: parseInt(e.target.value, 10) || 0 })
              }
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
            />
          </div>

          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="isActive"
              checked={formData.isActive}
              onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
              className="rounded border-gray-300 text-primary-teal focus:ring-primary-teal"
            />
            <label
              htmlFor="isActive"
              className="text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Active
            </label>
          </div>

          <div className="flex space-x-3">
            <Button type="submit" disabled={submitting} className="flex-1">
              {submitting ? 'Saving...' : 'Save'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={handleCloseModal}
              disabled={submitting}
              className="flex-1"
            >
              Cancel
            </Button>
          </div>
        </form>
      </Modal>
    </Layout>
  );
}
