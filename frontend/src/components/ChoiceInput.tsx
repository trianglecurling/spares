import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { HiCheck, HiChevronDown, HiChevronRight } from 'react-icons/hi2'

type ChoicePrimitiveValue = string | number

type ChoiceClearButtonConfig = {
  visible: boolean
  label: string
  onClear: () => void
  openAfterClear?: boolean
}

export type ChoiceMultiSelection = 'none' | 'pills' | 'checkboxes' | 'both'

export type ChoiceRenderableOption<Value extends ChoicePrimitiveValue> = {
  type?: 'option'
  value: Value
  label: ReactNode
  textValue?: string
  description?: ReactNode
  icon?: ReactNode
  disabled?: boolean
  children?: ChoiceOption<Value>[]
  render?: (context: ChoiceRenderContext<Value>) => ReactNode
  action?: (helpers: ChoiceActionHelpers<Value>) => void
}

export type ChoiceDivider = {
  type: 'divider'
  key?: string | number
  label?: ReactNode
}

export type ChoiceOption<Value extends ChoicePrimitiveValue> =
  | ChoiceRenderableOption<Value>
  | ChoiceDivider

export type ChoiceRenderContext<Value extends ChoicePrimitiveValue> = {
  option: ChoiceRenderableOption<Value>
  selected: boolean
  highlighted: boolean
  depth: number
  layout: 'popover' | 'inline' | 'block'
  multiple: boolean
}

export type ChoiceActionHelpers<Value extends ChoicePrimitiveValue> = {
  option: ChoiceRenderableOption<Value>
  value: Value | Value[] | null
  isSelected: boolean
  select: () => void
  toggle: () => void
  close: () => void
  openSubmenu: () => void
}

type ChoiceInputProps<Value extends ChoicePrimitiveValue> = {
  options: ChoiceOption<Value>[]
  value: Value | Value[] | null
  onChange: (value: Value | Value[] | null) => void
  layout?: 'popover' | 'inline' | 'block'
  multiSelection?: ChoiceMultiSelection
  allowCustomValue?: boolean
  inputValue?: string
  onInputValueChange?: (value: string) => void
  inputId?: string
  name?: string
  placeholder?: string
  disabled?: boolean
  readOnly?: boolean
  loading?: boolean
  loadingText?: string
  emptyText?: string
  listboxLabel?: string
  ariaLabel?: string
  ariaLabelledBy?: string
  required?: boolean
  autoComplete?: string
  inputClassName?: string
  clearButton?: ChoiceClearButtonConfig
  shouldShowDropdown?: boolean
  onOpenChange?: (open: boolean) => void
  onInputFocus?: () => void
  createCustomValue?: (inputValue: string) => Value | null
  renderOption?: (
    option: ChoiceRenderableOption<Value>,
    context: ChoiceRenderContext<Value>
  ) => ReactNode
}

type PositionStyle = Pick<
  CSSProperties,
  'top' | 'left' | 'bottom' | 'width' | 'maxHeight' | 'inset' | 'margin'
>

type FlattenedOption<Value extends ChoicePrimitiveValue> = {
  option: ChoiceRenderableOption<Value>
  path: string
  depth: number
  parentPath: string
}

type PopoverElement = HTMLDivElement & {
  showPopover?: () => void
  hidePopover?: () => void
}

const PANEL_GAP = 6
const VIEWPORT_PADDING = 8
const MIN_PANEL_WIDTH = 220
const SUBMENU_WIDTH = 260

function isDivider<Value extends ChoicePrimitiveValue>(
  option: ChoiceOption<Value>
): option is ChoiceDivider {
  return option.type === 'divider'
}

function isSelectableOption<Value extends ChoicePrimitiveValue>(
  option: ChoiceOption<Value>
): option is ChoiceRenderableOption<Value> {
  return !isDivider(option)
}

function getOptionText<Value extends ChoicePrimitiveValue>(option: ChoiceRenderableOption<Value>): string {
  if (option.textValue) return option.textValue
  if (typeof option.label === 'string' || typeof option.label === 'number') {
    return String(option.label)
  }
  return String(option.value)
}

