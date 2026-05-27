import type { Ruleset, TournamentFormat } from './types';

export const formatLabels: Record<TournamentFormat, string> = {
  'single-elimination': 'Single elimination',
  'round-robin': 'Round robin',
  'double-elimination-bronze': 'Double elimination bronze',
  custom: 'Custom bracket'
};

export const rulesetLabels: Record<Ruleset, string> = {
  points: 'Points',
  'submission-only': 'Submission-only',
  ebi: 'EBI'
};

const methodsByRuleset: Record<Ruleset, string[]> = {
  points: [
    'Submission',
    'Points',
    'Advantage',
    'Referee decision',
    'DQ',
    'Walkover',
    'Injury'
  ],
  'submission-only': ['Submission', 'Referee decision', 'DQ', 'Walkover', 'Injury'],
  ebi: [
    'Regulation submission',
    'Overtime submission',
    'Overtime escape/riding time',
    'DQ',
    'Walkover',
    'Injury'
  ]
};

export function getWinMethods(ruleset: Ruleset): string[] {
  return methodsByRuleset[ruleset];
}

export function getDefaultWinMethod(ruleset: Ruleset): string {
  return methodsByRuleset[ruleset][0];
}

export function isSubmissionMethod(method: string): boolean {
  return method.toLowerCase().includes('submission');
}
