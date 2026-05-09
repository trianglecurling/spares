import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMemberOptions } from '../contexts/MemberOptionsContext';
import type { MemberPickerOption } from '../types/memberPicker';

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
  inputId: inputIdProp,
}: MemberMultiSelectProps) {
  const sharedMembers = useMemberOptions({ autoLoad: options === undefined });
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const boxRef = useRef<HTMLDivElement | null>(null);
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
  const hasReachedMax = maxSelections !== undefined && selectedIds.length >= maxSelections;

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

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!boxRef.current) return;
      if (boxRef.current.contains(event.target as Node)) return;
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

  return (
    <div className="space-y-3">
      {selectedMembers.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {selectedMembers.map((member) => (
            <div
              key={member.id}
              className="flex items-center rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-900 focus-within:ring-2 focus-within:ring-primary-teal focus-within:ring-offset-2 dark:bg-gray-700 dark:text-gray-100"
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

      <div ref={boxRef} className="relative">
        <input
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

        {open && query.trim() && !disabled && !hasReachedMax ? (
          <div
            id={listboxId}
            role="listbox"
            aria-label="Member suggestions"
            className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-md border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900"
          >
            {effectiveLoading ? (
              <p className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">{loadingText}</p>
            ) : filteredOptions.length === 0 ? (
              <p className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                {effectiveNoMatchesText}
              </p>
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
                      optionDisabled
                        ? 'cursor-not-allowed opacity-60'
                        : 'cursor-pointer'
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
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          {option.name}
                        </div>
                        {option.email ? (
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {option.email}
                          </div>
                        ) : null}
                      </div>
                      {getOptionStatusText?.(option) ? (
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {getOptionStatusText(option)}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ) : null}
      </div>

      {helperText ? <p className="text-sm text-gray-500 dark:text-gray-400">{helperText}</p> : null}
    </div>
  );
}
