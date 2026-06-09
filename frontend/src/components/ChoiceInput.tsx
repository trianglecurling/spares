import {
  useCallback,
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
import { HiCheck, HiChevronDown, HiChevronRight, HiXMark } from 'react-icons/hi2'

type ChoicePrimitiveValue = string | number

type ChoiceClearButtonConfig = {
  visible: boolean
  label: string
  onClear: () => void
  openAfterClear?: boolean
}

export type ChoiceMultiSelectionIndicatorStyle = 'pills' | 'checkboxes' | 'both'

/**
 * `undefined` → single-select (max 1). `null`, non-positive values, or `NaN` → no limit.
 * Positive integers cap how many items may be selected.
 */
function resolveMaxSelectedItems(maxSelectedItems: number | null | undefined): number | null {
  if (maxSelectedItems === undefined) return 1
  if (maxSelectedItems === null) return null
  if (typeof maxSelectedItems !== 'number' || Number.isNaN(maxSelectedItems) || maxSelectedItems <= 0) {
    return null
  }
  const n = Math.floor(maxSelectedItems)
  return n >= 1 ? n : null
}

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
  /** Omit or set to `1` for single-select. `null`, `0`, or `NaN` means no limit. An integer greater than `1` caps selections. */
  maxSelectedItems?: number | null
  /** When multi-select is active, controls pills vs checkbox presentation in the popover (and checkbox vs radio for inline/block). */
  multiSelectionIndicatorStyle?: ChoiceMultiSelectionIndicatorStyle
  /**
   * Popover: commit typed values (single or multi); multi-select also shows an Add row and list rows for custom values.
   * Inline/block: adds an Other row (single) or an add field plus removable custom chips (multi).
   */
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
  /** For composite labeling with `FormField` helper/error regions. */
  ariaDescribedBy?: string
  ariaInvalid?: boolean
  required?: boolean
  /** Text combobox only; defaults to `off` to suppress browser autocomplete. */
  autoComplete?: string
  /**
   * When true (popover text combobox only), uses `autocomplete="chrome-off"` only while the field is focused,
   * and omits the attribute on blur so Chromium’s ~5-instance cap for `chrome-off` is not exhausted.
   * Native autofill overlays can otherwise cover custom suggestion lists (e.g. Nominatim).
   */
  chromeOffAutocompleteWhileFocused?: boolean
  /** Popover layout: defaults to `max-w-md` on the trigger shell; override with any `max-w-*` utility here. */
  inputClassName?: string
  /** Omit to use the built-in clear control when `allowCustomValue` is true (popover text combobox). */
  clearButton?: ChoiceClearButtonConfig
  shouldShowDropdown?: boolean
  onOpenChange?: (open: boolean) => void
  onInputFocus?: () => void
  /** Text combobox: fired on native `input` so parents can enable option filtering only while typing. */
  onComboboxInput?: () => void
  /** Text combobox: fired on blur when focus leaves the combobox container (not when moving into the listbox). */
  onComboboxTextBlur?: () => void
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
/** Upper bound for popover list height (viewport space is still the hard limit when smaller). */
const POPOVER_PANEL_MAX_HEIGHT = 400
const POPOVER_TRIGGER_DEFAULT_MAX_WIDTH_CLASS = 'max-w-md'
/** Synthetic list path for the multi-combobox "Add …" row (root panel only). */
const CHOICE_ROOT_ADD_CUSTOM_PATH = '__add_custom__'

/** Popover triggers: max-width utilities apply to the shell so chevron/clear align with the field. */
function popoverTriggerClassNames(inputClassName: string): {
  shellClassName: string
  controlClassName: string
} {
  const tokens = inputClassName.trim().split(/\s+/).filter(Boolean)
  const maxWidthTokens = tokens.filter((token) => /^!?max-w-/.test(token))
  const controlTokens = tokens.filter((token) => !/^!?max-w-/.test(token))
  const maxWidthClass =
    maxWidthTokens.length > 0
      ? maxWidthTokens[maxWidthTokens.length - 1]!
      : POPOVER_TRIGGER_DEFAULT_MAX_WIDTH_CLASS
  return {
    shellClassName: ['group', 'relative', 'w-full', maxWidthClass].join(' '),
    controlClassName: controlTokens.join(' '),
  }
}

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
      maxHeight: Math.max(140, Math.min(spaceBelow, POPOVER_PANEL_MAX_HEIGHT)),
    }
  }

  return {
    inset: 'auto',
    margin: 0,
    bottom: window.innerHeight - anchorRect.top + PANEL_GAP,
    left,
    width,
    maxHeight: Math.max(140, Math.min(spaceAbove, POPOVER_PANEL_MAX_HEIGHT)),
  }
}

function getSubmenuOpenRight(anchorRect: DOMRect): boolean {
  const width = clamp(SUBMENU_WIDTH, MIN_PANEL_WIDTH, window.innerWidth - VIEWPORT_PADDING * 2)
  const spaceRight = window.innerWidth - anchorRect.right - VIEWPORT_PADDING
  const spaceLeft = anchorRect.left - VIEWPORT_PADDING
  return spaceRight >= width || spaceRight >= spaceLeft
}

function getSubmenuPosition(anchorRect: DOMRect): PositionStyle {
  const width = clamp(SUBMENU_WIDTH, MIN_PANEL_WIDTH, window.innerWidth - VIEWPORT_PADDING * 2)
  const openRight = getSubmenuOpenRight(anchorRect)
  const left = openRight
    ? clamp(anchorRect.right + 4, VIEWPORT_PADDING, window.innerWidth - width - VIEWPORT_PADDING)
    : clamp(anchorRect.left - width - 4, VIEWPORT_PADDING, window.innerWidth - width - VIEWPORT_PADDING)
  const top = clamp(
    anchorRect.top,
    VIEWPORT_PADDING,
    window.innerHeight - VIEWPORT_PADDING - 160
  )

  const spaceBelowTop = window.innerHeight - top - VIEWPORT_PADDING

  return {
    inset: 'auto',
    margin: 0,
    top,
    left,
    width,
    maxHeight: Math.max(140, Math.min(spaceBelowTop, POPOVER_PANEL_MAX_HEIGHT)),
  }
}

/** Valid `anchor-name` / `position-anchor` dashed-ident for this trigger (unique per instance). */
function choiceInputPopoverAnchorName(triggerId: string): string {
  const safe = triggerId
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return `--choice-input-${safe.length > 0 ? safe : 'trigger'}`
}

