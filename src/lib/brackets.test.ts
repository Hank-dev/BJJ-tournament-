import { describe, expect, it } from 'vitest';
import {
  applyMatchResult,
  clearMatchResult,
  computeRoundRobinStandings,
  generateBracketForDivision,
  getMatchLoserId,
  getMatchWinnerId,
  getPlacements,
  makeCompetitorSlot,
  resolveMatch,
  updateMatchSlot
} from './brackets';

describe('single elimination brackets', () => {
  it('generates a full bracket with automatic byes for odd sizes', () => {
    const bracket = generateBracketForDivision('single-elimination', ['a', 'b', 'c', 'd', 'e']);
    const firstMatch = bracket.matches.find((match) => match.id === 'main-r1-m1');
    const resolved = resolveMatch(firstMatch!, bracket.matches);

    expect(bracket.matches).toHaveLength(7);
    expect(resolved.autoWinnerId).toBe('a');
    expect(getMatchWinnerId(firstMatch!, bracket.matches)).toBe('a');
  });

  it('does not create matches for one competitor', () => {
    const bracket = generateBracketForDivision('single-elimination', ['a']);

    expect(bracket.matches).toHaveLength(0);
  });

  it('advances winners and clears invalid downstream results when an earlier result changes', () => {
    let bracket = generateBracketForDivision('single-elimination', ['a', 'b', 'c', 'd']);
    bracket = applyMatchResult(bracket, 'main-r1-m1', 'a', 'Submission');
    bracket = applyMatchResult(bracket, 'main-r1-m2', 'b', 'Points');

    const final = bracket.matches.find((match) => match.id === 'main-r2-m1')!;
    expect(resolveMatch(final, bracket.matches).participantIds).toEqual(['a', 'b']);

    bracket = applyMatchResult(bracket, final.id, 'a', 'Points');
    expect(bracket.matches.find((match) => match.id === final.id)?.result?.winnerId).toBe('a');

    bracket = applyMatchResult(bracket, 'main-r1-m1', 'd', 'Submission');
    expect(resolveMatch(final, bracket.matches).participantIds).toEqual(['d', 'b']);
    expect(bracket.matches.find((match) => match.id === final.id)?.result).toBeUndefined();
  });

  it('updates generated starting slots and clears dependent results', () => {
    let bracket = generateBracketForDivision('single-elimination', ['a', 'b', 'c', 'd']);
    bracket = applyMatchResult(bracket, 'main-r1-m1', 'a', 'Submission');
    bracket = applyMatchResult(bracket, 'main-r1-m2', 'b', 'Points');
    bracket = applyMatchResult(bracket, 'main-r2-m1', 'a', 'Points');

    bracket = updateMatchSlot(bracket, 'main-r1-m1', 'A', makeCompetitorSlot('c'));

    expect(bracket.matches.find((match) => match.id === 'main-r1-m1')?.slotA.competitorId).toBe('c');
    expect(bracket.matches.find((match) => match.id === 'main-r1-m1')?.result).toBeUndefined();
    expect(bracket.matches.find((match) => match.id === 'main-r2-m1')?.result).toBeUndefined();
  });

  it('clears stale submission type when a non-submission method is saved', () => {
    let bracket = generateBracketForDivision('single-elimination', ['a', 'b']);
    bracket = applyMatchResult(bracket, 'main-r1-m1', 'a', 'Submission', 'Armbar');
    expect(bracket.matches[0].result?.submissionType).toBe('Armbar');

    bracket = applyMatchResult(bracket, 'main-r1-m1', 'a', 'Points', 'Armbar');
    expect(bracket.matches[0].result?.method).toBe('Points');
    expect(bracket.matches[0].result?.submissionType).toBeUndefined();
  });

  it('does not place winners until every real match is completed', () => {
    let bracket = generateBracketForDivision('single-elimination', ['a', 'b', 'c']);
    bracket = applyMatchResult(bracket, 'main-r1-m2', 'b', 'Points');

    expect(getPlacements('single-elimination', ['a', 'b', 'c'], bracket)).toEqual({});

    bracket = applyMatchResult(bracket, 'main-r2-m1', 'a', 'Submission');

    expect(getPlacements('single-elimination', ['a', 'b', 'c'], bracket)).toEqual({
      gold: 'a',
      silver: 'b'
    });
  });

  it('evicts a competitor from their old slot when swapped into a new one', () => {
    // Seeded layout: match1(a vs d), match2(b vs c)
    const bracket = generateBracketForDivision('single-elimination', ['a', 'b', 'c', 'd']);

    // Swap 'c' (match 2 slot B) into match 1 slot A (replacing 'a')
    const updated = updateMatchSlot(bracket, 'main-r1-m1', 'A', makeCompetitorSlot('c'));

    // 'c' should now be in match 1 slot A
    expect(updated.matches.find((m) => m.id === 'main-r1-m1')?.slotA.competitorId).toBe('c');

    // 'c' should no longer be in match 2 slot B — replaced with bye
    const match2 = updated.matches.find((m) => m.id === 'main-r1-m2')!;
    expect(match2.slotB.competitorId).toBeUndefined();
    expect(match2.slotB.bye).toBe(true);

    // 'd' (match 1 slot B) and 'b' (match 2 slot A) should be untouched
    expect(updated.matches.find((m) => m.id === 'main-r1-m1')?.slotB.competitorId).toBe('d');
    expect(match2.slotA.competitorId).toBe('b');
  });
});

