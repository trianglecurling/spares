import { useMemo, useState } from 'react';
import AutocompleteInput from './AutocompleteInput';
import { useMemberOptions } from '../contexts/MemberOptionsContext';
import type { MemberPickerOption } from '../types/memberPicker';

type MemberAutocompleteProps = {
  value: number | '';
  onChange: (value: number | '') => void;
  options?: MemberPickerOption[];
  placeholder?: string;
  disabled?: boolean;
  noMatchesText?: string;
  loading?: boolean;
  loadingText?: string;
  minQueryLength?: number;
  inputValue?: string;
  onInputValueChange?: (value: string) => void;
  selectedOption?: MemberPickerOption | null;
  onSelectOption?: (option: MemberPickerOption) => void;
  openOnFocus?: boolean;
  inputClassName?: string;
  filterOption?: (option: MemberPickerOption) => boolean;
};

export default function MemberAutocomplete({
  value,
  onChange,
  options,
  placeholder = 'Search members...',
  disabled = false,
  noMatchesText = 'No matching members',
  loading = false,
  loadingText = 'Loading...',
  minQueryLength = 0,
  inputValue,
  onInputValueChange,
  selectedOption,
  onSelectOption,
  openOnFocus = true,
  inputClassName = 'app-input',
  filterOption,
}: MemberAutocompleteProps) {
  const sharedMembers = useMemberOptions({ autoLoad: options === undefined });
  const [internalQuery, setInternalQuery] = useState('');
  const isQueryControlled = inputValue !== undefined && onInputValueChange !== undefined;
  const query = isQueryControlled ? inputValue : internalQuery;
  const sourceOptions = options ?? sharedMembers.options;
  const effectiveLoading = loading || (options === undefined && sharedMembers.loading);
  const effectiveNoMatchesText =
    options === undefined && sharedMembers.error ? sharedMembers.error : noMatchesText;

  const selected = selectedOption ?? sourceOptions.find((option) => option.id === value) ?? null;
  const displayText = query || selected?.name || '';
  const queryLength = query.trim().length;
  const shouldShowResults = minQueryLength === 0 || queryLength >= minQueryLength;

  const setQuery = (nextValue: string) => {
    if (isQueryControlled) {
      onInputValueChange(nextValue);
      return;
    }
    setInternalQuery(nextValue);
  };

  const filteredOptions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const visibleOptions = filterOption
      ? sourceOptions.filter((option) => filterOption(option))
      : sourceOptions;
    if (!needle) return minQueryLength === 0 ? visibleOptions : [];
    return visibleOptions.filter((option) => {
      const haystacks = [option.name, option.email ?? ''];
      return haystacks.some((part) => part.toLowerCase().includes(needle));
    });
  }, [filterOption, minQueryLength, query, sourceOptions]);

  const selectMember = (option: MemberPickerOption) => {
    onChange(option.id);
    onSelectOption?.(option);
    if (isQueryControlled) {
      onInputValueChange(option.name);
    } else {
      setInternalQuery('');
    }
  };

  return (
    <AutocompleteInput
      inputValue={displayText}
      onInputValueChange={(nextQuery) => {
        setQuery(nextQuery);
        if (value !== '' && selected && nextQuery !== selected.name) onChange('');
      }}
      options={filteredOptions}
      onSelectOption={selectMember}
      getOptionKey={(option) => option.id}
      renderOption={(option) => (
        <>
          <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{option.name}</div>
          {option.email ? (
            <div className="text-xs text-gray-500 dark:text-gray-400">{option.email}</div>
          ) : null}
        </>
      )}
      placeholder={placeholder}
      disabled={disabled}
      loading={effectiveLoading}
      loadingText={loadingText}
      noMatchesText={effectiveNoMatchesText}
      listboxLabel="Member suggestions"
      openOnFocus={openOnFocus}
      shouldShowDropdown={shouldShowResults}
      inputClassName={inputClassName}
      clearButton={
        selected && !query && !disabled
          ? {
              visible: true,
              label: `Clear selected member ${selected.name}`,
              onClear: () => {
                onChange('');
                setQuery('');
              },
            }
          : undefined
      }
      onInputFocus={() => {
        if (!isQueryControlled) {
          setInternalQuery('');
        }
      }}
    />
  );
}
