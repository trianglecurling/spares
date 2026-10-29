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
      return `Canceled dragging ${getItemLabel(activeItem)} ${itemNoun}.`;
    },
  };
}

type GroupAnnouncerConfig<T> = {
  groups: { id: UniqueIdentifier; items: T[] }[];
  getId: (item: T) => UniqueIdentifier;
  getItemLabel: (item: T) => string;
  getGroupLabel: (groupId: UniqueIdentifier) => string;
  /** When set, `id` is a droppable for that whole group rather than an item. */
  parseGroupId?: (id: UniqueIdentifier) => UniqueIdentifier | null;
  itemNoun?: string;
};

function locateItem<T>(
  groups: { id: UniqueIdentifier; items: T[] }[],
  getId: (item: T) => UniqueIdentifier,
  id: UniqueIdentifier,
): { groupId: UniqueIdentifier; index: number; item: T; count: number } | null {
  for (const group of groups) {
    const index = group.items.findIndex((item) => getId(item) === id);
    if (index >= 0) {
      return { groupId: group.id, index, item: group.items[index]!, count: group.items.length };
    }
  }
  return null;
}

/** Announcements for lists that can move items between groups, such as pool columns. */
export function createGroupedSortableAnnouncements<T>({
  groups,
  getId,
  getItemLabel,
  getGroupLabel,
  parseGroupId,
  itemNoun = 'item',
}: GroupAnnouncerConfig<T>): Announcements {
  const describeOver = (overId: UniqueIdentifier | null | undefined) => {
    if (overId == null) return null;
    const groupOnly = parseGroupId?.(overId);
    if (groupOnly != null) return getGroupLabel(groupOnly);
    const located = locateItem(groups, getId, overId);
    if (!located) return null;
    return `position ${located.index + 1} of ${located.count} in ${getGroupLabel(located.groupId)}`;
  };

  return {
    onDragStart({ active }: DragStartEvent) {
      const located = locateItem(groups, getId, active.id);
      if (!located) return;
      return `Picked up ${getItemLabel(located.item)} ${itemNoun} from ${getGroupLabel(located.groupId)}.`;
    },
    onDragOver({ active, over }: DragOverEvent) {
      const located = locateItem(groups, getId, active.id);
      if (!located || !over) return;
      const where = describeOver(over.id);
      if (!where) return;
      return `${getItemLabel(located.item)} ${itemNoun} is over ${where}.`;
    },
    onDragEnd({ active, over }: DragEndEvent) {
      const located = locateItem(groups, getId, active.id);
      if (!located) return;
      if (!over) return `Dropped ${getItemLabel(located.item)} ${itemNoun}.`;
      const where = describeOver(over.id);
      if (!where) return `Dropped ${getItemLabel(located.item)} ${itemNoun}.`;
      return `Dropped ${getItemLabel(located.item)} ${itemNoun} at ${where}.`;
    },
    onDragCancel({ active }: DragCancelEvent) {
      const located = locateItem(groups, getId, active.id);
      if (!located) return;
      return `Canceled dragging ${getItemLabel(located.item)} ${itemNoun}.`;
    },
  };
}
