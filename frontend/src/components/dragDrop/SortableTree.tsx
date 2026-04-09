import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
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
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import DragHandle from './DragHandle';
import { createSortableAnnouncements } from './dragDropAnnouncer';
import usePrefersReducedMotion from './usePrefersReducedMotion';

type SortableTreeRenderProps<T> = {
  item: T;
  depth: number;
  isDragging: boolean;
  isSorting: boolean;
  isOverlay: boolean;
  canDrag: boolean;
  dragHandle: ReactNode;
};

type SortableTreeProps<T> = {
  items: T[];
  getId: (item: T) => UniqueIdentifier;
  getParentId: (item: T) => UniqueIdentifier | null;
  getItemLabel: (item: T) => string;
  renderItem: (props: SortableTreeRenderProps<T>) => ReactNode;
  onReorder: (meta: {
    activeId: UniqueIdentifier;
    overId: UniqueIdentifier;
    parentId: UniqueIdentifier | null;
    reorderedSiblings: T[];
  }) => void | Promise<void>;
  renderOverlay?: (item: T, depth: number) => ReactNode;
  sortSiblings?: (siblings: T[]) => T[];
  isExpanded?: (item: T) => boolean;
  canDragItem?: (item: T, siblings: T[]) => boolean;
  className?: string;
  rootListClassName?: string;
  childListClassName?: string;
  emptyState?: ReactNode;
  itemNoun?: string;
  renderGap?: (args: {
    parentId: UniqueIdentifier | null;
    insertBeforeId: UniqueIdentifier | null;
    depth: number;
  }) => ReactNode;
};

type TreeRowProps<T> = {
  item: T;
  depth: number;
  canDrag: boolean;
  getId: (item: T) => UniqueIdentifier;
  getItemLabel: (item: T) => string;
  renderItem: (props: SortableTreeRenderProps<T>) => ReactNode;
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

function TreeRow<T>({
  item,
  depth,
  canDrag,
  getId,
  getItemLabel,
  renderItem,
}: TreeRowProps<T>) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isSorting,
  } = useSortable({
    id: getId(item),
    disabled: !canDrag,
    animateLayoutChanges,
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 20 : undefined,
      }}
    >
      {renderItem({
        item,
        depth,
        isDragging,
        isSorting,
        isOverlay: false,
        canDrag,
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

export default function SortableTree<T>({
  items,
  getId,
  getParentId,
  getItemLabel,
  renderItem,
  onReorder,
  renderOverlay,
  sortSiblings = (siblings) => siblings,
  isExpanded = () => true,
  canDragItem,
  className,
  rootListClassName,
  childListClassName,
  emptyState = null,
  itemNoun = 'item',
  renderGap,
}: SortableTreeProps<T>) {
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  const prefersReducedMotion = usePrefersReducedMotion();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const byParent = useMemo(() => {
    const map = new Map<UniqueIdentifier | null, T[]>();
    for (const item of items) {
      const parentId = getParentId(item);
      if (!map.has(parentId)) map.set(parentId, []);
      map.get(parentId)!.push(item);
    }
    return map;
  }, [getParentId, items]);

  const getSortedChildren = useCallback(
    (parentId: UniqueIdentifier | null) => sortSiblings([...(byParent.get(parentId) ?? [])]),
    [byParent, sortSiblings]
  );

  const activeItem = activeId === null ? null : items.find((item) => getId(item) === activeId) ?? null;
  const activeDepth = useMemo(() => {
    if (!activeItem) return 0;
    let depth = 0;
    let parentId = getParentId(activeItem);

    while (parentId !== null) {
      const parentItem = items.find((item) => getId(item) === parentId);
      if (!parentItem) break;
      depth += 1;
      parentId = getParentId(parentItem);
    }

    return depth;
  }, [activeItem, getId, getParentId, items]);

  useEffect(() => {
    if (activeId === null) return;

    const previousCursor = document.body.style.cursor;
    document.body.style.cursor = 'grabbing';

    return () => {
      document.body.style.cursor = previousCursor;
    };
  }, [activeId]);

  const renderGroup = (parentId: UniqueIdentifier | null, depth: number): ReactNode => {
    const siblings = getSortedChildren(parentId);
    if (siblings.length === 0) return null;

    return (
      <SortableContext
        items={siblings.map((item) => getId(item))}
        strategy={verticalListSortingStrategy}
      >
        <ul className={joinClasses(depth === 0 ? rootListClassName : childListClassName)}>
          {siblings.map((item) => {
            const id = getId(item);
            const children = getSortedChildren(id);
            const canDrag = canDragItem ? canDragItem(item, siblings) : true;

            return (
              <Fragment key={String(id)}>
                {renderGap ? renderGap({ parentId, insertBeforeId: id, depth }) : null}
                <li className="space-y-2">
                  <TreeRow
                    item={item}
                    depth={depth}
                    canDrag={canDrag}
                    getId={getId}
                    getItemLabel={getItemLabel}
                    renderItem={renderItem}
                  />
                  {children.length > 0 && isExpanded(item) ? renderGroup(id, depth + 1) : null}
                </li>
              </Fragment>
            );
          })}
          {renderGap ? renderGap({ parentId, insertBeforeId: null, depth }) : null}
        </ul>
      </SortableContext>
    );
  };

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

        const activeItemValue = items.find((item) => getId(item) === active.id);
        const overItemValue = items.find((item) => getId(item) === over.id);
        if (!activeItemValue || !overItemValue) return;

        const parentId = getParentId(activeItemValue);
        if (parentId !== getParentId(overItemValue)) return;

        const siblings = getSortedChildren(parentId);
        const activeIndex = siblings.findIndex((item) => getId(item) === active.id);
        const overIndex = siblings.findIndex((item) => getId(item) === over.id);
        if (activeIndex === -1 || overIndex === -1 || activeIndex === overIndex) return;

        const reorderedSiblings = arrayMove(siblings, activeIndex, overIndex);
        void onReorder({
          activeId: active.id,
          overId: over.id,
          parentId,
          reorderedSiblings,
        });
      }}
    >
      <div className={className}>
        {items.length > 0 ? renderGroup(null, 0) : (
          <>
            {renderGap ? renderGap({ parentId: null, insertBeforeId: null, depth: 0 }) : null}
            {emptyState}
          </>
        )}
      </div>
      <DragOverlay dropAnimation={prefersReducedMotion ? null : undefined}>
        {activeItem
          ? renderOverlay
            ? renderOverlay(activeItem, activeDepth)
            : renderItem({
                item: activeItem,
                depth: activeDepth,
                isDragging: true,
                isSorting: false,
                isOverlay: true,
                canDrag: true,
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
