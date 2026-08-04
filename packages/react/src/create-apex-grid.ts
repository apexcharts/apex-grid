import type { WebComponentProps } from '@lit/react';
import type { ApexGrid as ApexGridElementClass, ApexGridEventMap } from 'apex-grid';
import type React from 'react';
import { ApexGrid as ApexGridBase } from './generated/index.js';

/** The `<apex-grid>` custom-element instance, row-typed to `T`. */
export type ApexGridElement<T extends object> = ApexGridElementClass<T>;

/**
 * `on<Event>` handler props for `<apex-grid>`, derived straight from
 * `ApexGridEventMap` so they track the element's event contract automatically
 * and carry the row type `T` into every event detail.
 */
type ApexGridEventHandlers<T extends object> = {
  [K in keyof ApexGridEventMap<T> as `on${Capitalize<string & K>}`]?: (
    event: ApexGridEventMap<T>[K]
  ) => void;
};

/** Props of the row-typed grid component returned by {@link createApexGrid}. */
export type ApexGridProps<T extends object> = Omit<
  WebComponentProps<ApexGridElement<T>>,
  keyof ApexGridEventHandlers<T> | 'ref'
> &
  ApexGridEventHandlers<T> &
  React.RefAttributes<ApexGridElement<T>>;

/** The row-typed `<apex-grid>` React component type. */
export type ApexGridComponent<T extends object> = React.ForwardRefExoticComponent<ApexGridProps<T>>;

/**
 * Returns the `<apex-grid>` React wrapper typed to a specific row shape `T`:
 * `data` is `T[]`, `columns` is `ColumnConfiguration<T>[]`, every `on<Event>`
 * handler receives a detail generic over `T`, and a `ref` resolves to
 * `ApexGrid<T>`.
 *
 * The runtime component is the same one exported as {@link ApexGrid}; only the
 * types change, so this is a zero-cost retype (no wrapper component is created).
 *
 * @example
 * ```tsx
 * import { createApexGrid } from 'react-apex-grid';
 * import type { ColumnConfiguration } from 'apex-grid';
 *
 * interface User { id: number; name: string }
 * const UserGrid = createApexGrid<User>();
 *
 * <UserGrid
 *   data={users}
 *   columns={columns satisfies ColumnConfiguration<User>[]}
 *   onRowSelected={(e) => e.detail} // detail is ApexRowSelectedEvent<User>
 * />
 * ```
 */
export function createApexGrid<T extends object>(): ApexGridComponent<T> {
  return ApexGridBase as unknown as ApexGridComponent<T>;
}
