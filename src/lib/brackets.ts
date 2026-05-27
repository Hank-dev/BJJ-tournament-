import type {
  Bracket,
  BracketStage,
  Match,
  MatchResult,
  MatchSlot,
  ResolvedMatch,
  SlotOutcome,
  SlotSide,
  SlotResolution,
  Standing,
  TournamentFormat
} from './types';

export function nextPowerOfTwo(value: number): number {
  if (value <= 1) return 1;
  let power = 1;
  while (power < value) power *= 2;
  return power;
}

export function seededPositions(size: number): number[] {
  if (size <= 1) return [1];
  const previous = seededPositions(size / 2);
  return previous.flatMap((seed) => [seed, size + 1 - seed]);
}

function slotFromCompetitor(competitorId: string): MatchSlot {
  return { competitorId, label: 'Seed' };
}

function byeSlot(): MatchSlot {
  return { bye: true, label: 'Bye' };
}

function sourceSlot(
  sourceMatchId: string,
  sourceOutcome: SlotOutcome,
  label: string
): MatchSlot {
  return { sourceMatchId, sourceOutcome, label };
}

function matchId(stage: BracketStage, round: number, position: number): string {
  return `${stage}-r${round}-m${position}`;
}

function makeMatch(
  stage: BracketStage,
  round: number,
  position: number,
  slotA: MatchSlot,
  slotB: MatchSlot,
  label?: string
): Match {
  const defaultLabel =
    stage === 'bronze'
      ? `Bronze R${round} Match ${position}`
      : stage === 'round-robin'
        ? `Round ${round} Match ${position}`
        : `R${round} Match ${position}`;

  return {
    id: matchId(stage, round, position),
    stage,
    round,
    position,
    label: label ?? defaultLabel,
    slotA,
    slotB
  };
}

function arrangeSeededSlots(entrantSlots: MatchSlot[]): MatchSlot[] {
  const bracketSize = nextPowerOfTwo(Math.max(2, entrantSlots.length));
  const positions = seededPositions(bracketSize);

  return positions.map((seedNumber) => entrantSlots[seedNumber - 1] ?? byeSlot());
}

function generateEliminationMatches(
  entrantSlots: MatchSlot[],
  stage: Extract<BracketStage, 'main' | 'bronze'>,
  finalLabel?: string
): Match[] {
  if (entrantSlots.length < 2) return [];

  const slots = arrangeSeededSlots(entrantSlots);
  const firstRound: Match[] = [];

  for (let i = 0; i < slots.length; i += 2) {
    firstRound.push(makeMatch(stage, 1, firstRound.length + 1, slots[i], slots[i + 1]));
  }

  const matches = [...firstRound];
  let previousRound = firstRound;
  let round = 2;

  while (previousRound.length > 1) {
    const nextRound: Match[] = [];

    for (let i = 0; i < previousRound.length; i += 2) {
      const left = previousRound[i];
      const right = previousRound[i + 1];
      const position = nextRound.length + 1;
      const isFinal = previousRound.length === 2;
      const isSemifinal = previousRound.length === 4;
      const isQuarterfinal = previousRound.length === 8;

      const prefix = stage === 'bronze' ? 'Bronze ' : '';
      let roundLabel: string | undefined;
      if (isFinal) roundLabel = finalLabel;
      else if (isSemifinal) roundLabel = `${prefix}Semifinal ${position}`;
      else if (isQuarterfinal) roundLabel = `${prefix}Quarterfinal ${position}`;

      nextRound.push(
        makeMatch(
          stage,
          round,
          position,
          sourceSlot(left.id, 'winner', `Winner of ${left.label}`),
          sourceSlot(right.id, 'winner', `Winner of ${right.label}`),
          roundLabel
        )
      );
    }

    matches.push(...nextRound);
    previousRound = nextRound;
    round += 1;
  }

  return matches;
}

