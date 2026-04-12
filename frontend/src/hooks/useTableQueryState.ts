import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { TableSort, TableSortDirection } from '../components/table/tableTypes';

type TableFilterConfig<Value extends string> = {
  queryKey: string;
  defaultValue: Value;
  parse?: (raw: string | null) => Value;
  serialize?: (value: Value) => string;
  shouldOmit?: (value: Value, defaultValue: Value) => boolean;
  debounceMs?: number;
};

type UseTableQueryStateOptions<SortKey extends string, Filters extends Record<string, string>> = {
  defaultSort: TableSort<SortKey>;
  sortKeys: readonly SortKey[];
  defaultPage?: number;
  pageParam?: string;
  sortParam?: string;
  orderParam?: string;
  filterConfig: {
    [Key in keyof Filters]: TableFilterConfig<Filters[Key]>;
  };
};

type SetParamOptions = {
  replace?: boolean;
};

function joinKeys<T extends object>(obj: T): Array<keyof T> {
  return Object.keys(obj) as Array<keyof T>;
}

function filtersEqual<Filters extends Record<string, string>>(left: Filters, right: Filters) {
  const keys = joinKeys(left);
  return keys.every((key) => left[key] === right[key]);
}

function defaultShouldOmit<Value extends string>(value: Value, defaultValue: Value) {
  return value === defaultValue || value === '';
}

export default function useTableQueryState<
  SortKey extends string,
  Filters extends Record<string, string>,
>({
  defaultSort,
  sortKeys,
  defaultPage = 1,
  pageParam = 'page',
  sortParam = 'sort',
  orderParam = 'order',
  filterConfig,
}: UseTableQueryStateOptions<SortKey, Filters>) {
  const [searchParams, setSearchParams] = useSearchParams();
  const latestSearchParamsRef = useRef(searchParams.toString());
  latestSearchParamsRef.current = searchParams.toString();

  const parsedState = useMemo(() => {
    const rawPage = Number.parseInt(searchParams.get(pageParam) ?? '', 10);
    const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : defaultPage;

    const rawSort = searchParams.get(sortParam);
    const rawOrder = searchParams.get(orderParam);
    const sort: TableSort<SortKey> = {
      key: rawSort && sortKeys.includes(rawSort as SortKey) ? (rawSort as SortKey) : defaultSort.key,
      direction:
        rawOrder === 'asc' || rawOrder === 'desc'
          ? rawOrder
          : defaultSort.direction,
    };

    const filters = joinKeys(filterConfig).reduce((acc, key) => {
      const config = filterConfig[key];
      const rawValue = searchParams.get(config.queryKey);
      acc[key] = config.parse ? config.parse(rawValue) : ((rawValue ?? config.defaultValue) as Filters[typeof key]);
      return acc;
    }, {} as Filters);

    return { page, sort, filters };
  }, [defaultPage, defaultSort.direction, defaultSort.key, filterConfig, orderParam, pageParam, searchParams, sortKeys, sortParam]);

  const latestStateRef = useRef(parsedState);
  latestStateRef.current = parsedState;

  const [draftFilters, setDraftFilters] = useState<Filters>(parsedState.filters);
  const debounceTimersRef = useRef<Partial<Record<keyof Filters, number>>>({});

  useEffect(() => {
    setDraftFilters((current) => (filtersEqual(current, parsedState.filters) ? current : parsedState.filters));
  }, [parsedState.filters]);

  useEffect(() => {
    return () => {
      joinKeys(debounceTimersRef.current).forEach((key) => {
        const handle = debounceTimersRef.current[key];
        if (handle) window.clearTimeout(handle);
      });
    };
  }, []);

  const commitState = useCallback(
    (
      nextState: {
        page?: number;
        sort?: TableSort<SortKey>;
        filters?: Filters;
      },
      { replace = false }: SetParamOptions = {}
    ) => {
      const current = latestStateRef.current;
      const nextPage = nextState.page ?? current.page;
      const nextSort = nextState.sort ?? current.sort;
      const nextFilters = nextState.filters ?? current.filters;
      const nextParams = new URLSearchParams(latestSearchParamsRef.current);

      if (nextPage <= defaultPage) nextParams.delete(pageParam);
      else nextParams.set(pageParam, String(nextPage));

      if (nextSort.key === defaultSort.key) nextParams.delete(sortParam);
      else nextParams.set(sortParam, nextSort.key);

      if (nextSort.direction === defaultSort.direction) nextParams.delete(orderParam);
      else nextParams.set(orderParam, nextSort.direction);

      joinKeys(filterConfig).forEach((key) => {
        const config = filterConfig[key];
        const value = nextFilters[key];
        const serialized = config.serialize ? config.serialize(value) : value;
        const shouldOmit = config.shouldOmit
          ? config.shouldOmit(value, config.defaultValue)
          : defaultShouldOmit(value, config.defaultValue);

        if (shouldOmit) nextParams.delete(config.queryKey);
        else nextParams.set(config.queryKey, serialized);
      });

      setSearchParams(nextParams, { replace });
    },
    [defaultPage, defaultSort.direction, defaultSort.key, filterConfig, orderParam, pageParam, setSearchParams, sortParam]
  );

  const setPage = useCallback(
    (page: number, options?: SetParamOptions) => {
      commitState({ page: Math.max(defaultPage, page) }, options);
    },
    [commitState, defaultPage]
  );

  const setSort = useCallback(
    (sort: TableSort<SortKey>, options?: SetParamOptions) => {
      commitState({ page: defaultPage, sort }, options);
    },
    [commitState, defaultPage]
  );

  const toggleSort = useCallback(
    (key: SortKey, defaultDirection: TableSortDirection, options?: SetParamOptions) => {
      const currentSort = latestStateRef.current.sort;
      if (currentSort.key === key) {
        setSort(
          {
            key,
            direction: currentSort.direction === 'asc' ? 'desc' : 'asc',
          },
          options
        );
        return;
      }

      setSort(
        {
          key,
          direction: defaultDirection,
        },
        options
      );
    },
    [setSort]
  );

  const setFilter = useCallback(
    <Key extends keyof Filters>(
      key: Key,
      value: Filters[Key],
      options?: SetParamOptions
    ) => {
      const handle = debounceTimersRef.current[key];
      if (handle) window.clearTimeout(handle);

      const nextFilters = {
        ...latestStateRef.current.filters,
        [key]: value,
      };
      setDraftFilters((current) => ({ ...current, [key]: value }));
      commitState(
        {
          page: defaultPage,
          filters: nextFilters,
        },
        options
      );
    },
    [commitState, defaultPage]
  );

  const setDraftFilter = useCallback(
    <Key extends keyof Filters>(key: Key, value: Filters[Key]) => {
      setDraftFilters((current) => ({ ...current, [key]: value }));
      const config = filterConfig[key];

      if (!config.debounceMs) {
        setFilter(key, value);
        return;
      }

      const handle = debounceTimersRef.current[key];
      if (handle) window.clearTimeout(handle);

      debounceTimersRef.current[key] = window.setTimeout(() => {
        setFilter(key, value, { replace: true });
      }, config.debounceMs);
    },
    [filterConfig, setFilter]
  );

  return {
    page: parsedState.page,
    sort: parsedState.sort,
    filters: parsedState.filters,
    draftFilters,
    setPage,
    setSort,
    toggleSort,
    setFilter,
    setDraftFilter,
  };
}

export type {
  TableFilterConfig,
  UseTableQueryStateOptions,
};
