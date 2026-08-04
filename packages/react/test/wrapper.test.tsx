import { expect } from '@open-wc/testing';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ApexGrid, createApexGrid } from '../src/index.js';

/** Mount a React node into a fresh container and let effects/microtasks flush. */
async function render(node: ReactNode): Promise<{ container: HTMLElement; root: Root }> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  root.render(node);
  await tick();
  return { container, root };
}

function tick(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  );
}

function cleanup(root: Root, container: HTMLElement): void {
  root.unmount();
  container.remove();
}

describe('react-apex-grid wrapper', () => {
  it('renders an <apex-grid> element into the DOM', async () => {
    const { container, root } = await render(<ApexGrid style={{ height: 300 }} />);
    const el = container.querySelector('apex-grid');
    expect(el).to.exist;
    expect(el?.tagName.toLowerCase()).to.equal('apex-grid');
    cleanup(root, container);
  });

  it('passes object props through as element properties (not attributes)', async () => {
    const data = [{ id: 1, name: 'a' }];
    const { container, root } = await render(<ApexGrid data={data} style={{ height: 300 }} />);
    const el = container.querySelector('apex-grid') as unknown as { data: unknown };
    expect(el.data).to.deep.equal(data);
    // Object props must be set as properties, never serialized to attributes.
    expect((el as unknown as Element).getAttribute('data')).to.equal(null);
    cleanup(root, container);
  });

  it('wires on<Event> handler props to the element custom events', async () => {
    let detail: unknown = null;
    const { container, root } = await render(
      <ApexGrid
        style={{ height: 300 }}
        onRowSelected={(e) => {
          detail = e.detail;
        }}
      />
    );
    const el = container.querySelector('apex-grid')!;
    el.dispatchEvent(new CustomEvent('rowSelected', { detail: { rows: [1, 2] } }));
    await tick();
    expect(detail).to.deep.equal({ rows: [1, 2] });
    cleanup(root, container);
  });

  it('createApexGrid<T>() renders the same element with the same wiring', async () => {
    const Grid = createApexGrid<{ id: number }>();
    let sorted = false;
    const data = [{ id: 1 }];
    const { container, root } = await render(
      <Grid
        data={data}
        style={{ height: 300 }}
        onSorted={() => {
          sorted = true;
        }}
      />
    );
    const el = container.querySelector('apex-grid') as unknown as { data: unknown };
    expect(el).to.exist;
    expect(el.data).to.deep.equal(data);
    (el as unknown as Element).dispatchEvent(new CustomEvent('sorted', { detail: {} }));
    await tick();
    expect(sorted).to.be.true;
    cleanup(root, container);
  });

  it('forwards ref to the underlying custom element', async () => {
    let node: Element | null = null;
    const { container, root } = await render(
      <ApexGrid
        style={{ height: 300 }}
        ref={(el) => {
          node = el as unknown as Element;
        }}
      />
    );
    expect(node).to.exist;
    expect(node!.tagName.toLowerCase()).to.equal('apex-grid');
    cleanup(root, container);
  });
});
