import type Anthropic from '@anthropic-ai/sdk';
import { expect } from '@open-wc/testing';
import * as ai from '../src/features/ai/index.js';
import * as enterprise from '../src/index.js';
import {
  buildAskRequest,
  buildControlRequest,
  type ClaudeClient,
  type ClaudeRequest,
  type GridApi,
  type LLMRequest,
} from '../src/index.js';
import { enterpriseSchema } from './ai-fixtures.js';
import { createFakeGridApi } from './helpers/fake-grid-api.js';

// Batch B74: apex-grid-enterprise 0.10.0 removals (ent-ai-context-api-7,
// ent-ai-llm-reasoners-10) and SDK-free Claude reasoner declarations
// (ent-ai-llm-reasoners-8).

// ent-ai-context-api-7: the unimplemented optional actions are gone from the facade.
type RemovedActions = Extract<keyof GridApi, 'editCell' | 'renderChart'>;
export const noRemovedActions: [RemovedActions] extends [never] ? true : false = true;

// ent-ai-context-api-7: their argument types are gone from the public entry.
// @ts-expect-error CellTarget was removed in apex-grid-enterprise 0.10.0
export type RemovedCellTarget = import('../src/index.js').CellTarget;
// @ts-expect-error ChartRequest was removed in apex-grid-enterprise 0.10.0
export type RemovedChartRequest = import('../src/index.js').ChartRequest;
// ent-ai-llm-reasoners-10: the test double's seed type is gone too.
// @ts-expect-error FakeGridApiInit was removed in apex-grid-enterprise 0.10.0
export type RemovedFakeInit = import('../src/index.js').FakeGridApiInit<unknown>;

// ent-ai-llm-reasoners-8: the declarations no longer name the SDK, yet the real
// client still fits ClaudeClient and accepts the built requests as the
// non-streaming create overload (these are only type-checked, never called).
// These three checks run against the workspace dev SDK only (0.106.0), so they
// prove nothing for the rest of the supported peer range; olderSdkFits below
// stands in for releases before 0.73.0.
export const sdkClientFits = (sdk: Anthropic): ClaudeClient => sdk;
export const sdkTakesControl = (sdk: Anthropic, request: LLMRequest): Promise<Anthropic.Message> =>
  sdk.messages.create(buildControlRequest(request, {}));
export const sdkTakesAsk = (sdk: Anthropic, request: LLMRequest): Promise<Anthropic.Message> =>
  sdk.messages.create(buildAskRequest(request, {}));

// A client shaped like an SDK release before 0.73.0, whose params type has no
// adaptive thinking (and so no assignability to ClaudeRequest either way),
// still fits ClaudeClient: create only promises the fields all releases share.
interface OlderSdkParams {
  model: string;
  max_tokens: number;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string | Array<{ type: 'text'; text: string }>;
  }>;
  system?: string;
  thinking?: { type: 'enabled'; budget_tokens: number } | { type: 'disabled' };
  stream?: false;
}
interface OlderSdk {
  messages: {
    create(
      body: OlderSdkParams,
      options?: { signal?: AbortSignal; timeout?: number }
    ): Promise<{ content: Array<{ type: 'text'; text: string }>; stop_reason: string | null }>;
  };
}
export const olderSdkFits = (sdk: OlderSdk): ClaudeClient => sdk;
// A stub may still read the built request's fields by annotating the body.
export const stubFits: ClaudeClient = {
  messages: {
    create: async (body: ClaudeRequest) => ({ content: [{ type: 'text', text: body.system }] }),
  },
};

describe('enterprise 0.10.0 removals (B74)', () => {
  it('createFakeGridApi is no longer exported from the package or the AI barrel', () => {
    expect('createFakeGridApi' in enterprise).to.equal(false);
    expect('createFakeGridApi' in ai).to.equal(false);
    // The facade itself and its real adapter stay public.
    expect(enterprise.gridApiFor).to.be.a('function');
    expect(enterprise.emptyGridState).to.be.a('function');
  });

  it('the test-only fake still drives the AI layer', () => {
    const api = createFakeGridApi({ schema: enterpriseSchema, data: [{ a: 1 }] });
    expect(api.getData()).to.eql([{ a: 1 }]);
    api.applyState({ quickFilter: 'x' });
    expect(api.calls).to.eql([{ quickFilter: 'x' }]);
    expect(api.getState().quickFilter).to.equal('x');
    expect(api.getDirection).to.equal(undefined);
  });

  it('the built requests keep the shape the Messages API expects', () => {
    const request: LLMRequest = {
      prompt: 'sort by amount',
      mode: 'control',
      schema: enterpriseSchema,
    };
    const control = buildControlRequest(request, { model: 'm', maxTokens: 10 });
    expect(control.model).to.equal('m');
    expect(control.max_tokens).to.equal(10);
    expect(control.thinking).to.eql({ type: 'adaptive' });
    expect(control.tool_choice).to.eql({ type: 'auto' });
    expect(control.tools?.[0].input_schema.type).to.equal('object');
    expect(control.messages).to.eql([
      { role: 'user', content: [{ type: 'text', text: 'sort by amount' }] },
    ]);
    const ask = buildAskRequest({ ...request, mode: 'ask' }, {});
    expect(ask.tools).to.equal(undefined);
    expect(ask.system).to.be.a('string');
  });
});
