import { describe, expect, it } from 'vitest';
import {
  isUnsupportedSamplingParameterError,
  modelRejectsSamplingParameters,
  stripUnsupportedSamplingParameters,
} from './constants';

/**
 * Sprint 44 — model-aware sampling-parameter compatibility. Sonnet 4.5/4.6 (and other known
 * Claude models) keep sampling params; Sonnet 5+/Opus 4.7+ (and OpenAI o-series) reject them;
 * an UNKNOWN/future ANTHROPIC model conservatively omits them by default; unknown non-Anthropic
 * models are unaffected. The runtime one-time retry remains the defensive fallback.
 */

describe('modelRejectsSamplingParameters', () => {
  it('(Sonnet 4.5) allows sampling parameters', () => {
    expect(modelRejectsSamplingParameters('claude-sonnet-4-5')).toBe(false);
    expect(modelRejectsSamplingParameters('claude-sonnet-4-5-20250929')).toBe(false);
  });

  it('(Sonnet 4.6) allows sampling parameters', () => {
    expect(modelRejectsSamplingParameters('claude-sonnet-4-6')).toBe(false);
  });

  it('(Sonnet 5 and newer) rejects sampling parameters', () => {
    expect(modelRejectsSamplingParameters('claude-sonnet-5')).toBe(true);
    expect(modelRejectsSamplingParameters('claude-sonnet-5-20260101')).toBe(true);
  });

  it('(Opus 4.7 and newer) rejects sampling parameters', () => {
    expect(modelRejectsSamplingParameters('claude-opus-4-7')).toBe(true);
    expect(modelRejectsSamplingParameters('claude-opus-4-8')).toBe(true);
  });

  it('rejects sampling parameters for OpenAI reasoning models already in the guard', () => {
    expect(modelRejectsSamplingParameters('o1')).toBe(true);
    expect(modelRejectsSamplingParameters('o3-mini')).toBe(true);
    expect(modelRejectsSamplingParameters('gpt-5')).toBe(true);
  });

  it('keeps sampling parameters for other known-compatible Claude models (Haiku 4.5, Claude 3.x)', () => {
    expect(modelRejectsSamplingParameters('claude-haiku-4-5-20251001')).toBe(false);
    expect(modelRejectsSamplingParameters('claude-3-5-sonnet-latest')).toBe(false);
    expect(modelRejectsSamplingParameters('claude-3-opus')).toBe(false);
  });

  it('(unknown future Claude Sonnet version) conservatively omits sampling parameters', () => {
    expect(modelRejectsSamplingParameters('claude-sonnet-6')).toBe(true);
    expect(modelRejectsSamplingParameters('claude-sonnet-9-ultra')).toBe(true);
  });

  it('(unknown future Claude Opus version) conservatively omits sampling parameters', () => {
    expect(modelRejectsSamplingParameters('claude-opus-4-9')).toBe(true);
    expect(modelRejectsSamplingParameters('claude-opus-5')).toBe(true);
  });

  it('(unknown non-Anthropic model) remains unaffected — sampling parameters allowed', () => {
    expect(modelRejectsSamplingParameters('some-brand-new-model')).toBe(false);
    expect(modelRejectsSamplingParameters('gpt-4o')).toBe(false);
    expect(modelRejectsSamplingParameters('mistral-large-2')).toBe(false);
  });
});

describe('stripUnsupportedSamplingParameters', () => {
  const sampling = { temperature: 0.7, topP: 0.9, topK: 40 };

  it('(Sonnet 4.5) keeps every sampling parameter', () => {
    expect(stripUnsupportedSamplingParameters('claude-sonnet-4-5', { ...sampling })).toEqual(sampling);
  });

  it('(Sonnet 4.6) keeps every sampling parameter', () => {
    expect(stripUnsupportedSamplingParameters('claude-sonnet-4-6', { ...sampling })).toEqual(sampling);
  });

  it('(Sonnet 5) removes temperature, topP, and topK but keeps unrelated params', () => {
    const result = stripUnsupportedSamplingParameters('claude-sonnet-5', { ...sampling, maxTokens: 8192 });
    expect(result).toEqual({ maxTokens: 8192 });
    expect(result).not.toHaveProperty('temperature');
    expect(result).not.toHaveProperty('topP');
    expect(result).not.toHaveProperty('topK');
  });

  it('(Opus 4.7 and newer) removes sampling parameters', () => {
    expect(stripUnsupportedSamplingParameters('claude-opus-4-7', { ...sampling })).toEqual({});
    expect(stripUnsupportedSamplingParameters('claude-opus-4-8', { ...sampling })).toEqual({});
  });

  it('(unknown future Anthropic model) conservatively strips sampling parameters', () => {
    expect(stripUnsupportedSamplingParameters('claude-sonnet-6', { ...sampling })).toEqual({});
    expect(stripUnsupportedSamplingParameters('claude-opus-5', { ...sampling })).toEqual({});
  });

  it('(unknown non-Anthropic model) keeps sampling parameters', () => {
    expect(stripUnsupportedSamplingParameters('some-brand-new-model', { ...sampling })).toEqual(sampling);
  });

  it('handles undefined options', () => {
    expect(stripUnsupportedSamplingParameters('claude-sonnet-5', undefined)).toEqual({});
  });
});

describe('isUnsupportedSamplingParameterError', () => {
  it('detects an explicit temperature rejection', () => {
    expect(isUnsupportedSamplingParameterError(new Error('temperature is deprecated for this model'))).toBe(true);
    expect(isUnsupportedSamplingParameterError(new Error('temperature must be removed for this model'))).toBe(true);
  });

  it('detects top_p / top_k rejections', () => {
    expect(isUnsupportedSamplingParameterError(new Error('Unexpected parameter: top_p'))).toBe(true);
    expect(isUnsupportedSamplingParameterError(new Error('unsupported value for top_k'))).toBe(true);
  });

  it('does NOT trigger on unrelated errors (billing, rate limit, auth, truncation)', () => {
    expect(isUnsupportedSamplingParameterError(new Error('Your credit balance is too low to access the API'))).toBe(
      false,
    );
    expect(isUnsupportedSamplingParameterError(new Error('rate limit exceeded'))).toBe(false);
    expect(isUnsupportedSamplingParameterError(new Error('Invalid or missing API key'))).toBe(false);
    expect(
      isUnsupportedSamplingParameterError(new Error('The AI response was cut off before completing valid JSON')),
    ).toBe(false);
  });

  it('handles non-Error and empty inputs safely', () => {
    expect(isUnsupportedSamplingParameterError('temperature is not supported')).toBe(true);
    expect(isUnsupportedSamplingParameterError(null)).toBe(false);
    expect(isUnsupportedSamplingParameterError(undefined)).toBe(false);
  });
});
