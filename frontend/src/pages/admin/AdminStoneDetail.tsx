import axios from 'axios';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { del, get, patch, post } from '../../api/client';
import { AppPage, AppPageHeader } from '../../components/AppPage';
import AppPageControlsRow from '../../components/AppPageControlsRow';
import AppStateCard from '../../components/AppStateCard';
import BackButton from '../../components/BackButton';
import Button from '../../components/Button';
import StoneDateActionModal from '../../components/stones/StoneDateActionModal';
import StoneDetailsList from '../../components/stones/StoneDetailsList';
import StoneFormModal from '../../components/stones/StoneFormModal';
import { StoneMaintenanceTable, StonePlacementTable } from '../../components/stones/StoneHistoryTables';
import StoneMaintenanceModal from '../../components/stones/StoneMaintenanceModal';
import StoneMoveModal from '../../components/stones/StoneMoveModal';
import { useAlert } from '../../contexts/AlertContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { formatApiError } from '../../utils/api';
import {
  adminStoneHref,
  formatStoneDate,
  maintenanceSummary,
  MAINTENANCE_ACTIVITY_LABELS,
  PLACEMENT_CHANGE_LABELS,
  publicStoneHref,
  stonePositionLabel,
  stoneTitle,
  type StoneDetailResponse,
  type StoneMaintenance,
  type StonePlacement,
  type StoneSummary,
} from '../../utils/curlingStones';

type DialogState =
  | { type: 'edit' }
  | { type: 'move' }
  | { type: 'flip' }
  | { type: 'maintenance'; record?: StoneMaintenance }
  | { type: 'placement'; placement: StonePlacement }
  | null;

const backButton = <BackButton label="Stones" to="/admin/facility/stones" />;

function placementEntryLabel(placement: StonePlacement): string {
  return `${PLACEMENT_CHANGE_LABELS[placement.changeType].toLowerCase()} entry from ${formatStoneDate(placement.effectiveDate)}`;
}

function placementScopeNote(placement: StonePlacement): string | null {
  if (placement.groupSize <= 1) return null;
  if (placement.changeType === 'swapped' && placement.relatedStone) {
    return `This also updates the matching entry for stone ${placement.relatedStone.wcfRegistrationNumber}.`;
  }
  if (placement.changeType === 'rotated') {
    return `This updates the whole rotation, all ${placement.groupSize} stones.`;
  }
  return `This updates all ${placement.groupSize} stones changed at the same time.`;
}

function placementDateHelper(range: StonePlacement['dateRange']): string | null {
  if (range.min && range.max) {
    return `Between ${formatStoneDate(range.min)} and ${formatStoneDate(range.max)}, so history stays in order.`;
  }
  if (range.min) return `${formatStoneDate(range.min)} or later, so history stays in order.`;
  if (range.max) return `${formatStoneDate(range.max)} or earlier, so history stays in order.`;
  return null;
}

