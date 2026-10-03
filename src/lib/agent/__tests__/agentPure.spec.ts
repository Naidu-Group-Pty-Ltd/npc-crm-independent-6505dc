import { describe, expect, it } from 'vitest';
import { narrateTool, toolDomain, describePendingAction, META_TOOLS } from '../toolNarration.pure';
import { derivePresence, IDLE_STATUS } from '../presence.pure';
import { toSpeakable, takeSpeakable, sentenceBoundaries, chunkUtterances } from '../speech.pure';
import { describePage, withPageContext, splitPageContext, hasPageContext } from '../pageContext.pure';
import { greetingFor, firstNameFrom, partOfDay } from '../greeting.pure';
import { suggestFollowUps, toolNamesFromCalls } from '../followUps.pure';
import { parseUserMessage } from '../userMessage.pure';

describe('narrateTool', () => {
  it('uses a hand-written sentence where one exists', () => {
    expect(narrateTool('get_upcoming_calendar')).toMatchObject({
      active: 'Checking your calendar',
      done: 'Checked your calendar',
      domain: 'calendar',
    });
  });

  it('humanises a tool it has never heard of rather than printing snake_case', () => {
    const n = narrateTool('get_client_additional_contacts');
    expect(n.active).toBe('Looking at client additional contacts');
    expect(n.done).toBe('Looked at client additional contacts');
    expect(n.active).not.toMatch(/_/);
  });

  it('keeps acronyms readable', () => {
    expect(narrateTool('get_qa_queue').active).toBe('Looking at QA queue');
    expect(narrateTool('calculate_lmi').active).toBe('Calculating LMI');
  });

  it('narrates all three meta tools as one step', () => {
    const labels = new Set([...META_TOOLS].map((t) => narrateTool(t).active));
    expect(labels).toEqual(new Set(['Choosing the right tools']));
  });

  it('never claims an outcome', () => {
    for (const t of ['search_clients', 'get_overdue_reminders', 'get_stale_deals']) {
      expect(narrateTool(t).done).not.toMatch(/\d|found \d|none/i);
    }
  });

  it('survives an empty or missing name', () => {
    expect(narrateTool(null).active).toBe('Working on it');
    expect(narrateTool('').domain).toBe('general');
  });

  it('places tools in the area of the business they touch', () => {
    expect(toolDomain('get_clawback_monitor')).toBe('deals');
    expect(toolDomain('get_upcoming_milestones')).toBe('reminders');
    expect(toolDomain('add_game_plan_milestone')).toBe('plans');
    expect(toolDomain('calculate_stamp_duty')).toBe('financial');
    expect(toolDomain('search_emails')).toBe('email');
    expect(toolDomain('get_call_alerts')).toBe('calls');
    expect(toolDomain('recall_memories')).toBe('memory');
  });
});

describe('describePendingAction', () => {
  it('reads the stored OpenAI tool-call shape and picks a salient argument', () => {
    const s = describePendingAction({
      function: { name: 'send_email', arguments: JSON.stringify({ to: 'jane@example.com', subject: 'Settlement update' }) },
    });
    expect(s).toMatchObject({ title: 'Send an email', detail: 'Settlement update', domain: 'email' });
  });

  it('builds an imperative for an action with no override', () => {
    expect(describePendingAction({ function: { name: 'toggle_checklist_item', arguments: '{}' } })?.title).toBe(
      'Toggle checklist item',
    );
  });

  it('tolerates unparseable arguments and ignores meta tools', () => {
    expect(describePendingAction({ function: { name: 'create_reminder', arguments: '{oops' } })?.detail).toBeNull();
    expect(describePendingAction({ function: { name: 'load_tools', arguments: '{}' } })).toBeNull();
    expect(describePendingAction(null)).toBeNull();
  });
});

describe('derivePresence', () => {
  it('lets a person speaking outrank everything', () => {
    expect(derivePresence({ listening: true, busy: true, activeTool: 'search_clients' }).mood).toBe('listening');
  });

  it('narrates the running tool', () => {
    expect(derivePresence({ busy: true, activeTool: 'get_upcoming_calendar' })).toMatchObject({
      mood: 'working',
      status: 'Checking your calendar…',
    });
  });

  it('separates thinking from writing', () => {
    expect(derivePresence({ busy: true }).status).toBe('Thinking…');
    expect(derivePresence({ busy: true, writing: true }).mood).toBe('writing');
  });

  it('puts an approval ahead of an unread reply, and both ahead of idle', () => {
    expect(derivePresence({ awaitingApproval: true, unseenReply: true }).mood).toBe('attention');
    expect(derivePresence({ unseenReply: true }).status).toBe('Reply ready');
    expect(derivePresence({}).status).toBe(IDLE_STATUS);
  });
});

