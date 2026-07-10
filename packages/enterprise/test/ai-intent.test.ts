import { expect } from '@open-wc/testing';
import { createIntentDetector, type GridContext } from '../src/features/ai/index.js';
import { makeApi, makeContext } from './ai-fixtures.js';

const detector = createIntentDetector();
let ctx: GridContext;

describe('AI reasoning layer — IntentDetector', () => {
  before(() => {
    ctx = makeContext(makeApi());
  });

  it('classifies sort with column and direction slots', () => {
    const intent = detector.detect('sort by amount descending', ctx);
    expect(intent.kind).to.equal('sort');
    expect(intent.confidence).to.be.greaterThan(0.7);
    expect(intent.slots.column?.text).to.equal('amount');
    expect(intent.slots.direction?.text).to.equal('descending');
  });

  it('classifies group and captures the column phrase', () => {
    const intent = detector.detect('group by region', ctx);
    expect(intent.kind).to.equal('group');
    expect(intent.slots.columns?.text).to.equal('region');
  });

  it('classifies filter with column, operator, and value', () => {
    const intent = detector.detect('filter region = EMEA', ctx);
    expect(intent.kind).to.equal('filter');
    expect(intent.slots.column?.text).to.equal('region');
    expect(intent.slots.operator?.text).to.equal('=');
    expect(intent.slots.value?.text).to.equal('EMEA');
  });

  it('classifies hide/show column (but not "show me ...")', () => {
    const hide = detector.detect('hide product', ctx);
    expect(hide.kind).to.equal('columns');
    expect(hide.slots.action?.text).to.equal('hide');
    expect(hide.slots.column?.text).to.equal('product');

    const showMe = detector.detect('show me the top sellers', ctx);
    expect(showMe.kind).to.not.equal('columns');
  });

  it('classifies a bare metric as the aggregate command, a metric question as analyze, a plain question as ask', () => {
    expect(detector.detect('sum of amount', ctx).kind).to.equal('aggregate');
    expect(detector.detect('what is the highest amount?', ctx).kind).to.equal('analyze');
    expect(detector.detect('how many rows are there?', ctx).kind).to.equal('ask');
  });

  it('classifies export with a format slot', () => {
    const intent = detector.detect('export to xlsx', ctx);
    expect(intent.kind).to.equal('export');
    expect(intent.slots.format?.text).to.equal('xlsx');
  });

  it('classifies pagination', () => {
    const intent = detector.detect('go to page 2', ctx);
    expect(intent.kind).to.equal('paginate');
    expect(intent.slots.page?.text).to.equal('2');
  });

  it('classifies reset, undo, ungroup, and sort-reverse', () => {
    expect(detector.detect('reset everything', ctx).kind).to.equal('reset');
    expect(detector.detect('undo', ctx).kind).to.equal('undo');
    expect(detector.detect('ungroup', ctx).kind).to.equal('ungroup');
    const reverse = detector.detect('reverse the sort', ctx);
    expect(reverse.kind).to.equal('sort');
    expect(reverse.slots.reverse).to.exist;
  });

  it('returns unknown with zero confidence for gibberish', () => {
    const intent = detector.detect('asdfqwer zxcv', ctx);
    expect(intent.kind).to.equal('unknown');
    expect(intent.confidence).to.equal(0);
  });

  it('captures raw slot offsets from the utterance', () => {
    const intent = detector.detect('sort by amount', ctx);
    const slot = intent.slots.column;
    expect(slot).to.exist;
    expect(intent.raw.slice(slot?.start, slot?.end)).to.equal('amount');
  });
});