export function generateBracketForDivision(
  format: TournamentFormat,
  competitorIds: string[],
  seedOrder: string[] = competitorIds
): Bracket {
  const orderedEntrants = seedOrder.filter((id) => competitorIds.includes(id));
  const missingEntrants = competitorIds.filter((id) => !orderedEntrants.includes(id));
  const entrantIds = [...orderedEntrants, ...missingEntrants];
  let matches: Match[] = [];

  if (format === 'single-elimination') {
    matches = generateEliminationMatches(
      entrantIds.map(slotFromCompetitor),
      'main',
      'Gold Final'
    );
  }

  if (format === 'double-elimination-bronze') {
    const mainMatches = generateEliminationMatches(
      entrantIds.map(slotFromCompetitor),
      'main',
      'Gold Final'
    );
    const maxMainRound = Math.max(0, ...mainMatches.map((match) => match.round));
    const bronzeEntrants = mainMatches
      .filter((match) => match.round < maxMainRound)
      .map((match) => sourceSlot(match.id, 'loser', `Loser of ${match.label}`));
    const bronzeMatches = generateEliminationMatches(bronzeEntrants, 'bronze', 'Bronze Final');
    matches = [...mainMatches, ...bronzeMatches];
  }

  if (format === 'round-robin') {
    matches = generateRoundRobinMatches(entrantIds);
  }

  if (format === 'custom') {
    matches = [];
  }

  return {
    id: `bracket-${Date.now().toString(36)}`,
    format,
    matches,
    generatedAt: new Date().toISOString()
  };
}

export function generateRoundRobinMatches(competitorIds: string[]): Match[] {
  const matches: Match[] = [];
  let round = 1;

  for (let i = 0; i < competitorIds.length; i += 1) {
    for (let j = i + 1; j < competitorIds.length; j += 1) {
      matches.push(
        makeMatch(
          'round-robin',
          round,
          matches.filter((match) => match.round === round).length + 1,
          slotFromCompetitor(competitorIds[i]),
          slotFromCompetitor(competitorIds[j])
        )
      );
      round = round === competitorIds.length - 1 ? 1 : round + 1;
    }
  }

  return matches.sort((a, b) => a.round - b.round || a.position - b.position);
}

function findMatch(matches: Match[], id?: string): Match | undefined {
  return matches.find((match) => match.id === id);
}

export function resolveSlot(
  slot: MatchSlot,
  matches: Match[],
  seen = new Set<string>()
): SlotResolution {
  if (slot.competitorId) {
    return {
      competitorId: slot.competitorId,
      label: slot.label ?? slot.competitorId,
      ready: true,
      empty: false
    };
  }

  if (slot.sourceMatchId) {
    if (seen.has(slot.sourceMatchId)) {
      return { label: slot.label ?? 'Invalid source', ready: false, empty: false };
    }

    const source = findMatch(matches, slot.sourceMatchId);
    if (!source) {
      return { label: slot.label ?? 'Missing source', ready: true, empty: true };
    }

    const nextSeen = new Set(seen);
    nextSeen.add(slot.sourceMatchId);
    const competitorId =
      slot.sourceOutcome === 'loser'
        ? getMatchLoserId(source, matches, nextSeen)
        : getMatchWinnerId(source, matches, nextSeen);
    const sourceIsSettled = isMatchSettled(source, matches, nextSeen);

    if (competitorId) {
      return {
        competitorId,
        label: slot.label ?? competitorId,
        ready: true,
        empty: false
      };
    }

    return {
      label: slot.label ?? `${slot.sourceOutcome ?? 'Winner'} of ${source.label}`,
      ready: sourceIsSettled,
      empty: sourceIsSettled
    };
  }

  return {
    label: slot.label ?? 'Bye',
    ready: true,
    empty: true
  };
}

export function resolveMatch(match: Match, matches: Match[]): ResolvedMatch {
  const slotA = resolveSlot(match.slotA, matches);
  const slotB = resolveSlot(match.slotB, matches);
  const participantIds = [slotA.competitorId, slotB.competitorId].filter(
    (id): id is string => Boolean(id)
  );
  const autoWinnerId =
    !match.result && slotA.ready && slotB.ready && participantIds.length === 1
      ? participantIds[0]
      : undefined;

  return {
    slotA,
    slotB,
    participantIds,
    autoWinnerId,
    canRecordResult:
      slotA.ready &&
      slotB.ready &&
      Boolean(slotA.competitorId) &&
      Boolean(slotB.competitorId) &&
      slotA.competitorId !== slotB.competitorId
  };
}

export function getMatchWinnerId(
  match: Match,
  matches: Match[],
  seen = new Set<string>()
): string | undefined {
  if (match.result?.winnerId) return match.result.winnerId;
  return resolveMatchWithSeen(match, matches, seen).autoWinnerId;
}