/** Unique per ChoiceInput instance and option path (e.g. `0`, `0.2`). */
function choiceInputSubmenuAnchorName(triggerId: string, optionPath: string): string {
  const safeTrigger = triggerId
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  const safePath = optionPath
    .replace(/[^a-zA-Z0-9_.-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .replace(/\./g, '-')
  const t = safeTrigger.length > 0 ? safeTrigger : 'trigger'
  const p = safePath.length > 0 ? safePath : 'path'
  return `--choice-submenu-${t}-${p}`
}

function supportsCssAnchorPositioning(): boolean {
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return false
  try {
    return (
      CSS.supports('position-anchor', '--choice-input') ||
      CSS.supports('(position-anchor: --choice-input)')
    )
  } catch {
    return false
  }
}

const SUPPORTS_CSS_ANCHOR_POSITIONING = supportsCssAnchorPositioning()

function getRootPanelPlaceBelow(anchorRect: DOMRect): boolean {
  const spaceBelow = window.innerHeight - anchorRect.bottom - VIEWPORT_PADDING
  const spaceAbove = anchorRect.top - VIEWPORT_PADDING
  return spaceBelow >= 240 || spaceBelow >= spaceAbove
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

/** `candidatePath` is a nested submenu under `ancestorPath` (e.g. `0` and `0.1`). */
function isStrictSubmenuPathOf(ancestorPath: string, candidatePath: string): boolean {
  if (!ancestorPath) return false
  return candidatePath.startsWith(`${ancestorPath}.`)
}

function targetIsInsideStrictDescendantSubmenuPanel(
  target: Node | null,
  panelPath: string,
  openSubmenuPaths: readonly string[],
  panels: Record<string, HTMLDivElement | null>
): boolean {
  if (!target) return false
  for (const openPath of openSubmenuPaths) {
    if (openPath !== panelPath && isStrictSubmenuPathOf(panelPath, openPath)) {
      const el = panels[openPath]
      if (el?.contains(target)) return true
    }
  }
  return false
}

function targetIsInsideAnyOpenSubmenuPanel(
  target: Node | null,
  openSubmenuPaths: readonly string[],
  panels: Record<string, HTMLDivElement | null>
): boolean {
  if (!target) return false
  for (const path of openSubmenuPaths) {
    const el = panels[path]
    if (el?.contains(target)) return true
  }
  return false
}

export default function ChoiceInput<Value extends ChoicePrimitiveValue>({
  options,
  value,
  onChange,
  layout = 'popover',
  maxSelectedItems: maxSelectedItemsProp,
  multiSelectionIndicatorStyle = 'checkboxes',
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
  ariaDescribedBy,
  ariaInvalid,
  required = false,
  autoComplete,
  chromeOffAutocompleteWhileFocused = false,
  inputClassName = 'app-input',
  clearButton,
  shouldShowDropdown = true,
  onOpenChange,
  onInputFocus,
  onComboboxInput,
  onComboboxTextBlur,
  createCustomValue,
  renderOption,
}: ChoiceInputProps<Value>) {
  const generatedTriggerId = useId()
  /** See `chromeOffAutocompleteWhileFocused`; only read when `isTextInput`. */
  const [, setPopoverComboboxFocused] = useState(false)
  const triggerId = inputId ?? generatedTriggerId
  const popoverId = `${triggerId}-popover`
  const listboxId = `${triggerId}-listbox`
  const popoverAnchorCssName = useMemo(() => choiceInputPopoverAnchorName(triggerId), [triggerId])
  const selectionLimitHintId = `${triggerId}-selection-limit`
  const normalizedMaxCap = resolveMaxSelectedItems(maxSelectedItemsProp)
  const multiple = normalizedMaxCap === null || normalizedMaxCap > 1
  const isTextInput = layout === 'popover' && inputValue !== undefined && onInputValueChange !== undefined
  const selection = useMemo(() => normalizeSelection(value, multiple), [multiple, value])
  const atSelectionCap =
    multiple && normalizedMaxCap !== null && selection.length >= normalizedMaxCap
  const selectionSlotsRemaining =
    normalizedMaxCap === null ? Number.POSITIVE_INFINITY : Math.max(0, normalizedMaxCap - selection.length)
  const showSelectionLimitHint =
    multiple && normalizedMaxCap !== null && normalizedMaxCap > 1
  const selectionLimitHintText = `${selection.length} of ${normalizedMaxCap} selected`
  const showSelectionLimitHintInComboboxPopover = showSelectionLimitHint && isTextInput
  const showSelectionLimitHintOutsidePopover = showSelectionLimitHint && !isTextInput
  const mergedAriaDescribedBy = [ariaDescribedBy, showSelectionLimitHint ? selectionLimitHintId : null]
    .filter(Boolean)
    .join(' ') || undefined
  const showSelectionPills =
    layout === 'popover' &&
    multiple &&
    (multiSelectionIndicatorStyle === 'pills' || multiSelectionIndicatorStyle === 'both')
  const showPopoverCheckboxes =
    multiSelectionIndicatorStyle === 'checkboxes' || multiSelectionIndicatorStyle === 'both'
  const selectedValueSet = useMemo(() => new Set(selection.map((item) => String(item))), [selection])
  const visibleOptions = useMemo(
    () =>
      layout === 'popover' && multiSelectionIndicatorStyle === 'pills'
        ? filterSelectedOptions(options, selectedValueSet)
        : options,
    [layout, multiSelectionIndicatorStyle, options, selectedValueSet]
  )
  /** Merges every option ever seen from `options` so filtered/parent lists still resolve labels, icons, and descriptions. */
  const optionCatalogRef = useRef<Map<string, ChoiceRenderableOption<Value>>>(new Map())
  const stableOptionByValue = useMemo(() => {
    for (const entry of flattenOptions(options)) {
      optionCatalogRef.current.set(String(entry.option.value), entry.option)
    }
    return new Map(optionCatalogRef.current)
  }, [options])
  const knownValueKeys = useMemo(
    () => new Set(stableOptionByValue.keys()),
    [stableOptionByValue]
  )
  const popoverListOptions = useMemo(() => {
    if (layout !== 'popover' || !multiple || !allowCustomValue) return visibleOptions
    const visibleKeys = new Set(flattenOptions(visibleOptions).map((entry) => String(entry.option.value)))
    const knownMissing = selection.filter(
      (s) => !visibleKeys.has(String(s)) && stableOptionByValue.has(String(s))
    )
    const customMissing = selection.filter(
      (s) => !visibleKeys.has(String(s)) && !stableOptionByValue.has(String(s))
    )
    if (knownMissing.length === 0 && customMissing.length === 0) return visibleOptions

    const flatOrder = flattenOptions(options)
    const orderIndex = new Map(flatOrder.map((entry, index) => [String(entry.option.value), index]))
    const sortedKnownMissing = [...knownMissing].sort((a, b) => {
      const ia = orderIndex.get(String(a)) ?? Number.POSITIVE_INFINITY
      const ib = orderIndex.get(String(b)) ?? Number.POSITIVE_INFINITY
      if (ia !== ib) return ia - ib
      return String(a).localeCompare(String(b), undefined, { sensitivity: 'base' })
    })
    const orderedMissing = [...sortedKnownMissing, ...customMissing]

    const appended: ChoiceRenderableOption<Value>[] = orderedMissing.map((v) => {
      const known = stableOptionByValue.get(String(v))
      return known ?? { value: v, label: String(v) }
    })
    return [...visibleOptions, ...appended]
  }, [allowCustomValue, layout, multiple, options, selection, stableOptionByValue, visibleOptions])
  const rootPanelOptions = layout === 'popover' ? popoverListOptions : visibleOptions
  const flattenedOptions = useMemo(() => flattenOptions(rootPanelOptions), [rootPanelOptions])
  const optionByValue = useMemo(
    () => new Map(flattenOptions(options).map((entry) => [String(entry.option.value), entry.option])),
    [options]
  )
  const comboboxInputAddIsRedundant = useMemo(() => {
    if (!isTextInput || !multiple || !allowCustomValue) return false
    const trimmed = (inputValue ?? '').trim()
    if (!trimmed) return false
    return selection.some((s) => {
      const opt = optionByValue.get(String(s)) ?? stableOptionByValue.get(String(s))
      if (opt) {
        return getOptionText(opt) === trimmed || String(opt.value) === trimmed
      }
      return String(s) === trimmed
    })
  }, [allowCustomValue, inputValue, isTextInput, multiple, optionByValue, selection, stableOptionByValue])
  const isCustomSingleValue =
    allowCustomValue && layout !== 'popover' && !multiple && value !== null && !knownValueKeys.has(String(value))
  const [inlineOtherActive, setInlineOtherActive] = useState(false)
  const [inlineMultiCustomDraft, setInlineMultiCustomDraft] = useState('')
  const otherFieldInputId = `${triggerId}-other-value`

  useEffect(() => {
    if (!allowCustomValue || layout === 'popover' || multiple) return
    if (value !== null && knownValueKeys.has(String(value))) {
      setInlineOtherActive(false)
      return
    }
    if (value !== null && !knownValueKeys.has(String(value))) {
      setInlineOtherActive(true)
    }
  }, [allowCustomValue, knownValueKeys, layout, multiple, value])

  const rootContainerRef = useRef<HTMLDivElement | null>(null)
  const popoverTriggerShellRef = useRef<HTMLDivElement | null>(null)
  const rootListboxRef = useRef<HTMLDivElement | null>(null)
  const toolbarUnselectAllRef = useRef<HTMLButtonElement | null>(null)
  const toolbarSelectAllRef = useRef<HTMLButtonElement | null>(null)
  const lastRootListHighlightRef = useRef<string | null>(null)
  const triggerRef = useRef<HTMLInputElement | HTMLButtonElement | null>(null)
  const popoverRef = useRef<PopoverElement | null>(null)
  const submenuAnchorRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const submenuRefs = useRef<Record<string, PopoverElement | null>>({})
  const submenuPanelRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const [open, setOpen] = useState(false)
  const [rootPosition, setRootPosition] = useState<PositionStyle>({})
  /** Viewport-aware cap for the root listbox; always set from `getPanelPosition` so the list scrolls even when CSS-anchor `calc()` max-height is unreliable. */
  const [rootListMaxHeight, setRootListMaxHeight] = useState<number | undefined>(undefined)
  const [rootPlaceBelow, setRootPlaceBelow] = useState(true)
  const [submenuPositions, setSubmenuPositions] = useState<Record<string, PositionStyle>>({})
  const [submenuOpenRight, setSubmenuOpenRight] = useState<Record<string, boolean>>({})
  const [highlightedByPanel, setHighlightedByPanel] = useState<Record<string, string | null>>({})
  const [openSubmenuPaths, setOpenSubmenuPaths] = useState<string[]>([])
  const [focusedSubmenuPath, setFocusedSubmenuPath] = useState<string | null>(null)
  const lastRangeAnchorRef = useRef<Record<string, number>>({})

  const selectionSummaryLabels = useMemo(
    () =>
      selection.map((item) => {
        const opt = optionByValue.get(String(item)) ?? stableOptionByValue.get(String(item))
        return opt ? getOptionText(opt) : String(item)
      }),
    [optionByValue, selection, stableOptionByValue]
  )

  const selectedSummary = useMemo(() => {
    if (selectionSummaryLabels.length === 0) return ''
    if (!multiple) return selectionSummaryLabels[0] ?? ''
    if (selectionSummaryLabels.length <= 2) {
      return selectionSummaryLabels.join(', ')
    }
    const leading = selectionSummaryLabels.slice(0, 2).join(', ')
    return `${leading}, +${selectionSummaryLabels.length - 2} more`
  }, [multiple, selectionSummaryLabels])

  const triggerValue = isTextInput ? inputValue ?? '' : selectedSummary
  const triggerButtonText =
    showSelectionPills && multiple
      ? placeholder
      : selectedSummary || placeholder
  const activeRootPath = highlightedByPanel[getPanelKey('')] ?? null
  const comboboxActiveDescendantId =
    open && activeRootPath
      ? activeRootPath === CHOICE_ROOT_ADD_CUSTOM_PATH
        ? `${listboxId}-option-add-custom`
        : `${listboxId}-option-${Number(activeRootPath.split('.').at(-1))}`
      : undefined
  const canOpenPopover = layout === 'popover' && shouldShowDropdown && !disabled && !readOnly

  const rootNavigablePaths = useMemo(() => {
    const fromOptions = rootPanelOptions
      .map((option, index) =>
        isSelectableOption(option) && !option.disabled ? String(index) : null
      )
      .filter(Boolean) as string[]

    if (!(isTextInput && multiple && allowCustomValue) || disabled || readOnly || atSelectionCap) {
      return fromOptions
    }
    const trimmed = (inputValue ?? '').trim()
    if (!trimmed) return fromOptions
    const custom = createCustomValue ? createCustomValue(trimmed) : (trimmed as Value)
    if (custom === null) return fromOptions
    if (selection.some((s) => String(s) === String(custom))) return fromOptions
    if (comboboxInputAddIsRedundant) return fromOptions
    return [...fromOptions, CHOICE_ROOT_ADD_CUSTOM_PATH]
  }, [
    allowCustomValue,
    atSelectionCap,
    comboboxInputAddIsRedundant,
    createCustomValue,
    disabled,
    readOnly,
    inputValue,
    isTextInput,
    multiple,
    rootPanelOptions,
    selection,
  ])

  const rootToolbarPanelToggleableValues = useMemo(
    () =>
      rootPanelOptions.flatMap((option) =>
        isSelectableOption(option) && !option.disabled && !option.children?.length
          ? [option.value]
          : []
      ),
    [rootPanelOptions]
  )
  const rootToolbarUnselectedValues = useMemo(
    () =>
      rootToolbarPanelToggleableValues.filter(
        (v) => !selection.some((s) => String(s) === String(v))
      ),
    [rootToolbarPanelToggleableValues, selection]
  )
  const showToolbarSelectAll =
    multiple &&
    !loading &&
    rootToolbarUnselectedValues.length > 0 &&
    selectionSlotsRemaining > 0 &&
    (normalizedMaxCap === null ||
      rootToolbarPanelToggleableValues.length <= normalizedMaxCap)
  const showToolbarUnselectAll = multiple && !loading && selection.length > 0
  const popoverTabTrapActive =
    isTextInput && open && multiple && (showToolbarSelectAll || showToolbarUnselectAll)

  const rootSelectableOptions = useMemo(
    () =>
      rootPanelOptions
        .map((option, index) =>
          isSelectableOption(option) && !option.disabled
            ? { path: String(index), option }
            : null
        )
        .filter(Boolean) as Array<{ path: string; option: ChoiceRenderableOption<Value> }>,
    [rootPanelOptions]
  )

  const updateOpenState = (nextOpen: boolean) => {
    setOpen(nextOpen)
    onOpenChange?.(nextOpen)
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

  const closePopover = (restoreFocus = true) => {
    setOpenSubmenuPaths([])
    setFocusedSubmenuPath(null)
    setRootListMaxHeight(undefined)
    if (isTextInput) {
      lastRootListHighlightRef.current = null
      setPanelHighlight('', null)
    }
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

  const syncRootPosition = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const panelPos = getPanelPosition(rect)
    const nextMax =
      panelPos.maxHeight !== undefined ? Number(panelPos.maxHeight) : undefined
    setRootListMaxHeight(Number.isFinite(nextMax) ? nextMax : undefined)
    if (SUPPORTS_CSS_ANCHOR_POSITIONING) {
      setRootPlaceBelow(getRootPanelPlaceBelow(rect))
      setRootPosition({})
      return
    }
    setRootPosition(panelPos)
  }, [])

  const openPopover = () => {
    if (!canOpenPopover) return
    syncRootPosition()
    if (isTextInput) {
      setPanelHighlight('', null)
    }
    updateOpenState(true)
  }

  const togglePopover = () => {
    if (open) {
      closePopover(false)
      return
    }

    openPopover()
  }

  useEffect(() => {
    if (!open) return
    const currentRootPath = highlightedByPanel[getPanelKey('')] ?? null

    if (isTextInput) {
      if (currentRootPath && rootNavigablePaths.includes(currentRootPath)) {
        return
      }
      if (currentRootPath) {
        setPanelHighlight('', null)
      }
      return
    }

    if (currentRootPath && rootNavigablePaths.includes(currentRootPath)) {
      return
    }

    const selectedRootPath = flattenedOptions.find(
      (entry) => entry.parentPath === '' && selection.some((item) => item === entry.option.value)
    )?.path
    const defaultPath = selectedRootPath ?? rootNavigablePaths[0] ?? null
    setPanelHighlight('', defaultPath)
  }, [flattenedOptions, highlightedByPanel, isTextInput, open, rootNavigablePaths, selection])

  useEffect(() => {
    if (!open || !activeRootPath) return
    if (
      activeRootPath === CHOICE_ROOT_ADD_CUSTOM_PATH ||
      rootNavigablePaths.includes(activeRootPath)
    ) {
      lastRootListHighlightRef.current = activeRootPath
    }
  }, [activeRootPath, open, rootNavigablePaths])

  useEffect(() => {
    if (!canOpenPopover && open) {
      closePopover(false)
    }
  }, [canOpenPopover, open])

  useLayoutEffect(() => {
    if (!SUPPORTS_CSS_ANCHOR_POSITIONING) return
    const el = popoverTriggerShellRef.current
    if (!el) return
    el.style.setProperty('anchor-name', popoverAnchorCssName)
    return () => {
      el.style.removeProperty('anchor-name')
    }
  }, [popoverAnchorCssName])

  useLayoutEffect(() => {
    if (!SUPPORTS_CSS_ANCHOR_POSITIONING) return
    const el = popoverRef.current
    if (!el) return
    el.style.setProperty('position-anchor', popoverAnchorCssName)
    return () => {
      el.style.removeProperty('position-anchor')
    }
  }, [popoverAnchorCssName])

  useLayoutEffect(() => {
    if (!open) {
      popoverRef.current?.hidePopover?.()
      Object.values(submenuRefs.current).forEach((element) => element?.hidePopover?.())
      return
    }

    syncRootPosition()
    popoverRef.current?.showPopover?.()
  }, [open, syncRootPosition, triggerValue])

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootContainerRef.current) return
      const target = event.target as Node
      if (rootContainerRef.current.contains(target)) return
      closePopover(false)
    }

    const handleScroll = (event: Event) => {
      const target = event.target
      if (target instanceof Node && popoverRef.current?.contains(target)) {
        return
      }
      closePopover(false)
    }

    const handleResize = () => {
      syncRootPosition()
      if (SUPPORTS_CSS_ANCHOR_POSITIONING) {
        if (openSubmenuPaths.length === 0) return
        const next: Record<string, boolean> = {}
        openSubmenuPaths.forEach((path) => {
          const anchor = submenuAnchorRefs.current[path]
          if (anchor) next[path] = getSubmenuOpenRight(anchor.getBoundingClientRect())
        })
        setSubmenuOpenRight(next)
        return
      }
      setSubmenuPositions(() => {
        const nextPositions: Record<string, PositionStyle> = {}
        openSubmenuPaths.forEach((path) => {
          const anchor = submenuAnchorRefs.current[path]
          if (!anchor) return
          nextPositions[path] = getSubmenuPosition(anchor.getBoundingClientRect())
        })
        return nextPositions
      })
    }

    document.addEventListener('mousedown', handlePointerDown)
    if (!SUPPORTS_CSS_ANCHOR_POSITIONING) {
      window.addEventListener('scroll', handleScroll, true)
    }
    window.addEventListener('resize', handleResize)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      if (!SUPPORTS_CSS_ANCHOR_POSITIONING) {
        window.removeEventListener('scroll', handleScroll, true)
      }
      window.removeEventListener('resize', handleResize)
    }
  }, [open, openSubmenuPaths, syncRootPosition])

  useLayoutEffect(() => {
    const pathsSnapshot = [...openSubmenuPaths]

    if (!SUPPORTS_CSS_ANCHOR_POSITIONING) {
      if (pathsSnapshot.length === 0) {
        setSubmenuPositions({})
        setSubmenuOpenRight({})
        return
      }
      setSubmenuOpenRight({})
      const nextPos: Record<string, PositionStyle> = {}
      pathsSnapshot.forEach((path) => {
        const anchor = submenuAnchorRefs.current[path]
        if (anchor) nextPos[path] = getSubmenuPosition(anchor.getBoundingClientRect())
      })
      setSubmenuPositions(nextPos)
      return
    }

    if (pathsSnapshot.length === 0) {
      setSubmenuPositions({})
      setSubmenuOpenRight({})
      return
    }

    const nextOpenRight: Record<string, boolean> = {}
    pathsSnapshot.forEach((path) => {
      const anchor = submenuAnchorRefs.current[path]
      if (anchor) nextOpenRight[path] = getSubmenuOpenRight(anchor.getBoundingClientRect())
    })
    setSubmenuOpenRight(nextOpenRight)
    setSubmenuPositions({})

    for (const path of pathsSnapshot) {
      const name = choiceInputSubmenuAnchorName(triggerId, path)
      submenuAnchorRefs.current[path]?.style.setProperty('anchor-name', name)
      submenuRefs.current[path]?.style.setProperty('position-anchor', name)
    }

    return () => {
      for (const path of pathsSnapshot) {
        submenuAnchorRefs.current[path]?.style.removeProperty('anchor-name')
        submenuRefs.current[path]?.style.removeProperty('position-anchor')
      }
    }
  }, [openSubmenuPaths, triggerId])

  useEffect(() => {
    if (openSubmenuPaths.length === 0) {
      Object.values(submenuRefs.current).forEach((element) => element?.hidePopover?.())
      return
    }

    const openSet = new Set(openSubmenuPaths)

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

  const resolvedClearButton = useMemo((): ChoiceClearButtonConfig | undefined => {
    if (layout !== 'popover' || disabled || readOnly) return undefined
    if (clearButton !== undefined) return clearButton
    if (!allowCustomValue) return undefined

    const hasValue = multiple
      ? Array.isArray(value) && value.length > 0
      : value !== null
    const hasTypedText = isTextInput && (inputValue ?? '').trim() !== ''
    const visible = isTextInput ? hasTypedText : hasValue || hasTypedText

    return {
      visible,
      label: isTextInput && multiple ? 'Clear input' : 'Clear',
      onClear: () => {
        if (isTextInput && multiple) {
          onInputValueChange?.('')
          return
        }
        if (multiple) {
          onChange([])
        } else {
          onChange(null)
        }
        if (isTextInput) {
          onInputValueChange?.('')
        }
      },
      openAfterClear: false,
    }
  }, [
    allowCustomValue,
    clearButton,
    disabled,
    inputValue,
    isTextInput,
    layout,
    multiple,
    onChange,
    onInputValueChange,
    readOnly,
    value,
  ])

  const removeSelectedValue = (nextValue: Value) => {
    if (!multiple) return

    const nextSelection = selection.filter((item) => item !== nextValue)
    selectValues(nextSelection)
  }

  const toggleValue = (nextValue: Value) => {
    if (!multiple) {
      // Close the panel before notifying parents. A synchronous `onChange` can trigger a large
      // ancestor re-render and make the popover feel sluggish or "stuck" closing.
      closePopover(false)
      queueMicrotask(() => {
        selectValues([nextValue])
      })
      return
    }

    const alreadySelected = selection.some((item) => item === nextValue)
    if (!alreadySelected && normalizedMaxCap !== null && selection.length >= normalizedMaxCap) {
      return
    }

    const nextSelection = alreadySelected
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
      for (const item of rangeValues) {
        if (normalizedMaxCap !== null && nextSelection.size >= normalizedMaxCap) break
        nextSelection.add(item)
      }
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

  /** Commits the current input text as a custom value (Enter). Does not use the list highlight or redundant-match rules. */
  const commitComboboxTypedValueIfAllowed = (): boolean => {
    if (!isTextInput || !allowCustomValue) return false
    const trimmed = (inputValue ?? '').trim()
    if (!trimmed) return false
    const custom = getCustomValue()
    if (custom === null) return false
    if (multiple) {
      if (normalizedMaxCap !== null && selection.length >= normalizedMaxCap) return false
      if (selection.some((s) => String(s) === String(custom))) return false
      selectValues([...selection, custom])
      onInputValueChange?.('')
      return true
    }
    selectValues([custom])
    onInputValueChange?.('')
    closePopover(false)
    return true
  }

  const addInlineMultiCustomValue = () => {
    if (!allowCustomValue || layout === 'popover' || !multiple) return
    if (normalizedMaxCap !== null && selection.length >= normalizedMaxCap) return
    const trimmed = inlineMultiCustomDraft.trim()
    if (!trimmed) return
    const next = createCustomValue ? createCustomValue(trimmed) : (trimmed as Value)
    if (next === null || next === undefined) return
    if (selection.some((s) => String(s) === String(next))) return
    selectValues([...selection, next])
    setInlineMultiCustomDraft('')
  }

  const otherFieldValue =
    allowCustomValue && layout !== 'popover' && !multiple
      ? isCustomSingleValue
        ? String(value)
        : inlineOtherActive
          ? value === null
            ? ''
            : String(value)
          : ''
      : ''

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

      if (isTextInput && !multiple) {
        onInputValueChange?.(getOptionText(option))
      }

      // Single-select: `toggleValue` already closes the popover before deferring `onChange`.
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

  const runOpenRootOptionKeys = (event: ReactKeyboardEvent): boolean => {
    const highlightedOption =
      activeRootPath && activeRootPath !== CHOICE_ROOT_ADD_CUSTOM_PATH
        ? flattenedOptions.find((entry) => entry.path === activeRootPath)?.option
        : undefined

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
      return true
    }

    if (event.key === 'Enter' || event.key === ' ') {
      if (event.key === 'Enter' && commitComboboxTypedValueIfAllowed()) {
        event.preventDefault()
        return true
      }
      if (activeRootPath === CHOICE_ROOT_ADD_CUSTOM_PATH) {
        const toAdd = getCustomValue()
        if (toAdd !== null && !(disabled || readOnly || atSelectionCap)) {
          event.preventDefault()
          if (!selection.some((s) => String(s) === String(toAdd))) {
            selectValues([...selection, toAdd])
            onInputValueChange?.('')
          }
          return true
        }
      }
      if (highlightedOption && activeRootPath) {
        event.preventDefault()
        const optionIndex = Number(activeRootPath.split('.').at(-1))
        if (highlightedOption.children?.length) {
          openSubmenu(activeRootPath)
          setFocusedSubmenuPath(activeRootPath)
          return true
        }
        handleSelectableAction(highlightedOption, popoverListOptions, optionIndex)
        return true
      }
    }
    return false
  }

  const rootListboxContainerKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled || readOnly) return

    if (
      targetIsInsideAnyOpenSubmenuPanel(
        event.target as Node | null,
        openSubmenuPaths,
        submenuPanelRefs.current
      )
    ) {
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      closePopover(false)
      return
    }

    if (popoverTabTrapActive) {
      if (event.key === 'Tab') {
        event.preventDefault()
        if (event.shiftKey) {
          if (showToolbarSelectAll) {
            toolbarSelectAllRef.current?.focus()
          } else if (showToolbarUnselectAll) {
            toolbarUnselectAllRef.current?.focus()
          }
        } else if (showToolbarUnselectAll) {
          toolbarUnselectAllRef.current?.focus()
        } else if (showToolbarSelectAll) {
          toolbarSelectAllRef.current?.focus()
        }
        return
      }
      if (
        event.key.length === 1 &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        event.key !== ' '
      ) {
        event.preventDefault()
        onInputValueChange?.(`${inputValue ?? ''}${event.key}`)
        setPanelHighlight('', null)
        lastRootListHighlightRef.current = null
        requestAnimationFrame(() => triggerRef.current?.focus())
        return
      }
    }

    if (event.key === 'ArrowDown') {
      if (event.altKey) return
      event.preventDefault()
      moveRootHighlight(1)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveRootHighlight(-1)
      return
    }
    if (event.key === 'Home') {
      event.preventDefault()
      setPanelHighlight('', rootNavigablePaths[0] ?? null)
      return
    }
    if (event.key === 'End') {
      event.preventDefault()
      setPanelHighlight('', rootNavigablePaths[rootNavigablePaths.length - 1] ?? null)
      return
    }

    if (runOpenRootOptionKeys(event)) return
  }

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
    const typedCustomToAdd =
      !panelPath && multiple && allowCustomValue && isTextInput ? getCustomValue() : null
    const canShowAddCustomRow =
      typedCustomToAdd !== null &&
      !selection.some((s) => String(s) === String(typedCustomToAdd)) &&
      !comboboxInputAddIsRedundant &&
      !atSelectionCap

    const addCustomRowHighlighted =
      !panelPath && highlightedPath === CHOICE_ROOT_ADD_CUSTOM_PATH

    const panelToggleableValues = panelOptions.flatMap((option) =>
      isSelectableOption(option) && !option.disabled && !option.children?.length ? [option.value] : []
    )
    const unselectedToggleableValues = panelPath
      ? panelToggleableValues.filter((v) => !selection.some((s) => String(s) === String(v)))
      : rootToolbarUnselectedValues
    const showPopoverSelectAll = !panelPath && showToolbarSelectAll
    const showPopoverUnselectAll = !panelPath && showToolbarUnselectAll

    return (
      <>
        {showSelectionLimitHintInComboboxPopover && !panelPath ? (
          <p
            id={selectionLimitHintId}
            className="border-b border-gray-200 px-3 py-2 text-xs text-gray-600 dark:border-gray-700 dark:text-gray-400"
          >
            {selectionLimitHintText}
          </p>
        ) : null}
        <div
          id={panelId}
          ref={(element) => {
            if (panelPath) {
              submenuPanelRefs.current[panelPath] = element
            } else {
              rootListboxRef.current = element
            }
          }}
          role="listbox"
          aria-label={panelPath ? undefined : listboxLabel}
          aria-labelledby={panelPath ? undefined : ariaLabelledBy}
          aria-multiselectable={multiple || undefined}
          aria-activedescendant={
            !panelPath && popoverTabTrapActive ? comboboxActiveDescendantId : undefined
          }
          tabIndex={panelPath ? -1 : popoverTabTrapActive ? 0 : -1}
          onFocus={
            !panelPath && popoverTabTrapActive
              ? () => {
                  if (activeRootPath === null && lastRootListHighlightRef.current) {
                    const last = lastRootListHighlightRef.current
                    if (rootNavigablePaths.includes(last)) {
                      setPanelHighlight('', last)
                    }
                  }
                }
              : undefined
          }
          onKeyDown={(event) => {
            if (!panelPath) {
              rootListboxContainerKeyDown(event)
              return
            }

            if (
              targetIsInsideStrictDescendantSubmenuPanel(
                event.target as Node | null,
                panelPath,
                openSubmenuPaths,
                submenuPanelRefs.current
              )
            ) {
              return
            }

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
                rootListboxRef.current?.focus()
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
          className="py-1 focus:outline-none"
        >
        {loading && !panelPath ? (
          <p className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">{loadingText}</p>
        ) : !hasSelectableOptions && !canShowAddCustomRow ? (
          <p className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">{emptyText}</p>
        ) : (
          <>
            {hasSelectableOptions
              ? panelOptions.map((option, index) => {
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

            const cappedOut = multiple && !selected && !hasSubmenu && atSelectionCap
            const rowClasses = [
              'mx-1 flex w-[calc(100%-0.5rem)] items-start rounded-md px-3 py-2 text-left',
              option.disabled || cappedOut ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
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
                  disabled={option.disabled || cappedOut}
                  onMouseEnter={() => {
                    const skipMouseHighlightForComboboxRootLeaf =
                      isTextInput && !panelPath && !hasSubmenu
                    if (!skipMouseHighlightForComboboxRootLeaf) {
                      setPanelHighlight(panelPath, path)
                    }
                    if (hasSubmenu) {
                      openSubmenu(path)
                    }
                  }}
                  onMouseDown={(event) => {
                    event.preventDefault()
                  }}
                  onClick={(event) => {
                    if (option.disabled || cappedOut) return
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
                    className="overflow-hidden rounded-xl border border-gray-200 bg-white p-0 shadow-xl outline-none dark:border-gray-700 dark:bg-gray-900"
                    style={
                      SUPPORTS_CSS_ANCHOR_POSITIONING
                        ? ({
                            position: 'fixed',
                            zIndex: 60,
                            margin: 0,
                            width: `min(${SUBMENU_WIDTH}px, calc(100vw - ${VIEWPORT_PADDING * 2}px))`,
                            top: `min(max(${VIEWPORT_PADDING}px, anchor(top)), calc(100svh - ${VIEWPORT_PADDING + 160}px))`,
                            ...(submenuOpenRight[path] ?? true
                              ? { left: 'calc(anchor(right) + 4px)', right: 'auto' }
                              : { left: 'auto', right: `calc(100vw - anchor(left) + 4px)` }),
                          } as CSSProperties)
                        : {
                            position: 'fixed',
                            zIndex: 60,
                            ...submenuPositions[path],
                          }
                    }
                  >
                    <div
                      className="overflow-y-auto overscroll-y-contain"
                      style={
                        SUPPORTS_CSS_ANCHOR_POSITIONING
                          ? {
                              maxHeight: `min(${POPOVER_PANEL_MAX_HEIGHT}px, calc(100svh - max(${VIEWPORT_PADDING}px, anchor(top)) - ${VIEWPORT_PADDING}px))`,
                            }
                          : submenuPositions[path]?.maxHeight !== undefined
                            ? { maxHeight: submenuPositions[path].maxHeight }
                            : undefined
                      }
                    >
                      {renderPopoverPanel(option.children ?? [], path, depth + 1)}
                    </div>
                  </div>
                ) : null}
              </div>
            )
                })
              : null}
            {canShowAddCustomRow ? (
              <div className="border-t border-gray-200 px-2 py-1 dark:border-gray-700">
                <button
                  id={`${listboxId}-option-add-custom`}
                  type="button"
                  role="option"
                  aria-selected={false}
                  disabled={disabled || readOnly || atSelectionCap}
                  className={`mx-1 w-[calc(100%-0.5rem)] rounded-md px-3 py-2 text-left text-sm font-medium text-primary-teal focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/20 enabled:cursor-pointer enabled:hover:bg-gray-50 dark:enabled:hover:bg-gray-800/80 disabled:cursor-not-allowed disabled:opacity-60 ${
                    addCustomRowHighlighted ? 'bg-gray-100 dark:bg-gray-800' : ''
                  }`}
                  onMouseEnter={() => {
                    if (!panelPath) {
                      setPanelHighlight('', CHOICE_ROOT_ADD_CUSTOM_PATH)
                    }
                  }}
                  onMouseDown={(event) => {
                    event.preventDefault()
                  }}
                  onClick={() => {
                    selectValues([...selection, typedCustomToAdd])
                    onInputValueChange?.('')
                  }}
                >
                  Add &quot;{String(typedCustomToAdd)}&quot;
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
      {showPopoverSelectAll || showPopoverUnselectAll ? (
        <div
          className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-gray-200 px-3 py-2 dark:border-gray-700"
          role="toolbar"
          aria-label="Selection shortcuts"
        >
          {showPopoverUnselectAll ? (
            <button
              ref={toolbarUnselectAllRef}
              type="button"
              className="text-xs font-medium text-primary-teal focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/20 disabled:cursor-not-allowed disabled:opacity-60 enabled:cursor-pointer enabled:hover:underline"
              disabled={disabled || readOnly}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  closePopover(false)
                  return
                }
                if (!popoverTabTrapActive || event.key !== 'Tab') return
                event.preventDefault()
                if (event.shiftKey) {
                  rootListboxRef.current?.focus()
                } else if (showPopoverSelectAll) {
                  toolbarSelectAllRef.current?.focus()
                } else {
                  rootListboxRef.current?.focus()
                }
              }}
              onClick={() => selectValues([])}
            >
              Unselect all
            </button>
          ) : null}
          {showPopoverSelectAll ? (
            <button
              ref={toolbarSelectAllRef}
              type="button"
              className="text-xs font-medium text-primary-teal focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/20 disabled:cursor-not-allowed disabled:opacity-60 enabled:cursor-pointer enabled:hover:underline"
              disabled={disabled || readOnly || unselectedToggleableValues.length === 0 || selectionSlotsRemaining <= 0}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  closePopover(false)
                  return
                }
                if (!popoverTabTrapActive || event.key !== 'Tab') return
                event.preventDefault()
                if (event.shiftKey) {
                  if (showPopoverUnselectAll) {
                    toolbarUnselectAllRef.current?.focus()
                  } else {
                    rootListboxRef.current?.focus()
                  }
                } else {
                  rootListboxRef.current?.focus()
                }
              }}
              onClick={() => {
                if (normalizedMaxCap === null) {
                  selectValues(Array.from(new Set([...selection, ...unselectedToggleableValues])))
                  return
                }
                const room = normalizedMaxCap - selection.length
                if (room <= 0) return
                const toAdd = unselectedToggleableValues.slice(0, room)
                selectValues(Array.from(new Set([...selection, ...toAdd])))
              }}
            >
              Select all
            </button>
          ) : null}
        </div>
      ) : null}
    </>
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
      if (openSubmenuPaths.length > 0) {
        const deepest = openSubmenuPaths[openSubmenuPaths.length - 1]!
        submenuPanelRefs.current[deepest]?.focus()
        setFocusedSubmenuPath(deepest)
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
      if (openSubmenuPaths.length > 0) {
        const deepest = openSubmenuPaths[openSubmenuPaths.length - 1]!
        submenuPanelRefs.current[deepest]?.focus()
        setFocusedSubmenuPath(deepest)
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
      if (openSubmenuPaths.length > 0) {
        const deepest = openSubmenuPaths[openSubmenuPaths.length - 1]!
        submenuPanelRefs.current[deepest]?.focus()
        setFocusedSubmenuPath(deepest)
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
      if (openSubmenuPaths.length > 0) {
        const deepest = openSubmenuPaths[openSubmenuPaths.length - 1]!
        submenuPanelRefs.current[deepest]?.focus()
        setFocusedSubmenuPath(deepest)
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
      if (popoverTabTrapActive) {
        event.preventDefault()
        if (event.shiftKey) {
          if (showToolbarSelectAll) {
            toolbarSelectAllRef.current?.focus()
          } else if (showToolbarUnselectAll) {
            toolbarUnselectAllRef.current?.focus()
          } else {
            rootListboxRef.current?.focus()
          }
        } else {
          rootListboxRef.current?.focus()
        }
      } else {
        closePopover(false)
      }
      return
    }

    if (!open) return

    if (openSubmenuPaths.length > 0 && event.key === 'ArrowLeft') {
      event.preventDefault()
      const deepest = openSubmenuPaths[openSubmenuPaths.length - 1]!
      const parentPath = getParentPath(deepest)
      setOpenSubmenuPaths(parentPath ? getPathChain(parentPath) : [])
      setFocusedSubmenuPath(parentPath || null)
      if (!parentPath) {
        rootListboxRef.current?.focus()
      }
      return
    }

    if (openSubmenuPaths.length > 0 && event.key === 'ArrowRight') {
      event.preventDefault()
      const deepest = openSubmenuPaths[openSubmenuPaths.length - 1]!
      submenuPanelRefs.current[deepest]?.focus()
      setFocusedSubmenuPath(deepest)
      return
    }

    if (runOpenRootOptionKeys(event)) return
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
      const cappedOut = multiple && !checked && atSelectionCap
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
              option.disabled || cappedOut
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
                disabled={disabled || readOnly || option.disabled || cappedOut}
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

  const rootPopoverSurfaceStyle = useMemo((): CSSProperties => {
    if (!SUPPORTS_CSS_ANCHOR_POSITIONING) {
      return { position: 'fixed', zIndex: 50, ...rootPosition }
    }
    const gap = PANEL_GAP
    const pad = VIEWPORT_PADDING
    const shared = {
      position: 'fixed' as const,
      zIndex: 50,
      left: `anchor(left)`,
      width: `max(${MIN_PANEL_WIDTH}px, min(anchor-size(inline), calc(100vw - ${pad * 2}px)))`,
      margin: 0,
    }
    if (rootPlaceBelow) {
      return {
        ...shared,
        top: `calc(anchor(bottom) + ${gap}px)`,
        bottom: 'auto',
      } as CSSProperties
    }
    return {
      ...shared,
      top: 'auto',
      bottom: 'anchor(top)',
      marginBottom: gap,
    } as CSSProperties
  }, [popoverAnchorCssName, rootPlaceBelow, rootPosition])

  const rootPopoverScrollStyle = useMemo((): CSSProperties | undefined => {
    if (rootListMaxHeight === undefined) return undefined
    return { maxHeight: rootListMaxHeight }
  }, [rootListMaxHeight])

  if (layout !== 'popover') {
    const inlineCustomValues = selection.filter((v) => !knownValueKeys.has(String(v)))

    return (
      <div
        role={multiple ? 'group' : 'radiogroup'}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={mergedAriaDescribedBy}
        className={layout === 'inline' ? 'flex flex-wrap gap-3' : 'space-y-3'}
      >
        {showSelectionLimitHint ? (
          <p
            id={selectionLimitHintId}
            className={`text-xs text-gray-600 dark:text-gray-400 ${layout === 'inline' ? 'w-full basis-full' : ''}`}
          >
            {selectionLimitHintText}
          </p>
        ) : null}
        {renderInlineOptions(options)}
        {allowCustomValue && !multiple ? (
          <div className={layout === 'inline' ? 'min-w-0 basis-full sm:basis-auto sm:min-w-[min(100%,20rem)]' : 'w-full'}>
            <label
              className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm ${
                disabled || readOnly
                  ? 'cursor-not-allowed opacity-60'
                  : 'hover:border-primary-teal/40 hover:bg-gray-50 dark:hover:bg-gray-800/70'
              } ${
                inlineOtherActive || isCustomSingleValue
                  ? 'border-primary-teal/40 bg-primary-teal/5 dark:border-primary-teal/50 dark:bg-primary-teal/10'
                  : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900'
              }`}
            >
              <span className="flex h-5 w-4 shrink-0 items-center justify-center self-center">
                <input
                  type="radio"
                  name={name}
                  checked={inlineOtherActive || isCustomSingleValue}
                  disabled={disabled || readOnly}
                  onChange={() => {
                    setInlineOtherActive(true)
                    onChange(null)
                  }}
                  className="h-4 w-4 shrink-0 accent-primary-teal"
                  aria-label="Other"
                />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
                <span className="shrink-0 self-center text-sm font-medium text-gray-900 dark:text-gray-100">
                  Other
                </span>
                <input
                  id={otherFieldInputId}
                  type="text"
                  className="app-input min-w-0 flex-1"
                  disabled={disabled || readOnly}
                  value={otherFieldValue}
                  onFocus={() => {
                    setInlineOtherActive(true)
                    if (value !== null && knownValueKeys.has(String(value))) {
                      onChange(null)
                    }
                  }}
                  onChange={(event) => {
                    const raw = event.target.value
                    if (raw === '') {
                      onChange(null)
                      return
                    }
                    const next = createCustomValue ? createCustomValue(raw) : (raw as Value)
                    onChange(next ?? null)
                  }}
                  placeholder={placeholder}
                  aria-label="Other, specify"
                  autoComplete="off"
                />
              </div>
            </label>
          </div>
        ) : null}
        {allowCustomValue && multiple ? (
          <div
            role="group"
            aria-label="Additional choices"
            className={`space-y-3 ${layout === 'inline' ? 'w-full min-w-0 basis-full' : ''}`}
          >
            {inlineCustomValues.map((item, index) => (
              <div
                key={`${String(item)}-${index}`}
                className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
              >
                <span className="min-w-0 text-gray-900 dark:text-gray-100">{String(item)}</span>
                <button
                  type="button"
                  disabled={disabled || readOnly}
                  onClick={() => selectValues(selection.filter((entry) => entry !== item))}
                  className="shrink-0 rounded p-0.5 text-gray-500 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/20 dark:text-gray-400 dark:hover:text-gray-200"
                  aria-label={`Remove ${String(item)}`}
                >
                  <HiXMark className="h-4 w-4" aria-hidden />
                </button>
              </div>
            ))}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
              <input
                type="text"
                className="app-input min-w-0 flex-1"
                disabled={disabled || readOnly}
                value={inlineMultiCustomDraft}
                onChange={(event) => setInlineMultiCustomDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    addInlineMultiCustomValue()
                  }
                }}
                placeholder={placeholder || 'Add another'}
                aria-label="Add custom choice"
                autoComplete="off"
              />
              <button
                type="button"
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/20 enabled:cursor-pointer enabled:hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 enabled:dark:hover:bg-gray-700"
                disabled={disabled || readOnly || !inlineMultiCustomDraft.trim() || atSelectionCap}
                onClick={() => addInlineMultiCustomValue()}
              >
                Add
              </button>
            </div>
          </div>
        ) : null}
      </div>
    )
  }

  const { shellClassName: popoverTriggerShellClassName, controlClassName: popoverControlClassName } =
    popoverTriggerClassNames(inputClassName)
  const selectTriggerShellClassName = [
    popoverTriggerShellClassName,
    !isTextInput
      ? [
          'rounded-lg border border-gray-300 bg-white',
          'dark:border-gray-600 dark:bg-gray-900',
          disabled
            ? 'border-gray-200 bg-gray-100 opacity-80 dark:border-gray-700 dark:bg-gray-800'
            : readOnly
              ? 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/60'
              : open
                ? 'border-primary-teal ring-2 ring-primary-teal/20'
                : 'focus-within:border-primary-teal focus-within:ring-2 focus-within:ring-primary-teal/20',
        ].join(' ')
      : '',
  ]
    .filter(Boolean)
    .join(' ')
  const selectTriggerClassName = [
    popoverControlClassName,
    resolvedClearButton?.visible ? 'pr-20' : 'pr-10',
    'select-none text-left',
    !isTextInput
      ? 'border-transparent bg-transparent focus:border-transparent focus:ring-0 disabled:border-transparent dark:disabled:border-transparent'
      : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div ref={rootContainerRef} className="relative">
      {(showSelectionPills && selection.length > 0) || showSelectionLimitHintOutsidePopover ? (
        <div className="mb-3 space-y-2">
          {showSelectionPills && selection.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {selection.map((item, index) => {
                const label = selectionSummaryLabels[index] ?? String(item)
                return (
                  <div
                    key={`${String(item)}-${index}`}
                    className="flex items-center rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-900 focus-within:ring-2 focus-within:ring-primary-teal focus-within:ring-offset-2 dark:bg-gray-700 dark:text-gray-100"
                  >
                    <span>{label}</span>
                    <button
                      type="button"
                      onClick={() => removeSelectedValue(item)}
                      className="ml-2 rounded-full p-0.5 focus:outline-none"
                      aria-label={`Remove ${label}`}
                    >
                      ×
                    </button>
                  </div>
                )
              })}
            </div>
          ) : null}
          {showSelectionLimitHintOutsidePopover ? (
            <p id={selectionLimitHintId} className="text-xs text-gray-600 dark:text-gray-400">
              {selectionLimitHintText}
            </p>
          ) : null}
        </div>
      ) : null}
      <div ref={popoverTriggerShellRef} className={selectTriggerShellClassName}>
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
            aria-activedescendant={comboboxActiveDescendantId}
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledBy}
            aria-describedby={mergedAriaDescribedBy}
            aria-invalid={ariaInvalid || undefined}
            aria-haspopup="listbox"
            onFocus={() => {
              if (chromeOffAutocompleteWhileFocused) setPopoverComboboxFocused(true)
              onInputFocus?.()
            }}
            onClick={() => {
              togglePopover()
            }}
            onInput={() => {
              onComboboxInput?.()
            }}
            onBlur={(event) => {
              const nextTarget = event.relatedTarget as Node | null
              if (nextTarget && rootContainerRef.current?.contains(nextTarget)) return
              if (chromeOffAutocompleteWhileFocused) setPopoverComboboxFocused(false)
              onComboboxTextBlur?.()
            }}
            onChange={(event) => {
              onInputValueChange?.(event.target.value)
              if (isTextInput && open) {
                setPanelHighlight('', null)
                lastRootListHighlightRef.current = null
              }
              if (!open) {
                openPopover()
              }
            }}
            onKeyDown={rootTriggerKeyDown}
            placeholder={
              isTextInput
                ? (inputValue ?? '').trim()
                  ? undefined
                  : placeholder
                : selectedSummary
                  ? undefined
                  : placeholder
            }
            disabled={disabled}
            required={required}
            autoComplete={autoComplete ?? 'off'}
            className={`${popoverControlClassName} ${resolvedClearButton?.visible ? 'pr-20' : 'pr-10'}`}
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
            aria-activedescendant={comboboxActiveDescendantId}
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledBy}
            aria-describedby={mergedAriaDescribedBy}
            aria-invalid={ariaInvalid || undefined}
            aria-haspopup="listbox"
            disabled={disabled}
            onFocus={() => {
              onInputFocus?.()
            }}
            onClick={() => {
              togglePopover()
            }}
            onKeyDown={rootTriggerKeyDown}
            className={selectTriggerClassName}
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

        {resolvedClearButton?.visible ? (
          <button
            type="button"
            onClick={() => {
              resolvedClearButton.onClear()
              if (resolvedClearButton.openAfterClear) {
                openPopover()
              } else {
                closePopover(false)
              }
              window.setTimeout(() => triggerRef.current?.focus(), 0)
            }}
            aria-label={resolvedClearButton.label}
            className="absolute right-9 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-500 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/20 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <HiXMark className="h-4 w-4" aria-hidden />
          </button>
        ) : null}

        <span
          aria-hidden="true"
          className={`pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 transition-colors ${
            disabled
              ? 'text-gray-400 dark:text-gray-500'
              : open
                ? 'text-primary-teal'
                : 'text-gray-500 group-focus-within:text-primary-teal dark:text-gray-400 dark:group-focus-within:text-primary-teal'
          }`}
        >
          <HiChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </div>

      <div
        ref={popoverRef}
        {...({ popover: 'manual' } as HTMLAttributes<HTMLDivElement>)}
        id={popoverId}
        className="overflow-hidden rounded-xl border border-gray-200 bg-white p-0 shadow-xl outline-none dark:border-gray-700 dark:bg-gray-900"
        style={rootPopoverSurfaceStyle}
      >
        <div
          className="min-h-0 overflow-y-auto overscroll-y-contain"
          style={rootPopoverScrollStyle}
        >
          {renderPopoverPanel(popoverListOptions)}
        </div>
      </div>
    </div>
  )
}
