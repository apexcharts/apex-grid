import { expect, fixture, fixtureCleanup, html } from '@open-wc/testing';
import type { ReactiveController } from 'lit';
import { ApexGrid } from '../src/components/grid.js';
import { StateController } from '../src/controllers/state.js';
import type { GridFeatureModule } from '../src/internal/feature-module.js';
import type { GridHost } from '../src/internal/types.js';
import data, { type TestData } from './utils/test-data.js';

/** Reaches the protected `stateController` field for assertions. */
function stateOf<T extends object>(grid: ApexGrid<T>): StateController<T> {
  return (grid as unknown as { stateController: StateController<T> }).stateController;
}

describe('Feature module seam', () => {
  afterEach(() => fixtureCleanup());

  it('community grid registers zero feature modules (behaviour unchanged)', async () => {
    ApexGrid.register();
    const grid = await fixture<ApexGrid<TestData>>(html`<apex-grid .data=${data}></apex-grid>`);
    const state = stateOf(grid);

    expect(state.modules.size).to.equal(0);
    expect(state.module('anything')).to.be.undefined;

    // Built-in controllers remain wired exactly as before.
    for (const key of [
      'sorting',
      'filtering',
      'navigation',
      'resizing',
      'pagination',
      'reordering',
      'editing',
      'selection',
      'expansion',
      'tree',
    ] as const) {
      expect(state[key], `built-in controller "${key}"`).to.exist;
    }
  });

  it('injected module is constructed and retrievable via module(id)', async () => {
    let created = 0;
    let registeredWithHost = false;

    class DummyController implements ReactiveController {
      constructor(host: GridHost<TestData>) {
        created += 1;
        host.addController(this);
        registeredWithHost = true;
      }
      hostConnected() {}
    }

    const dummyModule: GridFeatureModule<TestData> = {
      id: 'dummy',
      create: (host) => new DummyController(host),
    };

    class SeamTestGrid<T extends object> extends ApexGrid<T> {
      public static override get tagName() {
        return 'apex-grid-seam-test';
      }
      public static override register() {
        if (!customElements.get(SeamTestGrid.tagName)) {
          customElements.define(SeamTestGrid.tagName, SeamTestGrid);
        }
      }
      protected override createStateController(): StateController<T> {
        return new StateController<T>(this, [dummyModule as unknown as GridFeatureModule<T>]);
      }
    }

    SeamTestGrid.register();
    const grid = await fixture<SeamTestGrid<TestData>>(
      html`<apex-grid-seam-test .data=${data}></apex-grid-seam-test>`
    );
    const state = stateOf(grid);

    expect(created, 'module.create called exactly once').to.equal(1);
    expect(registeredWithHost, 'controller registered with host').to.be.true;
    expect(state.modules.size).to.equal(1);
    expect(state.module('dummy')).to.be.instanceOf(DummyController);

    // Built-in controllers still present alongside the injected module.
    expect(state.sorting).to.exist;
    expect(state.tree).to.exist;
  });
});
