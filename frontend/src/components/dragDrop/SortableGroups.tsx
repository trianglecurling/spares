import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type ClientRect,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import {
  arrayMove,
  defaultAnimateLayoutChanges,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  type AnimateLayoutChanges,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import DragHandle from './DragHandle';
import { createGroupedSortableAnnouncements } from './dragDropAnnouncer';
import { sortableItemAtPointer } from './sortablePointerTarget';
import usePrefersReducedMotion from './usePrefersReducedMotion';

/**
 * Several vertical lists that share one drag session, so an item can be reordered
 * inside its list or moved into another list. `SortableList` stays single-list
 * because it locks movement to the vertical axis.
 */
const GROUP_PREFIX = 'sortable-group:';

export type SortableGroup<T> = {
  id: UniqueIdentifier;
  items: T[];
};

export type SortableGroupItemRenderProps<T> = {
  item: T;
  groupId: UniqueIdentifier;
  index: number;
  isDragging: boolean;
  isSorting: boolean;
  isOverlay: boolean;
  dragHandle: ReactNode;
};

export type SortableGroupRenderProps<T> = {
  groupId: UniqueIdentifier;
  items: T[];
  isDropTarget: boolean;
  setDropRef: (element: HTMLElement | null) => void;
  children: ReactNode;
};

type SortableGroupsProps<T> = {
  groups: SortableGroup<T>[];
  getId: (item: T) => UniqueIdentifier;
  getItemLabel: (item: T) => string;
  getGroupLabel: (groupId: UniqueIdentifier) => string;
  renderItem: (props: SortableGroupItemRenderProps<T>) => ReactNode;
  renderGroup: (props: SortableGroupRenderProps<T>) => ReactNode;
  onReorder: (groups: SortableGroup<T>[]) => void;
  className?: string;
  itemNoun?: string;
};

function joinClasses(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

function groupDropId(groupId: UniqueIdentifier): UniqueIdentifier {
  return `${GROUP_PREFIX}${String(groupId)}`;
}

function parseGroupDropId(id: UniqueIdentifier): UniqueIdentifier | null {
  const value = String(id);
  if (!value.startsWith(GROUP_PREFIX)) return null;
  return value.slice(GROUP_PREFIX.length);
}

function cloneGroups<T>(groups: SortableGroup<T>[]): SortableGroup<T>[] {
  return groups.map((group) => ({ id: group.id, items: [...group.items] }));
}

function findGroupId<T>(
  groups: SortableGroup<T>[],
  id: UniqueIdentifier,
  getId: (item: T) => UniqueIdentifier,
): UniqueIdentifier | null {
  const fromDroppable = parseGroupDropId(id);
  if (fromDroppable != null && groups.some((group) => String(group.id) === String(fromDroppable))) {
    return groups.find((group) => String(group.id) === String(fromDroppable))!.id;
  }
  return groups.find((group) => group.items.some((item) => getId(item) === id))?.id ?? null;
}

function containsPoint(rect: ClientRect, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function arrangementKey<T>(groups: SortableGroup<T>[], getId: (item: T) => UniqueIdentifier): string {
  return groups.map((group) => `${String(group.id)}:${group.items.map((item) => String(getId(item))).join(',')}`).join('|');
}

const animateLayoutChanges: AnimateLayoutChanges = (args) => {
  if (!args.isSorting) return false;
  return defaultAnimateLayoutChanges(args);
};

function SortableGroupItem<T>({
  item,
  groupId,
  index,
  getId,
  getItemLabel,
  renderItem,
  prefersReducedMotion,
}: {
  item: T;
  groupId: UniqueIdentifier;
  index: number;
  getId: (item: T) => UniqueIdentifier;
  getItemLabel: (item: T) => string;
  renderItem: (props: SortableGroupItemRenderProps<T>) => ReactNode;
  prefersReducedMotion: boolean;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging, isSorting } =
    useSortable({
      id: getId(item),
      animateLayoutChanges,
    });

  return (
      <div
      ref={setNodeRef}
      role="listitem"
      style={{
        transform: CSS.Transform.toString(transform),
        transition: prefersReducedMotion ? undefined : transition,
        zIndex: isDragging ? 20 : undefined,
      }}
    >
      {renderItem({
        item,
        groupId,
        index,
        isDragging,
        isSorting,
        isOverlay: false,
        dragHandle: (
          <DragHandle
            label={`Move ${getItemLabel(item)}`}
            attributes={attributes}
            listeners={listeners}
            setActivatorNodeRef={setActivatorNodeRef}
          />
        ),
      })}
    </div>
  );
}

function SortableGroupColumn<T>({
  group,
  isDropTarget,
  getId,
  getItemLabel,
  renderItem,
  renderGroup,
  prefersReducedMotion,
}: {
  group: SortableGroup<T>;
  isDropTarget: boolean;
  getId: (item: T) => UniqueIdentifier;
  getItemLabel: (item: T) => string;
  renderItem: (props: SortableGroupItemRenderProps<T>) => ReactNode;
  renderGroup: (props: SortableGroupRenderProps<T>) => ReactNode;
  prefersReducedMotion: boolean;
}) {
  const { setNodeRef } = useDroppable({ id: groupDropId(group.id) });
  return (
    <SortableContext items={group.items.map((item) => getId(item))} strategy={verticalListSortingStrategy}>
      {renderGroup({
        groupId: group.id,
        items: group.items,
        isDropTarget,
        setDropRef: setNodeRef,
        children: group.items.map((item, index) => (
          <SortableGroupItem
            key={String(getId(item))}
            item={item}
            groupId={group.id}
            index={index}
            getId={getId}
            getItemLabel={getItemLabel}
            renderItem={renderItem}
            prefersReducedMotion={prefersReducedMotion}
          />
        )),
      })}
    </SortableContext>
  );
}

export default function SortableGroups<T>({
  groups: groupsProp,
  getId,
  getItemLabel,
  getGroupLabel,
  renderItem,
  renderGroup,
  onReorder,
  className,
  itemNoun = 'item',
}: SortableGroupsProps<T>) {
  const [groups, setGroups] = useState(() => cloneGroups(groupsProp));
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  const [overGroupId, setOverGroupId] = useState<UniqueIdentifier | null>(null);
  const groupsRef = useRef(groups);
  const snapshotRef = useRef(groups);
  const draggingRef = useRef(false);
  const recentlyMovedRef = useRef(false);
  const lastOverId = useRef<UniqueIdentifier | null>(null);
  const prefersReducedMotion = usePrefersReducedMotion();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const commitGroups = useCallback((next: SortableGroup<T>[]) => {
    groupsRef.current = next;
    setGroups(next);
  }, []);

  useEffect(() => {
    if (draggingRef.current) return;
    const sameItems =
      arrangementKey(groupsRef.current, getId) === arrangementKey(groupsProp, getId) &&
      groupsRef.current.every((group, groupIndex) =>
        group.items.every((item, itemIndex) => item === groupsProp[groupIndex]?.items[itemIndex]),
      );
    if (sameItems) return;
    commitGroups(cloneGroups(groupsProp));
  }, [commitGroups, getId, groupsProp]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      recentlyMovedRef.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [groups]);

  useEffect(() => {
    if (activeId === null) return;
    const previousCursor = document.body.style.cursor;
    document.body.style.cursor = 'grabbing';
    return () => {
      document.body.style.cursor = previousCursor;
    };
  }, [activeId]);

  const collisionDetection = useCallback<CollisionDetection>(
    (args) => {
      const remember = (id: UniqueIdentifier) => {
        lastOverId.current = id;
        return [{ id }];
      };
      const pointer = args.pointerCoordinates;
      if (pointer) {
        const group = args.droppableContainers.find((container) => {
          if (parseGroupDropId(container.id) == null) return false;
          const rect = args.droppableRects.get(container.id);
          return rect != null && containsPoint(rect, pointer.x, pointer.y);
        });
        if (group) {
          const groupRect = args.droppableRects.get(group.id);
          const rows = groupRect
            ? args.droppableContainers.flatMap((container) => {
                if (parseGroupDropId(container.id) != null) return [];
                const rect = args.droppableRects.get(container.id);
                if (!rect || !containsPoint(groupRect, rect.left + rect.width / 2, rect.top + rect.height / 2)) {
                  return [];
                }
                return [{ id: String(container.id), top: rect.top, bottom: rect.bottom }];
              })
            : [];
          const rowId = sortableItemAtPointer(rows, pointer.y);
          if (rowId != null) return remember(rowId);
          return remember(group.id);
        }
      }

      const itemContainers = args.droppableContainers.filter((container) => parseGroupDropId(container.id) == null);
      const closestItem = closestCenter({ ...args, droppableContainers: itemContainers })[0];
      if (closestItem) return remember(closestItem.id);
      const closest = closestCenter(args)[0];
      if (closest) return remember(closest.id);
      return lastOverId.current ? [{ id: lastOverId.current }] : [];
    },
    [],
  );

  const moveToGroup = useCallback(
    (active: UniqueIdentifier, overId: UniqueIdentifier, translatedTop: number | null, overRect: { top: number; height: number } | null) => {
      if (recentlyMovedRef.current) return;
      const current = groupsRef.current;
      const activeGroupId = findGroupId(current, active, getId);
      const overGroupIdNext = findGroupId(current, overId, getId);
      if (activeGroupId == null || overGroupIdNext == null || activeGroupId === overGroupIdNext) return;

      const activeGroup = current.find((group) => group.id === activeGroupId);
      const overGroup = current.find((group) => group.id === overGroupIdNext);
      if (!activeGroup || !overGroup) return;
      const activeIndex = activeGroup.items.findIndex((item) => getId(item) === active);
      if (activeIndex < 0) return;
      const moving = activeGroup.items[activeIndex]!;
      const overIndex = overGroup.items.findIndex((item) => getId(item) === overId);
      let newIndex = overGroup.items.length;
      if (parseGroupDropId(overId) == null && overIndex >= 0) {
        const isBelow = translatedTop != null && overRect != null && translatedTop > overRect.top + overRect.height;
        newIndex = overIndex + (isBelow ? 1 : 0);
      }

      const next = current.map((group) => {
        if (group.id === activeGroupId) return { ...group, items: group.items.filter((item) => getId(item) !== active) };
        if (group.id === overGroupIdNext) {
          const items = [...group.items];
          items.splice(Math.min(newIndex, items.length), 0, moving);
          return { ...group, items };
        }
        return group;
      });
      if (arrangementKey(current, getId) === arrangementKey(next, getId)) return;
      recentlyMovedRef.current = true;
      commitGroups(next);
    },
    [commitGroups, getId],
  );

  const finishDrag = (next: SortableGroup<T>[]) => {
    draggingRef.current = false;
    setActiveId(null);
    setOverGroupId(null);
    lastOverId.current = null;
    commitGroups(next);
    if (arrangementKey(snapshotRef.current, getId) !== arrangementKey(next, getId)) {
      onReorder(cloneGroups(next));
    }
  };

  const onDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      setOverGroupId(over ? findGroupId(groupsRef.current, over.id, getId) : null);
      return;
    }
    setOverGroupId(findGroupId(groupsRef.current, over.id, getId));
    moveToGroup(
      active.id,
      over.id,
      active.rect.current.translated?.top ?? null,
      over.rect ? { top: over.rect.top, height: over.rect.height } : null,
    );
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    const current = groupsRef.current;
    if (!over) {
      finishDrag(cloneGroups(snapshotRef.current));
      return;
    }
    const activeGroupId = findGroupId(current, active.id, getId);
    const overGroup = findGroupId(current, over.id, getId);
    if (activeGroupId == null || overGroup == null || activeGroupId !== overGroup) {
      finishDrag(current);
      return;
    }
    const group = current.find((entry) => entry.id === activeGroupId);
    if (!group) {
      finishDrag(current);
      return;
    }
    const activeIndex = group.items.findIndex((item) => getId(item) === active.id);
    const overIndex = group.items.findIndex((item) => getId(item) === over.id);
    if (activeIndex < 0 || overIndex < 0 || activeIndex === overIndex) {
      finishDrag(current);
      return;
    }
    finishDrag(
      current.map((entry) =>
        entry.id === activeGroupId ? { ...entry, items: arrayMove(entry.items, activeIndex, overIndex) } : entry,
      ),
    );
  };

  const activeGroup = activeId == null ? null : groups.find((group) => group.items.some((item) => getId(item) === activeId));
  const activeIndex = activeGroup?.items.findIndex((item) => getId(item) === activeId) ?? -1;
  const activeItem = activeIndex >= 0 ? activeGroup?.items[activeIndex] ?? null : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      accessibility={{
        announcements: createGroupedSortableAnnouncements({
          groups,
          getId,
          getItemLabel,
          getGroupLabel,
          parseGroupId: parseGroupDropId,
          itemNoun,
        }),
      }}
      onDragStart={({ active }) => {
        draggingRef.current = true;
        snapshotRef.current = cloneGroups(groupsRef.current);
        lastOverId.current = active.id;
        setActiveId(active.id);
        setOverGroupId(findGroupId(groupsRef.current, active.id, getId));
      }}
      onDragOver={onDragOver}
      onDragCancel={() => {
        recentlyMovedRef.current = false;
        draggingRef.current = false;
        setActiveId(null);
        setOverGroupId(null);
        lastOverId.current = null;
        commitGroups(cloneGroups(snapshotRef.current));
      }}
      onDragEnd={onDragEnd}
    >
      <div className={joinClasses(className)}>
        {groups.map((group) => (
          <SortableGroupColumn
            key={String(group.id)}
            group={group}
            isDropTarget={overGroupId != null && overGroupId === group.id && activeId != null}
            getId={getId}
            getItemLabel={getItemLabel}
            renderItem={renderItem}
            renderGroup={renderGroup}
            prefersReducedMotion={prefersReducedMotion}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={prefersReducedMotion ? null : undefined}>
        {activeItem && activeGroup ? (
          renderItem({
            item: activeItem,
            groupId: activeGroup.id,
            index: activeIndex,
            isDragging: true,
            isSorting: false,
            isOverlay: true,
            dragHandle: <DragHandle label={`Move ${getItemLabel(activeItem)}`} disabled />,
          })
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
