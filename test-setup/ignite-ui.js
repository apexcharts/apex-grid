// Ignite UI fixture sheets for the theming specs of both packages
// (`ignite-ui-sheets.js`), and colour comparison by the browser's own
// resolution.

import { IGNITE_UI_SHEETS } from './ignite-ui-sheets.js';

/**
 * Loads a fixture sheet into the document head, replacing the one loaded
 * before; `null` removes it.
 *
 * @param {string | null} name
 */
export async function loadIgniteSheet(name) {
  document.getElementById('ig-sheet')?.remove();
  if (!name) return;
  const text = IGNITE_UI_SHEETS[name];
  if (text === undefined) throw new Error(`No Ignite UI fixture sheet "${name}".`);
  const style = document.createElement('style');
  style.id = 'ig-sheet';
  style.textContent = text;
  document.head.append(style);
}

/**
 * The computed colour of a CSS colour value (a token chain, `var()`, any
 * syntax), resolved in `at` (its shadow root when it has one).
 *
 * @param {string} value
 * @param {Element} [at]
 */
export function resolveColor(value, at = document.body) {
  const probe = document.createElement('span');
  probe.style.color = value;
  (at.shadowRoot ?? at).append(probe);
  const out = getComputedStyle(probe).color;
  probe.remove();
  return out;
}
