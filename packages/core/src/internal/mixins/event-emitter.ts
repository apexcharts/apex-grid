import { LitElement } from 'lit';

export type UnpackCustomEvent<T> = T extends CustomEvent<infer U> ? U : never;

export class EventEmitterBase<E> extends LitElement {
  public override addEventListener<K extends keyof M, M extends E & HTMLElementEventMap>(
    type: K,
    listener: (this: HTMLElement, ev: M[K]) => any,
    options?: boolean | AddEventListenerOptions
  ): void;
  public override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): void {
    super.addEventListener(type, listener, options);
  }

  public override removeEventListener<K extends keyof M, M extends E & HTMLElementEventMap>(
    type: K,
    listener: (this: HTMLElement, ev: M[K]) => any,
    options?: boolean | EventListenerOptions
  ): void;
  public override removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions
  ): void {
    super.removeEventListener(type, listener, options);
  }
  public emitEvent<K extends keyof E, D extends UnpackCustomEvent<E[K]>>(
    type: K,
    eventInitDict?: CustomEventInit<D>
  ): boolean {
    return this.dispatchEvent(
      new CustomEvent<D>(
        type as string,
        Object.assign(
          {
            bubbles: true,
            cancelable: false,
            composed: true,
            detail: {},
          },
          eventInitDict
        )
      )
    );
  }
}
