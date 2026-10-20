import { expect, fixture, fixtureCleanup, html, nextFrame, waitUntil } from '@open-wc/testing';
import { ApexGrid } from '../src/components/grid.js';
import type { EditingController } from '../src/controllers/editing.js';
import type { EditCommand, HistoryController } from '../src/controllers/history.js';
import type { ColumnConfiguration } from '../src/internal/types.js';

// A command riding with a cell edit (a feature's state, such as an enterprise
// formula): it runs once the value is accepted, or when the row commits, joins
// the value's undo step and replays after it, and is dropped on a rejection or
// a cancelled row.

interface Row {
  id: number;
  amount: number;
  note: string;
}

const columns: ColumnConfiguration<Row>[] = [
  { key: 'id', type: 'number' },
  {
    key: 'amount',
    type: 'number',
    editable: true,
    validators: [(value: unknown) => (Number(value) >= 0 ? null : 'no negatives')],
  },
  { key: 'note', editable: true },
];

async function mount(mode: 'cell' | 'row' = 'cell') {
  ApexGrid.register();
  const parent = document.createElement('div');
  parent.style.height = '400px';
  const data: Row[] = [
    { id: 0, amount: 10, note: 'a' },
    { id: 1, amount: 20, note: 'b' },
  ];
  const grid = await fixture<ApexGrid<Row>>(
    html`<apex-grid
      .data=${data}
      .columns=${columns}
      .editing=${{ enabled: true, mode, history: { enabled: true } }}
    ></apex-grid>`,
    { parentNode: parent }
  );
  await grid.updateComplete;
  await nextFrame();
  await waitUntil(() => grid.rows.length > 0, 'body rows never rendered');
  const state = (
    grid as unknown as {
      stateController: { editing: EditingController<Row>; history: HistoryController<Row> };
    }
  ).stateController;
  return { grid, data, editing: state.editing, history: state.history };
}

/** A command logging its runs, reading the cell value when it runs. */
function tracked(data: Row[], log: string[], name = 'cmd'): EditCommand {
  return {
    apply: () => log.push(`${name}:apply@${data[0].amount}`),
    revert: () => log.push(`${name}:revert@${data[0].amount}`),
  };
}

describe('commands riding with a cell edit', () => {
  afterEach(() => fixtureCleanup());

  it('cell mode: runs after the write and undoes with it, value first', async () => {
    const { grid, data, editing } = await mount();
    const log: string[] = [];
    await editing.editCell(0, 'amount');
    expect(await editing.commitCell(15, tracked(data, log))).to.equal(true);
    expect(log).to.eql(['cmd:apply@15']);

    grid.undo();
    expect(data[0].amount).to.equal(10);
    expect(log.at(-1), 'reverted after the value').to.equal('cmd:revert@10');
    expect(grid.canUndo, 'one step').to.equal(false);

    grid.redo();
    expect(data[0].amount).to.equal(15);
    expect(log.at(-1), 'reapplied after the value').to.equal('cmd:apply@15');
  });

  it('cell mode: a rejected value drops the command', async () => {
    const { grid, data, editing } = await mount();
    const log: string[] = [];
    await editing.editCell(0, 'amount');
    expect(await editing.commitCell(-1, tracked(data, log))).to.equal(false);
    grid.addEventListener('cellValueChanging', (event) => event.preventDefault(), { once: true });
    expect(await editing.commitCell(5, tracked(data, log))).to.equal(false);
    expect(log).to.eql([]);
    expect(grid.canUndo).to.equal(false);
  });

  it('cell mode: an unchanged value still runs the command, undoably', async () => {
    const { grid, data, editing } = await mount();
    const log: string[] = [];
    await editing.editCell(0, 'amount');
    expect(await editing.commitCell(10, tracked(data, log))).to.equal(true);
    expect(log).to.eql(['cmd:apply@10']);
    expect(grid.canUndo).to.equal(true);
    grid.undo();
    expect(log.at(-1)).to.equal('cmd:revert@10');
  });

  it('row mode: staged with the row, run on commit as one undo step', async () => {
    const { grid, data, editing } = await mount('row');
    const log: string[] = [];
    const command = tracked(data, log);
    await editing.editCell(0, 'amount');
    await editing.commitCell(30, command);
    expect(editing.stagedEffect(data[0], 'amount')).to.equal(command);
    expect(log, 'not run while staged').to.eql([]);

    // A bare commit of the reopened cell keeps it staged.
    await editing.editCell(0, 'amount');
    await editing.commitCell();
    expect(editing.stagedEffect(data[0], 'amount')).to.equal(command);

    await editing.editCell(0, 'note');
    await editing.commitCell('z');
    expect(await editing.commitRow()).to.equal(true);
    expect(log).to.eql(['cmd:apply@30']);
    expect(editing.stagedEffect(data[0], 'amount')).to.equal(undefined);

    grid.undo();
    expect(data[0]).to.include({ amount: 10, note: 'a' });
    expect(log.at(-1)).to.equal('cmd:revert@10');
    expect(grid.canUndo, 'the row is one step').to.equal(false);
  });

  it('row mode: a cancelled row or a plain value drops the command', async () => {
    const { data, editing } = await mount('row');
    const log: string[] = [];
    await editing.editCell(0, 'amount');
    await editing.commitCell(30, tracked(data, log));
    editing.cancelRow();
    expect(editing.stagedEffect(data[0], 'amount')).to.equal(undefined);

    await editing.editCell(0, 'amount');
    await editing.commitCell(30, tracked(data, log));
    await editing.editCell(0, 'amount');
    await editing.commitCell(40);
    expect(editing.stagedEffect(data[0], 'amount')).to.equal(undefined);
    await editing.commitRow();
    expect(log).to.eql([]);
    expect(data[0].amount).to.equal(40);
  });

  it('history.push records a step of its own outside a batch', async () => {
    const { grid, data, history } = await mount();
    const log: string[] = [];
    grid.editing = { enabled: true };
    history.push(tracked(data, log));
    expect(grid.canUndo, 'no-op with history off').to.equal(false);
    grid.editing = { enabled: true, history: { enabled: true } };
    history.push(tracked(data, log));
    expect(grid.canUndo).to.equal(true);
    grid.undo();
    expect(log).to.eql(['cmd:revert@10']);
  });

  it("a reload that drops a command's record clears history", async () => {
    const { grid, data, editing } = await mount();
    await editing.editCell(0, 'amount');
    // A value left unchanged: the step holds only the command.
    await editing.commitCell(10, { ...tracked(data, []), record: data[0] });
    expect(grid.canUndo).to.equal(true);
    grid.data = data.map((row) => ({ ...row }));
    await grid.updateComplete;
    expect(grid.canUndo).to.equal(false);
  });

  it('row mode: stagedValue re-reads the staged row before validation', async () => {
    const { data, editing } = await mount('row');
    const log: string[] = [];
    await editing.editCell(0, 'amount');
    await editing.commitCell(5, {
      ...tracked(data, log),
      stagedValue: (staged) => (staged.get('note') === 'neg' ? -1 : 5),
    });
    await editing.editCell(0, 'note');
    await editing.commitCell('neg');
    expect(await editing.commitRow(), 'judged on the refreshed value').to.equal(false);
    expect(data[0].amount).to.equal(10);
    expect(log).to.eql([]);
  });
});
