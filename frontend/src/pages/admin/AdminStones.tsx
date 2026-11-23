import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { get, post } from '../../api/client';
import AppPageControlsRow from '../../components/AppPageControlsRow';
import AppStateCard from '../../components/AppStateCard';
import Button from '../../components/Button';
import StoneDateActionModal from '../../components/stones/StoneDateActionModal';
import StoneFormModal from '../../components/stones/StoneFormModal';
import StoneIceMap from '../../components/stones/StoneIceMap';
import StoneImportModal from '../../components/stones/StoneImportModal';
import StoneMaintenanceModal from '../../components/stones/StoneMaintenanceModal';
import DataTable from '../../components/table/DataTable';
import { useAlert } from '../../contexts/AlertContext';
import { formatApiError } from '../../utils/api';
import {
  adminStoneHref,
  formatStoneDate,
  stonePositionLabel,
  type StonePosition,
  type StoneSummary,
} from '../../utils/curlingStones';

type DialogState =
  | { type: 'add'; position?: StonePosition }
  | { type: 'import' }
  | { type: 'rotate' }
  | { type: 'maintenance' }
  | null;

export default function AdminStones() {
  const { showAlert } = useAlert();
  const [stones, setStones] = useState<StoneSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);

  const loadStones = useCallback(async () => {
    try {
      const response = await get('/public/stones');
      setStones(response.stones);
      setLoadError(null);
    } catch (error) {
      setLoadError(formatApiError(error, 'Failed to load stones'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStones();
  }, [loadStones]);

  const onSheets = useMemo(() => stones.filter((stone) => stone.current?.sheet != null), [stones]);
  const lastSheetChange = useMemo(
    () =>
      onSheets
        .map((stone) => stone.current?.effectiveDate ?? '')
        .sort()
        .pop(),
    [onSheets],
  );

  const closeAndReload = () => {
    setDialog(null);
    void loadStones();
  };

  const handleRotate = async ({ effectiveDate }: { effectiveDate: string }) => {
    try {
      const result = await post('/stones/rotate', { effectiveDate });
      showAlert(`Rotated ${result.moved} stones to the next sheet`, 'success');
      closeAndReload();
    } catch (error) {
      showAlert(formatApiError(error, 'Failed to rotate stones'), 'error');
      throw error;
    }
  };

  const controls = (
    <AppPageControlsRow
      left={
        stones.length > 0 ? (
          <>
            <Button
              variant="secondary"
              onClick={() => setDialog({ type: 'rotate' })}
              disabled={onSheets.length === 0}
              title={onSheets.length === 0 ? 'Assign stones to sheets before rotating.' : undefined}
            >
              Rotate sheets
            </Button>
            <Button variant="secondary" onClick={() => setDialog({ type: 'maintenance' })}>
              Record maintenance
            </Button>
            <Link to="/stones" className="text-sm font-medium text-primary-teal-link hover:underline">
              View public page
            </Link>
          </>
        ) : undefined
      }
      right={
        <>
          <Button variant="secondary" onClick={() => setDialog({ type: 'import' })}>
            Import stones
          </Button>
          <Button onClick={() => setDialog({ type: 'add' })}>Add stone</Button>
        </>
      }
    />
  );

  return (
    <>
      {controls}

      {loading ? (
        <AppStateCard title="Loading stones..." />
      ) : loadError ? (
        <AppStateCard
          title="Stones could not be loaded."
          description={loadError}
          action={
            <Button variant="secondary" onClick={() => void loadStones()}>
              Try again
            </Button>
          }
        />
      ) : stones.length === 0 ? (
        <AppStateCard
          title="No stones yet."
          description="Import your stones from a spreadsheet, or add them one at a time."
          action={
            <div className="flex flex-wrap justify-center gap-3">
              <Button variant="secondary" onClick={() => setDialog({ type: 'import' })}>
                Import stones
              </Button>
              <Button onClick={() => setDialog({ type: 'add' })}>Add stone</Button>
            </div>
          }
        />
      ) : (
        <div className="space-y-8">
          <section className="space-y-3">
            <div className="space-y-1">
              <h2 className="app-section-title">On the ice</h2>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Each sheet shows its red and yellow stones in handle order. The small letter on each stone is the side
                in play. Select a stone to see its history, or an empty spot to add a stone there.
              </p>
            </div>
            <StoneIceMap
              stones={stones}
              getStoneHref={(stone) => adminStoneHref(stone.id)}
              onEmptyPositionClick={(position) => setDialog({ type: 'add', position })}
            />
          </section>

          <section className="space-y-3">
            <h2 className="app-section-title">All stones</h2>
            <DataTable<StoneSummary, never, number>
              rows={stones}
              rowKey={(stone) => stone.id}
              columns={[
                {
                  id: 'wcf',
                  header: 'WCF number',
                  renderCell: (stone) => (
                    <Link to={adminStoneHref(stone.id)} className="font-medium text-primary-teal-link hover:underline">
                      {stone.wcfRegistrationNumber}
                    </Link>
                  ),
                },
                { id: 'al', header: 'AL serial', renderCell: (stone) => stone.alSerialNumber },
                { id: 'position', header: 'Position', renderCell: (stone) => stonePositionLabel(stone.current) },
                { id: 'side', header: 'Side in play', renderCell: (stone) => stone.current?.side ?? '' },
                {
                  id: 'texturing',
                  header: 'Last textured',
                  renderCell: (stone) => formatStoneDate(stone.lastMaintenance.texturing) || '—',
                },
                {
                  id: 'narrowing',
                  header: 'Last band narrowing',
                  renderCell: (stone) => formatStoneDate(stone.lastMaintenance.bandNarrowing) || '—',
                },
                {
                  id: 'imprinting',
                  header: 'Last imprinted',
                  renderCell: (stone) => formatStoneDate(stone.lastMaintenance.imprinting) || '—',
                },
              ]}
            />
          </section>
        </div>
      )}

      {dialog?.type === 'add' ? (
        <StoneFormModal
          stones={stones}
          initialPosition={dialog.position}
          onClose={() => setDialog(null)}
          onSaved={closeAndReload}
        />
      ) : null}
      {dialog?.type === 'import' ? (
        <StoneImportModal onClose={() => setDialog(null)} onImported={closeAndReload} />
      ) : null}
      {dialog?.type === 'maintenance' ? (
        <StoneMaintenanceModal stones={stones} onClose={() => setDialog(null)} onSaved={closeAndReload} />
      ) : null}
      {dialog?.type === 'rotate' ? (
        <StoneDateActionModal
          title="Rotate sheets"
          submitLabel={`Rotate ${onSheets.length} stones`}
          minDate={lastSheetChange}
          onClose={() => setDialog(null)}
          onSubmit={handleRotate}
          description={
            <div className="space-y-2">
              <p>
                Every stone on the ice moves one sheet over: A to B, B to C, C to D, and D to A. Colors, rock numbers,
                and the side in play stay the same.
              </p>
              <p>The red and yellow spares stay where they are.</p>
            </div>
          }
        />
      ) : null}
    </>
  );
}
