import { describe, expect, it } from 'vitest';
import {
  reportPermitsVerified,
  resolveReportStatus,
  summariseChecks,
  VERIFICATION_ALLOWS_ADVISORY_WARNINGS,
  type VerificationCheck,
  type VerificationCheckStatus,
} from './verificationTypes';

function check(
  id: string,
  status: VerificationCheckStatus,
  required: boolean,
  overrides: Partial<VerificationCheck> = {},
): VerificationCheck {
  return {
    id,
    category: 'availability',
    name: id,
    description: '',
    required,
    status,
    evidence: {},
    retryable: false,
    attempts: 1,
    ...overrides,
  };
}

describe('summariseChecks', () => {
  it('counts every status and separates required from advisory', () => {
    const summary = summariseChecks([
      check('a', 'passed', true),
      check('b', 'passed', false),
      check('c', 'warning', false),
      check('d', 'skipped', false),
      check('e', 'unavailable', false),
    ]);

    expect(summary).toMatchObject({
      total: 5,
      passed: 2,
      failed: 0,
      warnings: 1,
      skipped: 1,
      unavailable: 1,
      requiredTotal: 1,
      requiredPassed: 1,
      requiredFailed: 0,
    });
    expect(summary.blockingFailure).toBeUndefined();
  });

  it('reports the first required failure as the blocking failure', () => {
    const summary = summariseChecks([
      check('advisory', 'failed', false),
      check('root', 'failed', true, { name: 'HTTP response', errorCode: 'http_status', errorMessage: 'HTTP 500' }),
      check('later', 'failed', true),
    ]);

    expect(summary.requiredFailed).toBe(2);
    expect(summary.blockingFailure).toEqual({
      checkId: 'root',
      name: 'HTTP response',
      errorCode: 'http_status',
      errorMessage: 'HTTP 500',
    });
  });
});

describe('resolveReportStatus', () => {
  it('passes when every required check passed and nothing warned', () => {
    expect(resolveReportStatus([check('a', 'passed', true), check('b', 'passed', false)])).toBe('passed');
  });

  it('warns when an advisory check warned but every required check passed', () => {
    expect(resolveReportStatus([check('a', 'passed', true), check('b', 'warning', false)])).toBe('warning');
  });

  it('warns when an advisory check is unavailable', () => {
    expect(resolveReportStatus([check('a', 'passed', true), check('b', 'unavailable', false)])).toBe('warning');
  });

  it('does not treat a skipped advisory check as a warning', () => {
    expect(resolveReportStatus([check('a', 'passed', true), check('b', 'skipped', false)])).toBe('passed');
  });

  it('fails when a required check failed, regardless of everything else passing', () => {
    expect(resolveReportStatus([check('a', 'failed', true), check('b', 'passed', false)])).toBe('failed');
  });

  it('does not fail on an advisory failure (the engine downgrades those, and the rule agrees)', () => {
    expect(resolveReportStatus([check('a', 'passed', true), check('b', 'warning', false)])).not.toBe('failed');
  });

  it('is incomplete when a required check could not be evaluated', () => {
    expect(resolveReportStatus([check('a', 'passed', true), check('b', 'unavailable', true)])).toBe('incomplete');
    expect(resolveReportStatus([check('a', 'passed', true), check('b', 'pending', true)])).toBe('incomplete');
  });

  it('honours a terminal override over the check-derived result', () => {
    expect(resolveReportStatus([check('a', 'passed', true)], 'cancelled')).toBe('cancelled');
    expect(resolveReportStatus([check('a', 'failed', true)], 'cancelled')).toBe('cancelled');
    expect(resolveReportStatus([check('a', 'passed', true)], 'incomplete')).toBe('incomplete');
  });
});

describe('reportPermitsVerified', () => {
  const summary = (requiredFailed: number) =>
    summariseChecks(requiredFailed > 0 ? [check('a', 'failed', true)] : [check('a', 'passed', true)]);

  it('permits verified for a passed report', () => {
    expect(reportPermitsVerified({ status: 'passed', summary: summary(0) })).toBe(true);
  });

  it('permits verified for a warning report, per the documented advisory rule', () => {
    expect(VERIFICATION_ALLOWS_ADVISORY_WARNINGS).toBe(true);
    expect(reportPermitsVerified({ status: 'warning', summary: summary(0) })).toBe(true);
  });

  it('never permits verified when a required check failed', () => {
    expect(reportPermitsVerified({ status: 'failed', summary: summary(1) })).toBe(false);
    expect(reportPermitsVerified({ status: 'warning', summary: summary(1) })).toBe(false);
  });

  it('never permits verified for a cancelled or incomplete report', () => {
    expect(reportPermitsVerified({ status: 'cancelled', summary: summary(0) })).toBe(false);
    expect(reportPermitsVerified({ status: 'incomplete', summary: summary(0) })).toBe(false);
    expect(reportPermitsVerified({ status: 'running', summary: summary(0) })).toBe(false);
  });
});
