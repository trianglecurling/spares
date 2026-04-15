import { useMemo, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import {
  HiBolt,
  HiCalendarDays,
  HiFlag,
  HiFolder,
  HiSparkles,
  HiUsers,
  HiWrenchScrewdriver,
} from 'react-icons/hi2'
import ChoiceInput, { type ChoiceOption } from './ChoiceInput'
import FormField from './FormField'
import FormSection from './FormSection'

const meta = {
  title: 'Components/ChoiceInput',
  component: ChoiceInput,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: `
Shared selection primitive for dropdown/select, combobox, radiogroup, and checkboxgroup scenarios.

Use \`layout="popover"\` for dropdown-style interactions and \`layout="inline"\` / \`layout="block"\` for always-visible radio or checkbox groups.

\`maxSelectedItems\` controls how many values may be selected: default \`1\` is single-select; \`null\`, \`0\`, or \`NaN\` means no limit; a positive integer caps the selection (with disabled add/checkbox affordances until something is removed). When the cap is greater than 1, a short \`{count} of {max} selected\` hint is shown.

When multi-select is active, \`multiSelectionIndicatorStyle\` chooses the presentation:

- \`checkboxes\`: checkbox rows in the popover (or native checkboxes for inline/block)
- \`pills\`: removable pills above the popover trigger; selected items are hidden from the popover list
- \`both\`: pills and checkbox rows together

For text-entry scenarios, provide \`inputValue\` and \`onInputValueChange\` to use the editable combobox path. For select-like scenarios, the trigger behaves like a button-backed chooser rather than a text field.

Use \`onComboboxInput\` and \`onComboboxTextBlur\` when the parent should filter options only while the user is actively typing (see combobox stories).

With \`allowCustomValue\`, multi-select popovers can append typed values (and show them as removable pills and/or list rows). Inline/block layouts add an **Other** row (radio + field) or an **Additional choices** group (checkbox flows) for custom entries.
        `,
      },
    },
  },
  argTypes: {
    layout: {
      description: 'Presentation mode for the control surface.',
      control: 'inline-radio',
      options: ['popover', 'inline', 'block'],
      table: {
        category: 'Presentation',
        defaultValue: { summary: 'popover' },
      },
    },
    maxSelectedItems: {
      description:
        'Maximum selections: omit or `1` for single-select; `null`, `0`, or `NaN` for unlimited multi; integer > 1 for a capped multi-select.',
      control: 'number',
      table: {
        category: 'Selection',
        defaultValue: { summary: '1 (single)' },
        type: { summary: 'number | null' },
      },
    },
    multiSelectionIndicatorStyle: {
      description:
        'Multi-select presentation when `maxSelectedItems` is unlimited or greater than 1 (ignored for single-select).',
      control: 'inline-radio',
      options: ['pills', 'checkboxes', 'both'],
      table: {
        category: 'Selection',
        defaultValue: { summary: 'checkboxes' },
      },
    },
    allowCustomValue: {
      description: 'Enables combobox-style custom values when the user types a value not present in the option list.',
      control: 'boolean',
      table: {
        category: 'Selection',
      },
    },
    inputValue: {
      description: 'Controlled textbox value for editable combobox/autocomplete usage.',
      control: 'text',
      table: {
        category: 'Text entry',
      },
    },
    onInputValueChange: {
      description: 'Called when the editable combobox text changes.',
      table: {
        category: 'Text entry',
        type: { summary: '(value: string) => void' },
      },
    },
    onComboboxInput: {
      description: 'Native input event: use to turn on option filtering while typing.',
      table: { category: 'Text entry' },
    },
    onComboboxTextBlur: {
      description: 'Blur leaving the combobox shell: use to turn off filtering until the next input event.',
      table: { category: 'Text entry' },
    },
    value: {
      description: 'Controlled selected value or values.',
      table: {
        category: 'Selection',
        type: { summary: 'Value | Value[] | null' },
      },
    },
    onChange: {
      description: 'Called when the selected value or values change.',
      table: {
        category: 'Selection',
        type: { summary: '(value) => void' },
      },
    },
    options: {
      description: 'Choice items, dividers, and optional nested submenu items.',
      table: {
        category: 'Data',
        type: { summary: 'ChoiceOption[]' },
      },
    },
    placeholder: {
      description: 'Placeholder text shown when there is no current display value.',
      control: 'text',
      table: {
        category: 'Presentation',
      },
    },
    disabled: {
      description: 'Disables interaction.',
      control: 'boolean',
      table: {
        category: 'State',
      },
    },
    readOnly: {
      description: 'Keeps the value visible but non-interactive.',
      control: 'boolean',
      table: {
        category: 'State',
      },
    },
    loading: {
      description: 'Shows the loading state in the popover panel.',
      control: 'boolean',
      table: {
        category: 'State',
      },
    },
    listboxLabel: {
      description: 'Accessible label for the popover listbox.',
      control: 'text',
      table: {
        category: 'Accessibility',
      },
    },
    inputId: {
      description: 'Use with FormField `htmlFor` to associate an external label with the trigger or textbox.',
      control: 'text',
      table: {
        category: 'Accessibility',
      },
    },
    ariaLabel: {
      description: 'Accessible name override when no visible label is associated externally.',
      control: 'text',
      table: {
        category: 'Accessibility',
      },
    },
    ariaLabelledBy: {
      description: 'Accessible name reference for composite labeling scenarios.',
      control: 'text',
      table: {
        category: 'Accessibility',
      },
    },
  },
} satisfies Meta<typeof ChoiceInput>

