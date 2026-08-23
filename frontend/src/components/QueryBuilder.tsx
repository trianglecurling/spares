import { useId, useMemo, useState, type FormEvent } from 'react';
import ChoiceInput, { type ChoiceOption } from './ChoiceInput';
import FormField from './FormField';
import Button from './Button';

const VALUELESS_OPERATORS = new Set(['is_empty', 'is_not_empty']);
const MULTI_VALUE_OPERATORS = new Set(['in', 'not_in']);

export type QueryBuilderValueType = 'enum' | 'string' | 'number' | 'boolean' | 'date';

export type QueryBuilderFieldOption = {
  value: string;
  label: string;
};

export type QueryBuilderField = {
  key: string;
  label: string;
  group: string;
  valueType: QueryBuilderValueType;
  operators: string[];
  options?: QueryBuilderFieldOption[];
  allowCustomValue?: boolean;
  nullable?: boolean;
};

export type QueryBuilderRule = {
  field: string;
  operator: string;
  value?: unknown;
};

export type QueryBuilderQuery = {
  match: 'all' | 'any';
  rules: QueryBuilderRule[];
};

type QueryBuilderProps = {
  query: QueryBuilderQuery;
  onChange: (query: QueryBuilderQuery) => void;
  fields: QueryBuilderField[];
  matchOptions?: Array<{ value: 'all' | 'any'; label: string }>;
  operatorLabels?: Array<{ value: string; label: string }>;
  disabled?: boolean;
  loading?: boolean;
};

function emptyQuery(): QueryBuilderQuery {
  return { match: 'all', rules: [] };
}

function cloneQuery(query: QueryBuilderQuery): QueryBuilderQuery {
  return {
    match: query.match === 'any' ? 'any' : 'all',
    rules: query.rules.map((rule) => ({
      field: rule.field,
      operator: rule.operator,
      value: rule.value,
    })),
  };
}

function serializeQuery(query: QueryBuilderQuery): string {
  return JSON.stringify(cloneQuery(query));
}

function fieldByKey(fields: QueryBuilderField[], key: string): QueryBuilderField | undefined {
  return fields.find((field) => field.key === key);
}

function defaultOperator(field: QueryBuilderField | undefined): string {
  return field?.operators[0] ?? 'eq';
}

function defaultRule(fields: QueryBuilderField[]): QueryBuilderRule {
  const field = fields[0];
  return { field: field?.key ?? '', operator: defaultOperator(field) };
}

function scalarString(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => scalarString(item)).filter((item) => item !== '');
  const single = scalarString(value);
  return single ? [single] : [];
}

function operatorNeedsValue(operator: string): boolean {
  return !VALUELESS_OPERATORS.has(operator);
}

function operatorIsMulti(operator: string): boolean {
  return MULTI_VALUE_OPERATORS.has(operator);
}

function coerceValueForOperator(field: QueryBuilderField | undefined, operator: string, value: unknown): unknown {
  if (!operatorNeedsValue(operator)) return undefined;
  if (operatorIsMulti(operator)) return asStringList(value);
  if (field?.valueType === 'boolean') {
    if (typeof value === 'boolean') return value;
    const text = Array.isArray(value) ? scalarString(value[0]) : scalarString(value);
    if (text === 'true') return true;
    if (text === 'false') return false;
    return undefined;
  }
  if (Array.isArray(value)) return value[0];
  return value;
}

