import { useMemo, type ReactNode } from 'react'
import ChoiceInput from './ChoiceInput'

type ClearButtonConfig = {
  visible: boolean
  label: string
  onClear: () => void
  openAfterClear?: boolean
}

type AutocompleteInputProps<T> = {
  inputValue: string
  onInputValueChange: (value: string) => void
  options: T[]
  onSelectOption: (option: T) => void
  getOptionKey: (option: T) => string | number
  renderOption: (option: T) => ReactNode
  placeholder?: string
  disabled?: boolean
  loading?: boolean
  loadingText?: string
  noMatchesText?: string
  listboxLabel?: string
  openOnFocus?: boolean
  shouldShowDropdown?: boolean
  inputClassName?: string
  clearButton?: ClearButtonConfig
  onInputFocus?: () => void
  onOpenChange?: (open: boolean) => void
  /** Text combobox: run search/submit when Enter is pressed and no suggestion is selected. */
  onEnterKey?: () => void
  inputId?: string
  required?: boolean
  autoComplete?: string
  /** Chromium: toggle `autocomplete="chrome-off"` only while focused (see ChoiceInput). */
  chromeOffAutocompleteWhileFocused?: boolean
}

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
  shouldShowDropdown = true,
  inputClassName = 'app-input',
  clearButton,
  onInputFocus,
  onOpenChange,
  onEnterKey,
  inputId,
  required = false,
  autoComplete,
  chromeOffAutocompleteWhileFocused,
}: AutocompleteInputProps<T>) {
  const mappedOptions = useMemo(
    () =>
      options.map((option) => ({
        value: String(getOptionKey(option)),
        label: renderOption(option),
        action: ({ close, select }: { close: () => void; select: () => void }) => {
          select()
          onSelectOption(option)
          close()
        },
      })),
    [getOptionKey, onSelectOption, options, renderOption]
  )

  return (
    <ChoiceInput<string>
      options={mappedOptions}
      value={null}
      onChange={() => undefined}
      layout="popover"
      inputValue={inputValue}
      onInputValueChange={onInputValueChange}
      inputId={inputId}
      placeholder={placeholder}
      disabled={disabled}
      loading={loading}
      loadingText={loadingText}
      emptyText={noMatchesText}
      listboxLabel={listboxLabel}
      required={required}
      autoComplete={autoComplete}
      chromeOffAutocompleteWhileFocused={chromeOffAutocompleteWhileFocused}
      inputClassName={inputClassName}
      clearButton={clearButton}
      shouldShowDropdown={shouldShowDropdown}
      onOpenChange={onOpenChange}
      onInputFocus={onInputFocus}
      onComboboxEnter={onEnterKey}
    />
  )
}
