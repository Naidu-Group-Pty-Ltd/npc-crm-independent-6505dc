/**
 * The audit's reading is the first test:
 * `Stage: Ingestion · Function: market-updates-ingest · HTTP 422` over
 * "Market News Feed could not complete this operation."
 */
import { describe, expect, it } from 'vitest';

import {
  classifyMarketFailure,
  looksLikeOperatorSentence,
  marketFailureIsRetryable,
  resolveIssueMessage,
} from '../operationalIssue.pure';

const GENERIC = 'Market News Feed could not complete this operation.';
const UNSEEDED = 'The Market Updates source registry has not been seeded in this environment.';
const DISABLED = 'No enabled market sources are configured in the connected database.';

describe('classifyMarketFailure', () => {
  it('reads a 422 as what the server said it was', () => {
    expect(classifyMarketFailure({ status: 422, message: UNSEEDED })).toBe('registry_empty');
    expect(classifyMarketFailure({ status: 422, message: DISABLED })).toBe('sources_disabled');
  });

  it('still names a 422 it does not recognise as an ingestion emptiness', () => {
    // Never `unknown`: the status alone says the run found nothing to read.
    expect(classifyMarketFailure({ status: 422, message: 'Something else entirely.' }))
      .toBe('ingestion_empty');
  });

  it('keeps the classifications it already had', () => {
    expect(classifyMarketFailure({ network: true })).toBe('network_error');
    expect(classifyMarketFailure({ status: 401 })).toBe('unauthorised');
    expect(classifyMarketFailure({ status: 403 })).toBe('rls_denied');
    expect(classifyMarketFailure({ status: 404 })).toBe('function_missing');
    expect(classifyMarketFailure({ status: 500 })).toBe('server_error');
    expect(classifyMarketFailure({ message: 'relation does not exist' })).toBe('migration_missing');
    expect(classifyMarketFailure({ status: 418, message: 'teapot' })).toBe('unknown');
  });

  it('lets the server name its own code', () => {
    expect(classifyMarketFailure({ status: 500, code: 'provider_timeout' })).toBe('provider_timeout');
  });

  it('classifies rather than trusting a code this surface cannot render', () => {
    // `internalError` sends `internal_error` on every 500. Taken on trust it
    // resolved to no message and no remediation at all, so the generic pair
    // stood in for `server_error`'s better wording.
    expect(classifyMarketFailure({ status: 500, code: 'internal_error' })).toBe('server_error');
    expect(classifyMarketFailure({ status: 422, code: 'something_new', message: UNSEEDED }))
      .toBe('registry_empty');
  });
});

describe('looksLikeOperatorSentence', () => {
  it('accepts a sentence a person wrote', () => {
    expect(looksLikeOperatorSentence(UNSEEDED)).toBe(true);
    expect(looksLikeOperatorSentence(DISABLED)).toBe(true);
  });

  it('refuses database vocabulary', () => {
    // The rule the whole platform answers to: database vocabulary never
    // reaches the operator.
    expect(looksLikeOperatorSentence('column market_sources.foo does not exist')).toBe(false);
    expect(looksLikeOperatorSentence('new row violates check constraint "x"')).toBe(false);
    expect(looksLikeOperatorSentence('null value in column "id" of relation "y"')).toBe(false);
    expect(looksLikeOperatorSentence('PGRST205: schema cache')).toBe(false);
    expect(looksLikeOperatorSentence('permission denied due to row-level security')).toBe(false);
    expect(looksLikeOperatorSentence('market_ingestion_run_lock_failed')).toBe(false);
  });

  it('refuses a status code standing in for a message', () => {
    expect(looksLikeOperatorSentence('HTTP 422')).toBe(false);
    expect(looksLikeOperatorSentence('500')).toBe(false);
    expect(looksLikeOperatorSentence('Error')).toBe(false);
    expect(looksLikeOperatorSentence('')).toBe(false);
    expect(looksLikeOperatorSentence(undefined)).toBe(false);
    expect(looksLikeOperatorSentence(422)).toBe(false);
  });
});

describe('resolveIssueMessage', () => {
  it('keeps the sentence the server wrote about its own state', () => {
    expect(resolveIssueMessage('registry_empty', UNSEEDED, GENERIC)).toBe(UNSEEDED);
    expect(resolveIssueMessage('sources_disabled', DISABLED, GENERIC)).toBe(DISABLED);
  });

  it('keeps the client sentence where the client knows better', () => {
    // A 404's body is the gateway's, and a network failure has no body at all.
    expect(resolveIssueMessage('function_missing', 'Requested function was not found', GENERIC))
      .toBe(GENERIC);
    expect(resolveIssueMessage('network_error', null, GENERIC)).toBe(GENERIC);
    expect(resolveIssueMessage('unauthorised', 'Unauthorised market ingestion request.', GENERIC))
      .toBe(GENERIC);
  });

  it('falls back to the generic sentence rather than showing a database message', () => {
    expect(resolveIssueMessage('unknown', 'column x does not exist', GENERIC)).toBe(GENERIC);
    expect(resolveIssueMessage('server_error', 'HTTP 500', GENERIC)).toBe(GENERIC);
  });
});

describe('marketFailureIsRetryable', () => {
  it('does not offer a retry that cannot change anything', () => {
    // Pressing Ingest again against an unseeded registry fails identically.
    expect(marketFailureIsRetryable('registry_empty')).toBe(false);
    expect(marketFailureIsRetryable('sources_disabled')).toBe(false);
    expect(marketFailureIsRetryable('migration_missing')).toBe(false);
    expect(marketFailureIsRetryable('function_missing')).toBe(false);
    expect(marketFailureIsRetryable('rls_denied')).toBe(false);
  });

  it('keeps the retry where a retry is the act', () => {
    expect(marketFailureIsRetryable('network_error')).toBe(true);
    expect(marketFailureIsRetryable('provider_timeout')).toBe(true);
    expect(marketFailureIsRetryable('server_error')).toBe(true);
    expect(marketFailureIsRetryable('ingestion_empty')).toBe(true);
  });
});