export default function QueryBuilder({
  query,
  onChange,
  fields,
  matchOptions,
  operatorLabels,
  disabled = false,
  loading = false,
}: QueryBuilderProps) {
  const headingId = useId();
  const matchFieldId = useId();
  const idPrefix = useId();
  const unavailable = disabled || loading;
  const appliedKey = serializeQuery(query);
  const [draft, setDraft] = useState<QueryBuilderQuery>(() => cloneQuery(query));
  const [draftSource, setDraftSource] = useState(appliedKey);
  if (draftSource !== appliedKey) {
    setDraft(cloneQuery(query));
    setDraftSource(appliedKey);
  }
  const operatorLabelByValue = useMemo(() => {
    const labels = new Map<string, string>();
    for (const item of operatorLabels ?? []) labels.set(item.value, item.label);
    return labels;
  }, [operatorLabels]);

  const fieldOptions = useMemo((): ChoiceOption<string>[] => {
    const options: ChoiceOption<string>[] = [];
    let previousGroup = '';
    for (const field of fields) {
      if (field.group !== previousGroup) {
        options.push({ type: 'divider', key: field.group, label: field.group });
        previousGroup = field.group;
      }
      options.push({ value: field.key, label: field.label });
    }
    return options;
  }, [fields]);

  const resolvedMatchOptions = matchOptions?.length
    ? matchOptions
    : [
        { value: 'all' as const, label: 'Match all conditions' },
        { value: 'any' as const, label: 'Match any condition' },
      ];

  const updateQuery = (next: QueryBuilderQuery) => {
    setDraft(next);
  };

  const applyDraft = (next: QueryBuilderQuery = draft) => {
    setDraft(cloneQuery(next));
    setDraftSource(serializeQuery(next));
    onChange(next);
  };

  const updateRule = (index: number, patch: Partial<QueryBuilderRule>) => {
    const rules = draft.rules.map((rule, ruleIndex) => {
      if (ruleIndex !== index) return rule;
      const fieldKey = patch.field ?? rule.field;
      const field = fieldByKey(fields, fieldKey);
      let operator = patch.operator ?? rule.operator;
      if (patch.field && field && !field.operators.includes(operator)) {
        operator = defaultOperator(field);
      }
      const value = coerceValueForOperator(field, operator, patch.value !== undefined ? patch.value : rule.value);
      return { field: fieldKey, operator, value };
    });
    updateQuery({ ...draft, rules });
  };

  const addRule = () => {
    updateQuery({ ...draft, rules: [...draft.rules, defaultRule(fields)] });
  };

  const removeRule = (index: number) => {
    updateQuery({ ...draft, rules: draft.rules.filter((_, ruleIndex) => ruleIndex !== index) });
  };

  const clearRules = () => {
    applyDraft({ ...emptyQuery(), match: draft.match });
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (unavailable) return;
    applyDraft();
  };

  return (
    <section className="app-card space-y-4" aria-labelledby={headingId}>
      <div>
        <h3 id={headingId} className="app-section-title text-base">
          Filters
        </h3>
        <p className="app-section-subtitle">
          Match all conditions to require every row, or any condition to include a registration that matches at least
          one. Incomplete conditions are ignored until you choose a value. Select Filter to update the list.
        </p>
      </div>

      <form className="space-y-4" onSubmit={handleSubmit}>
      <FormField label="Match" htmlFor={matchFieldId} className="max-w-sm">
        <ChoiceInput
          inputId={matchFieldId}
          layout="popover"
          value={draft.match}
          onChange={(value) => {
            const next = Array.isArray(value) ? value[0] : value;
            if (next === 'all' || next === 'any') updateQuery({ ...draft, match: next });
          }}
          options={resolvedMatchOptions}
          disabled={unavailable}
          placeholder="Select match mode"
        />
      </FormField>

      {draft.rules.length === 0 ? (
        <p className="text-sm text-gray-600 dark:text-gray-400">
          No conditions yet. Add a condition, or use a session summary count to start a filtered list.
        </p>
      ) : (
        <ol className="space-y-3">
          {draft.rules.map((rule, index) => {
            const field = fieldByKey(fields, rule.field);
            const fieldId = `${idPrefix}-field-${index}`;
            const operatorId = `${idPrefix}-operator-${index}`;
            const valueId = `${idPrefix}-value-${index}`;
            const showValue = operatorNeedsValue(rule.operator);
            const multi = operatorIsMulti(rule.operator);
            const operatorOptions = (field?.operators ?? []).map((operator) => ({
              value: operator,
              label: operatorLabelByValue.get(operator) ?? operator.replace(/_/g, ' '),
            }));
            const valueOptions = (field?.options ?? []).map((option) => ({
              value: option.value,
              label: option.label,
            }));

            return (
              <li
                key={`${idPrefix}-${index}`}
                className="rounded-lg border border-gray-200 p-3 dark:border-gray-700"
                aria-label={`Condition ${index + 1}`}
              >
                <div className="flex flex-wrap items-end gap-3">
                  <FormField label="Field" htmlFor={fieldId} className="min-w-[12rem] flex-1">
                    <ChoiceInput
                      inputId={fieldId}
                      layout="popover"
                      value={rule.field || null}
                      onChange={(value) => {
                        const next = Array.isArray(value) ? value[0] : value;
                        updateRule(index, { field: next ?? '' });
                      }}
                      options={fieldOptions}
                      disabled={unavailable}
                      loading={loading}
                      placeholder="Select field"
                    />
                  </FormField>
                  <FormField label="Operator" htmlFor={operatorId} className="min-w-[10rem] sm:max-w-[14rem]">
                    <ChoiceInput
                      inputId={operatorId}
                      layout="popover"
                      value={rule.operator || null}
                      onChange={(value) => {
                        const next = Array.isArray(value) ? value[0] : value;
                        updateRule(index, { operator: next ?? defaultOperator(field) });
                      }}
                      options={operatorOptions}
                      disabled={unavailable || !field}
                      placeholder="Select operator"
                    />
                  </FormField>
                  {showValue ? (
                    <FormField label="Value" htmlFor={valueId} className="min-w-[12rem] flex-1">
                      <QueryBuilderValueInput
                        id={valueId}
                        field={field}
                        operator={rule.operator}
                        value={rule.value}
                        multi={multi}
                        disabled={unavailable}
                        onChange={(value) => updateRule(index, { value })}
                        options={valueOptions}
                      />
                    </FormField>
                  ) : null}
                  <Button
                    type="button"
                    variant="secondary"
                    className="shrink-0"
                    disabled={unavailable}
                    onClick={() => removeRule(index)}
                    aria-label={`Remove condition ${index + 1}`}
                  >
                    Remove
                  </Button>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={unavailable}>
          Filter
        </Button>
        <Button type="button" variant="secondary" disabled={unavailable || fields.length === 0} onClick={addRule}>
          Add condition
        </Button>
        {draft.rules.length > 0 ? (
          <Button type="button" variant="secondary" disabled={unavailable} onClick={clearRules}>
            Clear filters
          </Button>
        ) : null}
      </div>
      </form>
    </section>
  );
}

function QueryBuilderValueInput({
  id,
  field,
  value,
  multi,
  disabled,
  onChange,
  options,
}: {
  id: string;
  field: QueryBuilderField | undefined;
  operator: string;
  value: unknown;
  multi: boolean;
  disabled: boolean;
  onChange: (value: unknown) => void;
  options: Array<{ value: string; label: string }>;
}) {
  const valueType = field?.valueType ?? 'string';
  const allowCustomValue = Boolean(field?.allowCustomValue);

  if (valueType === 'enum' || valueType === 'boolean') {
    if (multi) {
      return (
        <ChoiceInput
          inputId={id}
          layout="popover"
          maxSelectedItems={null}
          value={asStringList(value)}
          onChange={(next) => {
            if (Array.isArray(next)) onChange(next.map(String));
            else if (next == null) onChange([]);
            else onChange([String(next)]);
          }}
          options={options}
          allowCustomValue={allowCustomValue}
          disabled={disabled}
          placeholder="Select values"
        />
      );
    }
    const current = Array.isArray(value) ? scalarString(value[0]) : scalarString(value);
    return (
      <ChoiceInput
        inputId={id}
        layout="popover"
        value={current || null}
        onChange={(next) => {
          const selected = Array.isArray(next) ? next[0] : next;
          if (selected == null || selected === '') {
            onChange(undefined);
            return;
          }
          if (valueType === 'boolean') {
            onChange(selected === 'true');
            return;
          }
          onChange(String(selected));
        }}
        options={options}
        allowCustomValue={allowCustomValue}
        disabled={disabled}
        placeholder="Select value"
      />
    );
  }

  if (valueType === 'number') {
    return (
      <input
        id={id}
        type="number"
        inputMode="decimal"
        className="app-input"
        disabled={disabled}
        value={value == null || value === '' ? '' : String(value)}
        onChange={(event) => {
          const text = event.target.value;
          if (text === '') {
            onChange(undefined);
            return;
          }
          const parsed = Number(text);
          onChange(Number.isFinite(parsed) ? parsed : text);
        }}
      />
    );
  }

  if (valueType === 'date') {
    return (
      <input
        id={id}
        type="date"
        className="app-input"
        disabled={disabled}
        value={scalarString(value).slice(0, 10)}
        onChange={(event) => onChange(event.target.value || undefined)}
      />
    );
  }

  return (
    <input
      id={id}
      type="text"
      className="app-input"
      disabled={disabled}
      value={scalarString(value)}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
