import { virtualize, virtualizerRef } from '@lit-labs/virtualizer/virtualize.js';
import { expect, fixture, fixtureCleanup, html } from '@open-wc/testing';
import { ApexGrid } from '../src/components/grid.js';
import { virtualizedRows } from '../src/components/virtualize-rows.js';
import type ApexVirtualizer from '../src/components/virtualizer.js';
import { settle } from './utils/settle.js';

// The body's rows directive subclasses upstream's unexported directive and
// reaches into its `Virtualizer` (src/components/virtualize-rows.ts). The
// package is pinned to an exact version; this suite fails as soon as an
// upgrade renames or drops anything the fork relies on, instead of the grid
// silently overlapping rows or never settling `layoutComplete`.
// See plans/core/2026-10-27-row-recycling-plan.md, sections 3.1, 3.5 and 12.

describe('virtualizer private API the rows directive relies on', () => {
  afterEach(() => fixtureCleanup());

  async function body(): Promise<ApexVirtualizer> {
    ApexGrid.register();
    const data = Array.from({ length: 50 }, (_, i) => ({ id: i }));
    const grid = await fixture<ApexGrid<{ id: number }>>(
      html`<apex-grid .data=${data} .columns=${[{ key: 'id' }]}></apex-grid>`
    );
    await settle(grid);
    return grid.renderRoot.querySelector('apex-virtualizer') as ApexVirtualizer;
  }

  it('exposes the upstream directive class on a directive result', () => {
    const result = virtualize() as unknown as { _$litDirective$?: { name: string } };
    expect(result._$litDirective$, '_$litDirective$').to.be.a('function');
    expect(result._$litDirective$!.name).to.equal('VirtualizeDirective');
  });

  it('keeps the directive fields the fork renders from', async () => {
    const rows = virtualizedRows(await body()) as unknown as Record<string, unknown>;
    expect(rows, 'the body renders through the fork').to.exist;
    expect(rows._first, '_first').to.be.a('number');
    expect(rows._last, '_last').to.be.a('number');
    expect(rows._items, '_items').to.be.an('array');
    expect(rows._renderItem, '_renderItem').to.be.a('function');
    expect(rows._keyFunction, '_keyFunction').to.be.a('function');
    expect(rows._virtualizer, '_virtualizer').to.be.an('object');
  });

  it('keeps the Virtualizer members the fork measures and settles through', async () => {
    const host = await body();
    const virtualizer = (host as unknown as Record<symbol, Record<string, unknown>>)[
      virtualizerRef
    ];
    expect(virtualizer, 'virtualizerRef').to.be.an('object');
    expect(virtualizerRef in host).to.equal(true);
    expect(virtualizer).to.equal(
      (virtualizedRows(host) as unknown as { _virtualizer: unknown })._virtualizer
    );
    expect(virtualizer._childrenRO, '_childrenRO').to.be.instanceOf(ResizeObserver);
    // On the prototype: the fork wraps `_scheduleLayoutComplete` per instance.
    const proto = Object.getPrototypeOf(virtualizer) as Record<string, unknown>;
    expect(proto._scheduleLayoutComplete, '_scheduleLayoutComplete').to.be.a('function');
    expect(proto._resolveLayoutCompletePromise, '_resolveLayoutCompletePromise').to.be.a(
      'function'
    );
    expect(proto._childrenSizeChanged, '_childrenSizeChanged').to.be.a('function');
    expect(String(proto._childrenSizeChanged)).to.contain('_scheduleLayoutComplete');
    // Slot mode measures re-bound rows synchronously through these two.
    expect(virtualizer._toBeMeasured, '_toBeMeasured').to.be.instanceOf(Map);
    expect(proto._measureChildren, '_measureChildren').to.be.a('function');
    expect(String(proto._measureChildren)).to.contain('_toBeMeasured');
    expect(virtualizer, '_layoutCompletePromise').to.have.property('_layoutCompletePromise');
    expect(virtualizer, '_pendingLayoutComplete').to.have.property('_pendingLayoutComplete');
    // Upstream creates the promise lazily from the getter and drops it once
    // settled; the fallback depends on both.
    const promise = host.layoutComplete;
    expect(virtualizer._layoutCompletePromise).to.equal(promise);
    await promise;
    expect(virtualizer._layoutCompletePromise).to.equal(null);
  });
});
