import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useMemberOptions } from '../contexts/MemberOptionsContext';
import type { MemberPickerOption } from '../types/memberPicker';
import Button from './Button';

const DROPDOWN_GAP_PX = 4;
const VIEWPORT_PADDING_PX = 8;
const DROPDOWN_MAX_HEIGHT_PX = 288;
const DROPDOWN_Z_INDEX = 120;

type DropdownPosition = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
};

function computeDropdownPosition(anchor: HTMLElement): DropdownPosition {
  const rect = anchor.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom - DROPDOWN_GAP_PX - VIEWPORT_PADDING_PX;
  const spaceAbove = rect.top - DROPDOWN_GAP_PX - VIEWPORT_PADDING_PX;
  const placeBelow = spaceBelow >= 120 || spaceBelow >= spaceAbove;
  const maxHeight = Math.min(
    DROPDOWN_MAX_HEIGHT_PX,
    Math.max(placeBelow ? spaceBelow : spaceAbove, 80),
  );

  if (placeBelow) {
    return {
      top: rect.bottom + DROPDOWN_GAP_PX,
      left: rect.left,
      width: rect.width,
      maxHeight,
    };
  }

  return {
    top: Math.max(VIEWPORT_PADDING_PX, rect.top - DROPDOWN_GAP_PX - maxHeight),
    left: rect.left,
    width: rect.width,
    maxHeight,
  };
}

type MemberMultiSelectLockedPill = {
  key: string;
  label: string;
  detail?: string;
};

type MemberMultiSelectExtraPill = {
  key: string;
  label: string;
  detail?: string;
  onRemove: () => void;
};

type MemberMultiSelectManualNameEntry = {
  linkLabel: string;
  inputPlaceholder?: string;
  addButtonLabel?: string;
  onAdd: (name: string) => void;
};

type MemberMultiSelectProps = {
  selectedIds: number[];
  onChange: (nextSelectedIds: number[]) => void;
  options?: MemberPickerOption[];
  placeholder?: string;
  disabled?: boolean;
  maxSelections?: number;
  noMatchesText?: string;
  loadingText?: string;
  helperText?: ReactNode;
  isOptionDisabled?: (option: MemberPickerOption) => boolean;
  getOptionStatusText?: (option: MemberPickerOption) => ReactNode;
  filterOption?: (option: MemberPickerOption) => boolean;
  /** Pills shown before selected members; cannot be removed. */
  lockedPills?: MemberMultiSelectLockedPill[];
  /** Additional removable pills (for example manually entered names). Count toward `maxSelections`. */
  extraPills?: MemberMultiSelectExtraPill[];
  /** Optional flow to add a non-member name from the suggestion list. */
  manualNameEntry?: MemberMultiSelectManualNameEntry;
  /** When set, assigns this id to the combobox input for label association (`htmlFor`). */
  inputId?: string;
};