export function getMatchLoserId(
  match: Match,
  matches: Match[],
  seen = new Set<string>()
): string | undefined {
  if (match.result?.loserId) return match.result.loserId;

  if (match.result?.winnerId) {
    const resolved = resolveMatchWithSeen(match, matches, seen);
    return resolved.participantIds.find((id) => id !== match.result?.winnerId);
  }

  return undefined;
}

function resolveMatchWithSeen(match: Match, matches: Match[], seen: Set<string>): ResolvedMatch {
  const slotA = resolveSlot(match.slotA, matches, seen);
  const slotB = resolveSlot(match.slotB, matches, seen);
  const participantIds = [slotA.competitorId, slotB.competitorId].filter(
    (id): id is string => Boolean(id)
  );
  const autoWinnerId =
    !match.result && slotA.ready && slotB.ready && participantIds.length === 1
      ? participantIds[0]
      : undefined;

  return {
    slotA,
    slotB,
    participantIds,
    autoWinnerId,
    canRecordResult:
      slotA.ready &&
      slotB.ready &&
      Boolean(slotA.competitorId) &&
      Boolean(slotB.competitorId) &&
      slotA.competitorId !== slotB.competitorId
  };
}

function isMatchSettled(match: Match, matches: Match[], seen: Set<string>): boolean {
  if (match.result) return true;
  const resolved = resolveMatchWithSeen(match, matches, seen);
  return Boolean(resolved.autoWinnerId) || (resolved.slotA.ready && resolved.slotB.ready);
}

export function applyMatchResult(
  bracket: Bracket,
  matchId: string,
  winnerId: string,
  method: string,
  submissionType?: string,
  notes?: string
): Bracket {
  const target = bracket.matches.find((match) => match.id === matchId);
  if (!target) return bracket;

  const resolved = resolveMatch(target, bracket.matches);
  const loserId = resolved.participantIds.find((id) => id !== winnerId);

  const result: MatchResult = {
    winnerId,
    loserId,
    method,
    submissionType: submissionType?.trim() || undefined,
    notes: notes?.trim() || undefined,
    completedAt: new Date().toISOString()
  };

  const matches = bracket.matches.map((match) =>
    match.id === matchId ? { ...match, result } : match
  );

  return {
    ...bracket,
    matches: normalizeBracketResults(matches)
  };
}

export function clearMatchResult(bracket: Bracket, matchId: string): Bracket {
  const matches = bracket.matches.map((match) => {
    if (match.id !== matchId) return match;
    const { result: _result, ...withoutResult } = match;
    return withoutResult;
  });

  return {
    ...bracket,
    matches: normalizeBracketResults(matches)
  };
}

export function updateMatchSlot(
  bracket: Bracket,
  matchId: string,
  side: SlotSide,
  slot: MatchSlot
): Bracket {
  const incomingId = slot.competitorId;

  const matches = bracket.matches.map((match) => {
    if (match.id === matchId) {
      const { result: _result, ...withoutResult } = match;
      return side === 'A'
        ? { ...withoutResult, slotA: slot }
        : { ...withoutResult, slotB: slot };
    }

    if (!incomingId) return match;

    const evictA = !match.slotA.sourceMatchId && match.slotA.competitorId === incomingId;
    const evictB = !match.slotB.sourceMatchId && match.slotB.competitorId === incomingId;
    if (!evictA && !evictB) return match;

    const { result: _result, ...withoutResult } = match;
    return {
      ...withoutResult,
      slotA: evictA ? byeSlot() : match.slotA,
      slotB: evictB ? byeSlot() : match.slotB,
    };
  });

  return {
    ...bracket,
    matches: normalizeBracketResults(matches)
  };
}

export function normalizeBracketResults(matches: Match[]): Match[] {
  let normalized = matches.map((match) => ({ ...match }));
  let changed = true;

  while (changed) {
    changed = false;
    normalized = normalized.map((match) => {
      if (!match.result) return match;

      const resolved = resolveMatch(match, normalized);
      const resultIsValid = resolved.participantIds.includes(match.result.winnerId);
      const loserIsValid =
        !match.result.loserId || resolved.participantIds.includes(match.result.loserId);

      if (resultIsValid && loserIsValid) return match;

      changed = true;
      const { result: _result, ...withoutResult } = match;
      return withoutResult;
    });
  }

  return normalized;
}

