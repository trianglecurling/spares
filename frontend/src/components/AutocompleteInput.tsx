import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

type ClearButtonConfig = {
  visible: boolean;
  label: string;
  onClear: () => void;
  openAfterClear?: boolean;
};

type AutocompleteInputProps<T> = {
  inputValue: string;
  onInputValueChange: (value: string) => void;
  options: T[];
  onSelectOption: (option: T) => void;
  getOptionKey: (option: T) => string | number;
  renderOption: (option: T) => ReactNode;
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
  loadingText?: string;
  noMatchesText?: string;
  listboxLabel?: string;
  openOnFocus?: boolean;
  shouldShowDropdown?: boolean;
  inputClassName?: string;
  clearButton?: ClearButtonConfig;
  onInputFocus?: () => void;
  onOpenChange?: (open: boolean) => void;
  inputId?: string;
  required?: boolean;
  autoComplete?: string;
};

export default function AutocompleteInput<T>({
  inputValue,
  onInputValueChange,
  options,
  onSelectOption,
  getOptionKey,
  renderOption,
  placeholder = 'Search...',
  disabled = false,
  loading = false,
  loadingText = 'Loading...',
  noMatchesText = 'No matches found',
  listboxLabel = 'Suggestions',
  openOnFocus = true,
  shouldShowDropdown = true,
  inputClassName = 'app-input',
  clearButton,
  onInputFocus,
  onOpenChange,
  inputId,
  required = false,
  autoComplete,
}: AutocompleteInputProps<T>) {
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const generatedId = useId();
  const listboxId = `${generatedId}-listbox`;
  const showDropdown = open && !disabled && shouldShowDropdown;

  const setOpenState = (nextOpen: boolean) => {
    setOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!boxRef.current) return;
      if (boxRef.current.contains(event.target as Node)) return;
      setOpenState(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  useEffect(() => {
    if (!showDropdown || options.length === 0) {
      setHighlightedIndex(-1);
      return;
    }
    setHighlightedIndex((prev) => {
      if (prev >= 0 && prev < options.length) return prev;
      return 0;
    });
  }, [options.length, showDropdown]);

  useEffect(() => {
    if (!showDropdown || highlightedIndex < 0) return;
    const active = document.getElementById(`${listboxId}-option-${highlightedIndex}`);
    active?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex, listboxId, showDropdown]);

  const handleSelectOption = (option: T) => {
    onSelectOption(option);
    setOpenState(false);
    setHighlightedIndex(-1);
  };

  return (
    <div ref={boxRef} className="relative">
      <input
        id={inputId}
        ref={inputRef}
        type="text"
        value={inputValue}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showDropdown}
        aria-controls={showDropdown ? listboxId : undefined}
        aria-activedescendant={
          showDropdown && highlightedIndex >= 0 ? `${listboxId}-option-${highlightedIndex}` : undefined
        }
        onFocus={() => {
          onInputFocus?.();
          if (!disabled && openOnFocus) {
            setOpenState(true);
          }
        }}
        onChange={(event) => {
          onInputValueChange(event.target.value);
          setOpenState(true);
          setHighlightedIndex(0);
        }}
        onKeyDown={(event) => {
          if (disabled) return;
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (!open) {
              setOpenState(true);
              return;
            }
            if (options.length === 0) return;
            setHighlightedIndex((prev) => (prev + 1) % options.length);
            return;
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            if (!open) {
              setOpenState(true);
              return;
            }
            if (options.length === 0) return;
            setHighlightedIndex((prev) => (prev <= 0 ? options.length - 1 : prev - 1));
            return;
          }
          if (event.key === 'Enter' && showDropdown && highlightedIndex >= 0 && highlightedIndex < options.length) {
            event.preventDefault();
            handleSelectOption(options[highlightedIndex]);
            return;
          }
          if (event.key === 'Escape' && open) {
            event.preventDefault();
            setOpenState(false);
            return;
          }
          if (event.key === 'Tab') {
            setOpenState(false);
          }
        }}
        placeholder={placeholder}
        disabled={disabled}
        className={inputClassName}
        required={required}
        autoComplete={autoComplete}
      />
      {clearButton?.visible ? (
        <button
          type="button"
          onClick={() => {
            clearButton.onClear();
            setOpenState(Boolean(clearButton.openAfterClear));
            setHighlightedIndex(-1);
            inputRef.current?.focus();
          }}
          aria-label={clearButton.label}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          Clear
        </button>
      ) : null}
      {showDropdown ? (
        <div
          id={listboxId}
          role="listbox"
          aria-label={listboxLabel}
          className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-md border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900"
        >
          {loading ? (
            <p className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">{loadingText}</p>
          ) : options.length === 0 ? (
            <p className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">{noMatchesText}</p>
          ) : (
            options.map((option, index) => (
              <div
                key={getOptionKey(option)}
                id={`${listboxId}-option-${index}`}
                role="option"
                aria-selected={index === highlightedIndex}
                onMouseEnter={() => setHighlightedIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => handleSelectOption(option)}
                className={`cursor-pointer px-3 py-2 ${
                  index === highlightedIndex
                    ? 'bg-gray-100 dark:bg-gray-800'
                    : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                {renderOption(option)}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
