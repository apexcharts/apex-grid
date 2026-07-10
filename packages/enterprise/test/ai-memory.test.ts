import { expect } from '@open-wc/testing';
import {
  ConversationMemory,
  type ConversationTurn,
  emptyGridState,
} from '../src/features/ai/index.js';

/** Build a turn with sensible defaults so each test states only what it cares about. */
function turn(
  partial: Partial<ConversationTurn> & Pick<ConversationTurn, 'utterance' | 'outcome'>
): ConversationTurn {
  return { at: 0, ...partial };
}

describe('AI reasoning layer — Memory (ConversationMemory)', () => {
  it('records turns and returns them most-recent-last', () => {
    const memory = new ConversationMemory();
    memory.record(turn({ utterance: 'a', outcome: 'applied' }));
    memory.record(turn({ utterance: 'b', outcome: 'answered' }));
    expect(memory.snapshot().turns.map((t) => t.utterance)).to.deep.equal(['a', 'b']);
  });

  it('bounds retained turns to maxTurns, keeping the most recent', () => {
    const memory = new ConversationMemory({ maxTurns: 2 });
    memory.record(turn({ utterance: '1', outcome: 'applied' }));
    memory.record(turn({ utterance: '2', outcome: 'applied' }));
    memory.record(turn({ utterance: '3', outcome: 'applied' }));
    expect(memory.snapshot().turns.map((t) => t.utterance)).to.deep.equal(['2', '3']);
  });

  it('exposes the last applied control baseline for "undo"', () => {
    const memory = new ConversationMemory();
    const before = emptyGridState();
    memory.record(turn({ utterance: 'sort', outcome: 'applied', stateBefore: before }));
    memory.record(turn({ utterance: 'how many rows?', outcome: 'answered' }));
    expect(memory.snapshot().lastControlBefore).to.equal(before);
  });

  it('ignores non-applied turns when picking the undo baseline', () => {
    const memory = new ConversationMemory();
    memory.record(turn({ utterance: 'noop', outcome: 'no-op', stateBefore: emptyGridState() }));
    expect(memory.snapshot().lastControlBefore).to.be.undefined;
  });

  it('surfaces the most recent resolved entities for anaphora', () => {
    const memory = new ConversationMemory();
    memory.record(
      turn({ utterance: 'sort by amount', outcome: 'applied', entities: { columns: ['amount'] } })
    );
    memory.record(turn({ utterance: 'thanks', outcome: 'no-op' }));
    expect(memory.snapshot().lastEntities).to.deep.equal({ columns: ['amount'] });
  });

  it('clear() empties the conversation', () => {
    const memory = new ConversationMemory();
    memory.record(turn({ utterance: 'x', outcome: 'applied' }));
    memory.clear();
    expect(memory.snapshot().turns).to.be.empty;
  });
});