export default meta

type Story = StoryObj<typeof meta>

const singleSelectOptions: ChoiceOption<string>[] = [
  { value: 'published', label: 'Published', description: 'Visible on the site now', icon: <HiSparkles /> },
  { value: 'scheduled', label: 'Scheduled', description: 'Queued for a future publish date', icon: <HiCalendarDays /> },
  { value: 'draft', label: 'Draft', description: 'Only visible to editors', icon: <HiWrenchScrewdriver /> },
  { value: 'archived', label: 'Archived', description: 'Hidden from normal listings', icon: <HiFlag /> },
]

/** Stable list for stress-testing popover behavior with a long flat option set. */
const manySingleSelectOptions: ChoiceOption<string>[] = Array.from({ length: 100 }, (_, i) => {
  const n = i + 1
  return { value: `option-${n}`, label: `Option ${n}` }
})

const multiSelectOptions: ChoiceOption<string>[] = [
  { value: 'skip', label: 'Skip', description: 'Strategy and calling the game', icon: <HiUsers /> },
  { value: 'vice', label: 'Vice', description: 'Supports line calls and tactics', icon: <HiUsers /> },
  { value: 'second', label: 'Second', description: 'Middle-order shotmaker', icon: <HiUsers /> },
  { value: 'lead', label: 'Lead', description: 'Starts each end and sets tempo', icon: <HiUsers /> },
  { type: 'divider', label: 'Shared actions' },
  {
    value: 'all-positions',
    label: 'Show all positions',
    description: 'Example of a non-selection action row',
    icon: <HiBolt />,
  },
]

function StoryShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-100 px-6 py-8 dark:bg-gray-950">
      <div className="mx-auto max-w-6xl space-y-6">{children}</div>
    </div>
  )
}

function StoryCard({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <div className="app-card space-y-4">
      <div className="space-y-1">
        <h2 className="app-section-title text-lg">{title}</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">{description}</p>
      </div>
      {children}
    </div>
  )
}

function SingleSelectPopoverExample() {
  const [value, setValue] = useState<string | null>('published')

  return (
    <FormField label="Article status" htmlFor="storybook-choiceinput-status" helperText="Single-select dropdown with description rows and icons.">
      <ChoiceInput
        inputId="storybook-choiceinput-status"
        options={singleSelectOptions}
        value={value}
        onChange={(nextValue) => setValue(typeof nextValue === 'string' ? nextValue : null)}
        placeholder="Choose a status"
        listboxLabel="Article status options"
      />
    </FormField>
  )
}

function SingleSelectManyOptionsExample() {
  const [value, setValue] = useState<string | null>('option-1')

  return (
    <FormField
      label="Long list (100 options)"
      htmlFor="storybook-choiceinput-many"
      helperText="Single-select popover with 100 plain options. Use this story to reproduce scrolling, focus, and performance issues."
    >
      <ChoiceInput
        inputId="storybook-choiceinput-many"
        options={manySingleSelectOptions}
        value={value}
        onChange={(nextValue) => setValue(typeof nextValue === 'string' ? nextValue : null)}
        placeholder="Choose one of 100 options"
        listboxLabel="Long option list"
      />
    </FormField>
  )
}

