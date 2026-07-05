type SoftDeleteRowActionsProps = {
  archived: boolean;
  isServerAdmin?: boolean;
  onArchive: () => void;
  onRestore: () => void;
  onDeletePermanently: () => void;
  archiveLabel?: string;
};

const secondaryActionClassName =
  'rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100';

const archiveActionClassName =
  'rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50 hover:text-red-800 dark:text-red-400 dark:hover:bg-red-900/20 dark:hover:text-red-300';

const permanentDeleteActionClassName =
  'rounded px-2 py-1 text-xs text-red-700 hover:bg-red-100 hover:text-red-900 dark:text-red-300 dark:hover:bg-red-900/30 dark:hover:text-red-200';

export default function SoftDeleteRowActions({
  archived,
  isServerAdmin = false,
  onArchive,
  onRestore,
  onDeletePermanently,
  archiveLabel = 'Archive',
}: SoftDeleteRowActionsProps) {
  if (archived) {
    return (
      <div className="flex items-center justify-end gap-1">
        <button
          type="button"
          onClick={onRestore}
          className={secondaryActionClassName}
          title="Restore"
        >
          Restore
        </button>
        {isServerAdmin ? (
          <button
            type="button"
            onClick={onDeletePermanently}
            className={permanentDeleteActionClassName}
            title="Delete permanently"
          >
            Delete permanently
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onArchive}
      className={archiveActionClassName}
      title={archiveLabel}
    >
      {archiveLabel}
    </button>
  );
}
