'use client';

import type {
  ApexGridEnterprise as ApexGridEnterpriseElementClass,
  ApexGridEnterpriseEventMap,
} from 'apex-grid-enterprise';
import type React from 'react';
import {
  type ApexGridEnterpriseAttributeProps,
  ApexGridEnterprise as ApexGridEnterpriseBase,
  type ApexGridEnterpriseSettableProp,
} from '../generated/enterprise/apex-grid-enterprise.js';
import type { ApexGridEnterpriseEventProps } from '../generated/enterprise/events.js';
import type { GridProps } from '../grid-props.js';

/** The `<apex-grid-enterprise>` custom-element instance, row-typed to `T`. */
export type ApexGridEnterpriseElement<T extends object> = ApexGridEnterpriseElementClass<T>;

/**
 * Props of the row-typed enterprise grid returned by
 * {@link createApexGridEnterprise}: the grid's settable properties (its own
 * and the ones it inherits from `<apex-grid>`), its `theme` attribute, an
 * `on<Event>` handler per community and enterprise event typed with the row
 * type `T`, standard HTML props, and a `ref` to
 * {@link ApexGridEnterpriseElement}.
 *
 * As with `ApexGridProps`, the settable list comes from the manifest this
 * package was built against and is intersected with the installed element's
 * keys, so an older `apex-grid-enterprise` in the peer range drops a property
 * it lacks instead of breaking the declaration.
 */
export type ApexGridEnterpriseProps<T extends object> = GridProps<
  ApexGridEnterpriseElement<T>,
  ApexGridEnterpriseEventMap<T>,
  ApexGridEnterpriseEventProps,
  ApexGridEnterpriseSettableProp,
  ApexGridEnterpriseAttributeProps
>;

/** The row-typed `<apex-grid-enterprise>` React component type. */
export type ApexGridEnterpriseComponent<T extends object> = React.ForwardRefExoticComponent<
  ApexGridEnterpriseProps<T>
>;

/**
 * Returns the `<apex-grid-enterprise>` React wrapper typed to a specific row
 * shape `T`: `data` is `T[]`, `columns` is `ColumnConfiguration<T>[]`, every
 * `on<Event>` handler receives a detail generic over `T`, and a `ref`
 * resolves to `ApexGridEnterprise<T>`.
 *
 * The runtime component is the same one exported as {@link ApexGridEnterprise};
 * only the types change, so this is a zero-cost retype.
 *
 * @example
 * ```tsx
 * import { createApexGridEnterprise } from 'react-apex-grid/enterprise';
 *
 * interface Sale { region: string; amount: number }
 * const SalesGrid = createApexGridEnterprise<Sale>();
 *
 * <SalesGrid
 *   data={sales}
 *   columns={[{ key: 'region' }, { key: 'amount', type: 'number' }]}
 *   groupBy={['region']}
 *   onApexRangeChanged={(e) => e.detail.stats}
 * />
 * ```
 */
export function createApexGridEnterprise<T extends object>(): ApexGridEnterpriseComponent<T> {
  return ApexGridEnterpriseBase as unknown as ApexGridEnterpriseComponent<T>;
}
