import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import DataTable from '../table/DataTable';
import InlineStateMessage from '../InlineStateMessage';
import {
  MAINTENANCE_ACTIVITY_LABELS,
  PLACEMENT_CHANGE_LABELS,
  formatStoneDate,
  maintenanceSummary,
  stonePositionLabel,
  type StoneMaintenance,
  type StonePlacement,
} from '../../utils/curlingStones';

export function StoneMaintenanceTable({
  records,
  renderActions,
}: {
  records: StoneMaintenance[];
  renderActions?: (record: StoneMaintenance) => ReactNode;
}) {
  return (
    <DataTable<StoneMaintenance, never, number>
      rows={records}
      rowKey={(record) => record.id}
      emptyState={<InlineStateMessage title="No maintenance recorded yet." />}
      columns={[
        {
          id: 'date',
          header: 'Date',
          renderCell: (record) => <span className="whitespace-nowrap">{formatStoneDate(record.performedOn)}</span>,
        },
        {
          id: 'activity',
          header: 'Activity',
          renderCell: (record) => MAINTENANCE_ACTIVITY_LABELS[record.activityType],
        },
        { id: 'side', header: 'Side', renderCell: (record) => record.side },
        { id: 'details', header: 'Details', renderCell: (record) => maintenanceSummary(record) },
        {
          id: 'comments',
          header: 'Comments',
          cellClassName: 'max-w-xs whitespace-pre-line break-words',
          renderCell: (record) => record.comments ?? '',
        },
      ]}
      actions={
        renderActions
          ? { header: 'Actions', widthClassName: 'w-40', renderActions }
          : undefined
      }
    />
  );
}

export function StonePlacementTable({
  placements,
  getStoneHref,
  renderActions,
}: {
  placements: StonePlacement[];
  getStoneHref: (stoneId: number) => string;
  renderActions?: (placement: StonePlacement) => ReactNode;
}) {
  return (
    <DataTable<StonePlacement, never, number>
      rows={placements}
      rowKey={(placement) => placement.id}
      emptyState={<InlineStateMessage title="No position history yet." />}
      columns={[
        {
          id: 'date',
          header: 'Date',
          renderCell: (placement) => (
            <span className="whitespace-nowrap">{formatStoneDate(placement.effectiveDate)}</span>
          ),
        },
        {
          id: 'change',
          header: 'Change',
          renderCell: (placement) => (
            <span>
              {PLACEMENT_CHANGE_LABELS[placement.changeType]}
              {placement.relatedStone ? (
                <>
                  {' with '}
                  <Link
                    to={getStoneHref(placement.relatedStone.id)}
                    className="font-medium text-primary-teal-link hover:underline"
                  >
                    {placement.relatedStone.wcfRegistrationNumber}
                  </Link>
                </>
              ) : null}
            </span>
          ),
        },
        { id: 'position', header: 'Position', renderCell: (placement) => stonePositionLabel(placement) },
        { id: 'side', header: 'Side in play', renderCell: (placement) => placement.side },
        {
          id: 'notes',
          header: 'Notes',
          cellClassName: 'max-w-xs whitespace-pre-line break-words',
          renderCell: (placement) => placement.notes ?? '',
        },
      ]}
      actions={
        renderActions
          ? { header: 'Actions', widthClassName: 'w-40', renderActions }
          : undefined
      }
    />
  );
}
