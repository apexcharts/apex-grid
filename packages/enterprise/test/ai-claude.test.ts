import { expect } from '@open-wc/testing';
import type { GridSchema, GridState } from 'apex-grid';
import type { AIRequest } from '../src/features/ai.js';
import {
  buildAskRequest,
  buildControlRequest,
  type ClaudeClient,
  type ClaudeMessage,
  createClaudeAdapter,
  extractAnswer,
  extractPatch,
} from '../src/features/ai-claude.js';
import { toJSONSchema } from '../src/features/ai-schema.js';

function makeState(): GridState {
  return {
    version: 1,
    columns: [],
    sort: [],
    filter: [],
    quickFilter: '',
    pagination: { page: 0, pageSize: 10 },
    selection: [],
    expansion: [],
    treeExpanded: [],
    treeExpandedKeys: [],
    modules: {},
  };
}

function makeSchema(): GridSchema {
  return {
    version: 1,
    columns: [
      {
        key: 'region',
        label: 'Region',
        dataType: 'string',
        sortable: true,
        filterable: true,
        filterOperands: ['contains', 'equals'],
        editable: false,
        hidden: false,
        groupable: true,
        pivotable: true,
        aggregatable: false,
      },
      {
        key: 'amount',
        label: 'Amount',
        dataType: 'number',
        sortable: true,
        filterable: true,
        filterOperands: ['equals', 'greaterThan'],
        editable: false,
        hidden: false,
        groupable: true,
        pivotable: true,
        aggregatable: true,
        aggFuncs: ['sum', 'avg'],
      },
    ],
    capabilities: {
      sort: { directions: ['ascending', 'descending'], multi: true },
      filter: {
        operandsByType: { string: ['contains', 'equals'], number: ['equals', 'greaterThan'] },
      },
      pagination: false,
      selection: false,
      rowPinning: false,
      rowReordering: false,
      grouping: true,
      pivot: true,
      aggregation: { funcs: ['sum', 'avg', 'min', 'max', 'count'] },
    },
    state: makeState(),
  };
}

function makeRequest(overrides: Partial<AIRequest> = {}): AIRequest {
  return { schema: makeSchema(), prompt: 'do it', mode: 'control', ...overrides };
}

