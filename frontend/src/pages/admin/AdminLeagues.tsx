import { useEffect, useState } from 'react';
import Layout from '../../components/Layout';
import api from '../../utils/api';
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
}

export default function AdminLeagues() {
  const [leagues, setLeagues] = useState<League[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingLeague, setEditingLeague] = useState<League | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    dayOfWeek: 0,
    format: 'teams' as 'teams' | 'doubles',
    startDate: '',
    endDate: '',
    drawTimes: [''],
  });
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
      });
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingLeague(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const payload = {
        name: formData.name,
        dayOfWeek: formData.dayOfWeek,
        format: formData.format,
        startDate: formData.startDate,
        endDate: formData.endDate,
        drawTimes: formData.drawTimes.filter((t) => t.trim() !== ''),
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
      alert('Failed to save league');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`Are you sure you want to delete ${name}?`)) {
      return;
    }

    try {
      await api.delete(`/leagues/${id}`);
      setLeagues(leagues.filter((l) => l.id !== id));
    } catch (error) {
      console.error('Failed to delete league:', error);
      alert('Failed to delete league');
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

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-bold" style={{ color: '#121033' }}>
            Manage leagues
          </h1>
          <Button onClick={() => handleOpenModal()}>Add league</Button>
        </div>

        {loading ? (
          <div className="text-center py-12 text-gray-500">Loading...</div>
        ) : leagues.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg shadow">
            <p className="text-gray-600 text-lg mb-4">No leagues configured yet.</p>
            <Button onClick={() => handleOpenModal()}>Create your first league</Button>
          </div>
        ) : (
          <div className="grid gap-4">
            {leagues.map((league) => (
              <div key={league.id} className="bg-white rounded-lg shadow p-6">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <h3 className="text-xl font-semibold mb-2">{league.name}</h3>
                    <div className="text-sm text-gray-600 space-y-1">
                      <p>
                        <span className="font-medium">Day:</span> {getDayName(league.dayOfWeek)}
                      </p>
                      <p>
                        <span className="font-medium">Times:</span>{' '}
                        {league.drawTimes.map(formatTime).join(', ')}
                      </p>
                      <p>
                        <span className="font-medium">Format:</span>{' '}
                        {league.format === 'teams' ? 'Teams' : 'Doubles'}
                      </p>
                      <p>
                        <span className="font-medium">Season:</span>{' '}
                        {formatDateDisplay(league.startDate)} -{' '}
                        {formatDateDisplay(league.endDate)}
                      </p>
                    </div>
                  </div>

                  <div className="flex space-x-2">
                    <Button onClick={() => handleOpenModal(league)} variant="secondary">
                      Edit
                    </Button>
                    <Button onClick={() => handleDelete(league.id, league.name)} variant="danger">
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
        title={editingLeague ? 'Edit league' : 'Add league'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-2">
              League name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
              required
            />
          </div>

          <div>
            <label htmlFor="dayOfWeek" className="block text-sm font-medium text-gray-700 mb-2">
              Day of week <span className="text-red-500">*</span>
            </label>
            <select
              id="dayOfWeek"
              value={formData.dayOfWeek}
              onChange={(e) => setFormData({ ...formData, dayOfWeek: parseInt(e.target.value) })}
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
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
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Draw times <span className="text-red-500">*</span>
            </label>
            {formData.drawTimes.map((time, index) => (
              <div key={index} className="flex space-x-2 mb-2">
                <input
                  type="time"
                  value={time}
                  onChange={(e) => updateDrawTime(index, e.target.value)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
                  required
                />
                {formData.drawTimes.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeDrawTime(index)}
                    className="px-3 py-2 text-red-600 hover:text-red-800"
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
            <label htmlFor="format" className="block text-sm font-medium text-gray-700 mb-2">
              Format <span className="text-red-500">*</span>
            </label>
            <select
              id="format"
              value={formData.format}
              onChange={(e) =>
                setFormData({ ...formData, format: e.target.value as 'teams' | 'doubles' })
              }
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
              required
            >
              <option value="teams">Teams</option>
              <option value="doubles">Doubles</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="startDate" className="block text-sm font-medium text-gray-700 mb-2">
                Start date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                id="startDate"
                value={formData.startDate}
                onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
                required
              />
            </div>

            <div>
              <label htmlFor="endDate" className="block text-sm font-medium text-gray-700 mb-2">
                End date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                id="endDate"
                value={formData.endDate}
                onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
                required
              />
            </div>
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
