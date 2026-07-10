import { expect } from '@open-wc/testing';
import {
  type AIMode,
  buildAskRequest,
  buildControlRequest,
  type ClaudeClient,
  type ClaudeMessage,
  ConversationMemory,
  createAIEngine,
  createClaudeReasoner,
  createContextBuilder,
  createDefaultRegistry,
  createRuleBasedReasoner,
  createToolExecutor,
  extractAnswer,
  extractPatch,
  type GridApi,
} from '../src/features/ai/index.js';
import { enterpriseSchema, makeApi, type Row } from './ai-fixtures.js';

/** A stub Anthropic client that always returns a fixed message. */
function clientReturning(message: ClaudeMessage): ClaudeClient {
  return { messages: { create: () => Promise.resolve(message) } };
}

function ctxWith(api: GridApi<Row>, requestedMode?: AIMode) {
  return createContextBuilder<Row>().build(api, new ConversationMemory(), { requestedMode });
}

const runPlan = (
  api: GridApi<Row>,
  ctx: ReturnType<typeof ctxWith>,
  plan: Parameters<ReturnType<typeof createToolExecutor>['run']>[0]
) => createToolExecutor(createDefaultRegistry()).run(plan, { api, ctx });

describe('AI reasoning layer — createClaudeReasoner (direct transport)', () => {
  it('turns a tool-use patch into an applyState step and applies it', async () => {
    const client = clientReturning({
      content: [
        {
          type: 'tool_use',
          name: 'apply_grid_state',
          input: { sort: [{ key: 'amount', direction: 'descending' }] },
        },
      ],
    });
    const reasoner = createClaudeReasoner({ client });
    const api = makeApi();
    const ctx = ctxWith(api, 'control');

    const plan = await reasoner.reason('sort by amount, highest first', ctx);
    expect(plan.source).to.equal('llm:claude');
    expect(plan.steps[0]?.tool).to.equal('applyState');

    runPlan(api, ctx, plan);
    expect(api.getState().sort).to.deep.equal([{ key: 'amount', direction: 'descending' }]);
  });

  it('returns the model text answer in ask mode', async () => {
    const client = clientReturning({
      content: [{ type: 'text', text: 'The total Amount is 60.' }],
    });
    const reasoner = createClaudeReasoner({ client });
    const plan = await reasoner.reason('what is the total amount?', ctxWith(makeApi(), 'ask'));
    expect(plan.mode).to.equal('ask');
    expect(plan.answer).to.equal('The total Amount is 60.');
  });

  it('rejects when the model refuses', async () => {
    const client = clientReturning({
      content: [],
      stop_reason: 'refusal',
      stop_details: { explanation: 'nope' },
    });
    const reasoner = createClaudeReasoner({ client });
    let threw = false;
    try {
      await reasoner.reason('do something disallowed', ctxWith(makeApi(), 'control'));
    } catch (error) {
      threw = true;
      expect(String((error as Error).message)).to.contain('declined');
    }
    expect(threw, 'expected the refusal to reject').to.be.true;
  });
});

describe('AI reasoning layer — createClaudeReasoner (proxy transport)', () => {
  it('POSTs { prompt, mode, schema, data } and applies the returned patch', async () => {
    const bodies: string[] = [];
    const stubFetch = ((_url: string, init: { body: string }) => {
      bodies.push(init.body);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ patch: { quickFilter: 'proxied' } }),
      });
    }) as unknown as typeof fetch;

    const reasoner = createClaudeReasoner({ endpoint: '/api/grid-ai', fetch: stubFetch });
    const api = makeApi();
    const ctx = ctxWith(api, 'control');

    const plan = await reasoner.reason('search for proxied', ctx);
    runPlan(api, ctx, plan);
    expect(api.getState().quickFilter).to.equal('proxied');

    const sent = JSON.parse(bodies[0] ?? '{}');
    expect(Object.keys(sent).sort()).to.deep.equal(['data', 'mode', 'prompt', 'schema']);
    expect(sent.mode).to.equal('control');
    expect(sent.data).to.have.lengthOf(3);
  });

  it('throws when the proxy responds with an error status', async () => {
    const stubFetch = (() =>
      Promise.resolve({ ok: false, status: 500 })) as unknown as typeof fetch;
    const reasoner = createClaudeReasoner({ endpoint: '/api/grid-ai', fetch: stubFetch });
    let threw = false;
    try {
      await reasoner.reason('anything', ctxWith(makeApi(), 'control'));
    } catch (error) {
      threw = true;
      expect(String((error as Error).message)).to.contain('500');
    }
    expect(threw).to.be.true;
  });
});