function normalizeSelection<Value extends ChoicePrimitiveValue>(
  value: Value | Value[] | null,
  multiple: boolean
): Value[] {
  if (multiple) {
    return Array.isArray(value) ? value : value === null ? [] : [value]
  }
  if (Array.isArray(value)) return value.length > 0 ? [value[0]] : []
  return value === null ? [] : [value]
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

function getPanelPosition(anchorRect: DOMRect): PositionStyle {
  const width = clamp(anchorRect.width, MIN_PANEL_WIDTH, window.innerWidth - VIEWPORT_PADDING * 2)
  const left = clamp(anchorRect.left, VIEWPORT_PADDING, window.innerWidth - width - VIEWPORT_PADDING)
  const spaceBelow = window.innerHeight - anchorRect.bottom - VIEWPORT_PADDING
  const spaceAbove = anchorRect.top - VIEWPORT_PADDING
  const placeBelow = spaceBelow >= 240 || spaceBelow >= spaceAbove

  if (placeBelow) {
    return {
      inset: 'auto',
      margin: 0,
      top: anchorRect.bottom + PANEL_GAP,
      left,
      width,
      maxHeight: Math.max(140, spaceBelow),
    }
  }

  return {
    inset: 'auto',
    margin: 0,
    bottom: window.innerHeight - anchorRect.top + PANEL_GAP,
    left,
    width,
    maxHeight: Math.max(140, spaceAbove),
  }
}

function getSubmenuPosition(anchorRect: DOMRect): PositionStyle {
  const width = clamp(SUBMENU_WIDTH, MIN_PANEL_WIDTH, window.innerWidth - VIEWPORT_PADDING * 2)
  const spaceRight = window.innerWidth - anchorRect.right - VIEWPORT_PADDING
  const spaceLeft = anchorRect.left - VIEWPORT_PADDING
  const openRight = spaceRight >= width || spaceRight >= spaceLeft
  const left = openRight
    ? clamp(anchorRect.right + 4, VIEWPORT_PADDING, window.innerWidth - width - VIEWPORT_PADDING)
    : clamp(anchorRect.left - width - 4, VIEWPORT_PADDING, window.innerWidth - width - VIEWPORT_PADDING)
  const top = clamp(
    anchorRect.top,
    VIEWPORT_PADDING,
    window.innerHeight - VIEWPORT_PADDING - 160
  )

  return {
    inset: 'auto',
    margin: 0,
    top,
    left,
    width,
    maxHeight: Math.max(140, window.innerHeight - top - VIEWPORT_PADDING),
  }
}

function flattenOptions<Value extends ChoicePrimitiveValue>(
  options: ChoiceOption<Value>[],
  parentPath = '',
  depth = 0
): FlattenedOption<Value>[] {
  return options.flatMap((option, index) => {
    if (isDivider(option)) return []

    const path = parentPath ? `${parentPath}.${index}` : String(index)
    const current: FlattenedOption<Value> = {
      option,
      path,
      depth,
      parentPath,
    }

    if (!option.children?.length) {
      return [current]
    }

    return [current, ...flattenOptions(option.children, path, depth + 1)]
  })
}

function filterSelectedOptions<Value extends ChoicePrimitiveValue>(
  options: ChoiceOption<Value>[],
  selectedValues: Set<string>
): ChoiceOption<Value>[] {
  return options.reduce<ChoiceOption<Value>[]>((accumulator, option) => {
    if (isDivider(option)) {
      accumulator.push(option)
      return accumulator
    }

    if (option.children?.length) {
      const nextChildren = filterSelectedOptions(option.children, selectedValues)
      if (nextChildren.length === 0) {
        return accumulator
      }

      accumulator.push({
        ...option,
        children: nextChildren,
      })
      return accumulator
    }

    if (!selectedValues.has(String(option.value))) {
      accumulator.push(option)
    }

    return accumulator
  }, [])
}

function getPanelKey(path: string): string {
  return path || '__root__'
}

function getParentPath(path: string): string {
  const segments = path.split('.')
  segments.pop()
  return segments.join('.')
}

function getPathChain(path: string): string[] {
  if (!path) return []
  const segments = path.split('.')
  return segments.map((_, index) => segments.slice(0, index + 1).join('.'))
}

export default function ChoiceInput<Value extends ChoicePrimitiveValue>({
  options,
  value,
  onChange,
  layout = 'popover',
  multiSelection = 'none',
  allowCustomValue = false,
  inputValue,
  onInputValueChange,
  inputId,
  name,
  placeholder = 'Select an option',
  disabled = false,
  readOnly = false,
  loading = false,
  loadingText = 'Loading...',
  emptyText = 'No options available',
  listboxLabel = 'Choices',
  ariaLabel,
  ariaLabelledBy,
  required = false,
  autoComplete,
  inputClassName = 'app-input',
  clearButton,
  shouldShowDropdown = true,
  onOpenChange,
  onInputFocus,
  createCustomValue,
  renderOption,
}: ChoiceInputProps<Value>) {
  const generatedTriggerId = useId()
  const triggerId = inputId ?? generatedTriggerId
  const popoverId = `${triggerId}-popover`
  const listboxId = `${triggerId}-listbox`
  const multiple = multiSelection !== 'none'
  const selection = useMemo(() => normalizeSelection(value, multiple), [multiple, value])
  const showSelectionPills =
    layout === 'popover' && multiple && (multiSelection === 'pills' || multiSelection === 'both')
  const showPopoverCheckboxes = multiSelection === 'checkboxes' || multiSelection === 'both'
  const selectedValueSet = useMemo(() => new Set(selection.map((item) => String(item))), [selection])
  const visibleOptions = useMemo(
    () =>
      layout === 'popover' && multiSelection === 'pills'
        ? filterSelectedOptions(options, selectedValueSet)
        : options,
    [layout, multiSelection, options, selectedValueSet]
  )
  const flattenedOptions = useMemo(() => flattenOptions(visibleOptions), [visibleOptions])
  const optionByValue = useMemo(
    () => new Map(flattenOptions(options).map((entry) => [String(entry.option.value), entry.option])),
    [options]
  )
  const selectedOptions = useMemo(
    () =>
      selection
        .map((item) => optionByValue.get(String(item)))
        .filter(Boolean) as ChoiceRenderableOption<Value>[],
    [optionByValue, selection]
  )
  const isTextInput = layout === 'popover' && inputValue !== undefined && onInputValueChange !== undefined
  const rootContainerRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLInputElement | HTMLButtonElement | null>(null)
  const popoverRef = useRef<PopoverElement | null>(null)
  const submenuAnchorRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const submenuRefs = useRef<Record<string, PopoverElement | null>>({})
  const submenuPanelRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const [open, setOpen] = useState(false)
  const [rootPosition, setRootPosition] = useState<PositionStyle>({})
  const [submenuPositions, setSubmenuPositions] = useState<Record<string, PositionStyle>>({})
  const [highlightedByPanel, setHighlightedByPanel] = useState<Record<string, string | null>>({})
  const [openSubmenuPaths, setOpenSubmenuPaths] = useState<string[]>([])
  const [focusedSubmenuPath, setFocusedSubmenuPath] = useState<string | null>(null)
  const lastRangeAnchorRef = useRef<Record<string, number>>({})

  const selectedSummary = useMemo(() => {
    if (selectedOptions.length === 0) return ''
    if (!multiple) return getOptionText(selectedOptions[0])
    if (selectedOptions.length <= 2) {
      return selectedOptions.map((option) => getOptionText(option)).join(', ')
    }
    const leading = selectedOptions
      .slice(0, 2)
      .map((option) => getOptionText(option))
      .join(', ')
    return `${leading}, +${selectedOptions.length - 2} more`
  }, [multiple, selectedOptions])

  const triggerValue = isTextInput ? inputValue ?? '' : selectedSummary
  const triggerButtonText =
    showSelectionPills && multiple
      ? placeholder
      : selectedSummary || placeholder
  const activeRootPath = highlightedByPanel[getPanelKey('')] ?? null
  const canOpenPopover = layout === 'popover' && shouldShowDropdown && !disabled && !readOnly

  const rootNavigablePaths = useMemo(
    () =>
      visibleOptions
        .map((option, index) =>
          isSelectableOption(option) && !option.disabled ? String(index) : null
        )
        .filter(Boolean) as string[],
    [visibleOptions]
  )
  const rootSelectableOptions = useMemo(
    () =>
      visibleOptions
        .map((option, index) =>
          isSelectableOption(option) && !option.disabled
            ? { path: String(index), option }
            : null
        )
        .filter(Boolean) as Array<{ path: string; option: ChoiceRenderableOption<Value> }>,
    [visibleOptions]
  )

  const updateOpenState = (nextOpen: boolean) => {
    setOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }

  const closePopover = (restoreFocus = true) => {
    setOpenSubmenuPaths([])
    setFocusedSubmenuPath(null)
    updateOpenState(false)
    if (restoreFocus) {
      window.setTimeout(() => {
        triggerRef.current?.focus()
      }, 0)
    }
  }

  const openSubmenu = (path: string) => {
    setOpenSubmenuPaths(getPathChain(path))
  }

  const syncRootPosition = () => {
    if (!triggerRef.current) return
    setRootPosition(getPanelPosition(triggerRef.current.getBoundingClientRect()))
  }

  const openPopover = () => {
    if (!canOpenPopover) return
    syncRootPosition()
    updateOpenState(true)
  }

  const togglePopover = () => {
    if (open) {
      closePopover(false)
      return
    }

    openPopover()
  }

  const setPanelHighlight = (panelPath: string, optionPath: string | null) => {
    setHighlightedByPanel((current) => {
      if (current[getPanelKey(panelPath)] === optionPath) return current
      return {
        ...current,
        [getPanelKey(panelPath)]: optionPath,
      }
    })
  }

  useEffect(() => {
    if (!open) return
    const currentRootPath = highlightedByPanel[getPanelKey('')] ?? null
    if (currentRootPath && rootNavigablePaths.includes(currentRootPath)) {
      return
    }

    const selectedRootPath = flattenedOptions.find(
      (entry) => entry.parentPath === '' && selection.some((item) => item === entry.option.value)
    )?.path
    const defaultPath = selectedRootPath ?? rootNavigablePaths[0] ?? null
    setPanelHighlight('', defaultPath)
  }, [flattenedOptions, highlightedByPanel, open, rootNavigablePaths, selection])

  useEffect(() => {
    if (!canOpenPopover && open) {
      closePopover(false)
    }
  }, [canOpenPopover, open])

  useLayoutEffect(() => {
    if (!open) {
      popoverRef.current?.hidePopover?.()
      Object.values(submenuRefs.current).forEach((element) => element?.hidePopover?.())
      return
    }

    syncRootPosition()
    popoverRef.current?.showPopover?.()
  }, [open, triggerValue])

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootContainerRef.current) return
      const target = event.target as Node
      if (rootContainerRef.current.contains(target)) return
      closePopover(false)
    }

    const handleScroll = () => {
      closePopover(false)
    }

    const handleResize = () => {
      if (!triggerRef.current) return
      setRootPosition(getPanelPosition(triggerRef.current.getBoundingClientRect()))
      setSubmenuPositions((current) => {
        const nextPositions = { ...current }
        openSubmenuPaths.forEach((path) => {
          const anchor = submenuAnchorRefs.current[path]
          if (!anchor) return
          nextPositions[path] = getSubmenuPosition(anchor.getBoundingClientRect())
        })
        return nextPositions
      })
    }

    document.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('scroll', handleScroll, true)
    window.addEventListener('resize', handleResize)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('resize', handleResize)
    }
  }, [open, openSubmenuPaths])

  useEffect(() => {
    if (openSubmenuPaths.length === 0) {
      Object.values(submenuRefs.current).forEach((element) => element?.hidePopover?.())
      return
    }

    const openSet = new Set(openSubmenuPaths)

    setSubmenuPositions((current) => {
      const nextPositions = { ...current }
      openSubmenuPaths.forEach((path) => {
        const anchor = submenuAnchorRefs.current[path]
        if (!anchor) return
        nextPositions[path] = getSubmenuPosition(anchor.getBoundingClientRect())
      })
      return nextPositions
    })

    Object.entries(submenuRefs.current).forEach(([path, element]) => {
      if (openSet.has(path)) {
        element?.showPopover?.()
      } else {
        element?.hidePopover?.()
      }
    })
  }, [openSubmenuPaths])

  useEffect(() => {
    if (!focusedSubmenuPath) return
    const panel = submenuPanelRefs.current[focusedSubmenuPath]
    panel?.focus()
  }, [focusedSubmenuPath])

  const moveRootHighlight = (direction: 1 | -1) => {
    if (rootNavigablePaths.length === 0) return
    const currentIndex = activeRootPath ? rootNavigablePaths.indexOf(activeRootPath) : -1
    const nextIndex =
      currentIndex === -1
        ? direction === 1
          ? 0
          : rootNavigablePaths.length - 1
        : (currentIndex + direction + rootNavigablePaths.length) % rootNavigablePaths.length
    setPanelHighlight('', rootNavigablePaths[nextIndex])
  }

  const cycleClosedSingleSelect = (target: 'next' | 'previous' | 'first' | 'last') => {
    if (multiple || isTextInput || rootSelectableOptions.length === 0) return

    const currentIndex = rootSelectableOptions.findIndex(
      (entry) => selection[0] !== undefined && entry.option.value === selection[0]
    )

    let nextIndex = 0
    if (target === 'first') {
      nextIndex = 0
    } else if (target === 'last') {
      nextIndex = rootSelectableOptions.length - 1
    } else if (currentIndex === -1) {
      nextIndex = target === 'next' ? 0 : rootSelectableOptions.length - 1
    } else {
      nextIndex =
        (currentIndex +
          (target === 'next' ? 1 : -1) +
          rootSelectableOptions.length) %
        rootSelectableOptions.length
    }

    const nextEntry = rootSelectableOptions[nextIndex]
    setPanelHighlight('', nextEntry.path)
    selectValues([nextEntry.option.value])
  }

  const selectValues = (nextValues: Value[]) => {
    if (multiple) {
      onChange(nextValues)
      return
    }

    onChange(nextValues[0] ?? null)
  }

  const removeSelectedValue = (nextValue: Value) => {
    if (!multiple) return

    const nextSelection = selection.filter((item) => item !== nextValue)
    selectValues(nextSelection)
  }

  const toggleValue = (nextValue: Value) => {
    if (!multiple) {
      selectValues([nextValue])
      closePopover(false)
      return
    }

    const nextSelection = selection.some((item) => item === nextValue)
      ? selection.filter((item) => item !== nextValue)
      : [...selection, nextValue]
    selectValues(nextSelection)
  }

  const applyRangeSelection = (
    siblingOptions: ChoiceOption<Value>[],
    siblingIndex: number,
    targetValue: Value
  ) => {
    const selectableEntries = siblingOptions
      .map((option, index) =>
        isSelectableOption(option) && !option.disabled && !option.children?.length
          ? { option, index }
          : null
      )
      .filter(Boolean) as Array<{ option: ChoiceRenderableOption<Value>; index: number }>

    const panelKey = siblingOptions
      .map((option, index) => (index === siblingIndex ? 'current' : isDivider(option) ? 'divider' : 'option'))
      .join('|')
    const targetSelectableIndex = selectableEntries.findIndex((entry) => entry.index === siblingIndex)
    if (targetSelectableIndex === -1) {
      toggleValue(targetValue)
      return
    }

    const lastAnchor = lastRangeAnchorRef.current[panelKey]
    if (lastAnchor === undefined) {
      lastRangeAnchorRef.current[panelKey] = targetSelectableIndex
      toggleValue(targetValue)
      return
    }

    const start = Math.min(lastAnchor, targetSelectableIndex)
    const end = Math.max(lastAnchor, targetSelectableIndex)
    const targetWasSelected = selection.some((item) => item === targetValue)
    const rangeValues = selectableEntries.slice(start, end + 1).map((entry) => entry.option.value)
    const nextSelection = new Set(selection)

    if (targetWasSelected) {
      rangeValues.forEach((item) => nextSelection.delete(item))
    } else {
      rangeValues.forEach((item) => nextSelection.add(item))
    }

    lastRangeAnchorRef.current[panelKey] = targetSelectableIndex
    selectValues(Array.from(nextSelection))
  }

  const getCustomValue = () => {
    const trimmed = inputValue?.trim() ?? ''
    if (!allowCustomValue || trimmed.length === 0) return null
    if (createCustomValue) {
      return createCustomValue(trimmed)
    }
    return trimmed as Value
  }

  const handleSelectableAction = (
    option: ChoiceRenderableOption<Value>,
    siblingOptions: ChoiceOption<Value>[],
    siblingIndex: number,
    event?: { shiftKey?: boolean }
  ) => {
    const select = () => {
      if (multiple && event?.shiftKey) {
        applyRangeSelection(siblingOptions, siblingIndex, option.value)
      } else {
        toggleValue(option.value)
      }

      if (isTextInput) {
        onInputValueChange?.(getOptionText(option))
      }

      if (!multiple) {
        closePopover(false)
      }
    }

    const helpers: ChoiceActionHelpers<Value> = {
      option,
      value,
      isSelected: selection.some((item) => item === option.value),
      select,
      toggle: select,
      close: () => closePopover(false),
      openSubmenu: () => {
        if (!option.children?.length) return
        openSubmenu(optionPathForSibling(siblingIndex))
      },
    }

    if (option.action) {
      option.action(helpers)
      return
    }

    select()
  }

  const optionPathForSibling = (index: number, parentPath = '') =>
    parentPath ? `${parentPath}.${index}` : String(index)

  const renderOptionContent = (
    option: ChoiceRenderableOption<Value>,
    context: ChoiceRenderContext<Value>,
    hasSubmenu: boolean
  ) => {
    const content = option.render?.(context) ?? renderOption?.(option, context)

    if (content) return content

    return (
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-start gap-3">
          {context.layout === 'popover' && (!multiple || showPopoverCheckboxes) ? (
            <span
              aria-hidden="true"
              className={`mt-px flex h-5 w-5 shrink-0 items-start justify-center rounded border pt-px ${
                context.multiple
                  ? context.selected
                    ? 'border-primary-teal bg-primary-teal text-white'
                    : 'border-gray-300 bg-white text-transparent dark:border-gray-600 dark:bg-gray-900'
                  : 'border-transparent text-primary-teal'
              }`}
            >
              {context.multiple ? (
                <HiCheck className="h-3.5 w-3.5" />
              ) : context.selected ? (
                <HiCheck className="h-4 w-4" />
              ) : null}
            </span>
          ) : null}
          {option.icon ? (
            <span className="mt-px flex h-5 w-5 shrink-0 items-start justify-center pt-px text-gray-500 dark:text-gray-300">
              {option.icon}
            </span>
          ) : null}
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium leading-5 text-gray-900 dark:text-gray-100">
              {option.label}
            </div>
            {option.description ? (
              <div className="mt-0.5 text-xs leading-4 text-gray-500 dark:text-gray-400">
                {option.description}
              </div>
            ) : null}
          </div>
          {hasSubmenu ? (
            <span className="ml-auto mt-px flex h-5 w-5 shrink-0 items-start justify-center pt-px text-gray-400 dark:text-gray-500">
              <HiChevronRight className="h-4 w-4" />
            </span>
          ) : null}
        </div>
      </div>
    )
  }

  const renderPopoverPanel = (
    panelOptions: ChoiceOption<Value>[],
    panelPath = '',
    depth = 0
  ): ReactNode => {
    const panelKey = getPanelKey(panelPath)
    const highlightedPath = highlightedByPanel[panelKey] ?? null
    const panelId = panelPath ? `${listboxId}-${panelPath.replace(/\./g, '-')}` : listboxId
    const hasSelectableOptions = panelOptions.some((option) => isSelectableOption(option))

    return (
      <div
        id={panelId}
        ref={(element) => {
          if (panelPath) {
            submenuPanelRefs.current[panelPath] = element
          }
        }}
        role="listbox"
        aria-label={panelPath ? undefined : listboxLabel}
        aria-labelledby={panelPath ? undefined : ariaLabelledBy}
        aria-multiselectable={multiple || undefined}
        tabIndex={panelPath ? -1 : undefined}
        onKeyDown={(event) => {
          if (!panelPath) return

          const navigablePaths = panelOptions
            .map((option, index) =>
              isSelectableOption(option) && !option.disabled
                ? optionPathForSibling(index, panelPath)
                : null
            )
            .filter(Boolean) as string[]
          const currentPath = highlightedPath ?? navigablePaths[0] ?? null
          const currentIndex = currentPath ? navigablePaths.indexOf(currentPath) : -1

          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            if (navigablePaths.length === 0) return
            const nextIndex =
              currentIndex === -1
                ? event.key === 'ArrowDown'
                  ? 0
                  : navigablePaths.length - 1
                : (currentIndex +
                    (event.key === 'ArrowDown' ? 1 : -1) +
                    navigablePaths.length) %
                  navigablePaths.length
            setPanelHighlight(panelPath, navigablePaths[nextIndex])
            return
          }

          if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault()
            setPanelHighlight(
              panelPath,
              navigablePaths[event.key === 'Home' ? 0 : navigablePaths.length - 1] ?? null
            )
            return
          }

          if (event.key === 'ArrowLeft') {
            event.preventDefault()
            const parentPath = getParentPath(panelPath)
            setOpenSubmenuPaths(parentPath ? getPathChain(parentPath) : [])
            setFocusedSubmenuPath(parentPath || null)
            if (!parentPath) {
              triggerRef.current?.focus()
            }
            return
          }

          if (event.key === 'Escape') {
            event.preventDefault()
            closePopover()
            return
          }

          if (event.key === 'Tab') {
            closePopover(false)
            return
          }

          if (!currentPath) return
          const optionIndex = Number(currentPath.split('.').at(-1))
          const currentOption = panelOptions[optionIndex]
          if (!isSelectableOption(currentOption) || currentOption.disabled) return

          if (event.key === 'ArrowRight' && currentOption.children?.length) {
            event.preventDefault()
            openSubmenu(currentPath)
            setFocusedSubmenuPath(currentPath)
            setPanelHighlight(
              currentPath,
              currentOption.children.findIndex(
                (child) => isSelectableOption(child) && !child.disabled
              ) >= 0
                ? `${currentPath}.${currentOption.children.findIndex(
                    (child) => isSelectableOption(child) && !child.disabled
                  )}`
                : null
            )
            return
          }

          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            if (currentOption.children?.length) {
              openSubmenu(currentPath)
              setFocusedSubmenuPath(currentPath)
              return
            }
            handleSelectableAction(currentOption, panelOptions, optionIndex)
          }
        }}
        className="max-h-[inherit] overflow-auto py-1 focus:outline-none"
      >
        {loading && !panelPath ? (
          <p className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">{loadingText}</p>
        ) : !hasSelectableOptions ? (
          <p className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">{emptyText}</p>
        ) : (
          panelOptions.map((option, index) => {
            const path = optionPathForSibling(index, panelPath)

            if (isDivider(option)) {
              return (
                <div key={option.key ?? path} className="px-2 py-1">
                  {option.label ? (
                    <div className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      {option.label}
                    </div>
                  ) : null}
                  <div className="border-t border-gray-200 dark:border-gray-700" />
                </div>
              )
            }

            const selected = selection.some((item) => item === option.value)
            const highlighted = highlightedPath === path
            const hasSubmenu = Boolean(option.children?.length)
            const context: ChoiceRenderContext<Value> = {
              option,
              selected,
              highlighted,
              depth,
              layout: 'popover',
              multiple,
            }

            const rowClasses = [
              'mx-1 flex w-[calc(100%-0.5rem)] items-start rounded-md px-3 py-2 text-left',
              option.disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
              highlighted
                ? 'bg-gray-100 dark:bg-gray-800'
                : 'hover:bg-gray-50 dark:hover:bg-gray-800/80',
            ].join(' ')

            return (
              <div key={path} className="relative">
                <button
                  ref={(element) => {
                    if (hasSubmenu) {
                      submenuAnchorRefs.current[path] = element
                    }
                  }}
                  id={`${panelId}-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  aria-haspopup={hasSubmenu ? 'menu' : undefined}
                  aria-expanded={hasSubmenu && openSubmenuPaths.includes(path) ? true : undefined}
                  aria-label={getOptionText(option)}
                  onMouseEnter={() => {
                    setPanelHighlight(panelPath, path)
                    if (hasSubmenu) {
                      openSubmenu(path)
                    }
                  }}
                  onMouseDown={(event) => {
                    event.preventDefault()
                  }}
                  onClick={(event) => {
                    if (option.disabled) return
                    if (hasSubmenu) {
                      openSubmenu(path)
                      setFocusedSubmenuPath(path)
                      setPanelHighlight(
                        path,
                        option.children?.findIndex(
                          (child) => isSelectableOption(child) && !child.disabled
                        ) !== undefined &&
                          option.children &&
                          option.children.findIndex(
                            (child) => isSelectableOption(child) && !child.disabled
                          ) >= 0
                          ? `${path}.${option.children.findIndex(
                              (child) => isSelectableOption(child) && !child.disabled
                            )}`
                          : null
                      )
                      return
                    }
                    handleSelectableAction(option, panelOptions, index, event)
                  }}
                  className={rowClasses}
                >
                  {renderOptionContent(option, context, hasSubmenu)}
                </button>

                {hasSubmenu ? (
                  <div
                    ref={(element) => {
                      submenuRefs.current[path] = element
                    }}
                    {...({ popover: 'manual' } as HTMLAttributes<HTMLDivElement>)}
                    className="rounded-xl border border-gray-200 bg-white p-0 shadow-xl outline-none dark:border-gray-700 dark:bg-gray-900"
                    style={{
                      position: 'fixed',
                      zIndex: 60,
                      ...submenuPositions[path],
                    }}
                  >
                    {renderPopoverPanel(option.children ?? [], path, depth + 1)}
                  </div>
                ) : null}
              </div>
            )
          })
        )}
      </div>
    )
  }

  const rootTriggerKeyDown = (
    event: ReactKeyboardEvent<HTMLInputElement | HTMLButtonElement>
  ) => {
    if (disabled || layout !== 'popover') return

    if (event.key === 'ArrowDown') {
      if (event.altKey) {
        event.preventDefault()
        if (!open) {
          openPopover()
        }
        return
      }
      if (isTextInput && !open) return
      event.preventDefault()
      if (!open) {
        cycleClosedSingleSelect('next')
        return
      }
      moveRootHighlight(1)
      return
    }

    if (event.key === 'ArrowUp') {
      if (isTextInput && !open) return
      event.preventDefault()
      if (!open) {
        cycleClosedSingleSelect('previous')
        return
      }
      moveRootHighlight(-1)
      return
    }

    if (event.key === 'Home' && (!isTextInput || open)) {
      event.preventDefault()
      if (!open) {
        cycleClosedSingleSelect('first')
        return
      }
      setPanelHighlight('', rootNavigablePaths[0] ?? null)
      return
    }

    if (event.key === 'End' && (!isTextInput || open)) {
      event.preventDefault()
      if (!open) {
        cycleClosedSingleSelect('last')
        return
      }
      setPanelHighlight('', rootNavigablePaths[rootNavigablePaths.length - 1] ?? null)
      return
    }

    if ((event.key === 'Enter' || (!isTextInput && event.key === ' ')) && !open) {
      event.preventDefault()
      openPopover()
      return
    }

    if (event.key === 'Escape' && open) {
      event.preventDefault()
      closePopover(false)
      return
    }

    if (event.key === 'Tab' && open) {
      closePopover(false)
      return
    }

    if (!open) return

    const highlightedOption = activeRootPath
      ? flattenedOptions.find((entry) => entry.path === activeRootPath)?.option
      : null

    if (event.key === 'ArrowRight' && highlightedOption?.children?.length && activeRootPath) {
      event.preventDefault()
      openSubmenu(activeRootPath)
      setFocusedSubmenuPath(activeRootPath)
      setPanelHighlight(
        activeRootPath,
        highlightedOption.children.findIndex((child) => isSelectableOption(child) && !child.disabled) >=
          0
          ? `${activeRootPath}.${highlightedOption.children.findIndex(
              (child) => isSelectableOption(child) && !child.disabled
            )}`
          : null
      )
      return
    }

    if (event.key === 'Enter' || event.key === ' ') {
      if (highlightedOption && activeRootPath) {
        event.preventDefault()
        const optionIndex = Number(activeRootPath.split('.').at(-1))
        if (highlightedOption.children?.length) {
          openSubmenu(activeRootPath)
          setFocusedSubmenuPath(activeRootPath)
          return
        }
        handleSelectableAction(highlightedOption, visibleOptions, optionIndex)
        return
      }

      const customValue = getCustomValue()
      if (customValue !== null) {
        event.preventDefault()
        if (multiple) {
          selectValues(Array.from(new Set([...selection, customValue])))
        } else {
          selectValues([customValue])
          closePopover(false)
        }
      }
    }
  }

  const renderInlineOptions = (
    inlineOptions: ChoiceOption<Value>[],
    depth = 0,
    parentPath = ''
  ): ReactNode =>
    inlineOptions.map((option, index) => {
      const path = optionPathForSibling(index, parentPath)

      if (isDivider(option)) {
        return (
          <div key={option.key ?? path} className="w-full border-t border-gray-200 py-2 dark:border-gray-700">
            {option.label ? (
              <div className="pb-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {option.label}
              </div>
            ) : null}
          </div>
        )
      }

      const checked = selection.some((item) => item === option.value)
      const context: ChoiceRenderContext<Value> = {
        option,
        selected: checked,
        highlighted: false,
        depth,
        layout,
        multiple,
      }

      return (
        <div key={path} className={layout === 'inline' ? 'min-w-0' : 'w-full'}>
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 text-sm ${
              option.disabled
                ? 'cursor-not-allowed opacity-60'
                : 'hover:border-primary-teal/40 hover:bg-gray-50 dark:hover:bg-gray-800/70'
            } ${
              checked
                ? 'border-primary-teal/40 bg-primary-teal/5 dark:border-primary-teal/50 dark:bg-primary-teal/10'
                : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900'
            }`}
          >
            <span className="flex h-5 w-4 shrink-0 items-center justify-center">
              <input
                type={multiple ? 'checkbox' : 'radio'}
                name={name}
                checked={checked}
                disabled={disabled || readOnly || option.disabled}
                onChange={() => {
                  if (multiple) {
                    toggleValue(option.value)
                  } else {
                    selectValues([option.value])
                  }
                }}
                className="h-4 w-4 shrink-0 accent-primary-teal"
                aria-label={getOptionText(option)}
              />
            </span>
            <div className="min-w-0 flex-1">
              {renderOptionContent(option, context, false)}
              {option.children?.length ? (
                <div className="mt-2 pl-6">{renderInlineOptions(option.children, depth + 1, path)}</div>
              ) : null}
            </div>
          </label>
        </div>
      )
    })

  if (layout !== 'popover') {
    return (
      <div
        role={multiple ? 'group' : 'radiogroup'}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        className={layout === 'inline' ? 'flex flex-wrap gap-3' : 'space-y-3'}
      >
        {renderInlineOptions(options)}
      </div>
    )
  }

  return (
    <div ref={rootContainerRef} className="relative">
      {showSelectionPills && selectedOptions.length > 0 ? (
        <div className="mb-3 flex flex-wrap gap-2">
          {selectedOptions.map((option) => (
            <div
              key={String(option.value)}
              className="flex items-center rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-900 focus-within:ring-2 focus-within:ring-primary-teal focus-within:ring-offset-2 dark:bg-gray-700 dark:text-gray-100"
            >
              <span>{getOptionText(option)}</span>
              <button
                type="button"
                onClick={() => removeSelectedValue(option.value)}
                className="ml-2 rounded-full p-0.5 focus:outline-none"
                aria-label={`Remove ${getOptionText(option)}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="relative">
        {isTextInput ? (
          <input
            id={triggerId}
            ref={(element) => {
              triggerRef.current = element
            }}
            type="text"
            role="combobox"
            value={triggerValue}
            readOnly={readOnly}
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={open ? listboxId : undefined}
            aria-activedescendant={
              open && activeRootPath
                ? `${listboxId}-option-${Number(activeRootPath.split('.').at(-1))}`
                : undefined
            }
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledBy}
            aria-haspopup="listbox"
            onFocus={() => {
              onInputFocus?.()
            }}
            onClick={() => {
              togglePopover()
            }}
            onChange={(event) => {
              onInputValueChange?.(event.target.value)
              if (!open) {
                openPopover()
              }
            }}
            onKeyDown={rootTriggerKeyDown}
            placeholder={selectedSummary ? undefined : placeholder}
            disabled={disabled}
            required={required}
            autoComplete={autoComplete}
            className={`${inputClassName} ${clearButton?.visible ? 'pr-20' : 'pr-10'}`}
          />
        ) : (
          <button
            id={triggerId}
            ref={(element) => {
              triggerRef.current = element
            }}
            type="button"
            role="combobox"
            aria-expanded={open}
            aria-controls={open ? listboxId : undefined}
            aria-activedescendant={
              open && activeRootPath
                ? `${listboxId}-option-${Number(activeRootPath.split('.').at(-1))}`
                : undefined
            }
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledBy}
            aria-haspopup="listbox"
            disabled={disabled}
            onFocus={() => {
              onInputFocus?.()
            }}
            onClick={() => {
              togglePopover()
            }}
            onKeyDown={rootTriggerKeyDown}
            className={`${inputClassName} ${clearButton?.visible ? 'pr-20' : 'pr-10'} select-none text-left`}
          >
            <span
              className={
                selectedSummary && !(showSelectionPills && multiple)
                  ? undefined
                  : 'text-gray-500 dark:text-gray-400'
              }
            >
              {triggerButtonText}
            </span>
          </button>
        )}

        {clearButton?.visible ? (
          <button
            type="button"
            onClick={() => {
              clearButton.onClear()
              if (clearButton.openAfterClear) {
                openPopover()
              } else {
                closePopover(false)
              }
              window.setTimeout(() => triggerRef.current?.focus(), 0)
            }}
            aria-label={clearButton.label}
            className="absolute right-9 top-1/2 -translate-y-1/2 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            Clear
          </button>
        ) : null}

        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (open) {
              closePopover(false)
            } else {
              openPopover()
              triggerRef.current?.focus()
            }
          }}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400"
        >
          <HiChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      <div
        ref={popoverRef}
        {...({ popover: 'manual' } as HTMLAttributes<HTMLDivElement>)}
        id={popoverId}
        className="rounded-xl border border-gray-200 bg-white p-0 shadow-xl outline-none dark:border-gray-700 dark:bg-gray-900"
        style={{
          position: 'fixed',
          zIndex: 50,
          ...rootPosition,
        }}
      >
        {renderPopoverPanel(visibleOptions)}
      </div>
    </div>
  )
}
