import type {
  Announcements,
  DragCancelEvent,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  UniqueIdentifier,
} from '@dnd-kit/core';

type AnnouncerConfig<T> = {
  items: T[];
  getId: (item: T) => UniqueIdentifier;
  getItemLabel: (item: T) => string;
  itemNoun?: string;
};

function getItem<T>(
  items: T[],
  getId: (item: T) => UniqueIdentifier,
  id: UniqueIdentifier | null | undefined
) {
  if (id === null || id === undefined) return null;
  return items.find((item) => getId(item) === id) ?? null;
}

function describePosition<T>(
  overId: UniqueIdentifier | null | undefined,
  items: T[],
  getId: (item: T) => UniqueIdentifier
) {
  if (!overId) return null;

  const nextIndex = items.findIndex((item) => getId(item) === overId);
  if (nextIndex === -1) return null;

  return `position ${nextIndex + 1} of ${items.length}`;
}

export function createSortableAnnouncements<T>({
  items,
  getId,
  getItemLabel,
  itemNoun = 'item',
}: AnnouncerConfig<T>): Announcements {
  return {
    onDragStart({ active }: DragStartEvent) {
      const activeItem = getItem(items, getId, active.id);
      if (!activeItem) return;
      return `Picked up ${getItemLabel(activeItem)} ${itemNoun}.`;
    },
    onDragOver({ active, over }: DragOverEvent) {
      const activeItem = getItem(items, getId, active.id);
      if (!activeItem || !over) return;

      const position = describePosition(over.id, items, getId);
      if (!position) return;

      return `${getItemLabel(activeItem)} ${itemNoun} is over ${position}.`;
    },
    onDragEnd({ active, over }: DragEndEvent) {
      const activeItem = getItem(items, getId, active.id);
      if (!activeItem) return;

      if (!over) {
        return `Dropped ${getItemLabel(activeItem)} ${itemNoun}.`;
      }

      const position = describePosition(over.id, items, getId);
      if (!position) {
        return `Dropped ${getItemLabel(activeItem)} ${itemNoun}.`;
      }

      return `Dropped ${getItemLabel(activeItem)} ${itemNoun} at ${position}.`;
    },
    onDragCancel({ active }: DragCancelEvent) {
      const activeItem = getItem(items, getId, active.id);
      if (!activeItem) return;
      return `Cancelled dragging ${getItemLabel(activeItem)} ${itemNoun}.`;
    },
  };
}
