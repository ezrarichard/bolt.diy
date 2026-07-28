import { describe, expect, it } from 'vitest';
import { classifyProviderError, isNonRetryableProviderError, isTruncatedOutput } from './providerErrors';

/**
 * Sprint 99, Checkpoint A — the classifier that stops Acceptance Round 2's ~800 futile paid calls
 * from ever happening again. The billing string below is the EXACT text captured from the wire
 * during Round 2's outage, not a paraphrase.
 */
describe('classifyProviderError', () => {
  const ROUND_2_BILLING_ERROR =
    'AI_APICallError: Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.';

  it('classifies the exact Acceptance Round 2 billing error as non-retryable', () => {
    expect(classifyProviderError(ROUND_2_BILLING_ERROR)).toBe('non-retryable');
    expect(isNonRetryableProviderError(ROUND_2_BILLING_ERROR)).toBe(true);
  });

  it.each([
    'Insufficient credit',
    'Payment Required',
    'HTTP 402',
    'invalid api key',
    'authentication_error',
    'Unauthorized',
    'HTTP 401',
    'permission denied for function',
    'quota exceeded',
    'You have exceeded your current quota',
  ])('classifies %s as non-retryable', (message) => {
    expect(classifyProviderError(message)).toBe('non-retryable');
  });

  it.each([
    'rate limit exceeded, please retry',
    'Overloaded',
    'HTTP 429',
    'HTTP 529',
    'socket hang up',
    'The AI response was not valid JSON.',
    'The AI response was cut off before completing valid JSON. Please regenerate.',
  ])('classifies %s as retryable', (message) => {
    expect(classifyProviderError(message)).toBe('retryable');
  });

  it('treats a rate limit as retryable even though its text mentions a limit', () => {
    // Guards the ordering of RETRYABLE_OVERRIDES ahead of the quota patterns.
    expect(classifyProviderError('Rate limit exceeded: quota exceeded for this minute')).toBe('retryable');
  });

  it('defaults unknown or empty text to retryable so the existing bounded budget still applies', () => {
    expect(classifyProviderError(undefined)).toBe('retryable');
    expect(classifyProviderError('')).toBe('retryable');
    expect(classifyProviderError('something unexpected happened')).toBe('retryable');
  });
});

describe('isTruncatedOutput', () => {
  it('detects the finishReason the AR2-BUG-008 investigation reproduced', () => {
    expect(isTruncatedOutput('length')).toBe(true);
  });

  it('detects truncation from the pipeline parser wording', () => {
    expect(isTruncatedOutput(undefined, 'The AI response was cut off before completing valid JSON.')).toBe(true);
  });

  it('does not treat a normal stop as truncation', () => {
    expect(isTruncatedOutput('stop')).toBe(false);
    expect(isTruncatedOutput(undefined, 'The AI response was not valid JSON.')).toBe(false);
  });
});