function MultiSelectPopoverExample() {
  const [value, setValue] = useState<string[]>(['skip', 'lead'])
  const [lastAction, setLastAction] = useState('None yet')

  const options = useMemo<ChoiceOption<string>[]>(
    () => [
      ...multiSelectOptions.slice(0, 4),
      { type: 'divider', label: 'Quick actions' },
      {
        value: 'select-front-end',
        label: 'Select front end',
        description: 'Example custom action that uses the provided helpers',
        icon: <HiBolt />,
        action: ({ close }) => {
          setValue(['lead', 'second'])
          setLastAction('Selected lead and second via a custom action row.')
          close()
        },
      },
      {
        value: 'clear-selection',
        label: 'Clear all',
        description: 'Clear the current multi-select value',
        icon: <HiFlag />,
        action: ({ close }) => {
          setValue([])
          setLastAction('Cleared the current selection.')
          close()
        },
      },
    ],
    []
  )

  return (
    <div className="space-y-3">
      <FormField
        label="Preferred positions"
        htmlFor="storybook-choiceinput-positions"
        helperText="Multi-select popover with checkbox rows and custom action items. Shift-click support is implemented in the base component."
      >
        <ChoiceInput
          inputId="storybook-choiceinput-positions"
          options={options}
          value={value}
          onChange={(nextValue) => setValue(Array.isArray(nextValue) ? nextValue : nextValue ? [nextValue] : [])}
          maxSelectedItems={null}
          multiSelectionIndicatorStyle="checkboxes"
          placeholder="Select one or more positions"
          listboxLabel="Preferred positions"
        />
      </FormField>
      <p className="text-sm text-gray-600 dark:text-gray-400">Last action: {lastAction}</p>
    </div>
  )
}

function MultiSelectPillsExample() {
  const [value, setValue] = useState<string[]>(['skip', 'lead'])

  return (
    <FormField
      label="Preferred positions"
      htmlFor="storybook-choiceinput-pills"
      helperText="Pills-only mode shows selected values above the field and removes them from the popover list."
    >
      <ChoiceInput
        inputId="storybook-choiceinput-pills"
        options={multiSelectOptions.slice(0, 4)}
        value={value}
        onChange={(nextValue) => setValue(Array.isArray(nextValue) ? nextValue : nextValue ? [nextValue] : [])}
        maxSelectedItems={null}
        multiSelectionIndicatorStyle="pills"
        placeholder="Add positions"
        listboxLabel="Preferred positions"
      />
    </FormField>
  )
}

function MultiSelectPillsAndCheckboxesExample() {
  const [value, setValue] = useState<string[]>(['vice'])

  return (
    <FormField
      label="Roster preferences"
      htmlFor="storybook-choiceinput-both"
      helperText="Both mode keeps checkboxes in the popover and also shows the current selection as removable pills."
    >
      <ChoiceInput
        inputId="storybook-choiceinput-both"
        options={multiSelectOptions.slice(0, 4)}
        value={value}
        onChange={(nextValue) => setValue(Array.isArray(nextValue) ? nextValue : nextValue ? [nextValue] : [])}
        maxSelectedItems={null}
        multiSelectionIndicatorStyle="both"
        placeholder="Choose positions"
        listboxLabel="Roster preferences"
      />
    </FormField>
  )
}

function MultiCustomComboboxExample() {
  const [query, setQuery] = useState('')
  const [value, setValue] = useState<string[]>(['published', 'custom-tag'])
  const [comboboxFiltering, setComboboxFiltering] = useState(false)

  const options = useMemo<ChoiceOption<string>[]>(() => {
    if (!comboboxFiltering) return singleSelectOptions
    const needle = query.trim().toLowerCase()
    if (!needle) return singleSelectOptions
    return singleSelectOptions.filter((option) => {
      if (option.type === 'divider') return false
      const text = `${option.label} ${option.description ?? ''}`.toLowerCase()
      return text.includes(needle)
    })
  }, [comboboxFiltering, query])

  return (
    <FormField
      label="Tags"
      htmlFor="storybook-choiceinput-multi-custom"
      helperText="Options filter only while you type; leaving the field restores the full list. Add custom tags with Enter or the Add row."
    >
      <ChoiceInput<string>
        inputId="storybook-choiceinput-multi-custom"
        options={options}
        value={value}
        onChange={(nextValue) => setValue(Array.isArray(nextValue) ? nextValue : nextValue ? [nextValue] : [])}
        maxSelectedItems={null}
        multiSelectionIndicatorStyle="both"
        inputValue={query}
        onInputValueChange={setQuery}
        onComboboxInput={() => setComboboxFiltering(true)}
        onComboboxTextBlur={() => setComboboxFiltering(false)}
        allowCustomValue
        createCustomValue={(raw) => raw.trim() || null}
        placeholder="Search or add a tag"
        listboxLabel="Tag suggestions"
      />
    </FormField>
  )
}

