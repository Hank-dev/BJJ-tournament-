import { describe, expect, it } from 'vitest';
import { getWinMethods, isSubmissionMethod } from './rulesets';

describe('ruleset win methods', () => {
  it('keeps points, submission-only, and EBI result fields distinct', () => {
    expect(getWinMethods('points')).toContain('Points');
    expect(getWinMethods('submission-only')).not.toContain('Points');
    expect(getWinMethods('ebi')).toContain('Overtime escape/riding time');
  });

  it('detects submission methods across rulesets', () => {
    expect(isSubmissionMethod('Submission')).toBe(true);
    expect(isSubmissionMethod('Overtime submission')).toBe(true);
    expect(isSubmissionMethod('Points')).toBe(false);
  });
});
