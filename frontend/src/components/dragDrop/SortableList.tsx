import { useEffect, useState, type ReactNode } from 'react';
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
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
};

type SortableListItemProps<T> = {
  item: T;
  index: number;
  id: UniqueIdentifier;
  getItemLabel: (item: T) => string;
  renderItem: (props: SortableListRenderProps<T>) => ReactNode;
  canDrag: boolean;
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
}: SortableListProps<T>) {
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  const prefersReducedMotion = usePrefersReducedMotion();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const ids = items.map((item) => getId(item));
  const activeItem = activeId === null ? null : items.find((item) => getId(item) === activeId) ?? null;

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
      collisionDetection={closestCenter}
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

        const activeIndex = items.findIndex((item) => getId(item) === active.id);
        const overIndex = items.findIndex((item) => getId(item) === over.id);
        if (activeIndex === -1 || overIndex === -1) return;

        const nextItems = arrayMove(items, activeIndex, overIndex);
        void onReorder(nextItems, {
          activeId: active.id,
          overId: over.id,
          activeIndex,
          overIndex,
        });
      }}
    >
      <SortableContext items={ids} strategy={strategy}>
        <div className={joinClasses('space-y-2', className)}>
          {items.map((item, index) => (
            <SortableListItem
              key={String(getId(item))}
              item={item}
              index={index}
              id={getId(item)}
              getItemLabel={getItemLabel}
              renderItem={renderItem}
              canDrag={canDragItem ? canDragItem(item, index) : true}
              className={itemClassName}
            />
          ))}
        </div>
      </SortableContext>
      <DragOverlay dropAnimation={prefersReducedMotion ? null : undefined}>
        {activeItem
          ? renderOverlay
            ? renderOverlay(activeItem)
            : renderItem({
                item: activeItem,
                index: items.findIndex((item) => getId(item) === activeId),
                isDragging: true,
                isSorting: false,
                isOverlay: true,
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