function MultiCustomComboboxCappedExample() {
  const [query, setQuery] = useState('')
  const [value, setValue] = useState<string[]>(['published', 'draft'])
  const [comboboxFiltering, setComboboxFiltering] = useState(false)

  const options = useMemo<ChoiceOption<string>[]>(() => {
    if (!comboboxFiltering) return singleSelectOptions
    const needle = query.trim().toLowerCase()
    if (!needle) return singleSelectOptions
    return singleSelectOptions.filter((option) => {
      if (option.type === 'divider') return false
      const text = `${option.label} ${option.description ?? ''}`.toLowerCase()
      return text.includes(needle)
    })
  }, [comboboxFiltering, query])

  return (
    <FormField
      label="Tags (max 3)"
      htmlFor="storybook-choiceinput-multi-custom-capped"
      helperText="Same combobox filtering as the unlimited example, but at most three tags. Add row, Enter, and list picks respect the cap."
    >
      <ChoiceInput<string>
        inputId="storybook-choiceinput-multi-custom-capped"
        options={options}
        value={value}
        onChange={(nextValue) => setValue(Array.isArray(nextValue) ? nextValue : nextValue ? [nextValue] : [])}
        maxSelectedItems={3}
        multiSelectionIndicatorStyle="both"
        inputValue={query}
        onInputValueChange={setQuery}
        onComboboxInput={() => setComboboxFiltering(true)}
        onComboboxTextBlur={() => setComboboxFiltering(false)}
        allowCustomValue
        createCustomValue={(raw) => raw.trim() || null}
        placeholder="Search or add a tag"
        listboxLabel="Tag suggestions"
      />
    </FormField>
  )
}

function ComboboxExample() {
  const [query, setQuery] = useState('Published')
  const [value, setValue] = useState<string | null>('published')
  const [comboboxFiltering, setComboboxFiltering] = useState(false)

  const options = useMemo<ChoiceOption<string>[]>(() => {
    if (!comboboxFiltering) return singleSelectOptions
    const needle = query.trim().toLowerCase()
    if (!needle) return singleSelectOptions
    return singleSelectOptions.filter((option) => {
      if (option.type === 'divider') return false
      const text = `${option.label} ${option.description ?? ''}`.toLowerCase()
      return text.includes(needle)
    })
  }, [comboboxFiltering, query])

  return (
    <FormField
      label="Custom tag"
      htmlFor="storybook-choiceinput-combobox"
      helperText="The list filters only after you type; tabbing or clicking away restores the full option list until you type again."
    >
      <ChoiceInput
        inputId="storybook-choiceinput-combobox"
        options={options}
        value={value}
        onChange={(nextValue) => setValue(typeof nextValue === 'string' ? nextValue : null)}
        inputValue={query}
        onInputValueChange={setQuery}
        onComboboxInput={() => setComboboxFiltering(true)}
        onComboboxTextBlur={() => setComboboxFiltering(false)}
        allowCustomValue
        createCustomValue={(inputValue) => inputValue.trim() || null}
        placeholder="Search or type a custom tag"
        listboxLabel="Custom tag suggestions"
      />
    </FormField>
  )
}

function InlineRadioExample() {
  const [value, setValue] = useState<string | null>('published')

  return (
    <FormSection title="Inline radio layout" description="Horizontal layout for compact single-select groups.">
      <ChoiceInput
        options={singleSelectOptions}
        value={value}
        onChange={(nextValue) => setValue(typeof nextValue === 'string' ? nextValue : null)}
        layout="inline"
        ariaLabel="Publishing status"
        name="storybook-inline-status"
      />
    </FormSection>
  )
}

function BlockCheckboxExample() {
  const [value, setValue] = useState<string[]>(['vice'])

  return (
    <FormSection title="Block checkbox layout" description="Vertical layout for longer labels and helper text.">
      <ChoiceInput
        options={multiSelectOptions.slice(0, 4)}
        value={value}
        onChange={(nextValue) => setValue(Array.isArray(nextValue) ? nextValue : nextValue ? [nextValue] : [])}
        layout="block"
        maxSelectedItems={null}
        multiSelectionIndicatorStyle="checkboxes"
        ariaLabel="Preferred positions"
        name="storybook-block-positions"
      />
    </FormSection>
  )
}