export default function AdminStoneDetail() {
  const { stoneId = '' } = useParams();
  const navigate = useNavigate();
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const [detail, setDetail] = useState<StoneDetailResponse | null>(null);
  const [stones, setStones] = useState<StoneSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<{ notFound: boolean; message: string } | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);

  const load = useCallback(async () => {
    try {
      const [detailResponse, listResponse] = await Promise.all([
        get('/public/stones/{id}', undefined, { id: stoneId }),
        get('/public/stones'),
      ]);
      setDetail(detailResponse);
      setStones(listResponse.stones);
      setLoadError(null);
    } catch (error) {
      const notFound = axios.isAxiosError(error) && error.response?.status === 404;
      setLoadError({ notFound, message: formatApiError(error, 'Failed to load stone') });
    } finally {
      setLoading(false);
    }
  }, [stoneId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const closeAndReload = () => {
    setDialog(null);
    void load();
  };

  if (loading) {
    return (
      <AppPage>
        <AppPageHeader title="Stone" actions={backButton} />
        <AppStateCard title="Loading stone..." />
      </AppPage>
    );
  }

  if (loadError || !detail) {
    return (
      <AppPage>
        <AppPageHeader title="Stone" actions={backButton} />
        <AppStateCard
          title={loadError?.notFound ? 'Stone not found.' : 'This stone could not be loaded.'}
          description={loadError?.notFound ? 'It may have been deleted.' : loadError?.message}
          action={
            loadError?.notFound ? (
              <Link to="/admin/facility/stones" className="font-medium text-primary-teal-link hover:underline">
                View all stones
              </Link>
            ) : (
              <Button variant="secondary" onClick={() => void load()}>
                Try again
              </Button>
            )
          }
        />
      </AppPage>
    );
  }

  const { stone, placements, maintenance } = detail;
  const current = stone.current;
  const otherSide = current?.side === 'B' ? 'A' : 'B';

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: 'Delete stone',
      message: `Delete stone ${stone.wcfRegistrationNumber} (AL serial ${stone.alSerialNumber})? Its position history and all ${maintenance.length} maintenance records will be deleted too. This cannot be undone.`,
      variant: 'danger',
      confirmText: 'Delete stone',
    });
    if (!confirmed) return;
    try {
      await del('/stones/{id}', undefined, { id: String(stone.id) });
      showAlert('Stone deleted', 'success');
      navigate('/admin/facility/stones');
    } catch (error) {
      showAlert(formatApiError(error, 'Failed to delete stone'), 'error');
    }
  };

  const handleDeleteMaintenance = async (record: StoneMaintenance) => {
    const confirmed = await confirm({
      title: 'Delete maintenance record',
      message: `Delete the ${MAINTENANCE_ACTIVITY_LABELS[record.activityType].toLowerCase()} record from ${formatStoneDate(record.performedOn)} (${maintenanceSummary(record)})? This cannot be undone.`,
      variant: 'danger',
      confirmText: 'Delete record',
    });
    if (!confirmed) return;
    try {
      await del('/stones/maintenance/{id}', undefined, { id: String(record.id) });
      showAlert('Maintenance record deleted', 'success');
      void load();
    } catch (error) {
      showAlert(formatApiError(error, 'Failed to delete maintenance record'), 'error');
    }
  };

  const handleUpdatePlacement = async (
    placement: StonePlacement,
    values: { effectiveDate: string; notes: string | null },
  ) => {
    try {
      const { affected } = await patch('/stones/placements/{id}', values, { id: String(placement.id) });
      showAlert(affected > 1 ? `Updated history for ${affected} stones` : 'Position history updated', 'success');
      closeAndReload();
    } catch (error) {
      showAlert(formatApiError(error, 'Failed to update position history'), 'error');
      throw error;
    }
  };

  const handleUndoPlacement = async (placement: StonePlacement) => {
    const previous = placements[placements.findIndex((entry) => entry.id === placement.id) + 1];
    const outcome =
      placement.changeType === 'swapped' && placement.relatedStone
        ? `Both this stone and stone ${placement.relatedStone.wcfRegistrationNumber} go back to where they were.`
        : placement.changeType === 'rotated'
          ? `All ${placement.groupSize} stones in the rotation move back one sheet.`
          : placement.changeType === 'flipped'
            ? `Side ${previous?.side ?? (placement.side === 'A' ? 'B' : 'A')} goes back in play.`
            : `This stone goes back to ${stonePositionLabel(previous)}.`;
    const confirmed = await confirm({
      title: 'Undo position change',
      message: `Undo the ${placementEntryLabel(placement)}? ${outcome} The entry is removed from history.`,
      variant: 'danger',
      confirmText: 'Undo change',
    });
    if (!confirmed) return;
    try {
      await del('/stones/placements/{id}', undefined, { id: String(placement.id) });
      showAlert('Position change undone', 'success');
      void load();
    } catch (error) {
      showAlert(formatApiError(error, 'Failed to undo position change'), 'error');
    }
  };

  const handleFlip = async ({ effectiveDate, notes }: { effectiveDate: string; notes: string | null }) => {
    try {
      await post('/stones/{id}/flip', { effectiveDate, notes }, { id: String(stone.id) });
      showAlert(`Stone flipped to side ${otherSide}`, 'success');
      closeAndReload();
    } catch (error) {
      showAlert(formatApiError(error, 'Failed to flip stone'), 'error');
      throw error;
    }
  };

  return (
    <AppPage>
      <AppPageHeader
        title={stoneTitle(stone)}
        description={
          current
            ? `${stonePositionLabel(current)} · Side ${current.side} in play`
            : stonePositionLabel(current)
        }
        actions={backButton}
      />

      <AppPageControlsRow
        left={
          <Link to={publicStoneHref(stone.id)} className="text-sm font-medium text-primary-teal-link hover:underline">
            View public page
          </Link>
        }
        right={
          <>
            <Button variant="secondary" onClick={() => setDialog({ type: 'move' })}>
              Move or swap
            </Button>
            <Button variant="secondary" onClick={() => setDialog({ type: 'flip' })}>
              Flip to side {otherSide}
            </Button>
            <Button onClick={() => setDialog({ type: 'maintenance' })}>Record maintenance</Button>
          </>
        }
      />

      <section className="app-card space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="app-section-title">Details</h2>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setDialog({ type: 'edit' })}>
              Edit
            </Button>
            <Button variant="outline-danger" onClick={() => void handleDelete()}>
              Delete
            </Button>
          </div>
        </div>
        <StoneDetailsList stone={stone} />
      </section>

      <section className="space-y-3">
        <h2 className="app-section-title">Maintenance</h2>
        <StoneMaintenanceTable
          records={maintenance}
          renderActions={(record) => (
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                className="!px-3 !py-1"
                onClick={() => setDialog({ type: 'maintenance', record })}
                aria-label={`Edit ${MAINTENANCE_ACTIVITY_LABELS[record.activityType].toLowerCase()} record from ${formatStoneDate(record.performedOn)}`}
              >
                Edit
              </Button>
              <Button
                variant="outline-danger"
                className="!px-3 !py-1"
                onClick={() => void handleDeleteMaintenance(record)}
                aria-label={`Delete ${MAINTENANCE_ACTIVITY_LABELS[record.activityType].toLowerCase()} record from ${formatStoneDate(record.performedOn)}`}
              >
                Delete
              </Button>
            </div>
          )}
        />
      </section>

      <section className="space-y-3">
        <h2 className="app-section-title">Position history</h2>
        <StonePlacementTable
          placements={placements}
          getStoneHref={adminStoneHref}
          renderActions={(placement) => (
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                className="!px-3 !py-1"
                onClick={() => setDialog({ type: 'placement', placement })}
                aria-label={`Edit ${placementEntryLabel(placement)}`}
              >
                Edit
              </Button>
              {placement.canUndo ? (
                <Button
                  variant="outline-danger"
                  className="!px-3 !py-1"
                  onClick={() => void handleUndoPlacement(placement)}
                  aria-label={`Undo ${placementEntryLabel(placement)}`}
                >
                  Undo
                </Button>
              ) : null}
            </div>
          )}
        />
      </section>
      {dialog?.type === 'placement' ? (
        <StoneDateActionModal
          title="Edit position history"
          submitLabel="Save changes"
          initialDate={dialog.placement.effectiveDate}
          initialNotes={dialog.placement.notes}
          minDate={dialog.placement.dateRange.min}
          maxDate={dialog.placement.dateRange.max}
          dateHelperText={placementDateHelper(dialog.placement.dateRange)}
          showNotes
          onClose={() => setDialog(null)}
          onSubmit={(values) => handleUpdatePlacement(dialog.placement, values)}
          description={
            <>
              <p>
                {PLACEMENT_CHANGE_LABELS[dialog.placement.changeType]} to {stonePositionLabel(dialog.placement)}, side{' '}
                {dialog.placement.side} in play.
              </p>
              {placementScopeNote(dialog.placement) ? <p className="mt-2">{placementScopeNote(dialog.placement)}</p> : null}
            </>
          }
        />
      ) : null}

      {dialog?.type === 'edit' ? (
        <StoneFormModal stones={stones} stone={stone} onClose={() => setDialog(null)} onSaved={closeAndReload} />
      ) : null}
      {dialog?.type === 'move' ? (
        <StoneMoveModal stone={stone} stones={stones} onClose={() => setDialog(null)} onSaved={closeAndReload} />
      ) : null}
      {dialog?.type === 'flip' ? (
        <StoneDateActionModal
          title={`Flip stone ${stone.wcfRegistrationNumber}`}
          submitLabel={`Flip to side ${otherSide}`}
          minDate={current?.effectiveDate}
          showNotes
          onClose={() => setDialog(null)}
          onSubmit={handleFlip}
          description={`Side ${current?.side ?? 'A'} is in play now. Flipping puts side ${otherSide} in play; the stone stays at ${stonePositionLabel(current)}.`}
        />
      ) : null}
      {dialog?.type === 'maintenance' ? (
        <StoneMaintenanceModal
          stones={[stone]}
          initialStoneIds={[stone.id]}
          lockStones
          record={dialog.record}
          onClose={() => setDialog(null)}
          onSaved={closeAndReload}
        />
      ) : null}
    </AppPage>
  );
}