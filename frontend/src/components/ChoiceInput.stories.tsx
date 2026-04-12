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

The \`multiSelection\` prop controls both whether multiple values are allowed and how that multi-select state is presented:

- \`none\`: single selection
- \`checkboxes\`: multi-select with checkbox rows in the popover
- \`pills\`: multi-select with removable pills above the trigger; selected items are hidden from the popover
- \`both\`: multi-select with both removable pills and checkbox rows

For text-entry scenarios, provide \`inputValue\` and \`onInputValueChange\` to use the editable combobox path. For select-like scenarios, the trigger behaves like a button-backed chooser rather than a text field.
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
    multiSelection: {
      description:
        'Controls whether multiple values are allowed and whether the popover uses checkboxes, pills, or both.',
      control: 'inline-radio',
      options: ['none', 'pills', 'checkboxes', 'both'],
      table: {
        category: 'Selection',
        defaultValue: { summary: 'none' },
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
          multiSelection="checkboxes"
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
        multiSelection="pills"
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
        multiSelection="both"
        placeholder="Choose positions"
        listboxLabel="Roster preferences"
      />
    </FormField>
  )
}

function ComboboxExample() {
  const [query, setQuery] = useState('')
  const [value, setValue] = useState<string | null>('published')

  const options = useMemo<ChoiceOption<string>[]>(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return singleSelectOptions
    return singleSelectOptions.filter((option) => {
      if (option.type === 'divider') return false
      const text = `${option.label} ${option.description ?? ''}`.toLowerCase()
      return text.includes(needle)
    })
  }, [query])

  return (
    <FormField
      label="Custom tag"
      htmlFor="storybook-choiceinput-combobox"
      helperText="Combobox mode keeps filtering page-owned and allows freeform entry when no option fits."
    >
      <ChoiceInput
        inputId="storybook-choiceinput-combobox"
        options={options}
        value={value}
        onChange={(nextValue) => setValue(typeof nextValue === 'string' ? nextValue : null)}
        inputValue={query}
        onInputValueChange={setQuery}
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
        multiSelection="checkboxes"
        ariaLabel="Preferred positions"
        name="storybook-block-positions"
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

export const Showcase: Story = {
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
          <MultiSelectPopoverExample />
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
          </div>
        </StoryCard>

        <StoryCard title="State handling" description="Parent-owned loading and empty states.">
          <LoadingAndEmptyExample />
        </StoryCard>
      </div>
    </StoryShell>
  ),
}

export const SingleSelectPopover: Story = {
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
}

export const MultiSelectPopover: Story = {
  render: () => (
    <StoryShell>
      <StoryCard
        title="Multi-select popover"
        description="Checkbox rows, custom actions, and range-selection support."
      >
        <MultiSelectPopoverExample />
      </StoryCard>
    </StoryShell>
  ),
}

export const MultiSelectPills: Story = {
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
}

export const Combobox: Story = {
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
}

export const InlineAndBlockGroups: Story = {
  render: () => (
    <StoryShell>
      <StoryCard
        title="Inline and block groups"
        description="Non-popover presentations for radio-group and checkbox-group use cases."
      >
        <div className="space-y-6">
          <InlineRadioExample />
          <BlockCheckboxExample />
        </div>
      </StoryCard>
    </StoryShell>
  ),
}

export const NestedOptionsAndActions: Story = {
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
}

export const LoadingAndEmptyStates: Story = {
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
}