export default function MemberMultiSelect({
  selectedIds,
  onChange,
  options,
  placeholder = 'Search members...',
  disabled = false,
  maxSelections,
  noMatchesText = 'No matching members',
  loadingText = 'Loading...',
  helperText,
  isOptionDisabled,
  getOptionStatusText,
  filterOption,
  lockedPills,
  extraPills,
  manualNameEntry,
  inputId: inputIdProp,
}: MemberMultiSelectProps) {
  const sharedMembers = useMemberOptions({ autoLoad: options === undefined });
  const [query, setQuery] = useState('');
  const [manualEntryMode, setManualEntryMode] = useState(false);
  const [manualEntryDraft, setManualEntryDraft] = useState('');
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const [dropdownPosition, setDropdownPosition] = useState<DropdownPosition | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();
  const autoInputId = useId();
  const comboboxId = inputIdProp ?? autoInputId;
  const sourceOptions = options ?? sharedMembers.options;
  const effectiveLoading = options === undefined && sharedMembers.loading;
  const effectiveNoMatchesText =
    options === undefined && sharedMembers.error ? sharedMembers.error : noMatchesText;

  const selectedLookup = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedMembers = useMemo(
    () =>
      selectedIds
        .map((id) => sourceOptions.find((option) => option.id === id))
        .filter(Boolean) as MemberPickerOption[],
    [selectedIds, sourceOptions]
  );
  const totalSelectedCount = selectedIds.length + (extraPills?.length ?? 0);
  const hasReachedMax = maxSelections !== undefined && totalSelectedCount >= maxSelections;

  const filteredOptions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const visibleOptions = filterOption
      ? sourceOptions.filter((option) => filterOption(option))
      : sourceOptions;
    if (!needle) return [];
    return visibleOptions.filter((option) => {
      if (selectedLookup.has(option.id)) return false;
      const haystacks = [option.name, option.email ?? ''];
      return haystacks.some((part) => part.toLowerCase().includes(needle));
    });
  }, [filterOption, query, selectedLookup, sourceOptions]);

  const updateDropdownPosition = useCallback(() => {
    if (!inputRef.current) return;
    setDropdownPosition(computeDropdownPosition(inputRef.current));
  }, []);

  useLayoutEffect(() => {
    if (!open || manualEntryMode || disabled || hasReachedMax || (!query.trim() && !manualNameEntry)) {
      setDropdownPosition(null);
      return;
    }
    updateDropdownPosition();
    window.addEventListener('resize', updateDropdownPosition);
    window.addEventListener('scroll', updateDropdownPosition, true);
    return () => {
      window.removeEventListener('resize', updateDropdownPosition);
      window.removeEventListener('scroll', updateDropdownPosition, true);
    };
  }, [disabled, hasReachedMax, manualEntryMode, manualNameEntry, open, query, updateDropdownPosition]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (boxRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  useEffect(() => {
    if (!open || filteredOptions.length === 0) {
      setHighlightedIndex(-1);
      return;
    }
    setHighlightedIndex((prev) => {
      const nextIndex = prev >= 0 && prev < filteredOptions.length ? prev : 0;
      if (isOptionDisabled?.(filteredOptions[nextIndex])) {
        return filteredOptions.findIndex((option) => !isOptionDisabled(option));
      }
      return nextIndex;
    });
  }, [filteredOptions, isOptionDisabled, open]);

  useEffect(() => {
    if (!open || highlightedIndex < 0) return;
    const active = document.getElementById(`${listboxId}-option-${highlightedIndex}`);
    active?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex, listboxId, open]);

  const moveHighlight = (direction: 1 | -1) => {
    if (filteredOptions.length === 0) return;
    for (let step = 1; step <= filteredOptions.length; step += 1) {
      const candidate =
        (highlightedIndex + direction * step + filteredOptions.length) % filteredOptions.length;
      if (!isOptionDisabled?.(filteredOptions[candidate])) {
        setHighlightedIndex(candidate);
        return;
      }
    }
  };

  const addMember = (memberId: number) => {
    if (selectedLookup.has(memberId) || hasReachedMax) return;
    onChange([...selectedIds, memberId]);
    setQuery('');
    setOpen(false);
    setHighlightedIndex(-1);
  };

  const removeMember = (memberId: number) => {
    onChange(selectedIds.filter((id) => id !== memberId));
  };

  const activateManualEntry = () => {
    setManualEntryMode(true);
    setManualEntryDraft('');
    setQuery('');
    setOpen(false);
    setHighlightedIndex(-1);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const submitManualEntry = () => {
    if (!manualNameEntry) return;
    const trimmed = manualEntryDraft.trim();
    if (!trimmed) return;
    manualNameEntry.onAdd(trimmed);
    setManualEntryDraft('');
    setManualEntryMode(false);
  };

  const lockedPillClassName =
    'flex items-center rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-900 dark:bg-gray-700 dark:text-gray-100';

  const showDropdown = open && !manualEntryMode && !disabled && !hasReachedMax && (query.trim() || manualNameEntry);

  const dropdownPanel =
    showDropdown && dropdownPosition ? (
      <div
        ref={dropdownRef}
        id={listboxId}
        role="listbox"
        aria-label="Member suggestions"
        className="fixed overflow-auto rounded-md border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900"
        style={{
          zIndex: DROPDOWN_Z_INDEX,
          top: dropdownPosition.top,
          left: dropdownPosition.left,
          width: dropdownPosition.width,
          maxHeight: dropdownPosition.maxHeight,
        }}
      >
        {effectiveLoading ? (
          <p className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">{loadingText}</p>
        ) : !query.trim() && manualNameEntry ? (
          <p className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">Search for a club member.</p>
        ) : filteredOptions.length === 0 ? (
          <p className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">{effectiveNoMatchesText}</p>
        ) : (
          filteredOptions.map((option, index) => {
            const optionDisabled = Boolean(isOptionDisabled?.(option));
            return (
              <div
                key={option.id}
                id={`${listboxId}-option-${index}`}
                role="option"
                aria-selected={index === highlightedIndex}
                onMouseEnter={() => setHighlightedIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  if (!optionDisabled) addMember(option.id);
                }}
                className={`px-3 py-2 ${
                  optionDisabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
                } ${
                  index === highlightedIndex
                    ? 'bg-gray-100 dark:bg-gray-800'
                    : !optionDisabled
                      ? 'hover:bg-gray-100 dark:hover:bg-gray-800'
                      : ''
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{option.name}</div>
                    {option.email ? (
                      <div className="text-xs text-gray-500 dark:text-gray-400">{option.email}</div>
                    ) : null}
                  </div>
                  {getOptionStatusText?.(option) ? (
                    <div className="text-xs text-gray-500 dark:text-gray-400">{getOptionStatusText(option)}</div>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
        {manualNameEntry ? (
          <div className="border-t border-gray-200 dark:border-gray-700">
            <button
              type="button"
              className="w-full px-3 py-2 text-left text-sm text-primary-teal hover:bg-gray-100 dark:hover:bg-gray-800"
              onMouseDown={(event) => event.preventDefault()}
              onClick={activateManualEntry}
            >
              {manualNameEntry.linkLabel}
            </button>
          </div>
        ) : null}
      </div>
    ) : null;

  return (
    <div className="space-y-3">
      {(lockedPills?.length ?? 0) > 0 || (extraPills?.length ?? 0) > 0 || selectedMembers.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {lockedPills?.map((pill) => (
            <div key={pill.key} className={lockedPillClassName}>
              <span>{pill.label}</span>
              {pill.detail ? (
                <span className="ml-1 text-gray-500 dark:text-gray-400">{pill.detail}</span>
              ) : null}
            </div>
          ))}
          {extraPills?.map((pill) => (
            <div
              key={pill.key}
              className={`${lockedPillClassName} focus-within:ring-2 focus-within:ring-primary-teal focus-within:ring-offset-2`}
            >
              <span>{pill.label}</span>
              {pill.detail ? (
                <span className="ml-1 text-gray-500 dark:text-gray-400">{pill.detail}</span>
              ) : null}
              <button
                type="button"
                onClick={pill.onRemove}
                className="ml-2 rounded-full p-0.5 focus:outline-none"
                aria-label={`Remove ${pill.label}`}
              >
                ×
              </button>
            </div>
          ))}
          {selectedMembers.map((member) => (
            <div
              key={member.id}
              className={`${lockedPillClassName} focus-within:ring-2 focus-within:ring-primary-teal focus-within:ring-offset-2`}
            >
              <span>{member.name}</span>
              <button
                type="button"
                onClick={() => removeMember(member.id)}
                className="ml-2 rounded-full p-0.5 focus:outline-none"
                aria-label={`Remove ${member.name}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div ref={boxRef}>
        {manualEntryMode && manualNameEntry ? (
          <div className="flex gap-2">
            <input
              ref={inputRef}
              id={comboboxId}
              type="text"
              value={manualEntryDraft}
              onChange={(event) => setManualEntryDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  submitManualEntry();
                  return;
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setManualEntryMode(false);
                  setManualEntryDraft('');
                }
              }}
              className="app-input min-w-0 flex-1"
              placeholder={manualNameEntry.inputPlaceholder ?? 'Full name'}
              autoComplete="name"
              disabled={disabled || hasReachedMax}
            />
            <Button
              type="button"
              variant="secondary"
              className="shrink-0"
              disabled={disabled || hasReachedMax || !manualEntryDraft.trim()}
              onClick={submitManualEntry}
            >
              {manualNameEntry.addButtonLabel ?? 'Add'}
            </Button>
          </div>
        ) : (
          <input
            ref={inputRef}
            id={comboboxId}
            type="text"
            value={query}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={open ? listboxId : undefined}
            aria-activedescendant={
              open && highlightedIndex >= 0 ? `${listboxId}-option-${highlightedIndex}` : undefined
            }
            onFocus={() => {
              if (!disabled && !hasReachedMax) setOpen(true);
            }}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
              setHighlightedIndex(0);
            }}
            onKeyDown={(event) => {
              if (disabled || hasReachedMax) return;
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                if (!open) {
                  setOpen(true);
                  return;
                }
                moveHighlight(1);
                return;
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                if (!open) {
                  setOpen(true);
                  return;
                }
                moveHighlight(-1);
                return;
              }
              if (
                event.key === 'Enter' &&
                open &&
                highlightedIndex >= 0 &&
                highlightedIndex < filteredOptions.length
              ) {
                event.preventDefault();
                const option = filteredOptions[highlightedIndex];
                if (!isOptionDisabled?.(option)) addMember(option.id);
                return;
              }
              if (event.key === 'Escape' && open) {
                event.preventDefault();
                setOpen(false);
                return;
              }
              if (event.key === 'Tab') {
                setOpen(false);
              }
            }}
            className="app-input"
            placeholder={hasReachedMax ? `Selection limit reached (${maxSelections})` : placeholder}
            disabled={disabled || hasReachedMax}
          />
        )}
      </div>

      {dropdownPanel ? createPortal(dropdownPanel, document.body) : null}

      {helperText ? <p className="text-sm text-gray-500 dark:text-gray-400">{helperText}</p> : null}
    </div>
  );
}