export function computeRoundRobinStandings(
  competitorIds: string[],
  matches: Match[]
): Standing[] {
  const standings = new Map<string, Standing>();

  competitorIds.forEach((competitorId) => {
    standings.set(competitorId, {
      competitorId,
      matches: 0,
      wins: 0,
      losses: 0,
      submissionWins: 0
    });
  });

  matches
    .filter((match) => match.stage === 'round-robin' && match.result)
    .forEach((match) => {
      const winner = match.result?.winnerId;
      const loser = match.result?.loserId;
      if (!winner) return;

      const winnerStanding = standings.get(winner);
      if (winnerStanding) {
        winnerStanding.matches += 1;
        winnerStanding.wins += 1;
        if (match.result?.method.toLowerCase().includes('submission')) {
          winnerStanding.submissionWins += 1;
        }
      }

      if (loser) {
        const loserStanding = standings.get(loser);
        if (loserStanding) {
          loserStanding.matches += 1;
          loserStanding.losses += 1;
        }
      }
    });

  return [...standings.values()].sort(
    (a, b) =>
      b.wins - a.wins ||
      b.submissionWins - a.submissionWins ||
      a.losses - b.losses ||
      a.competitorId.localeCompare(b.competitorId)
  );
}

export function getPlacements(
  format: TournamentFormat,
  competitorIds: string[],
  bracket?: Bracket
): { gold?: string; silver?: string; bronze?: string } {
  if (!bracket || bracket.matches.length === 0) {
    return competitorIds.length === 1 ? { gold: competitorIds[0] } : {};
  }

  if (format === 'round-robin') {
    const standings = computeRoundRobinStandings(competitorIds, bracket.matches);
    return {
      gold: standings[0]?.competitorId,
      silver: standings[1]?.competitorId,
      bronze: standings[2]?.competitorId
    };
  }

  const mainFinal = getFinalMatch(bracket.matches, 'main');
  const bronzeFinal = getFinalMatch(bracket.matches, 'bronze');

  return {
    gold: mainFinal ? getMatchWinnerId(mainFinal, bracket.matches) : undefined,
    silver: mainFinal ? getMatchLoserId(mainFinal, bracket.matches) : undefined,
    bronze: bronzeFinal ? getMatchWinnerId(bronzeFinal, bracket.matches) : undefined
  };
}

function getFinalMatch(matches: Match[], stage: BracketStage): Match | undefined {
  const stageMatches = matches.filter((match) => match.stage === stage);
  const maxRound = Math.max(0, ...stageMatches.map((match) => match.round));
  return stageMatches.find((match) => match.round === maxRound);
}

export function addCustomMatch(
  bracket: Bracket | undefined,
  round: number,
  slotA: MatchSlot,
  slotB: MatchSlot
): Bracket {
  const baseBracket: Bracket =
    bracket?.format === 'custom'
      ? bracket
      : {
          id: `bracket-${Date.now().toString(36)}`,
          format: 'custom',
          matches: [],
          generatedAt: new Date().toISOString()
        };

  const position =
    baseBracket.matches.filter((match) => match.stage === 'custom' && match.round === round)
      .length + 1;
  const customMatch: Match = {
    id: `custom-r${round}-m${position}-${Date.now().toString(36)}`,
    stage: 'custom',
    round,
    position,
    label: `Custom R${round} Match ${position}`,
    slotA,
    slotB
  };

  return {
    ...baseBracket,
    matches: normalizeBracketResults([...baseBracket.matches, customMatch])
  };
}

export interface ScheduledMatch {
  order: number;
  mat: number;
  match: Match;
  divisionId: string;
  divisionName: string;
  tag?: 'bronze-final' | 'gold-final';
}

interface DivisionEntry {
  division: { id: string; name: string; format: TournamentFormat };
  matches: Match[];
}

