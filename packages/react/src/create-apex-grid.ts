'use client';

import type { ApexGrid as ApexGridElementClass, ApexGridEventMap } from 'apex-grid';
import type React from 'react';
import type { ApexGridEventProps } from './events.js';
import {
  type ApexGridAttributeProps,
  ApexGrid as ApexGridBase,
  type ApexGridSettableProp,
} from './generated/apex-grid.js';
import type { GridProps } from './grid-props.js';

/** The `<apex-grid>` custom-element instance, row-typed to `T`. */
export type ApexGridElement<T extends object> = ApexGridElementClass<T>;

/**
 * Props of the row-typed grid component returned by {@link createApexGrid}:
 * the grid's settable properties, its `theme` attribute, an `on<Event>`
 * handler per event typed with the row type `T`, standard HTML props, and a
 * `ref` to {@link ApexGridElement}. See {@link GridProps} for the rules.
 */
export type ApexGridProps<T extends object> = GridProps<
  ApexGridElement<T>,
  ApexGridEventMap<T>,
  ApexGridEventProps,
  ApexGridSettableProp,
  ApexGridAttributeProps
>;

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