function InlineOtherRadioExample() {
  const [value, setValue] = useState<string | null>(null)

  return (
    <FormField
      label="Publishing status"
      htmlFor="storybook-inline-other"
      helperText="Choose a preset or select Other and type a custom status."
    >
      <ChoiceInput<string>
        inputId="storybook-inline-other"
        layout="inline"
        options={singleSelectOptions.slice(0, 3)}
        value={value}
        onChange={(next) => setValue(typeof next === 'string' ? next : null)}
        allowCustomValue
        createCustomValue={(raw) => raw.trim() || null}
        placeholder="Custom status"
        ariaLabel="Publishing status"
        name="storybook-inline-other-status"
      />
    </FormField>
  )
}

function BlockCheckboxWithCustomExample() {
  const [value, setValue] = useState<string[]>(['vice', 'weekend volunteer'])

  return (
    <FormSection
      title="Block checkboxes with custom choices"
      description="Predefined rows plus an add field for values not in the list."
    >
      <ChoiceInput<string>
        options={multiSelectOptions.slice(0, 4)}
        value={value}
        onChange={(nextValue) => setValue(Array.isArray(nextValue) ? nextValue : nextValue ? [nextValue] : [])}
        layout="block"
        maxSelectedItems={null}
        multiSelectionIndicatorStyle="checkboxes"
        allowCustomValue
        createCustomValue={(raw) => raw.trim() || null}
        placeholder="Add another role"
        ariaLabel="Preferred positions and custom roles"
        name="storybook-block-custom-positions"
      />
    </FormSection>
  )
}

function LimitedMultiSelectPopoverExample() {
  const [value, setValue] = useState<string[]>(['skip', 'lead'])

  return (
    <FormField
      label="Capped multi-select (popover)"
      htmlFor="storybook-choiceinput-capped-popover"
      helperText="Up to three selections; extra rows stay disabled until you remove one."
    >
      <ChoiceInput
        inputId="storybook-choiceinput-capped-popover"
        options={multiSelectOptions.slice(0, 4)}
        value={value}
        onChange={(nextValue) => setValue(Array.isArray(nextValue) ? nextValue : nextValue ? [nextValue] : [])}
        maxSelectedItems={3}
        multiSelectionIndicatorStyle="both"
        placeholder="Choose up to three"
        listboxLabel="Preferred positions"
      />
    </FormField>
  )
}

function LimitedMultiSelectInlineExample() {
  const [value, setValue] = useState<string[]>(['vice', 'second'])

  return (
    <FormSection
      title="Inline checkboxes with a selection cap"
      description="Same limit behavior as the popover: unselected options are disabled at the cap."
    >
      <ChoiceInput
        options={multiSelectOptions.slice(0, 4)}
        value={value}
        onChange={(nextValue) => setValue(Array.isArray(nextValue) ? nextValue : nextValue ? [nextValue] : [])}
        layout="inline"
        maxSelectedItems={2}
        multiSelectionIndicatorStyle="checkboxes"
        ariaLabel="Preferred positions"
        name="storybook-inline-capped-positions"
      />
    </FormSection>
  )
}

