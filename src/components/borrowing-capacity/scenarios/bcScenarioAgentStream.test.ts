/**
 * The Strategy Advisor says when it has not answered (bcScenarioAgentStream.pure.ts).
 *
 * On 28 Sep 2026 the advisor showed the broker's question and nothing else:
 * its request went to the app's own host, which answered with HTML and a 200,
 * and the stream reader found nothing in it and said nothing about that. Once
 * the address was fixed, the function refused it 401 for want of the session
 * cookie (`openSecureStream` now carries it).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { agentStreamRefusal, emptyAgentAnswerMessage } from './bcScenarioAgentStream.pure';

const AGENT = readFileSync(resolve(__dirname, 'BCScenarioAgent.tsx'), 'utf8');

describe('what the reader accepts as an answer', () => {
  it('accepts the agent stream', () => {
    expect(agentStreamRefusal('text/event-stream')).toBeNull();
    expect(agentStreamRefusal('text/event-stream; charset=utf-8')).toBeNull();
  });

  it("refuses the web app answering in the advisor's place, by name", () => {
    expect(agentStreamRefusal('text/html; charset=utf-8')).toMatch(/answered by the web app/);
  });

  it('refuses anything else, and says what came back', () => {
    expect(agentStreamRefusal('application/json')).toMatch(/unexpected response \(application\/json\)/);
    expect(agentStreamRefusal(null)).toMatch(/unexpected response/);
  });

  it('has a sentence for a stream that carried nothing', () => {
    expect(emptyAgentAnswerMessage()).toMatch(/did not return an answer/);
  });
});

describe('the advisor', () => {
  // The address fix let the request reach the function, which then answered
  // 401 to both of the owner's attempts: it was sent without the session
  // cookie. The advisor now opens its stream through the one secure transport,
  // which resolves the project URL and sends the cookie.
  it('opens its stream through the one secure transport, never a fetch of its own', () => {
    expect(AGENT).toContain("import { openSecureStream } from '@/lib/streamSecureFunction';");
    expect(AGENT).toContain("await openSecureStream('bc-scenario-agent', {");
    expect(AGENT).not.toMatch(/\bfetch\(/);
    expect(AGENT).not.toContain("credentials: 'omit'");
    expect(AGENT).not.toContain('import.meta.env');
  });

  it('checks what came back before reading it, and refuses an empty turn', () => {
    expect(AGENT.indexOf('agentStreamRefusal(')).toBeLessThan(AGENT.indexOf('resp.body.getReader()'));
    expect(AGENT).toContain('throw new Error(emptyAgentAnswerMessage())');
  });
});
