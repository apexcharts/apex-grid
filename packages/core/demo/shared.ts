// Shared helpers for the demo pages. Anything that needs to be the same
// across pages — random-data generators, the User type, the theme picker
// — lives here so individual pages stay focused on their feature.

import { configureTheme, IgcSelectComponent, IgcSwitchComponent } from 'igniteui-webcomponents';
import { html, type TemplateResult } from 'lit';

export type User = {
  id: number;
  name: string;
  age: number;
  subscribed: boolean;
  satisfaction: number;
  priority: string;
  email: string;
  avatar: string;
};

export const PRIORITY_CHOICES = ['low', 'standard', 'high'] as const;
export const THEMES = ['bootstrap', 'material', 'fluent', 'indigo'] as const;

function getRandomInt(max: number) {
  return Math.floor(Math.random() * max);
}

function oneOf<T>(collection: readonly T[]): T {
  return collection.at(getRandomInt(collection.length)) as T;
}

function getAvatar() {
  const [type, idx] = [getRandomInt(2) % 2 ? 'women' : 'men', getRandomInt(100)];
  return `https://static.infragistics.com/xplatform/images/people/${type}/${idx}.jpg`;
}

export function generateUsers(length: number): User[] {
  return Array.from(
    { length },
    (_, idx) =>
      ({
        id: idx,
        name: `User - ${getRandomInt(length)}`,
        age: getRandomInt(100),
        subscribed: Boolean(getRandomInt(2)),
        satisfaction: getRandomInt(5),
        priority: oneOf(PRIORITY_CHOICES),
        email: `user${idx}@org.com`,
        avatar: getAvatar(),
      }) as User
  );
}

function getElement<T>(qs: string): T {
  return document.querySelector(qs) as T;
}

/**
 * Applies a theme by hot-swapping the corresponding Ignite UI stylesheet.
 * Reads the current selector + dark-mode switch when no explicit theme is
 * supplied so the same function works for both initial load and user changes.
 */
export async function setTheme(theme?: string): Promise<void> {
  theme = theme ?? getElement<IgcSelectComponent>(IgcSelectComponent.tagName).value;
  const variant = getElement<IgcSwitchComponent>(IgcSwitchComponent.tagName).checked
    ? 'dark'
    : 'light';

  await import(
    /* @vite-ignore */
    `/node_modules/igniteui-webcomponents/themes/${variant}/${theme}.css?${Date.now()}`
  );

  Array.from(document.head.querySelectorAll('style[type="text/css"]'))
    .slice(0, -1)
    .forEach((s) => s.remove());

  configureTheme(theme as never);
}

/** Theme picker template used in the demo shell header. */
export function themePicker(): TemplateResult {
  return html`
    <div class="theme-picker">
      <igc-select
        value="bootstrap"
        outlined
        label="Choose theme"
        @igcChange=${({ detail }: { detail: { value: string } }) => setTheme(detail.value)}
      >
        ${THEMES.map(
          (theme) => html`<igc-select-item .value=${theme}>${theme}</igc-select-item>`
        )}
      </igc-select>
      <igc-switch label-position="after" @igcChange=${() => setTheme()}>Dark variant</igc-switch>
    </div>
  `;
}