function NestedSubmenuExample() {
  const [value, setValue] = useState<string | null>(null)
  const [lastAction, setLastAction] = useState('None yet')

  const options = useMemo<ChoiceOption<string>[]>(
    () => [
      {
        value: 'article-templates',
        label: 'Article templates',
        description: 'Open a submenu of starter presets',
        icon: <HiFolder />,
        children: [
          {
            value: 'bonspiel-recap',
            label: 'Bonspiel recap',
            description: 'Structured long-form recap template',
            action: ({ select, close }) => {
              select()
              setLastAction('Selected the bonspiel recap template.')
              close()
            },
          },
          {
            value: 'league-preview',
            label: 'League preview',
            description: 'Pre-season or week-ahead format',
            action: ({ select, close }) => {
              select()
              setLastAction('Selected the league preview template.')
              close()
            },
          },
          {
            value: 'member-spotlight',
            label: 'Member spotlight',
            description: 'Profile and photo-friendly layout',
            action: ({ select, close }) => {
              select()
              setLastAction('Selected the member spotlight template.')
              close()
            },
          },
        ],
      },
      {
        value: 'event-actions',
        label: 'Event actions',
        description: 'Open nested follow-up actions',
        icon: <HiCalendarDays />,
        children: [
          {
            value: 'publish-event',
            label: 'Publish now',
            description: 'Make the event visible immediately',
            action: ({ select, close }) => {
              select()
              setLastAction('Published the current event from the submenu.')
              close()
            },
          },
          {
            value: 'duplicate-event',
            label: 'Duplicate draft',
            description: 'Create a new draft from this event',
            action: ({ select, close }) => {
              select()
              setLastAction('Duplicated the current event from the submenu.')
              close()
            },
          },
        ],
      },
      { type: 'divider', label: 'Row actions' },
      {
        value: 'feature-homepage',
        label: 'Feature on homepage',
        description: 'Run a custom action, then keep the value in sync if desired',
        icon: <HiSparkles />,
        action: ({ select, close }) => {
          select()
          setLastAction('Featured the current item on the homepage.')
          close()
        },
      },
    ],
    []
  )

  return (
    <div className="space-y-3">
      <FormField
        label="Template and actions"
        htmlFor="storybook-choiceinput-submenu"
        helperText="Nested popovers model submenu-style options, while action rows can run custom behavior."
      >
        <ChoiceInput
          inputId="storybook-choiceinput-submenu"
          options={options}
          value={value}
          onChange={(nextValue) => setValue(typeof nextValue === 'string' ? nextValue : null)}
          placeholder="Open nested choices"
          listboxLabel="Template and action choices"
        />
      </FormField>
      <p className="text-sm text-gray-600 dark:text-gray-400">Last action: {lastAction}</p>
    </div>
  )
}

function LoadingAndEmptyExample() {
  const [query, setQuery] = useState('')

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <FormField
        label="Loading state"
        htmlFor="storybook-choiceinput-loading"
        helperText="Parent-controlled loading state inside the normal field shell."
      >
        <ChoiceInput
          inputId="storybook-choiceinput-loading"
          options={singleSelectOptions}
          value={null}
          onChange={() => undefined}
          loading
          placeholder="Loading options"
          listboxLabel="Loading example"
        />
      </FormField>
      <FormField
        label="Empty state"
        htmlFor="storybook-choiceinput-empty"
        helperText="Empty state after filtering or when the source has no results."
      >
        <ChoiceInput
          inputId="storybook-choiceinput-empty"
          options={[]}
          value={null}
          onChange={() => undefined}
          inputValue={query}
          onInputValueChange={setQuery}
          placeholder="No options available"
          emptyText="No matching templates"
          listboxLabel="Empty example"
        />
      </FormField>
    </div>
  )
}

export const Showcase = {
  render: () => (
    <StoryShell>
      <div className="space-y-2">
        <h1 className="app-page-title">ChoiceInput showcase</h1>
        <p className="app-page-subtitle max-w-3xl">
          Review the supported selection patterns in one isolated place: popover select, combobox,
          multi-select with checkboxes or pills, inline and block groups, submenu flyouts, custom
          actions, and parent-owned loading or empty states.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <StoryCard title="Single-select popover" description="Default dropdown/select-style presentation.">
          <SingleSelectPopoverExample />
        </StoryCard>

        <StoryCard title="Combobox" description="Freeform entry plus option selection.">
          <ComboboxExample />
        </StoryCard>

        <StoryCard title="Multi-select popover" description="Checkbox-style rows inside the popover.">
          <div className="space-y-6">
            <MultiSelectPopoverExample />
            <LimitedMultiSelectPopoverExample />
          </div>
        </StoryCard>

        <StoryCard
          title="Pills and combined multi-select modes"
          description="Compare pills-only mode with the combined pills-and-checkboxes presentation."
        >
          <div className="space-y-6">
            <MultiSelectPillsExample />
            <MultiSelectPillsAndCheckboxesExample />
          </div>
        </StoryCard>

        <StoryCard title="Nested submenu and actions" description="Submenu flyouts and custom action rows.">
          <NestedSubmenuExample />
        </StoryCard>

        <StoryCard title="Inline and block groups" description="Radio and checkbox presentations without a popover.">
          <div className="space-y-6">
            <InlineRadioExample />
            <BlockCheckboxExample />
            <LimitedMultiSelectInlineExample />
            <InlineOtherRadioExample />
            <BlockCheckboxWithCustomExample />
          </div>
        </StoryCard>

        <StoryCard
          title="Multi-select combobox with custom values"
          description="Typed values join the selection; removable via pills and list rows. The second field uses a selection cap."
        >
          <div className="space-y-6">
            <MultiCustomComboboxExample />
            <MultiCustomComboboxCappedExample />
          </div>
        </StoryCard>

        <StoryCard title="State handling" description="Parent-owned loading and empty states.">
          <LoadingAndEmptyExample />
        </StoryCard>
      </div>
    </StoryShell>
  ),
} as unknown as Story

