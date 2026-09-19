/**
 * Claude reconstruction adapter — request/response shaping contract (plan WS2).
 *
 * Locks the claude-opus-4-8 request surface produced by the edge adapter:
 * multimodal conversion, native PDF documents, strict tool output, prompt-cache
 * placement, the forced-tool ↔ thinking rule, and OpenAI-shape reshaping. Pure →
 * runs under vitest without Deno. (The spec lives in src/ and imports the
 * Deno-free pure module directly.)
 */
import { describe, it, expect } from 'vitest';
import {
  imagePartFromDataUrl,
  convertContent,
  appendDocuments,
  mapToolChoice,
  buildReasoning,
  toOpenAIShape,
  buildAnthropicRequestBody,
  anthropicRejectsSampling,
  type ClaudeReconstructArgs,
} from '../../../../supabase/functions/_shared/claudeReconstruct.pure';

/** A resolved key credential: this contract is about request shape, not auth. */
const KEY_CREDENTIAL = { kind: 'api_key', value: 'k', workspaceId: null } as const;

const TOOL = {
  type: 'function' as const,
  function: { name: 'apply_changes', description: 'Apply ops', parameters: { type: 'object', properties: {} } },
};

describe('claudeReconstruct.pure — content conversion', () => {
  it('parses image data URLs into base64 image blocks', () => {
    expect(imagePartFromDataUrl('data:image/png;base64,AAAB')).toEqual({
      type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAB' },
    });
    expect(imagePartFromDataUrl('https://x/y.png')).toBeNull();
  });

  it('converts mixed OpenAI content into Anthropic blocks', () => {
    const out = convertContent([
      { type: 'text', text: 'hi' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,ZZ' } },
    ]);
    expect(out).toEqual([
      { type: 'text', text: 'hi' },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'ZZ' } },
    ]);
    expect(convertContent('plain')).toBe('plain');
  });

  it('appends PDF document blocks to the last user turn', () => {
    const turns: any[] = [{ role: 'user', content: 'reconstruct this' }];
    appendDocuments(turns, [{ base64: 'PDFDATA' }]);
    expect(turns[0].content).toEqual([
      { type: 'text', text: 'reconstruct this' },
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'PDFDATA' } },
    ]);
  });
});

describe('claudeReconstruct.pure — tool choice + reasoning', () => {
  it('maps tool_choice and flags forced tools', () => {
    expect(mapToolChoice('required')).toEqual({ value: { type: 'any' }, forced: true });
    expect(mapToolChoice({ type: 'function', function: { name: 'apply_changes' } }))
      .toEqual({ value: { type: 'tool', name: 'apply_changes' }, forced: true });
    expect(mapToolChoice('auto')).toEqual({ value: { type: 'auto' }, forced: false });
    expect(mapToolChoice(undefined)).toEqual({ value: undefined, forced: false });
  });

  it('omits thinking when a tool is forced; enables adaptive thinking + effort otherwise', () => {
    expect(buildReasoning({ thinking: true, effort: 'high' } as ClaudeReconstructArgs, true)).toEqual({});
    expect(buildReasoning({ thinking: true, effort: 'xhigh' } as ClaudeReconstructArgs, false)).toEqual({
      thinking: { type: 'adaptive' }, output_config: { effort: 'xhigh' },
    });
    expect(buildReasoning({} as ClaudeReconstructArgs, false)).toEqual({});
  });

  it('knows which models reject sampling params', () => {
    expect(anthropicRejectsSampling('claude-opus-4-8')).toBe(true);
    expect(anthropicRejectsSampling('claude-opus-4-7')).toBe(true);
    expect(anthropicRejectsSampling('claude-fable-5')).toBe(true);
    expect(anthropicRejectsSampling('claude-opus-4-6')).toBe(false);
    expect(anthropicRejectsSampling('claude-sonnet-4-6')).toBe(false);
  });
});

describe('claudeReconstruct.pure — buildAnthropicRequestBody', () => {
  const baseArgs: ClaudeReconstructArgs = {
    credential: KEY_CREDENTIAL,
    messages: [
      { role: 'system', content: 'SYSTEM PROMPT' },
      { role: 'system', content: 'CONTEXT' },
      { role: 'user', content: [{ type: 'text', text: 'rebuild' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,IMG' } }] },
    ],
    tools: [TOOL],
    tool_choice: { type: 'function', function: { name: 'apply_changes' } },
    max_tokens: 8192,
  };

  const { body, forced } = buildAnthropicRequestBody(baseArgs, 'claude-opus-4-8');

  it('uses the default model and never emits temperature', () => {
    expect(body.model).toBe('claude-opus-4-8');
    expect(body.temperature).toBeUndefined();
    expect(body.max_tokens).toBe(8192);
  });

  it('caches the first system block only', () => {
    expect(body.system).toHaveLength(2);
    expect(body.system[0]).toEqual({ type: 'text', text: 'SYSTEM PROMPT', cache_control: { type: 'ephemeral' } });
    expect(body.system[1]).toEqual({ type: 'text', text: 'CONTEXT' });
  });

  it('converts the multimodal user turn (image preserved)', () => {
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].content).toEqual([
      { type: 'text', text: 'rebuild' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'IMG' } },
    ]);
  });

  it('sends a strict tool + forces it, with no thinking', () => {
    expect(forced).toBe(true);
    expect(body.tools[0]).toMatchObject({ name: 'apply_changes', strict: true });
    expect(body.tools[0].input_schema).toEqual(TOOL.function.parameters);
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'apply_changes' });
    expect(body.thinking).toBeUndefined();
    expect(body.output_config).toBeUndefined();
  });

  it('attaches native PDF documents + applies effort when the tool is not forced', () => {
    const { body: b2 } = buildAnthropicRequestBody(
      { credential: KEY_CREDENTIAL, messages: [{ role: 'user', content: 'go' }], documents: [{ base64: 'PDF' }], effort: 'high', thinking: true },
      'claude-opus-4-8',
    );
    expect(b2.messages[0].content).toEqual([
      { type: 'text', text: 'go' },
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'PDF' } },
    ]);
    expect(b2.thinking).toEqual({ type: 'adaptive' });
    expect(b2.output_config).toEqual({ effort: 'high' });
  });
});

describe('claudeReconstruct.pure — toOpenAIShape', () => {
  it('reshapes Anthropic content blocks into an OpenAI message with tool_calls', () => {
    const shaped = toOpenAIShape({
      content: [
        { type: 'text', text: 'done' },
        { type: 'tool_use', id: 'tu_1', name: 'apply_changes', input: { reply: 'ok', operations: [] } },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 10 },
      model: 'claude-opus-4-8',
    });
    const msg = shaped.choices[0].message;
    expect(msg.content).toBe('done');
    expect(msg.tool_calls[0].function.name).toBe('apply_changes');
    expect(JSON.parse(msg.tool_calls[0].function.arguments)).toEqual({ reply: 'ok', operations: [] });
    expect(shaped.model).toBe('claude-opus-4-8');
  });
});
