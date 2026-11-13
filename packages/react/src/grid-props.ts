import type React from 'react';

/**
 * `on<Event>` handler props for a grid element, keyed by the generated
 * prop-to-event map (the same naming rule the runtime wiring uses) and typed
 * from the element's event map, so a row-typed map carries the row type into
 * every event detail.
 */
export type GridEventHandlers<Events, EventProps extends Record<string, keyof Events>> = {
  [P in keyof EventProps]?: (event: Events[EventProps[P]]) => void;
};

/**
 * Props of a row-typed grid component (`createApexGrid<T>()`,
 * `createApexGridEnterprise<T>()`), for the grid element `Element`.
 *
 * Element props are limited to the settable properties the manifest lists
 * (`Settable`): React assigns every prop to the element, so a getter-only
 * member such as `totalItems` would throw during commit and a method name
 * would replace the method on the instance. Standard HTML attributes keep
 * their React types unless the element defines the same name.
 *
 * The list is generated from the manifest of the version this package was
 * built against, so it is intersected with the installed element's own keys:
 * on an older version in the peer range, a property that version lacks drops
 * out instead of breaking the declaration.
 */
export type GridProps<
  Element extends HTMLElement,
  Events,
  EventProps extends Record<string, keyof Events>,
  Settable extends string,
  Attributes,
> = Omit<
  React.DetailedHTMLProps<React.HTMLAttributes<Element>, Element>,
  keyof EventProps | Exclude<keyof Element, keyof HTMLElement> | 'ref'
> &
  Partial<Pick<Element, Extract<Settable, keyof Element>>> &
  GridEventHandlers<Events, EventProps> &
  Attributes &
  React.RefAttributes<Element>;