export function computeTournamentSchedule(
  divisions: DivisionEntry[],
  matCount: number
): ScheduledMatch[] {
  const mats = Math.max(1, matCount);

  const allEntries: Array<{ match: Match; divId: string; divName: string }> = [];
  const bronzeFinals: typeof allEntries = [];
  const goldFinals: typeof allEntries = [];

  for (const { division, matches } of divisions) {
    if (matches.length === 0) continue;

    const realMatches = matches.filter((m) => !isByeMatch(m));
    const mainMatches = realMatches.filter((m) => m.stage === 'main');
    const bronzeMatches = realMatches.filter((m) => m.stage === 'bronze');
    const otherMatches = realMatches.filter((m) => m.stage !== 'main' && m.stage !== 'bronze');

    const maxMainRound = mainMatches.length > 0 ? Math.max(...mainMatches.map((m) => m.round)) : 0;
    const maxBronzeRound = bronzeMatches.length > 0 ? Math.max(...bronzeMatches.map((m) => m.round)) : 0;

    for (const m of mainMatches) {
      const entry = { match: m, divId: division.id, divName: division.name };
      if (m.round === maxMainRound) goldFinals.push(entry);
      else allEntries.push(entry);
    }

    for (const m of bronzeMatches) {
      const entry = { match: m, divId: division.id, divName: division.name };
      if (m.round === maxBronzeRound) bronzeFinals.push(entry);
      else allEntries.push(entry);
    }

    for (const m of otherMatches) {
      allEntries.push({ match: m, divId: division.id, divName: division.name });
    }
  }

  const allMatches = divisions.flatMap((d) => d.matches);

  const depLevel = (entry: typeof allEntries[0]): number => {
    return computeDepth(entry.match, allMatches);
  };
  allEntries.sort((a, b) => depLevel(a) - depLevel(b) || a.match.position - b.match.position);

  const scheduled: ScheduledMatch[] = [];
  const athleteLastSlot = new Map<string, number>();
  const matNextFree: number[] = new Array(mats).fill(0);

  const scheduleEntry = (
    entry: typeof allEntries[0],
    tag?: ScheduledMatch['tag']
  ) => {
    const competitors = collectDirectCompetitors(entry.match);

    let bestMat = 0;
    let bestScore = -Infinity;

    for (let m = 0; m < mats; m++) {
      let score = -matNextFree[m];
      for (const id of competitors) {
        const last = athleteLastSlot.get(id);
        if (last !== undefined) {
          const gap = scheduled.length - last;
          score += gap;
        } else {
          score += 1000;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestMat = m;
      }
    }

    const order = scheduled.length + 1;
    scheduled.push({
      order,
      mat: bestMat + 1,
      match: entry.match,
      divisionId: entry.divId,
      divisionName: entry.divName,
      tag,
    });

    for (const id of competitors) {
      athleteLastSlot.set(id, scheduled.length - 1);
    }
    matNextFree[bestMat] = scheduled.length;
  };

  const remaining = [...allEntries];
  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestMinGap = -1;

    for (let i = 0; i < remaining.length; i++) {
      const competitors = collectDirectCompetitors(remaining[i].match);
      let minGap = Infinity;
      for (const id of competitors) {
        const last = athleteLastSlot.get(id);
        if (last !== undefined) {
          minGap = Math.min(minGap, scheduled.length - last);
        }
      }
      if (minGap > bestMinGap) {
        bestMinGap = minGap;
        bestIdx = i;
      }
    }

    scheduleEntry(remaining.splice(bestIdx, 1)[0]);
  }

  for (const entry of bronzeFinals) {
    scheduleEntry(entry, 'bronze-final');
  }

  for (const entry of goldFinals) {
    scheduleEntry(entry, 'gold-final');
  }

  return scheduled;
}

function computeDepth(match: Match, allMatches: Match[], seen = new Set<string>()): number {
  if (seen.has(match.id)) return 0;
  seen.add(match.id);

  let maxDep = 0;
  for (const slot of [match.slotA, match.slotB]) {
    if (slot.sourceMatchId) {
      const source = allMatches.find((m) => m.id === slot.sourceMatchId);
      if (source) maxDep = Math.max(maxDep, 1 + computeDepth(source, allMatches, seen));
    }
  }
  return maxDep;
}

export function isByeMatch(match: Match): boolean {
  return (
    (match.slotA.bye === true || match.slotB.bye === true) ||
    (!match.slotA.competitorId && !match.slotA.sourceMatchId && !match.slotB.competitorId && !match.slotB.sourceMatchId)
  );
}

function collectDirectCompetitors(match: Match): string[] {
  const ids: string[] = [];
  if (match.slotA.competitorId) ids.push(match.slotA.competitorId);
  if (match.slotB.competitorId) ids.push(match.slotB.competitorId);
  return ids;
}

export function makeCompetitorSlot(competitorId: string): MatchSlot {
  return slotFromCompetitor(competitorId);
}

export function makeByeSlot(): MatchSlot {
  return byeSlot();
}

export function makeSourceSlot(matchId: string, outcome: SlotOutcome, label: string): MatchSlot {
  return sourceSlot(matchId, outcome, label);
}