describe('toSpeakable', () => {
  it('drops Markdown scaffolding and keeps the words', () => {
    expect(toSpeakable('## Pipeline\n**3 deals** are at risk. See [the board](https://x.y/z).')).toBe(
      'Pipeline. 3 deals are at risk. See the board.',
    );
  });

  it('describes a table once instead of reading it', () => {
    const md = 'Here it is:\n\n| Stage | Count |\n|---|---|\n| Lead | 4 |\n\nThat is all.';
    const said = toSpeakable(md);
    expect(said).toContain('I have put the details in a table.');
    expect(said).not.toMatch(/Lead|Count|\|/);
  });

  it('skips code and chart blocks and fence markers', () => {
    const md = 'Before.\n```chart\n{"a":1}\n```\n:::tip\nKeep this tip.\n:::\nAfter.';
    const said = toSpeakable(md);
    expect(said).not.toMatch(/chart|\{/);
    expect(said).toContain('Keep this tip');
    expect(said).toContain('After');
  });

  it('removes emoji and list markers', () => {
    expect(toSpeakable('- ☀️ Morning briefing\n- 📊 Pipeline')).toBe('Morning briefing. Pipeline');
  });
});

describe('takeSpeakable', () => {
  it('only takes whole sentences while streaming', () => {
    const raw = 'Your pipeline looks healthy. Three deals need';
    const take = takeSpeakable(raw, 0, false);
    expect(take.text).toBe('Your pipeline looks healthy.');
    expect(raw.slice(take.next)).toBe(' Three deals need');
  });

  it('does not cut on a decimal or an address abbreviation', () => {
    expect(sentenceBoundaries('Rates rose 4.5% today')).toEqual([]);
    expect(sentenceBoundaries('Inspect 12 Smith St. tomorrow')).toEqual([]);
  });

  it('will not enter an unclosed code fence', () => {
    const raw = 'Here is the chart.\n```chart\n{"x": 1}. More.';
    const take = takeSpeakable(raw, 0, false);
    expect(take.text).toBe('Here is the chart.');
  });

  it('flushes the remainder once the reply is final', () => {
    const raw = 'One. Two without a stop';
    const first = takeSpeakable(raw, 0, false);
    const rest = takeSpeakable(raw, first.next, true);
    expect(rest.text).toBe('Two without a stop');
    expect(rest.next).toBe(raw.length);
  });

  it('announces a streamed table once, however many chunks it arrives in', () => {
    const raw = 'Here it is:\n| Stage | Count |\n|---|---|\n| Lead | 4 |\n| Won | 2 |\n\nThat is all. ';
    let cursor = 0;
    const said: string[] = [];
    // Feed the buffer as it would stream, one character at a time.
    for (let end = 1; end <= raw.length; end += 1) {
      const take = takeSpeakable(raw.slice(0, end), cursor, false);
      if (take.text) said.push(take.text);
      cursor = take.next;
    }
    const final = takeSpeakable(raw, cursor, true);
    if (final.text) said.push(final.text);
    const joined = said.join(' ');
    expect(joined.match(/I have put the details in a table\./g)).toHaveLength(1);
    expect(joined).toContain('That is all.');
    expect(joined).not.toMatch(/Lead|\|/);
  });

  it('returns nothing when there is nothing new', () => {
    expect(takeSpeakable('Done.', 5, true)).toEqual({ text: '', next: 5 });
  });
});

describe('chunkUtterances', () => {
  it('splits sentences and keeps long ones under the engine limit', () => {
    const long = `${'word '.repeat(60).trim()}, and then ${'more '.repeat(20).trim()}.`;
    const chunks = chunkUtterances(`Short one. ${long}`, 120);
    expect(chunks[0]).toBe('Short one.');
    expect(chunks.every((c) => c.length <= 121)).toBe(true);
  });
});

describe('page context', () => {
  it('prefers the page heading and keeps the path whole', () => {
    expect(describePage('/clients/7f3c2a10-1111-2222-3333-444455556666', 'Jane Citizen')).toEqual({
      label: 'Jane Citizen',
      path: '/clients/7f3c2a10-1111-2222-3333-444455556666',
    });
  });

  it('derives a label from the URL when there is no heading', () => {
    expect(describePage('/admin/aml/austrac', null).label).toBe('AML/CTF › AUSTRAC');
    expect(describePage('/clients/7f3c2a10-1111-2222-3333-444455556666', '').label).toBe('Clients record');
    expect(describePage('/', '').label).toBe('Dashboard');
  });

  it('adds the line once and reads it back out', () => {
    const ctx = { label: 'Jane Citizen', path: '/clients/abc' };
    const once = withPageContext('What is outstanding?', ctx);
    expect(withPageContext(once, ctx)).toBe(once);
    expect(hasPageContext(once)).toBe(true);
    expect(splitPageContext(once)).toEqual({ context: ctx, rest: 'What is outstanding?' });
  });

  it('leaves a message without context alone', () => {
    expect(splitPageContext('Hello')).toEqual({ context: null, rest: 'Hello' });
    expect(withPageContext('Hello', null)).toBe('Hello');
  });
});

describe('greeting', () => {
  it('greets by first name at the right time of day', () => {
    expect(greetingFor(new Date(2026, 9, 2, 8), 'ravi.naidu')).toBe('Good morning, Ravi');
    expect(greetingFor(new Date(2026, 9, 2, 14), 'Ravi Naidu')).toBe('Good afternoon, Ravi');
    expect(greetingFor(new Date(2026, 9, 2, 19), 'admin@npc.com.au')).toBe('Good evening, Admin');
    expect(greetingFor(new Date(2026, 9, 2, 23), 'ravi')).toBe('Working late, Ravi?');
  });

  it('says no name rather than a wrong one', () => {
    expect(firstNameFrom('u_8f3a91')).toBeNull();
    expect(firstNameFrom(undefined)).toBeNull();
    expect(greetingFor(new Date(2026, 9, 2, 9), '1234')).toBe('Good morning');
    expect(partOfDay(new Date(2026, 9, 2, 4))).toBe('late');
  });
});

describe('suggestFollowUps', () => {
  it('follows the area the reply worked in', () => {
    expect(suggestFollowUps(['get_pipeline_overview'])).toEqual([
      'Which deals are most at risk?',
      'Show stale deals',
      'Chart deals by stage',
    ]);
  });

  it('gives two areas a voice each', () => {
    const s = suggestFollowUps(['load_tools', 'get_upcoming_calendar', 'get_all_reminders']);
    expect(s).toHaveLength(3);
    expect(s[0]).toBe('What’s free tomorrow?');
    expect(s[1]).toBe('What’s due this week?');
  });

  it('falls back to general next steps', () => {
    expect(suggestFollowUps([])).toHaveLength(3);
  });

  it('reads tool names out of stored tool calls', () => {
    expect(
      toolNamesFromCalls([{ function: { name: 'send_email' } }, { function: { name: 'send_email' } }, { name: 'search_clients' }]),
    ).toEqual(['send_email', 'search_clients']);
    expect(toolNamesFromCalls(undefined)).toEqual([]);
  });
});

describe('parseUserMessage', () => {
  it('turns inlined file text back into a chip', () => {
    const stored = '[FILE: contract.pdf (application/pdf, 1.2MB)]\nPage one text\nPage two\n[/FILE]\n\nSummarise this';
    expect(parseUserMessage(stored)).toEqual({
      text: 'Summarise this',
      files: [{ name: 'contract.pdf', meta: 'application/pdf, 1.2MB' }],
      page: null,
    });
  });

  it('reads the in-flight indicator lines', () => {
    expect(parseUserMessage('📎 a.png\n📎 b.csv\n\nWhat is this?')).toEqual({
      text: 'What is this?',
      files: [{ name: 'a.png' }, { name: 'b.csv' }],
      page: null,
    });
  });

  it('turns an image-only fallback into chips with no text', () => {
    const parsed = parseUserMessage('[User attached 2 images: one.png, two.png. Please analyze the attached images.]');
    expect(parsed.text).toBe('');
    expect(parsed.files.map((f) => f.name)).toEqual(['one.png', 'two.png']);
  });

  it('separates the page line from the question', () => {
    const parsed = parseUserMessage('[FILE: a.txt (text/plain, 2B)]\nhi\n[/FILE]\n\n[Viewing: Jane — /clients/1]\n\nAny issues?');
    expect(parsed.page).toEqual({ label: 'Jane', path: '/clients/1' });
    expect(parsed.text).toBe('Any issues?');
    expect(parsed.files).toHaveLength(1);
  });

  it('never drops what the user typed', () => {
    expect(parseUserMessage('Plain [bracketed] words').text).toBe('Plain [bracketed] words');
  });
});