describe('AI Toolkit — Claude reference adapter', () => {
  // --- config validation --------------------------------------------------

  it('requires an endpoint or an acknowledged apiKey', () => {
    expect(() => createClaudeAdapter({})).to.throw(/endpoint|apiKey/);
    expect(() => createClaudeAdapter({ apiKey: 'sk-test' })).to.throw(/dangerouslyAllowBrowser/);
    expect(() => createClaudeAdapter({ endpoint: '/api/grid-ai' })).to.not.throw();
    expect(() =>
      createClaudeAdapter({ apiKey: 'sk-test', dangerouslyAllowBrowser: true })
    ).to.not.throw();
  });

  // --- proxy transport ----------------------------------------------------

  it('proxy transport posts the request and maps the response', async () => {
    let captured: { url: string; body: unknown } | null = null;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      captured = { url, body: JSON.parse(String(init.body)) };
      return { ok: true, json: async () => ({ patch: { quickFilter: 'hub' } }) };
    }) as unknown as typeof fetch;

    const adapter = createClaudeAdapter({ endpoint: '/api/grid-ai', fetch: fakeFetch });
    const result = await adapter(makeRequest({ prompt: 'search hub', data: [{ region: 'X' }] }));

    expect(result.patch).to.deep.equal({ quickFilter: 'hub' });
    expect(captured!.url).to.equal('/api/grid-ai');
    const body = captured!.body as {
      prompt: string;
      mode: string;
      schema: GridSchema;
      data: unknown[];
    };
    expect(body.prompt).to.equal('search hub');
    expect(body.mode).to.equal('control');
    expect(body.schema.columns).to.have.lengthOf(2);
    expect(body.data).to.deep.equal([{ region: 'X' }]);
  });

  it('proxy transport throws on a non-ok response', async () => {
    const fakeFetch = (async () => ({ ok: false, status: 502 })) as unknown as typeof fetch;
    const adapter = createClaudeAdapter({ endpoint: '/api', fetch: fakeFetch });
    let threw = false;
    try {
      await adapter(makeRequest({ mode: 'ask' }));
    } catch (error) {
      threw = true;
      expect(String(error)).to.include('502');
    }
    expect(threw).to.be.true;
  });

  // --- direct transport via injected client -------------------------------

  it('control mode forces the tool and maps the tool input to a patch', async () => {
    let sent: Record<string, unknown> | null = null;
    const client: ClaudeClient = {
      messages: {
        create: async (body) => {
          sent = body as unknown as Record<string, unknown>;
          return {
            content: [
              {
                type: 'tool_use',
                name: 'apply_grid_state',
                input: { sort: [{ key: 'amount', direction: 'descending' }] },
              },
            ],
            stop_reason: 'tool_use',
          };
        },
      },
    };
    const adapter = createClaudeAdapter({ client });
    const result = await adapter(makeRequest({ prompt: 'sort by amount' }));

    expect(result.patch).to.deep.equal({ sort: [{ key: 'amount', direction: 'descending' }] });
    const tools = sent!.tools as Array<{ name: string }>;
    expect(tools[0].name).to.equal('apply_grid_state');
    expect(sent!.tool_choice).to.deep.equal({ type: 'tool', name: 'apply_grid_state' });
  });

  it('ask mode sends no tools and maps text to an answer', async () => {
    let sent: Record<string, unknown> | null = null;
    const client: ClaudeClient = {
      messages: {
        create: async (body) => {
          sent = body as unknown as Record<string, unknown>;
          return {
            content: [{ type: 'text', text: 'There are 8 rows.' }],
            stop_reason: 'end_turn',
          };
        },
      },
    };
    const adapter = createClaudeAdapter({ client });
    const result = await adapter(makeRequest({ prompt: 'how many rows?', mode: 'ask' }));

    expect(result.answer).to.equal('There are 8 rows.');
    expect(sent!.tools).to.be.undefined;
  });

  it('throws when the model refuses', async () => {
    const client: ClaudeClient = {
      messages: {
        create: async () => ({
          content: [],
          stop_reason: 'refusal',
          stop_details: { explanation: 'policy' },
        }),
      },
    };
    const adapter = createClaudeAdapter({ client });
    let threw = false;
    try {
      await adapter(makeRequest());
    } catch (error) {
      threw = true;
      expect(String(error)).to.include('declined');
    }
    expect(threw).to.be.true;
  });

  // --- pure helpers -------------------------------------------------------

  it('buildControlRequest wires model, tool schema, and context', () => {
    const request = makeRequest({ data: [{ region: 'EMEA', amount: 10 }] });
    const body = buildControlRequest(request, {});

    expect(body.model).to.equal('claude-opus-4-8');
    const tool = body.tools?.[0] as { name: string; input_schema: unknown };
    expect(tool.name).to.equal('apply_grid_state');
    expect(tool.input_schema).to.deep.equal(toJSONSchema(request.schema));
    expect(String(body.system)).to.include('Amount'); // schema JSON
    expect(String(body.system)).to.include('Current rows'); // data sample
    expect(buildControlRequest(request, { model: 'claude-sonnet-4-6' }).model).to.equal(
      'claude-sonnet-4-6'
    );
  });

  it('buildAskRequest omits tools; maxDataRows: 0 drops the data block', () => {
    const request = makeRequest({ mode: 'ask', data: [{ region: 'EMEA' }] });
    const body = buildAskRequest(request, { maxDataRows: 0 });
    expect(body.tools).to.be.undefined;
    expect(String(body.system)).to.not.include('Current rows');
  });

  it('extractPatch reads the tool_use input; extractAnswer joins text', () => {
    const withTool: ClaudeMessage = {
      content: [
        { type: 'text', text: 'sure' },
        { type: 'tool_use', name: 'apply_grid_state', input: { quickFilter: 'x' } },
      ],
    };
    expect(extractPatch(withTool)).to.deep.equal({ quickFilter: 'x' });
    // falls back to any tool_use block
    expect(
      extractPatch({ content: [{ type: 'tool_use', name: 'other', input: { quickFilter: 'z' } }] })
    ).to.deep.equal({
      quickFilter: 'z',
    });
    expect(
      extractAnswer({
        content: [
          { type: 'text', text: 'Hello ' },
          { type: 'text', text: 'world' },
        ],
      })
    ).to.equal('Hello world');
  });
});