describe('double elimination bronze brackets', () => {
  it('places main bracket losers into a bronze bracket', () => {
    let bracket = generateBracketForDivision('double-elimination-bronze', ['a', 'b', 'c', 'd']);
    bracket = applyMatchResult(bracket, 'main-r1-m1', 'a', 'Submission');
    bracket = applyMatchResult(bracket, 'main-r1-m2', 'b', 'Points');

    const bronzeFinal = bracket.matches.find((match) => match.id === 'bronze-r1-m1')!;
    const resolvedBronze = resolveMatch(bronzeFinal, bracket.matches);

    expect(bracket.matches.filter((match) => match.stage === 'bronze')).toHaveLength(1);
    expect(resolvedBronze.participantIds).toEqual(['d', 'c']);
    expect(getMatchLoserId(bracket.matches.find((match) => match.id === 'main-r1-m1')!, bracket.matches)).toBe(
      'd'
    );
  });

  it('bronze bracket updates when a main bracket result changes', () => {
    let bracket = generateBracketForDivision('double-elimination-bronze', ['a', 'b', 'c', 'd']);
    bracket = applyMatchResult(bracket, 'main-r1-m1', 'a', 'Submission');
    bracket = applyMatchResult(bracket, 'main-r1-m2', 'b', 'Points');

    // Bronze should have losers d vs c
    let bronze = bracket.matches.find((m) => m.stage === 'bronze')!;
    expect(resolveMatch(bronze, bracket.matches).participantIds).toEqual(['d', 'c']);

    // Record bronze result
    bracket = applyMatchResult(bracket, bronze.id, 'd', 'Submission');
    bronze = bracket.matches.find((m) => m.stage === 'bronze')!;
    expect(bronze.result?.winnerId).toBe('d');

    // Now change main-r1-m1 winner from a to d (loser becomes a instead of d)
    bracket = applyMatchResult(bracket, 'main-r1-m1', 'd', 'Points');
    bronze = bracket.matches.find((m) => m.stage === 'bronze')!;

    // Bronze should now have losers a vs c (d moved to main winner)
    expect(resolveMatch(bronze, bracket.matches).participantIds).toEqual(['a', 'c']);
    // Old bronze result (winner d) should be cleared since d is no longer in bronze
    expect(bronze.result).toBeUndefined();
  });

  it('bronze bracket clears when a main bracket result is cleared', () => {
    let bracket = generateBracketForDivision('double-elimination-bronze', ['a', 'b', 'c', 'd']);
    bracket = applyMatchResult(bracket, 'main-r1-m1', 'a', 'Submission');
    bracket = applyMatchResult(bracket, 'main-r1-m2', 'b', 'Points');

    // Record bronze result
    let bronze = bracket.matches.find((m) => m.stage === 'bronze')!;
    bracket = applyMatchResult(bracket, bronze.id, 'd', 'Points');
    bronze = bracket.matches.find((m) => m.stage === 'bronze')!;
    expect(bronze.result?.winnerId).toBe('d');

    // Clear main-r1-m1 result
    bracket = clearMatchResult(bracket, 'main-r1-m1');
    bronze = bracket.matches.find((m) => m.stage === 'bronze')!;

    // Bronze result should be cleared (slot A is now unresolved)
    expect(bronze.result).toBeUndefined();
    const resolved = resolveMatch(bronze, bracket.matches);
    expect(resolved.canRecordResult).toBe(false);
  });
});

describe('round robin brackets', () => {
  it('generates every pairing and sorts standings by wins then submission wins', () => {
    let bracket = generateBracketForDivision('round-robin', ['a', 'b', 'c']);
    expect(bracket.matches).toHaveLength(3);

    bracket = applyMatchResult(bracket, 'round-robin-r1-m1', 'a', 'Submission');
    bracket = applyMatchResult(bracket, 'round-robin-r2-m1', 'a', 'Points');
    bracket = applyMatchResult(bracket, 'round-robin-r1-m2', 'b', 'Submission');

    const standings = computeRoundRobinStandings(['a', 'b', 'c'], bracket.matches);

    expect(standings[0]).toMatchObject({ competitorId: 'a', wins: 2, submissionWins: 1 });
    expect(standings[1]).toMatchObject({ competitorId: 'b', wins: 1, submissionWins: 1 });
  });
});
