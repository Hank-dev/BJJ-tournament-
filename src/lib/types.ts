export type TournamentFormat =
  | 'single-elimination'
  | 'round-robin'
  | 'double-elimination-bronze'
  | 'custom';

export type Ruleset = 'points' | 'submission-only' | 'ebi';

export type BracketStage = 'main' | 'bronze' | 'round-robin' | 'custom';

export type SlotOutcome = 'winner' | 'loser';

export type SlotSide = 'A' | 'B';

export interface Competitor {
  id: string;
  name: string;
  team?: string;
  belt?: string;
  ageClass?: string;
  weightClass?: string;
  monthsTrained?: string;
  gender?: string;
  divisionId?: string;
}

export interface Division {
  id: string;
  name: string;
  format: TournamentFormat;
  ruleset: Ruleset;
  competitorIds: string[];
  seedOrder: string[];
  bracket?: Bracket;
  createdAt: string;
  updatedAt: string;
}

export interface MatchSlot {
  competitorId?: string;
  sourceMatchId?: string;
  sourceOutcome?: SlotOutcome;
  label?: string;
  bye?: boolean;
}

export interface MatchResult {
  winnerId: string;
  loserId?: string;
  method: string;
  submissionType?: string;
  notes?: string;
  completedAt: string;
}

export interface Match {
  id: string;
  stage: BracketStage;
  round: number;
  position: number;
  label: string;
  slotA: MatchSlot;
  slotB: MatchSlot;
  result?: MatchResult;
}

export interface Bracket {
  id: string;
  format: TournamentFormat;
  matches: Match[];
  generatedAt: string;
}

export interface TournamentState {
  eventName: string;
  competitors: Competitor[];
  divisions: Division[];
  scheduleOrder?: string[];
  updatedAt: string;
}

export interface SlotResolution {
  competitorId?: string;
  label: string;
  ready: boolean;
  empty: boolean;
}

export interface ResolvedMatch {
  slotA: SlotResolution;
  slotB: SlotResolution;
  participantIds: string[];
  autoWinnerId?: string;
  canRecordResult: boolean;
}

export interface Standing {
  competitorId: string;
  matches: number;
  wins: number;
  losses: number;
  submissionWins: number;
}
