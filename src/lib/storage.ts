import type { TournamentState } from './types';
import { createId } from './id';

export const STORAGE_KEY = 'bjj-tournament-desk-state';
export const TOURNAMENT_STORE_KEY = 'bjj-tournament-desk-store';
export const ADMIN_PASSCODE_KEY = 'bjj-tournament-admin-passcode';

export interface StoredTournament {
  id: string;
  tournament: TournamentState;
}

export interface TournamentStore {
  activeTournamentId: string;
  tournaments: StoredTournament[];
}

export function emptyTournament(eventName = 'New BJJ Tournament'): TournamentState {
  return {
    eventName,
    competitors: [],
    divisions: [],
    updatedAt: new Date().toISOString()
  };
}

export function createStoredTournament(eventName = 'New BJJ Tournament'): StoredTournament {
  return {
    id: createId('tournament'),
    tournament: emptyTournament(eventName)
  };
}

export function loadTournamentStore(): TournamentStore {
  if (typeof localStorage === 'undefined') {
    const fallback = createStoredTournament();
    return { activeTournamentId: fallback.id, tournaments: [fallback] };
  }

  const rawStore = localStorage.getItem(TOURNAMENT_STORE_KEY);
  if (rawStore) {
    try {
      const parsed = JSON.parse(rawStore) as TournamentStore;
      if (isTournamentStore(parsed)) return normalizeTournamentStore(parsed);
    } catch {
      // Fall through to legacy migration.
    }
  }

  const migratedTournament = loadTournament();
  const migratedRecord: StoredTournament = {
    id: createId('tournament'),
    tournament: migratedTournament
  };
  const migratedStore = {
    activeTournamentId: migratedRecord.id,
    tournaments: [migratedRecord]
  };
  saveTournamentStore(migratedStore);
  return migratedStore;
}

export function saveTournamentStore(store: TournamentStore): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(TOURNAMENT_STORE_KEY, JSON.stringify(normalizeTournamentStore(store)));
}

export function loadTournament(): TournamentState {
  if (typeof localStorage === 'undefined') return emptyTournament();

  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return emptyTournament();

  try {
    const parsed = JSON.parse(raw) as TournamentState;
    if (!isTournamentState(parsed)) return emptyTournament();
    return parsed;
  } catch {
    return emptyTournament();
  }
}

export function saveTournament(tournament: TournamentState): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tournament));
}

export function hasAdminPasscode(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return Boolean(localStorage.getItem(ADMIN_PASSCODE_KEY));
}

export function setAdminPasscode(passcode: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(ADMIN_PASSCODE_KEY, passcode);
}

export function verifyAdminPasscode(passcode: string): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(ADMIN_PASSCODE_KEY) === passcode;
}

export function isTournamentState(value: unknown): value is TournamentState {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as TournamentState;
  return (
    typeof candidate.eventName === 'string' &&
    Array.isArray(candidate.competitors) &&
    Array.isArray(candidate.divisions) &&
    typeof candidate.updatedAt === 'string'
  );
}

function isTournamentStore(value: unknown): value is TournamentStore {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as TournamentStore;
  return (
    typeof candidate.activeTournamentId === 'string' &&
    Array.isArray(candidate.tournaments) &&
    candidate.tournaments.every(
      (record) =>
        record &&
        typeof record === 'object' &&
        typeof record.id === 'string' &&
        isTournamentState((record as StoredTournament).tournament)
    )
  );
}

function normalizeTournamentStore(store: TournamentStore): TournamentStore {
  if (store.tournaments.length === 0) {
    const fallback = createStoredTournament();
    return { activeTournamentId: fallback.id, tournaments: [fallback] };
  }

  const activeTournamentId = store.tournaments.some((record) => record.id === store.activeTournamentId)
    ? store.activeTournamentId
    : store.tournaments[0].id;

  return {
    activeTournamentId,
    tournaments: store.tournaments
  };
}