export const SingleSelectPopover = {
  render: () => (
    <StoryShell>
      <StoryCard
        title="Single-select popover"
        description='Default `layout="popover"` behavior for a select or dropdown.'
      >
        <SingleSelectPopoverExample />
      </StoryCard>
    </StoryShell>
  ),
} as unknown as Story

export const SingleSelectManyOptions = {
  render: () => (
    <StoryShell>
      <StoryCard
        title="Single-select with 100 options"
        description="Stress test for long flat lists: open the popover, scroll, keyboard navigate, and select near the end of the list."
      >
        <SingleSelectManyOptionsExample />
      </StoryCard>
    </StoryShell>
  ),
} as unknown as Story

export const MultiSelectPopover = {
  render: () => (
    <StoryShell>
      <StoryCard
        title="Multi-select popover"
        description="Checkbox rows, custom actions, range-selection support, and optional selection caps."
      >
        <div className="space-y-6">
          <MultiSelectPopoverExample />
          <LimitedMultiSelectPopoverExample />
        </div>
      </StoryCard>
    </StoryShell>
  ),
} as unknown as Story

export const MultiSelectPills = {
  render: () => (
    <StoryShell>
      <StoryCard
        title="Multi-select pills modes"
        description="Pills-only mode hides selected items from the popover, while both-mode keeps pills and checkbox rows together."
      >
        <div className="space-y-6">
          <MultiSelectPillsExample />
          <MultiSelectPillsAndCheckboxesExample />
        </div>
      </StoryCard>
    </StoryShell>
  ),
} as unknown as Story

export const Combobox = {
  render: () => (
    <StoryShell>
      <StoryCard
        title="Combobox"
        description="Parent-owned filtering plus custom-value creation for values outside the option list."
      >
        <ComboboxExample />
      </StoryCard>
    </StoryShell>
  ),
} as unknown as Story

export const MultiCustomCombobox = {
  render: () => (
    <StoryShell>
      <StoryCard
        title="Multi-select combobox with custom values"
        description="Combine pills/checkbox popover with freeform tags via Enter or the Add action."
      >
        <MultiCustomComboboxExample />
      </StoryCard>
    </StoryShell>
  ),
} as unknown as Story

export const MultiCustomComboboxCapped = {
  render: () => (
    <StoryShell>
      <StoryCard
        title="Multi-select combobox with a selection cap"
        description="Filtering and custom tags like the unlimited combobox, with max selections enforced on list picks, Add, and Enter."
      >
        <MultiCustomComboboxCappedExample />
      </StoryCard>
    </StoryShell>
  ),
} as unknown as Story

export const InlineAndBlockGroups = {
  render: () => (
    <StoryShell>
      <StoryCard
        title="Inline and block groups"
        description="Non-popover presentations for radio-group and checkbox-group use cases."
      >
        <div className="space-y-6">
          <InlineRadioExample />
          <BlockCheckboxExample />
          <LimitedMultiSelectInlineExample />
          <InlineOtherRadioExample />
          <BlockCheckboxWithCustomExample />
        </div>
      </StoryCard>
    </StoryShell>
  ),
} as unknown as Story

export const NestedOptionsAndActions = {
  render: () => (
    <StoryShell>
      <StoryCard
        title="Nested options and actions"
        description="Submenu-style nested options and rows that execute custom actions."
      >
        <NestedSubmenuExample />
      </StoryCard>
    </StoryShell>
  ),
} as unknown as Story

export const LoadingAndEmptyStates = {
  render: () => (
    <StoryShell>
      <StoryCard
        title="Loading and empty states"
        description="Examples of parent-owned data states rendered inside the normal field shell."
      >
        <LoadingAndEmptyExample />
      </StoryCard>
    </StoryShell>
  ),
} as unknown as Story
