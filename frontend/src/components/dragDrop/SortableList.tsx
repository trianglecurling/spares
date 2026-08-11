import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  arrayMove,
  defaultAnimateLayoutChanges,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  type AnimateLayoutChanges,
  type SortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import DragHandle from './DragHandle';
import { createSortableAnnouncements } from './dragDropAnnouncer';
import usePrefersReducedMotion from './usePrefersReducedMotion';

type SortableListRenderProps<T> = {
  item: T;
  index: number;
  isDragging: boolean;
  isSorting: boolean;
  isOverlay: boolean;
  /** True while another item is dragging and this row is outside the allowed drop group. */
  isInvalidDropTarget: boolean;
  dragHandle: ReactNode;
};

type SortableListProps<T> = {
  items: T[];
  getId: (item: T) => UniqueIdentifier;
  getItemLabel: (item: T) => string;
  renderItem: (props: SortableListRenderProps<T>) => ReactNode;
  onReorder: (
    nextItems: T[],
    meta: {
      activeId: UniqueIdentifier;
      overId: UniqueIdentifier;
      activeIndex: number;
      overIndex: number;
    }
  ) => void | Promise<void>;
  renderOverlay?: (item: T) => ReactNode;
  className?: string;
  itemClassName?: string;
  strategy?: SortingStrategy;
  itemNoun?: string;
  canDragItem?: (item: T, index: number) => boolean;
  /**
   * When set, only allowed drop targets participate in collision detection, so
   * the live sort preview cannot indicate an invalid destination.
   */
  canDropOnItem?: (activeItem: T, overItem: T, activeIndex: number, overIndex: number) => boolean;
};

type SortableListItemProps<T> = {
  item: T;
  index: number;
  id: UniqueIdentifier;
  getItemLabel: (item: T) => string;
  renderItem: (props: SortableListRenderProps<T>) => ReactNode;
  canDrag: boolean;
  isInvalidDropTarget: boolean;
  className?: string;
};

function joinClasses(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

const animateLayoutChanges: AnimateLayoutChanges = (args) => {
  if (!args.isSorting) {
    return false;
  }

  return defaultAnimateLayoutChanges(args);
};

function SortableListItem<T>({
  item,
  index,
  id,
  getItemLabel,
  renderItem,
  canDrag,
  isInvalidDropTarget,
  className,
}: SortableListItemProps<T>) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
    isSorting,
  } = useSortable({
    id,
    disabled: !canDrag,
    animateLayoutChanges,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 20 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} className={className}>
      {renderItem({
        item,
        index,
        isDragging,
        isSorting,
        isOverlay: false,
        isInvalidDropTarget,
        dragHandle: (
          <DragHandle
            label={`Reorder ${getItemLabel(item)}`}
            attributes={attributes}
            listeners={listeners}
            disabled={!canDrag}
            setActivatorNodeRef={setActivatorNodeRef}
          />
        ),
      })}
    </div>
  );
}

export default function SortableList<T>({
  items,
  getId,
  getItemLabel,
  renderItem,
  onReorder,
  renderOverlay,
  className,
  itemClassName,
  strategy = verticalListSortingStrategy,
  itemNoun = 'item',
  canDragItem,
  canDropOnItem,
}: SortableListProps<T>) {
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  const prefersReducedMotion = usePrefersReducedMotion();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const ids = items.map((item) => getId(item));
  const activeIndex = activeId === null ? -1 : items.findIndex((item) => getId(item) === activeId);
  const activeItem = activeIndex >= 0 ? items[activeIndex] ?? null : null;

  const isValidDropTarget = (overId: UniqueIdentifier, forActiveId: UniqueIdentifier = activeId ?? overId): boolean => {
    if (!canDropOnItem) return true;
    if (overId === forActiveId) return true;
    const currentActiveIndex = items.findIndex((item) => getId(item) === forActiveId);
    const overIndex = items.findIndex((item) => getId(item) === overId);
    if (currentActiveIndex < 0 || overIndex < 0) return false;
    return canDropOnItem(items[currentActiveIndex]!, items[overIndex]!, currentActiveIndex, overIndex);
  };

  const collisionDetection = useMemo<CollisionDetection>(() => {
    if (!canDropOnItem) return closestCenter;
    return (args) => {
      const collisions = closestCenter(args);
      const allowed = collisions.filter((collision) => isValidDropTarget(collision.id, args.active.id));
      // Keep the drag live over the nearest valid target; an empty list would
      // clear `over` and freeze the preview in an earlier invalid position.
      return allowed.length > 0 ? allowed : collisions.filter((collision) => collision.id === args.active.id);
    };
  }, [canDropOnItem, getId, items]);

  useEffect(() => {
    if (activeId === null) return;

    const previousCursor = document.body.style.cursor;
    document.body.style.cursor = 'grabbing';

    return () => {
      document.body.style.cursor = previousCursor;
    };
  }, [activeId]);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      modifiers={[restrictToVerticalAxis]}
      accessibility={{
        announcements: createSortableAnnouncements({
          items,
          getId,
          getItemLabel,
          itemNoun,
        }),
      }}
      onDragStart={({ active }) => {
        setActiveId(active.id);
      }}
      onDragCancel={() => {
        setActiveId(null);
      }}
      onDragEnd={({ active, over }) => {
        setActiveId(null);
        if (!over || active.id === over.id) return;
        if (!isValidDropTarget(over.id, active.id)) return;

        const nextActiveIndex = items.findIndex((item) => getId(item) === active.id);
        const overIndex = items.findIndex((item) => getId(item) === over.id);
        if (nextActiveIndex === -1 || overIndex === -1) return;

        const nextItems = arrayMove(items, nextActiveIndex, overIndex);
        void onReorder(nextItems, {
          activeId: active.id,
          overId: over.id,
          activeIndex: nextActiveIndex,
          overIndex,
        });
      }}
    >
      <SortableContext items={ids} strategy={strategy}>
        <div className={joinClasses('space-y-2', className)}>
          {items.map((item, index) => {
            const id = getId(item);
            const isInvalidDropTarget =
              activeItem != null && id !== activeId && !isValidDropTarget(id, activeId ?? id);
            return (
              <SortableListItem
                key={String(id)}
                item={item}
                index={index}
                id={id}
                getItemLabel={getItemLabel}
                renderItem={renderItem}
                canDrag={canDragItem ? canDragItem(item, index) : true}
                isInvalidDropTarget={isInvalidDropTarget}
                className={itemClassName}
              />
            );
          })}
        </div>
      </SortableContext>
      <DragOverlay dropAnimation={prefersReducedMotion ? null : undefined}>
        {activeItem
          ? renderOverlay
            ? renderOverlay(activeItem)
            : renderItem({
                item: activeItem,
                index: activeIndex,
                isDragging: true,
                isSorting: false,
                isOverlay: true,
                isInvalidDropTarget: false,
                dragHandle: (
                  <DragHandle
                    label={`Reorder ${getItemLabel(activeItem)}`}
                    disabled
                  />
                ),
              })
          : null}
      </DragOverlay>
    </DndContext>
  );
}
