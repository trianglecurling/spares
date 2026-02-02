import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import Layout from '../../components/Layout';
import api from '../../utils/api';
import { useAlert } from '../../contexts/AlertContext';
import { useAuth } from '../../contexts/AuthContext';
import Button from '../../components/Button';
import Modal from '../../components/Modal';

interface League {
  id: number;
  name: string;
  dayOfWeek: number;
  format: 'teams' | 'doubles';
  startDate: string;
  endDate: string;
  drawTimes: string[];
  exceptions: string[];
  canManage?: boolean;
}

export default function Leagues() {
  const { showAlert } = useAlert();
  const { member } = useAuth();
  const navigate = useNavigate();
  const [leagues, setLeagues] = useState<League[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importJson, setImportJson] = useState('');
  const [importing, setImporting] = useState(false);
  const [editingLeague, setEditingLeague] = useState<League | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    dayOfWeek: 0,
    format: 'teams' as 'teams' | 'doubles',
    startDate: '',
    endDate: '',
    drawTimes: [''],
    exceptions: [] as string[],
  });
  const [showExceptionPicker, setShowExceptionPicker] = useState(false);
  const [exceptionToAdd, setExceptionToAdd] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadLeagues();
  }, []);

  const loadLeagues = async () => {
    try {
      const response = await api.get('/leagues');
      setLeagues(response.data);
    } catch (error) {
      console.error('Failed to load leagues:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenModal = (league?: League) => {
    if (league) {
      setEditingLeague(league);
      setFormData({
        name: league.name,
        dayOfWeek: league.dayOfWeek,
        format: league.format,
        startDate: league.startDate,
        endDate: league.endDate,
        drawTimes: league.drawTimes,
        exceptions: league.exceptions || [],
      });
    } else {
      setEditingLeague(null);
      setFormData({
        name: '',
        dayOfWeek: 0,
        format: 'teams',
        startDate: '',
        endDate: '',
        drawTimes: [''],
        exceptions: [],
      });
    }
    setShowExceptionPicker(false);
    setExceptionToAdd('');
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingLeague(null);
    setShowExceptionPicker(false);
    setExceptionToAdd('');
  };

  const computeLeagueDates = (startDateStr: string, endDateStr: string, dayOfWeek: number): string[] => {
    if (!startDateStr || !endDateStr) return [];
    const startDate = new Date(startDateStr + 'T00:00:00Z');
    const endDate = new Date(endDateStr + 'T00:00:00Z');
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime()) || startDate > endDate) return [];

    const dates: string[] = [];
    const currentDate = new Date(startDate);
    const currentDay = currentDate.getUTCDay();
    const daysUntilTarget = (dayOfWeek - currentDay + 7) % 7;
    currentDate.setUTCDate(currentDate.getUTCDate() + daysUntilTarget);

    while (currentDate <= endDate) {
      dates.push(currentDate.toISOString().split('T')[0]);
      currentDate.setUTCDate(currentDate.getUTCDate() + 7);
    }
    return dates;
  };

  const allLeagueDates = computeLeagueDates(formData.startDate, formData.endDate, formData.dayOfWeek);
  const availableExceptionDates = allLeagueDates.filter((d) => !formData.exceptions.includes(d));

  // If dates/day change, drop exceptions that are no longer valid for the league range/day
  useEffect(() => {
    const valid = new Set(computeLeagueDates(formData.startDate, formData.endDate, formData.dayOfWeek));
    if (formData.exceptions.some((d) => !valid.has(d))) {
      setFormData((prev) => ({
        ...prev,
        exceptions: prev.exceptions.filter((d) => valid.has(d)),
      }));
      setExceptionToAdd('');
    }
  }, [formData.startDate, formData.endDate, formData.dayOfWeek]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const uniqueExceptions = Array.from(new Set(formData.exceptions)).sort();
      const payload = {
        name: formData.name,
        dayOfWeek: formData.dayOfWeek,
        format: formData.format,
        startDate: formData.startDate,
        endDate: formData.endDate,
        drawTimes: formData.drawTimes.filter((t) => t.trim() !== ''),
        exceptions: uniqueExceptions,
      };

      if (editingLeague) {
        await api.patch(`/leagues/${editingLeague.id}`, payload);
      } else {
        await api.post('/leagues', payload);
      }

      await loadLeagues();
      handleCloseModal();
    } catch (error) {
      console.error('Failed to save league:', error);
      showAlert('Failed to save league', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const addDrawTime = () => {
    setFormData({
      ...formData,
      drawTimes: [...formData.drawTimes, ''],
    });
  };

  const updateDrawTime = (index: number, value: string) => {
    const newDrawTimes = [...formData.drawTimes];
    newDrawTimes[index] = value;
    setFormData({ ...formData, drawTimes: newDrawTimes });
  };

  const removeDrawTime = (index: number) => {
    setFormData({
      ...formData,
      drawTimes: formData.drawTimes.filter((_, i) => i !== index),
    });
  };

  const handleExport = async () => {
    try {
      const response = await api.get('/leagues/export');
      const jsonString = JSON.stringify(response.data, null, 2);
      
      // Copy to clipboard
      await navigator.clipboard.writeText(jsonString);
      showAlert('Leagues exported and copied to clipboard!', 'success');
    } catch (error) {
      console.error('Failed to export leagues:', error);
      showAlert('Failed to export leagues', 'error');
    }
  };

  const handleImport = async () => {
    if (!importJson.trim()) {
      showAlert('Please paste JSON data', 'warning');
      return;
    }

    setImporting(true);
    try {
      let data;
      try {
        data = JSON.parse(importJson);
      } catch (e) {
        showAlert('Invalid JSON. Please check your data.', 'error');
        setImporting(false);
        return;
      }

      const response = await api.post('/leagues/import', data);
      showAlert(`Successfully imported ${response.data.imported} league(s)!`, 'success');
      setIsImportModalOpen(false);
      setImportJson('');
      await loadLeagues();
    } catch (error: unknown) {
      console.error('Failed to import leagues:', error);
      const errorMessage = axios.isAxiosError(error)
        ? error.response?.data?.error || 'Failed to import leagues'
        : 'Failed to import leagues';
      showAlert(errorMessage, 'error');
    } finally {
      setImporting(false);
    }
  };

  const getDayName = (dayOfWeek: number) => {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[dayOfWeek];
  };

  const formatTime = (timeStr: string) => {
    const [hours, minutes] = timeStr.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  // Helper to format date for display, handling timezone offset
  const formatDateDisplay = (dateString: string) => {
    if (!dateString) return '';
    // Create date object and adjust for timezone offset to display correct local date
    const date = new Date(dateString);
    const userTimezoneOffset = date.getTimezoneOffset() * 60000;
    const adjustedDate = new Date(date.getTime() + userTimezoneOffset);
    return adjustedDate.toLocaleDateString();
  };

  const removeException = (dateStr: string) => {
    setFormData((prev) => ({
      ...prev,
      exceptions: prev.exceptions.filter((d) => d !== dateStr),
    }));
  };

  const canManageLeagueDetails = Boolean(
    member?.isAdmin || member?.isServerAdmin || member?.isLeagueAdministratorGlobal
  );

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-bold text-[#121033] dark:text-gray-100">
            Leagues
          </h1>
          <div className="flex space-x-2">
            {canManageLeagueDetails && (
              <>
                <Button onClick={handleExport} variant="secondary">
                  Export
                </Button>
                <Button onClick={() => setIsImportModalOpen(true)} variant="secondary">
                  Import
                </Button>
                <Button onClick={() => handleOpenModal()}>Add league</Button>
              </>
            )}
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400">Loading...</div>
        ) : leagues.length === 0 ? (
          <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg shadow">
            <p className="text-gray-600 dark:text-gray-400 text-lg mb-4">No leagues configured yet.</p>
            {canManageLeagueDetails && (
              <Button onClick={() => handleOpenModal()}>Create your first league</Button>
            )}
          </div>
        ) : (
          <div className="grid gap-4">
            {leagues.map((league) => (
              <div key={league.id} className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <button
                      type="button"
                      onClick={() => navigate(`/leagues/${league.id}`)}
                      className="text-left text-xl font-semibold mb-2 text-primary-teal hover:underline"
                    >
                      {league.name}
                    </button>
                    <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                      <p>
                        <span className="font-medium dark:text-gray-300">Day:</span> {getDayName(league.dayOfWeek)}
                      </p>
                      <p>
                        <span className="font-medium dark:text-gray-300">Times:</span>{' '}
                        {league.drawTimes.map(formatTime).join(', ')}
                      </p>
                      <p>
                        <span className="font-medium dark:text-gray-300">Format:</span>{' '}
                        {league.format === 'teams' ? 'Teams' : 'Doubles'}
                      </p>
                      <p>
                        <span className="font-medium dark:text-gray-300">Season:</span>{' '}
                        {formatDateDisplay(league.startDate)} -{' '}
                        {formatDateDisplay(league.endDate)}
                      </p>
                      {league.exceptions?.length > 0 && (
                        <p>
                          <span className="font-medium dark:text-gray-300">Exceptions:</span>{' '}
                          {league.exceptions.length} date(s)
                        </p>
                      )}
                    </div>
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
        title={editingLeague ? 'Edit league' : 'Add league'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              League name <span className="text-red-500">*</span>
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
            <label htmlFor="dayOfWeek" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Day of week <span className="text-red-500">*</span>
            </label>
            <select
              id="dayOfWeek"
              value={formData.dayOfWeek}
              onChange={(e) => setFormData({ ...formData, dayOfWeek: parseInt(e.target.value) })}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
              required
            >
              {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(
                (day, index) => (
                  <option key={index} value={index}>
                    {day}
                  </option>
                )
              )}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Draw times <span className="text-red-500">*</span>
            </label>
            {formData.drawTimes.map((time, index) => (
              <div key={index} className="flex space-x-2 mb-2">
                <input
                  type="time"
                  value={time}
                  onChange={(e) => updateDrawTime(index, e.target.value)}
                  className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
                  required
                />
                {formData.drawTimes.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeDrawTime(index)}
                    className="px-3 py-2 text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={addDrawTime}
              className="text-sm text-primary-teal hover:text-opacity-80"
            >
              + Add draw time
            </button>
          </div>

          <div>
            <label htmlFor="format" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Format <span className="text-red-500">*</span>
            </label>
            <select
              id="format"
              value={formData.format}
              onChange={(e) =>
                setFormData({ ...formData, format: e.target.value as 'teams' | 'doubles' })
              }
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
              required
            >
              <option value="teams">Teams</option>
              <option value="doubles">Doubles</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="startDate" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Start date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                id="startDate"
                value={formData.startDate}
                onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
                required
              />
            </div>

            <div>
              <label htmlFor="endDate" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                End date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                id="endDate"
                value={formData.endDate}
                onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Exceptions (dates the league does not run)
            </label>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setShowExceptionPicker((v) => !v)}
                disabled={!formData.startDate || !formData.endDate}
              >
                Add exception
              </Button>

              {showExceptionPicker && (
                <select
                  value={exceptionToAdd}
                  onChange={(e) => {
                    const selected = e.target.value;
                    setExceptionToAdd(selected);
                    if (!selected) return;
                    if (!formData.exceptions.includes(selected)) {
                      setFormData((prev) => ({
                        ...prev,
                        exceptions: [...prev.exceptions, selected].sort(),
                      }));
                    }
                    setExceptionToAdd('');
                  }}
                  className="w-full sm:w-auto px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
                >
                  <option value="">
                    {availableExceptionDates.length === 0 ? 'No dates available' : 'Select a date...'}
                  </option>
                  {availableExceptionDates.map((d) => (
                    <option key={d} value={d}>
                      {formatDateDisplay(d)}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {formData.exceptions.length > 0 && (
              <div className="mt-3 space-y-2">
                {formData.exceptions.map((d) => (
                  <div
                    key={d}
                    className="flex items-center justify-between px-3 py-2 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/40"
                  >
                    <span className="text-sm text-gray-700 dark:text-gray-300">{formatDateDisplay(d)}</span>
                    <button
                      type="button"
                      onClick={() => removeException(d)}
                      className="text-sm text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
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

      <Modal
        isOpen={isImportModalOpen}
        onClose={() => {
          setIsImportModalOpen(false);
          setImportJson('');
        }}
        title="Import leagues"
      >
        <div className="space-y-4">
          <div>
            <label htmlFor="importJson" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Paste JSON data
            </label>
            <textarea
              id="importJson"
              value={importJson}
              onChange={(e) => setImportJson(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent font-mono text-sm"
              rows={15}
              placeholder='{"leagues": [{"name": "Example League", "dayOfWeek": 1, "format": "teams", "startDate": "2024-01-01", "endDate": "2024-12-31", "drawTimes": ["19:00", "21:00"]}]}'
            />
          </div>
          <div className="flex space-x-3">
            <Button onClick={handleImport} disabled={importing} className="flex-1">
              {importing ? 'Importing...' : 'Import'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setIsImportModalOpen(false);
                setImportJson('');
              }}
              disabled={importing}
              className="flex-1"
            >
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </Layout>
  );
}
