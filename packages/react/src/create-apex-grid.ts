'use client';

import type { ApexGrid as ApexGridElementClass, ApexGridEventMap } from 'apex-grid';
import type React from 'react';
import type { ApexGridEventProps } from './events.js';
import {
  type ApexGridAttributeProps,
  ApexGrid as ApexGridBase,
  type ApexGridSettableProp,
} from './generated/apex-grid.js';

/** The `<apex-grid>` custom-element instance, row-typed to `T`. */
export type ApexGridElement<T extends object> = ApexGridElementClass<T>;

/**
 * `on<Event>` handler props for `<apex-grid>`, keyed by the generated
 * prop-to-event map (the same naming rule the runtime wiring uses) and typed
 * from `ApexGridEventMap`, so they carry the row type `T` into every event
 * detail.
 */
type ApexGridEventHandlers<T extends object> = {
  [P in keyof ApexGridEventProps]?: (event: ApexGridEventMap<T>[ApexGridEventProps[P]]) => void;
};

/**
 * Props of the row-typed grid component returned by {@link createApexGrid}.
 *
 * Element props are limited to the settable properties the manifest lists
 * (`ApexGridSettableProp`): React assigns every prop to the element, so a
 * getter-only member such as `totalItems` would throw during commit and a
 * method name would replace the method on the instance. Standard HTML
 * attributes keep their React types unless the element defines the same name.
 *
 * The list is generated from the manifest of the apex-grid version this
 * package was built against, so it is intersected with the installed
 * element's own keys: on an older apex-grid in the peer range, a property
 * that version lacks drops out instead of breaking the declaration.
 */
export type ApexGridProps<T extends object> = Omit<
  React.DetailedHTMLProps<React.HTMLAttributes<ApexGridElement<T>>, ApexGridElement<T>>,
  keyof ApexGridEventHandlers<T> | Exclude<keyof ApexGridElement<T>, keyof HTMLElement> | 'ref'
> &
  Partial<Pick<ApexGridElement<T>, Extract<ApexGridSettableProp, keyof ApexGridElement<T>>>> &
  ApexGridEventHandlers<T> &
  ApexGridAttributeProps &
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
