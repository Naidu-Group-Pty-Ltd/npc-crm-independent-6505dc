/**
 * Tool use on the router's native Anthropic route.
 *
 * Every router caller speaks the OpenAI chat shape. The native Anthropic route
 * used to drop `tools` and `tool_choice` and keep only the text of the answer,
 * so an agent assigned a Claude model could never return a tool call — the
 * Strategy Advisor's scenario cards among them. These specs hold the
 * translation both ways, and hold the router to engaging it only when a call
 * carries tools, so every other call is built as it always was.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  anthropicMessagesFrom,
  anthropicToolChoiceFrom,
  anthropicToolUseId,
  anthropicToolsFrom,
  needsAnthropicToolTranslation,
  openAiMessageFromAnthropic,
} from '../../../supabase/functions/_shared/anthropicToolUse.pure';
import { convertContent } from '../../../supabase/functions/_shared/claudeReconstruct.pure';

const ROUTER = readFileSync(resolve(__dirname, '../../../supabase/functions/_shared/llmRouter.ts'), 'utf8');

const SCENARIO_TOOL = {
  type: 'function',
  function: {
    name: 'generate_scenarios',
    description: 'Return three scenarios',
    parameters: { type: 'object', properties: { scenarios: { type: 'array' } }, required: ['scenarios'] },
  },
};

describe('the request', () => {
  it('turns OpenAI function tools into Anthropic tools', () => {
    expect(anthropicToolsFrom([SCENARIO_TOOL])).toEqual([{
      name: 'generate_scenarios',
      description: 'Return three scenarios',
      input_schema: SCENARIO_TOOL.function.parameters,
    }]);
    expect(anthropicToolsFrom([{ type: 'function', function: {} }])).toBeUndefined();
    expect(anthropicToolsFrom(undefined)).toBeUndefined();
  });

  it('turns each tool_choice into Anthropic\'s', () => {
    expect(anthropicToolChoiceFrom({ type: 'function', function: { name: 'generate_scenarios' } }))
      .toEqual({ type: 'tool', name: 'generate_scenarios' });
    expect(anthropicToolChoiceFrom('required')).toEqual({ type: 'any' });
    expect(anthropicToolChoiceFrom('auto')).toEqual({ type: 'auto' });
    expect(anthropicToolChoiceFrom('none')).toEqual({ type: 'none' });
    expect(anthropicToolChoiceFrom(undefined)).toBeUndefined();
  });

  it('engages only for a call that carries tools or a tool turn', () => {
    const plain = [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }];
    expect(needsAnthropicToolTranslation(plain, undefined)).toBe(false);
    expect(needsAnthropicToolTranslation(plain, [])).toBe(false);
    expect(needsAnthropicToolTranslation(plain, [SCENARIO_TOOL])).toBe(true);
    expect(needsAnthropicToolTranslation([...plain, { role: 'tool', content: '{}', tool_call_id: 'call_1' }], undefined)).toBe(true);
  });

  it('carries a revision turn — the call and its result — as tool_use and tool_result', () => {
    const messages = anthropicMessagesFrom([
      { role: 'system', content: 'You are the advisor' },
      { role: 'user', content: 'Options for a $750k new build' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'call_abc', type: 'function', function: { name: 'generate_scenarios', arguments: '{"scenarios":[]}' } }],
      },
      { role: 'tool', tool_call_id: 'call_abc', content: '{"status":"engine_validation_failed"}' },
      { role: 'user', content: 'Revise the failing ones.' },
    ], convertContent);

    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(messages[1].content).toEqual([
      { type: 'tool_use', id: 'call_abc', name: 'generate_scenarios', input: { scenarios: [] } },
    ]);
    // The result comes first in the user turn that follows the call.
    expect(messages[2].content[0]).toEqual({
      type: 'tool_result', tool_use_id: 'call_abc', content: '{"status":"engine_validation_failed"}',
    });
    expect(messages[2].content[1]).toEqual({ type: 'text', text: 'Revise the failing ones.' });
  });

  it('answers the waiting call when a result lost its id on the way', () => {
    const messages = anthropicMessagesFrom([
      { role: 'user', content: 'Brief' },
      { role: 'assistant', content: 'Here they are', tool_calls: [{ type: 'function', function: { name: 'generate_scenarios', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'call_0', content: 'failed' },
    ], convertContent);
    const use = messages[1].content.find((b) => b.type === 'tool_use')!;
    const result = messages[2].content.find((b) => b.type === 'tool_result')!;
    expect(result.tool_use_id).toBe(use.id);
    expect(messages[1].content[0]).toEqual({ type: 'text', text: 'Here they are' });
  });

  it('keeps a tool-use id inside the characters Anthropic accepts', () => {
    expect(anthropicToolUseId('call_abc-1', 0)).toBe('call_abc-1');
    expect(anthropicToolUseId('function-call:1/2', 0)).toBe('function-call_1_2');
    expect(anthropicToolUseId(undefined, 3)).toBe('toolu_3');
  });
});

describe('the answer', () => {
  it('turns a tool_use block into the tool call every caller reads', () => {
    const message = openAiMessageFromAnthropic({
      content: [
        { type: 'text', text: 'Three options:' },
        { type: 'tool_use', id: 'toolu_01', name: 'generate_scenarios', input: { scenarios: [{ name: 'A' }] } },
      ],
      stop_reason: 'tool_use',
    });
    expect(message.content).toBe('Three options:');
    expect(message.tool_calls).toEqual([{
      id: 'toolu_01',
      type: 'function',
      function: { name: 'generate_scenarios', arguments: '{"scenarios":[{"name":"A"}]}' },
    }]);
    expect(JSON.parse(message.tool_calls![0].function.arguments)).toEqual({ scenarios: [{ name: 'A' }] });
  });

  it('reads a text-only answer as it always did, with no tool_calls key', () => {
    expect(openAiMessageFromAnthropic({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }))
      .toEqual({ role: 'assistant', content: 'a\nb' });
  });
});

describe('the router', () => {
  const native = ROUTER.slice(
    ROUTER.indexOf('async function callAnthropicNative('),
    ROUTER.indexOf('async function callGeminiNative('),
  );

  it('hands the native Anthropic route the call\'s tools and tool choice', () => {
    expect(ROUTER).toContain(
      'callAnthropicNative(modelId, args.messages, { temperature, max_tokens, tools: args.tools, tool_choice: args.toolChoice, timeoutMs, extras })',
    );
  });

  it('translates only when the call carries tools, so other calls are built as before', () => {
    expect(native).toContain('const withTools = needsAnthropicToolTranslation(messages, opts.tools);');
    expect(native).toContain('anthropicMessagesFrom(messages, convertContent)');
    expect(native).toContain('openAiMessageFromAnthropic(data)');
    expect(native).toContain("content: data?.content?.map((c: any) => c.text).filter(Boolean).join('\\n') ?? ''");
  });
});