describe('AI reasoning layer — Claude request building and extraction', () => {
  it('buildControlRequest uses the grid JSON schema as input_schema and forces the tool', () => {
    const request = buildControlRequest(
      { prompt: 'x', mode: 'control', schema: enterpriseSchema },
      {}
    );
    const tool = request.tools?.[0] as {
      name: string;
      input_schema: { properties?: Record<string, unknown> };
    };
    expect(tool.name).to.equal('apply_grid_state');
    expect(request.tool_choice).to.deep.equal({ type: 'tool', name: 'apply_grid_state' });
    expect(tool.input_schema.properties).to.have.property('sort');
    expect(tool.input_schema.properties).to.have.property('quickFilter');
  });

  it('buildAskRequest is a plain, read-only message with no tools', () => {
    const request = buildAskRequest({ prompt: 'x', mode: 'ask', schema: enterpriseSchema }, {});
    expect(request.tools).to.be.undefined;
    expect(String(request.system)).to.contain('read-only');
  });

  it('extractPatch reads the named tool_use, falls back to any tool_use, else {}', () => {
    expect(
      extractPatch({
        content: [{ type: 'tool_use', name: 'apply_grid_state', input: { quickFilter: 'a' } }],
      })
    ).to.deep.equal({ quickFilter: 'a' });
    expect(
      extractPatch({ content: [{ type: 'tool_use', name: 'other', input: { quickFilter: 'b' } }] })
    ).to.deep.equal({ quickFilter: 'b' });
    expect(extractPatch({ content: [{ type: 'text', text: 'no tool' }] })).to.deep.equal({});
  });

  it('extractAnswer concatenates and trims text blocks', () => {
    expect(
      extractAnswer({
        content: [
          { type: 'text', text: '  Hello ' },
          { type: 'text', text: 'world  ' },
        ],
      })
    ).to.equal('Hello world');
  });
});

describe('AI reasoning layer — createClaudeReasoner (config validation + wiring)', () => {
  it('requires a transport and gates a browser apiKey behind an acknowledgement', () => {
    expect(() => createClaudeReasoner({})).to.throw(/needs an endpoint/i);
    expect(() => createClaudeReasoner({ apiKey: 'sk-x' })).to.throw(/dangerouslyAllowBrowser/);
    expect(() =>
      createClaudeReasoner({ apiKey: 'sk-x', dangerouslyAllowBrowser: true })
    ).to.not.throw();
    expect(() => createClaudeReasoner({ endpoint: '/x' })).to.not.throw();
    expect(() => createClaudeReasoner({ client: clientReturning({ content: [] }) })).to.not.throw();
  });

  it('escalates from the rule engine to Claude through the engine', async () => {
    const client = clientReturning({
      content: [{ type: 'tool_use', name: 'apply_grid_state', input: { quickFilter: 'llm' } }],
    });
    const api = makeApi();
    const engine = createAIEngine<Row>(api, {
      reasoners: [createRuleBasedReasoner(), createClaudeReasoner({ client })],
    });
    const result = await engine.runPrompt('frobnicate the xyzzy widget immediately');
    expect(result.plan.source).to.equal('llm:claude');
    expect(api.getState().quickFilter).to.equal('llm');
  });
});
