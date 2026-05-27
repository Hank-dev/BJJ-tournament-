import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CalendarClock,
  CheckCircle2,
  Download,
  FileJson,
  FileSpreadsheet,
  GripVertical,
  Eye,
  LayoutGrid,
  ListChecks,
  ListOrdered,
  Lock,
  LogOut,
  Medal,
  Moon,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Search,
  Shuffle,
  Sun,
  Trash2,
  Trophy,
  Upload,
  Users,
  X
} from 'lucide-react';
import {
  addCustomMatch,
  applyMatchResult,
  clearMatchResult,
  computeRoundRobinStandings,
  computeTournamentSchedule,
  generateBracketForDivision,
  getMatchWinnerId,
  getPlacements,
  makeByeSlot,
  makeCompetitorSlot,
  makeSourceSlot,
  resolveMatch,
  updateMatchSlot,
  type ScheduledMatch
} from './lib/brackets';
import { parseCompetitorCsv, csvTemplate, type CsvCompetitorRow } from './lib/csv';
import { createId } from './lib/id';
import { formatLabels, getDefaultWinMethod, getWinMethods, isSubmissionMethod, rulesetLabels } from './lib/rulesets';
import {
  createStoredTournament,
  emptyTournament,
  hasAdminPasscode,
  isTournamentState,
  loadTournamentStore,
  saveTournamentStore,
  setAdminPasscode,
  verifyAdminPasscode,
  type TournamentStore
} from './lib/storage';
import {
  isAbortError,
  isRemoteStoreEnabled,
  loadRemoteTournamentStore,
  saveRemoteTournamentStore,
  verifyRemoteAdminPasscode
} from './lib/remoteStorage';
import type {
  Bracket,
  Competitor,
  Division,
  Match,
  MatchResult,
  MatchSlot,
  Ruleset,
  SlotSide,
  TournamentFormat,
  TournamentState
} from './lib/types';

type TabId = 'competitors' | 'divisions' | 'brackets' | 'schedule' | 'results' | 'import-export';
type GuestTabId = 'brackets' | 'schedule' | 'results';
type SessionMode = 'entry' | 'admin' | 'guest';

type CompetitorField = keyof Pick<
  Competitor,
  'name' | 'weightClass' | 'monthsTrained' | 'gender'
>;

type CompetitorSortKey = CompetitorField | 'division';
type SortDirection = 'asc' | 'desc';

interface CompetitorSortState {
  key: CompetitorSortKey;
  direction: SortDirection;
}

const navItems: Array<{ id: TabId; label: string; icon: React.ReactNode }> = [
  { id: 'competitors', label: 'Competitors', icon: <Users size={14} /> },
  { id: 'divisions', label: 'Divisions', icon: <LayoutGrid size={14} /> },
  { id: 'brackets', label: 'Brackets', icon: <Trophy size={14} /> },
  { id: 'schedule', label: 'Schedule', icon: <CalendarClock size={14} /> },
  { id: 'results', label: 'Results', icon: <Medal size={14} /> },
  { id: 'import-export', label: 'Import / Export', icon: <Download size={14} /> },
];

const defaultDivisionFormat: TournamentFormat = 'single-elimination';
const defaultRuleset: Ruleset = 'points';

const formatOptions: TournamentFormat[] = [
  'single-elimination',
  'round-robin',
  'double-elimination-bronze',
  'custom'
];

const rulesetOptions: Ruleset[] = ['points', 'submission-only', 'ebi'];

interface CsvImportPreview {
  rows: CsvCompetitorRow[];
  errors: string[];
  fileName?: string;
}

function App() {
  const [tournamentStore, setTournamentStore] = useState<TournamentStore>(() => loadTournamentStore());
  const [sessionMode, setSessionMode] = useState<SessionMode>('entry');
  const [adminPasscodeConfigured, setAdminPasscodeConfigured] = useState(
    () => hasAdminPasscode() || isRemoteStoreEnabled()
  );
  const [adminSessionPasscode, setAdminSessionPasscode] = useState('');
  const [remoteStoreReady, setRemoteStoreReady] = useState(() => !isRemoteStoreEnabled());
  const [activeTab, setActiveTab] = useState<TabId>('competitors');
  const [guestTab, setGuestTab] = useState<GuestTabId>('brackets');
  const [selectedDivisionId, setSelectedDivisionId] = useState<string>('');
  const [csvPreview, setCsvPreview] = useState<CsvImportPreview>({ rows: [], errors: [] });
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [highlightedMatchId, setHighlightedMatchId] = useState<string | null>(null);

  const activeTournamentRecord =
    tournamentStore.tournaments.find((record) => record.id === tournamentStore.activeTournamentId) ??
    tournamentStore.tournaments[0];
  const tournament = activeTournamentRecord?.tournament ?? emptyTournament();

  const navigateToMatch = (divisionId: string, matchId: string) => {
    setSelectedDivisionId(divisionId);
    setHighlightedMatchId(matchId);
    setActiveTab('brackets');
    setGuestTab('brackets');
  };

  useEffect(() => {
    if (!isRemoteStoreEnabled()) return;

    const controller = new AbortController();
    let cancelled = false;

    loadRemoteTournamentStore(controller.signal)
      .then((remoteStore) => {
        if (cancelled || !remoteStore) return;
        setTournamentStore(remoteStore);
        setSelectedDivisionId('');
      })
      .catch((error) => {
        if (!isAbortError(error)) {
          console.warn('Remote tournament store could not be loaded.', error);
        }
      })
      .finally(() => {
        if (cancelled) return;
        setRemoteStoreReady(true);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    saveTournamentStore(tournamentStore);

    if (!isRemoteStoreEnabled() || !remoteStoreReady || sessionMode !== 'admin') return;

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      saveRemoteTournamentStore(tournamentStore, adminSessionPasscode, controller.signal).catch((error) => {
        if (!isAbortError(error)) {
          console.warn('Tournament store could not be saved remotely.', error);
        }
      });
    }, 300);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [adminSessionPasscode, remoteStoreReady, sessionMode, tournamentStore]);

  useEffect(() => {
    if (!selectedDivisionId && tournament.divisions[0]) {
      setSelectedDivisionId(tournament.divisions[0].id);
    }

    if (
      selectedDivisionId &&
      !tournament.divisions.some((division) => division.id === selectedDivisionId)
    ) {
      setSelectedDivisionId(tournament.divisions[0]?.id ?? '');
    }
  }, [selectedDivisionId, tournament.divisions]);

  const competitorById = useMemo(() => {
    return new Map(tournament.competitors.map((competitor) => [competitor.id, competitor]));
  }, [tournament.competitors]);

  const commitTournament = (updater: (current: TournamentState) => TournamentState) => {
    setTournamentStore((currentStore) => {
      const activeId = currentStore.activeTournamentId;
      return {
        ...currentStore,
        tournaments: currentStore.tournaments.map((record) =>
          record.id === activeId
            ? {
                ...record,
                tournament: {
                  ...updater(record.tournament),
                  updatedAt: new Date().toISOString()
                }
              }
            : record
        )
      };
    });
  };

  const selectTournament = (tournamentId: string) => {
    setTournamentStore((currentStore) => ({ ...currentStore, activeTournamentId: tournamentId }));
    setSelectedDivisionId('');
    setHighlightedMatchId(null);
    setCsvPreview({ rows: [], errors: [] });
  };

  const createTournament = () => {
    const record = createStoredTournament(`Tournament ${tournamentStore.tournaments.length + 1}`);
    setTournamentStore((currentStore) => ({
      activeTournamentId: record.id,
      tournaments: [...currentStore.tournaments, record]
    }));
    setSelectedDivisionId('');
    setHighlightedMatchId(null);
    setCsvPreview({ rows: [], errors: [] });
    setActiveTab('competitors');
  };

  const deleteActiveTournament = () => {
    setTournamentStore((currentStore) => {
      const remaining = currentStore.tournaments.filter(
        (record) => record.id !== currentStore.activeTournamentId
      );
      if (remaining.length > 0) {
        return {
          activeTournamentId: remaining[0].id,
          tournaments: remaining
        };
      }

      const replacement = createStoredTournament();
      return {
        activeTournamentId: replacement.id,
        tournaments: [replacement]
      };
    });
    setSelectedDivisionId('');
    setHighlightedMatchId(null);
    setCsvPreview({ rows: [], errors: [] });
  };

  const handleAdminPasscodeSubmit = async (passcode: string): Promise<boolean> => {
    const trimmedPasscode = passcode.trim();
    if (!trimmedPasscode) return false;

    if (isRemoteStoreEnabled()) {
      try {
        const accepted = await verifyRemoteAdminPasscode(trimmedPasscode);
        if (!accepted) return false;
      } catch (error) {
        if (!isAbortError(error)) {
          console.warn('Admin passcode could not be verified remotely.', error);
        }
        return false;
      }

      setAdminSessionPasscode(trimmedPasscode);
      if (!adminPasscodeConfigured) {
        setAdminPasscode(trimmedPasscode);
        setAdminPasscodeConfigured(true);
      }
      setSessionMode('admin');
      return true;
    }

    if (!adminPasscodeConfigured) {
      setAdminPasscode(trimmedPasscode);
      setAdminPasscodeConfigured(true);
      setAdminSessionPasscode(trimmedPasscode);
      setSessionMode('admin');
      return true;
    }

    if (verifyAdminPasscode(trimmedPasscode)) {
      setAdminSessionPasscode(trimmedPasscode);
      setSessionMode('admin');
      return true;
    }

    return false;
  };

  const updateEventName = (eventName: string) => {
    commitTournament((current) => ({ ...current, eventName }));
  };

  const addCompetitor = (draft: Omit<Competitor, 'id'>) => {
    const competitor: Competitor = {
      ...draft,
      id: createId('competitor')
    };

    commitTournament((current) => {
      const divisions = current.divisions.map((division) => {
        if (division.id !== competitor.divisionId) return division;
        return syncDivisionSeeds({
          ...division,
          competitorIds: appendUnique(division.competitorIds, competitor.id),
          seedOrder: appendUnique(division.seedOrder, competitor.id),
          bracket: undefined,
          updatedAt: new Date().toISOString()
        });
      });

      return {
        ...current,
        competitors: [...current.competitors, competitor],
        divisions
      };
    });
  };

  const updateCompetitorField = (competitorId: string, field: CompetitorField, value: string) => {
    commitTournament((current) => ({
      ...current,
      competitors: current.competitors.map((competitor) =>
        competitor.id === competitorId
          ? { ...competitor, [field]: value.trim() || undefined }
          : competitor
      )
    }));
  };

  const assignCompetitor = (competitorId: string, nextDivisionId: string) => {
    commitTournament((current) => {
      const previousDivisionId = current.competitors.find((competitor) => competitor.id === competitorId)
        ?.divisionId;
      const affectedDivisionIds = new Set([previousDivisionId, nextDivisionId].filter(Boolean));

      return {
        ...current,
        competitors: current.competitors.map((competitor) =>
          competitor.id === competitorId
            ? { ...competitor, divisionId: nextDivisionId || undefined }
            : competitor
        ),
        divisions: current.divisions.map((division) => {
          const withoutCompetitor = division.competitorIds.filter((id) => id !== competitorId);
          const withoutSeed = division.seedOrder.filter((id) => id !== competitorId);
          const belongsHere = division.id === nextDivisionId;
          const nextDivision = syncDivisionSeeds({
            ...division,
            competitorIds: belongsHere ? appendUnique(withoutCompetitor, competitorId) : withoutCompetitor,
            seedOrder: belongsHere ? appendUnique(withoutSeed, competitorId) : withoutSeed,
            bracket: affectedDivisionIds.has(division.id) ? undefined : division.bracket,
            updatedAt: affectedDivisionIds.has(division.id) ? new Date().toISOString() : division.updatedAt
          });
          return nextDivision;
        })
      };
    });
  };

  const deleteCompetitor = (competitorId: string) => {
    commitTournament((current) => ({
      ...current,
      competitors: current.competitors.filter((competitor) => competitor.id !== competitorId),
      divisions: current.divisions.map((division) =>
        syncDivisionSeeds({
          ...division,
          competitorIds: division.competitorIds.filter((id) => id !== competitorId),
          seedOrder: division.seedOrder.filter((id) => id !== competitorId),
          bracket: division.competitorIds.includes(competitorId) ? undefined : division.bracket,
          updatedAt: division.competitorIds.includes(competitorId)
            ? new Date().toISOString()
            : division.updatedAt
        })
      )
    }));
  };

  const addDivision = (name: string, format: TournamentFormat, ruleset: Ruleset) => {
    const trimmedName = name.trim();
    if (!trimmedName) return;

    const division: Division = {
      id: createId('division'),
      name: trimmedName,
      format,
      ruleset,
      competitorIds: [],
      seedOrder: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    commitTournament((current) => ({
      ...current,
      divisions: [...current.divisions, division]
    }));
    setSelectedDivisionId(division.id);
  };

  const updateDivision = (
    divisionId: string,
    patch: Partial<Pick<Division, 'name' | 'format' | 'ruleset'>>
  ) => {
    commitTournament((current) => ({
      ...current,
      divisions: current.divisions.map((division) => {
        if (division.id !== divisionId) return division;
        const formatChanged = patch.format && patch.format !== division.format;
        return syncDivisionSeeds({
          ...division,
          ...patch,
          bracket: formatChanged ? undefined : division.bracket,
          updatedAt: new Date().toISOString()
        });
      })
    }));
  };

  const deleteDivision = (divisionId: string) => {
    commitTournament((current) => ({
      ...current,
      competitors: current.competitors.map((competitor) =>
        competitor.divisionId === divisionId ? { ...competitor, divisionId: undefined } : competitor
      ),
      divisions: current.divisions.filter((division) => division.id !== divisionId)
    }));
  };

  const moveSeed = (divisionId: string, competitorId: string, direction: -1 | 1) => {
    commitTournament((current) => ({
      ...current,
      divisions: current.divisions.map((division) => {
        if (division.id !== divisionId) return division;
        const seedOrder = syncDivisionSeeds(division).seedOrder;
        const index = seedOrder.indexOf(competitorId);
        const nextIndex = index + direction;
        if (index < 0 || nextIndex < 0 || nextIndex >= seedOrder.length) return division;
        const nextSeedOrder = [...seedOrder];
        [nextSeedOrder[index], nextSeedOrder[nextIndex]] = [nextSeedOrder[nextIndex], nextSeedOrder[index]];
        return { ...division, seedOrder: nextSeedOrder, bracket: undefined, updatedAt: new Date().toISOString() };
      })
    }));
  };

  const reorderSeed = (divisionId: string, draggedId: string, targetId: string) => {
    if (draggedId === targetId) return;

    commitTournament((current) => ({
      ...current,
      divisions: current.divisions.map((division) => {
        if (division.id !== divisionId) return division;
        const seedOrder = syncDivisionSeeds(division).seedOrder;
        const withoutDragged = seedOrder.filter((id) => id !== draggedId);
        const targetIndex = withoutDragged.indexOf(targetId);
        if (targetIndex < 0) return division;
        withoutDragged.splice(targetIndex, 0, draggedId);
        return {
          ...division,
          seedOrder: withoutDragged,
          bracket: undefined,
          updatedAt: new Date().toISOString()
        };
      })
    }));
  };

  const shuffleSeeds = (divisionId: string) => {
    commitTournament((current) => ({
      ...current,
      divisions: current.divisions.map((division) => {
        if (division.id !== divisionId) return division;
        return {
          ...division,
          seedOrder: shuffleArray(syncDivisionSeeds(division).seedOrder),
          bracket: undefined,
          updatedAt: new Date().toISOString()
        };
      })
    }));
  };

  const generateBracket = (divisionId: string) => {
    commitTournament((current) => ({
      ...current,
      divisions: current.divisions.map((division) => {
        if (division.id !== divisionId) return division;
        const synced = syncDivisionSeeds(division);
        return {
          ...synced,
          bracket: generateBracketForDivision(synced.format, synced.competitorIds, synced.seedOrder),
          updatedAt: new Date().toISOString()
        };
      })
    }));
  };

  const saveMatchResult = (
    divisionId: string,
    matchId: string,
    winnerId: string,
    method: string,
    submissionType?: string,
    notes?: string
  ) => {
    commitTournament((current) => ({
      ...current,
      divisions: current.divisions.map((division) => {
        if (division.id !== divisionId || !division.bracket) return division;
        return {
          ...division,
          bracket: applyMatchResult(division.bracket, matchId, winnerId, method, submissionType, notes),
          updatedAt: new Date().toISOString()
        };
      })
    }));
  };

  const clearResult = (divisionId: string, matchId: string) => {
    commitTournament((current) => ({
      ...current,
      divisions: current.divisions.map((division) => {
        if (division.id !== divisionId || !division.bracket) return division;
        return {
          ...division,
          bracket: clearMatchResult(division.bracket, matchId),
          updatedAt: new Date().toISOString()
        };
      })
    }));
  };

  const updateBracketSlot = (
    divisionId: string,
    matchId: string,
    side: SlotSide,
    slot: MatchSlot
  ) => {
    commitTournament((current) => ({
      ...current,
      divisions: current.divisions.map((division) => {
        if (division.id !== divisionId || !division.bracket) return division;
        return {
          ...division,
          bracket: updateMatchSlot(division.bracket, matchId, side, slot),
          updatedAt: new Date().toISOString()
        };
      })
    }));
  };

  const addCustomBracketMatch = (
    divisionId: string,
    round: number,
    slotA: MatchSlot,
    slotB: MatchSlot
  ) => {
    commitTournament((current) => ({
      ...current,
      divisions: current.divisions.map((division) => {
        if (division.id !== divisionId) return division;
        return {
          ...division,
          bracket: addCustomMatch(division.bracket, round, slotA, slotB),
          updatedAt: new Date().toISOString()
        };
      })
    }));
  };

  const importCsvRows = (rows: CsvCompetitorRow[]) => {
    commitTournament((current) => {
      const competitors: Competitor[] = [...current.competitors];

      rows.forEach((row) => {
        const competitor: Competitor = {
          id: createId('competitor'),
          name: row.name,
          weightClass: row.weight,
          monthsTrained: row.monthsTrained
        };

        competitors.push(competitor);
      });

      return { ...current, competitors };
    });
    setCsvPreview({ rows: [], errors: [] });
    setActiveTab('competitors');
  };

  const importTournamentJson = (nextTournament: TournamentState) => {
    setTournamentStore((currentStore) => ({
      ...currentStore,
      tournaments: currentStore.tournaments.map((record) =>
        record.id === currentStore.activeTournamentId
          ? {
              ...record,
              tournament: {
                ...nextTournament,
                updatedAt: new Date().toISOString()
              }
            }
          : record
      )
    }));
    setCsvPreview({ rows: [], errors: [] });
    setSelectedDivisionId(nextTournament.divisions[0]?.id ?? '');
    setActiveTab('brackets');
  };

  const resetTournament = () => {
    const nextTournament = emptyTournament(tournament.eventName || 'New BJJ Tournament');
    setTournamentStore((currentStore) => ({
      ...currentStore,
      tournaments: currentStore.tournaments.map((record) =>
        record.id === currentStore.activeTournamentId
          ? { ...record, tournament: nextTournament }
          : record
      )
    }));
    setCsvPreview({ rows: [], errors: [] });
    setSelectedDivisionId('');
    setActiveTab('competitors');
  };

  const updateScheduleOrder = (scheduleOrder: string[]) => {
    commitTournament((current) => ({
      ...current,
      scheduleOrder: scheduleOrder.length > 0 ? scheduleOrder : undefined
    }));
  };

  const counts = {
    competitors: tournament.competitors.length,
    divisions: tournament.divisions.length,
    brackets: tournament.divisions.filter((d) => d.bracket).length,
    results: tournament.divisions.reduce(
      (sum, d) => sum + (d.bracket?.matches.filter((m) => m.result).length ?? 0),
      0
    ),
  };

  const crumbs = (() => {
    switch (activeTab) {
      case 'competitors': return ['Tournament', 'Competitors'];
      case 'divisions': return ['Tournament', 'Divisions'];
      case 'brackets': {
        const div = tournament.divisions.find((d) => d.id === selectedDivisionId);
        return ['Tournament', 'Brackets', ...(div ? [div.name] : [])];
      }
      case 'schedule': return ['Tournament', 'Schedule'];
      case 'results': return ['Tournament', 'Results'];
      case 'import-export': return ['Tournament', 'Import / Export'];
    }
  })();

  if (sessionMode === 'entry') {
    return (
      <EntryScreen
        theme={theme}
        tournaments={tournamentStore.tournaments}
        activeTournamentId={tournamentStore.activeTournamentId}
        adminPasscodeConfigured={adminPasscodeConfigured}
        onAdminPasscodeSubmit={handleAdminPasscodeSubmit}
        onGuestSelect={(tournamentId) => {
          selectTournament(tournamentId);
          setSessionMode('guest');
          setGuestTab('brackets');
        }}
        onThemeToggle={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
      />
    );
  }

  if (sessionMode === 'guest') {
    return (
      <GuestApp
        theme={theme}
        tournament={tournament}
        tournaments={tournamentStore.tournaments}
        activeTournamentId={tournamentStore.activeTournamentId}
        activeTab={guestTab}
        selectedDivisionId={selectedDivisionId}
        highlightedMatchId={highlightedMatchId}
        competitorById={competitorById}
        onSelectTournament={selectTournament}
        onSelectTab={setGuestTab}
        onSelectDivision={setSelectedDivisionId}
        onNavigateToMatch={navigateToMatch}
        onClearHighlight={() => setHighlightedMatchId(null)}
        onBack={() => setSessionMode('entry')}
        onThemeToggle={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
      />
    );
  }

  return (
    <div className={`app ${theme === 'light' ? 'theme-light' : 'theme-dark'}`}>
      <aside className="sidebar">
        <div className="sb-brand">
          <div className="sb-mark">BJJ</div>
          <div className="sb-brand-text">
            <div className="name">Tournament</div>
            <div className="sub">Local &middot; v0.1</div>
          </div>
        </div>

        <div className="sb-tournament">
          <div className="lbl">Active tournament</div>
          <select
            className="input sm tournament-select"
            value={tournamentStore.activeTournamentId}
            onChange={(e) => selectTournament(e.target.value)}
            aria-label="Select tournament"
          >
            {tournamentStore.tournaments.map((record) => (
              <option key={record.id} value={record.id}>
                {record.tournament.eventName}
              </option>
            ))}
          </select>
          <input
            className="title-input"
            value={tournament.eventName}
            onChange={(e) => updateEventName(e.target.value)}
            aria-label="Event name"
          />
          <div className="date">{new Date().toISOString().slice(0, 10)}</div>
          <div className="tournament-actions">
            <button className="btn sm" type="button" onClick={createTournament}>
              <span className="ic"><Plus size={12} /></span>New
            </button>
            <button className="btn danger sm" type="button" onClick={deleteActiveTournament}>
              <span className="ic"><Trash2 size={12} /></span>Delete
            </button>
          </div>
        </div>

        <nav className="sb-nav">
          <div className="group-lbl">Admin</div>
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`sb-item${activeTab === item.id ? ' active' : ''}`}
              onClick={() => setActiveTab(item.id)}
            >
              <span className="ic">{item.icon}</span>
              <span>{item.label}</span>
              {item.id === 'competitors' && <span className="count">{counts.competitors}</span>}
              {item.id === 'divisions' && <span className="count">{counts.divisions}</span>}
              {item.id === 'brackets' && <span className="count">{counts.brackets}</span>}
            </button>
          ))}
        </nav>

        <div className="sb-foot">
          <span className="dot" />
          <span>Autosaved</span>
          <button
            type="button"
            className="sb-theme-toggle"
            title="Log out"
            onClick={() => setSessionMode('entry')}
          >
            <LogOut />
          </button>
          <button
            type="button"
            className="sb-theme-toggle"
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          >
            {theme === 'dark' ? <Sun /> : <Moon />}
          </button>
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <div className="crumb">
            {crumbs.map((c, i) => (
              <span key={i}>
                {i > 0 && <span className="sep"> / </span>}
                <span className={i === crumbs.length - 1 ? 'leaf' : 'root'}>{c}</span>
              </span>
            ))}
          </div>
          <div className="spacer" />
          <div className="meta">
            <span className="save"><span className="dot" /> Saved</span>
          </div>
        </div>

        <div className="content">
          {activeTab === 'competitors' && (
            <CompetitorsView
              competitors={tournament.competitors}
              divisions={tournament.divisions}
              onAdd={addCompetitor}
              onUpdateField={updateCompetitorField}
              onAssign={assignCompetitor}
              onDelete={deleteCompetitor}
            />
          )}

          {activeTab === 'divisions' && (
            <DivisionsView
              competitors={tournament.competitors}
              divisions={tournament.divisions}
              onAdd={addDivision}
              onUpdate={updateDivision}
              onDelete={deleteDivision}
              onAssign={assignCompetitor}
            />
          )}

          {activeTab === 'brackets' && (
            <BracketsView
              divisions={tournament.divisions}
              selectedDivisionId={selectedDivisionId}
              onSelectDivision={setSelectedDivisionId}
              competitorById={competitorById}
              onMoveSeed={moveSeed}
              onReorderSeed={reorderSeed}
              onShuffleSeeds={shuffleSeeds}
              onGenerateBracket={generateBracket}
              onSaveResult={saveMatchResult}
              onClearResult={clearResult}
              onUpdateMatchSlot={updateBracketSlot}
              onAddCustomMatch={addCustomBracketMatch}
              highlightedMatchId={highlightedMatchId}
              onClearHighlight={() => setHighlightedMatchId(null)}
            />
          )}

          {activeTab === 'schedule' && (
            <ScheduleView
              divisions={tournament.divisions}
              competitorById={competitorById}
              scheduleOrder={tournament.scheduleOrder}
              onScheduleOrderChange={updateScheduleOrder}
              onNavigateToMatch={navigateToMatch}
            />
          )}

          {activeTab === 'results' && (
            <ResultsView
              divisions={tournament.divisions}
              competitorById={competitorById}
            />
          )}

          {activeTab === 'import-export' && (
            <ImportExportView
              tournament={tournament}
              csvPreview={csvPreview}
              onCsvPreviewChange={setCsvPreview}
              onCsvImport={importCsvRows}
              onJsonImport={importTournamentJson}
              onReset={resetTournament}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function EntryScreen({
  theme,
  tournaments,
  activeTournamentId,
  adminPasscodeConfigured,
  onAdminPasscodeSubmit,
  onGuestSelect,
  onThemeToggle,
}: {
  theme: 'dark' | 'light';
  tournaments: TournamentStore['tournaments'];
  activeTournamentId: string;
  adminPasscodeConfigured: boolean;
  onAdminPasscodeSubmit: (passcode: string) => boolean | Promise<boolean>;
  onGuestSelect: (tournamentId: string) => void;
  onThemeToggle: () => void;
}) {
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);
    try {
      const accepted = await onAdminPasscodeSubmit(passcode);
      if (!accepted) {
        setError(adminPasscodeConfigured ? 'Wrong admin passcode.' : 'Enter an admin passcode.');
        return;
      }
      setError('');
      setPasscode('');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className={`app auth-app ${theme === 'light' ? 'theme-light' : 'theme-dark'}`}
      style={{ '--auth-background-image': 'url("/entry-background.jpg")' } as React.CSSProperties}
    >
      <main className="auth-shell">
        <section className="auth-hero">
          <div className="sb-mark auth-mark">BJJ</div>
          <h1>NTNUI Jiu-Jitsu</h1>
          <p>Tournament desk</p>
          <button className="btn sm" type="button" onClick={onThemeToggle}>
            <span className="ic">{theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}</span>
            Theme
          </button>
        </section>

        <section className="auth-grid">
          <form className="panel auth-panel admin-auth-panel" onSubmit={submit}>
            <div className="panel-hd">
              <Lock size={15} />
              <span className="t">{adminPasscodeConfigured ? 'Admin' : 'Create admin passcode'}</span>
            </div>
            <div className="auth-panel-body">
              <div className="field-label">
                <span className="lbl">Passcode</span>
                <input
                  className="input"
                  type="password"
                  value={passcode}
                  onChange={(event) => setPasscode(event.target.value)}
                  autoComplete="current-password"
                  disabled={isSubmitting}
                />
              </div>
              {error && <div className="auth-error">{error}</div>}
              <button className="btn primary" type="submit" disabled={isSubmitting}>
                <span className="ic"><Lock size={13} /></span>
                {adminPasscodeConfigured ? 'Log in' : 'Create login'}
              </button>
            </div>
          </form>

          <section className="panel auth-panel">
            <div className="panel-hd">
              <Eye size={15} />
              <span className="t">Tournaments</span>
            </div>
            <div className="auth-panel-body">
              <div className="guest-tournament-list">
                {tournaments.map((record) => (
                  <button
                    key={record.id}
                    className={`guest-tournament-row${record.id === activeTournamentId ? ' active' : ''}`}
                    type="button"
                    onClick={() => onGuestSelect(record.id)}
                  >
                    <span className="guest-tournament-name">{record.tournament.eventName}</span>
                    <span className="guest-tournament-meta">
                      {record.tournament.divisions.length} divisions · {record.tournament.competitors.length} competitors
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </section>
        </section>
      </main>
    </div>
  );
}

function GuestApp({
  theme,
  tournament,
  tournaments,
  activeTournamentId,
  activeTab,
  selectedDivisionId,
  highlightedMatchId,
  competitorById,
  onSelectTournament,
  onSelectTab,
  onSelectDivision,
  onNavigateToMatch,
  onClearHighlight,
  onBack,
  onThemeToggle,
}: {
  theme: 'dark' | 'light';
  tournament: TournamentState;
  tournaments: TournamentStore['tournaments'];
  activeTournamentId: string;
  activeTab: GuestTabId;
  selectedDivisionId: string;
  highlightedMatchId: string | null;
  competitorById: Map<string, Competitor>;
  onSelectTournament: (tournamentId: string) => void;
  onSelectTab: (tab: GuestTabId) => void;
  onSelectDivision: (divisionId: string) => void;
  onNavigateToMatch: (divisionId: string, matchId: string) => void;
  onClearHighlight: () => void;
  onBack: () => void;
  onThemeToggle: () => void;
}) {
  const guestNavItems: Array<{ id: GuestTabId; label: string; icon: React.ReactNode }> = [
    { id: 'brackets', label: 'Brackets', icon: <Trophy size={14} /> },
    { id: 'schedule', label: 'Schedule', icon: <CalendarClock size={14} /> },
    { id: 'results', label: 'Results', icon: <Medal size={14} /> },
  ];

  const crumbs = activeTab === 'brackets'
    ? ['Guest', 'Brackets']
    : activeTab === 'schedule'
      ? ['Guest', 'Schedule']
      : ['Guest', 'Results'];

  return (
    <div className={`app ${theme === 'light' ? 'theme-light' : 'theme-dark'}`}>
      <aside className="sidebar">
        <div className="sb-brand">
          <div className="sb-mark">BJJ</div>
          <div className="sb-brand-text">
            <div className="name">Guest View</div>
            <div className="sub">Read only</div>
          </div>
        </div>

        <div className="sb-tournament">
          <div className="lbl">Tournament</div>
          <select
            className="input sm tournament-select"
            value={activeTournamentId}
            onChange={(event) => onSelectTournament(event.target.value)}
          >
            {tournaments.map((record) => (
              <option key={record.id} value={record.id}>
                {record.tournament.eventName}
              </option>
            ))}
          </select>
          <div className="title">{tournament.eventName}</div>
          <div className="date">{tournament.divisions.length} divisions · {tournament.competitors.length} competitors</div>
        </div>

        <nav className="sb-nav">
          <div className="group-lbl">Guest</div>
          {guestNavItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`sb-item${activeTab === item.id ? ' active' : ''}`}
              onClick={() => onSelectTab(item.id)}
            >
              <span className="ic">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="sb-foot">
          <button className="btn sm" type="button" onClick={onBack}>
            <span className="ic"><LogOut size={13} /></span>Exit
          </button>
          <span className="spacer" />
          <button className="sb-theme-toggle" type="button" onClick={onThemeToggle} title="Toggle theme">
            {theme === 'dark' ? <Sun /> : <Moon />}
          </button>
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <div className="crumb">
            {crumbs.map((crumb, index) => (
              <span key={crumb}>
                {index > 0 && <span className="sep"> / </span>}
                <span className={index === crumbs.length - 1 ? 'leaf' : 'root'}>{crumb}</span>
              </span>
            ))}
          </div>
          <div className="spacer" />
          <div className="meta">
            <span><Eye size={12} /> Guest</span>
          </div>
        </div>

        <div className="content">
          {activeTab === 'brackets' && (
            <GuestBracketsView
              divisions={tournament.divisions}
              selectedDivisionId={selectedDivisionId}
              competitorById={competitorById}
              highlightedMatchId={highlightedMatchId}
              onSelectDivision={onSelectDivision}
              onClearHighlight={onClearHighlight}
            />
          )}
          {activeTab === 'schedule' && (
            <ScheduleView
              divisions={tournament.divisions}
              competitorById={competitorById}
              scheduleOrder={tournament.scheduleOrder}
              onNavigateToMatch={onNavigateToMatch}
            />
          )}
          {activeTab === 'results' && (
            <ResultsView divisions={tournament.divisions} competitorById={competitorById} />
          )}
        </div>
      </div>
    </div>
  );
}

function GuestBracketsView({
  divisions,
  selectedDivisionId,
  competitorById,
  highlightedMatchId,
  onSelectDivision,
  onClearHighlight,
}: {
  divisions: Division[];
  selectedDivisionId: string;
  competitorById: Map<string, Competitor>;
  highlightedMatchId: string | null;
  onSelectDivision: (divisionId: string) => void;
  onClearHighlight: () => void;
}) {
  const selectedDivision = divisions.find((division) => division.id === selectedDivisionId) ?? divisions[0];

  if (!selectedDivision) {
    return (
      <div className="empty-state" style={{ background: 'var(--surface)', border: '1px solid var(--divider)', borderRadius: 6, minHeight: 400 }}>
        <Trophy size={36} />
        <div className="t">No divisions yet</div>
        <p>Ask the admin to create divisions and brackets.</p>
      </div>
    );
  }

  const placements = getPlacements(
    selectedDivision.format,
    selectedDivision.competitorIds,
    selectedDivision.bracket
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="panel" style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div className="field-label" style={{ minWidth: 240 }}>
          <span className="lbl">Division</span>
          <select className="input sm" value={selectedDivision.id} onChange={(event) => onSelectDivision(event.target.value)}>
            {divisions.map((division) => (
              <option key={division.id} value={division.id}>{division.name}</option>
            ))}
          </select>
        </div>
        <span className="chip mono">{formatLabels[selectedDivision.format]}</span>
        <span className="chip accent">{rulesetLabels[selectedDivision.ruleset]}</span>
        <span className="chip">{selectedDivision.competitorIds.length} competitors</span>
      </div>

      <PlacementsBar placements={placements} competitorById={competitorById} />

      {selectedDivision.bracket ? (
        <ReadOnlyBracketBoard
          division={selectedDivision}
          competitorById={competitorById}
          highlightedMatchId={highlightedMatchId}
          onClearHighlight={onClearHighlight}
        />
      ) : (
        <div className="empty-state" style={{ background: 'var(--surface)', border: '1px solid var(--divider)', borderRadius: 6, minHeight: 320 }}>
          <ListOrdered size={36} />
          <div className="t">Bracket not generated</div>
          <p>Ask the admin to generate this division.</p>
        </div>
      )}
    </div>
  );
}

function ReadOnlyBracketBoard({
  division,
  competitorById,
  highlightedMatchId,
  onClearHighlight,
}: {
  division: Division;
  competitorById: Map<string, Competitor>;
  highlightedMatchId: string | null;
  onClearHighlight: () => void;
}) {
  const bracket = division.bracket;
  if (!bracket || bracket.matches.length === 0) {
    return (
      <div className="empty-state" style={{ background: 'var(--surface)', border: '1px solid var(--divider)', borderRadius: 6, minHeight: 320 }}>
        <CheckCircle2 size={36} />
        <div className="t">No matches needed</div>
      </div>
    );
  }

  const stageOrder: Array<Match['stage']> = ['main', 'bronze', 'round-robin', 'custom'];
  const stages = stageOrder.filter((stage) => bracket.matches.some((match) => match.stage === stage));

  return (
    <div className="board-stack">
      {stages.map((stage) => {
        const stageMatches = bracket.matches.filter((match) => match.stage === stage);
        const rounds = [...new Set(stageMatches.map((match) => match.round))].sort((a, b) => a - b);
        return (
          <section className="stage-band" key={stage}>
            <div className="stage-header">
              <h2>{stageLabel(stage)}</h2>
              <span className="stage-count">{stageMatches.length} matches</span>
            </div>
            <div className="rounds-grid">
              {rounds.map((round) => (
                <div className="round-column" key={`${stage}-${round}`}>
                  <h3>{roundLabel(round, rounds.length, stage)}</h3>
                  {stageMatches
                    .filter((match) => match.round === round)
                    .sort((a, b) => a.position - b.position)
                    .map((match) => (
                      <ReadOnlyMatchCard
                        key={match.id}
                        match={match}
                        matches={bracket.matches}
                        competitorById={competitorById}
                        highlighted={match.id === highlightedMatchId}
                        onClearHighlight={onClearHighlight}
                      />
                    ))}
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ReadOnlyMatchCard({
  match,
  matches,
  competitorById,
  highlighted,
  onClearHighlight,
}: {
  match: Match;
  matches: Match[];
  competitorById: Map<string, Competitor>;
  highlighted: boolean;
  onClearHighlight: () => void;
}) {
  const cardRef = useRef<HTMLElement>(null);
  const resolved = resolveMatch(match, matches);
  const winnerName = match.result?.winnerId
    ? competitorById.get(match.result.winnerId)?.name ?? 'Unknown'
    : resolved.autoWinnerId
      ? competitorById.get(resolved.autoWinnerId)?.name ?? 'Unknown'
      : undefined;
  const resultMethod = formatResultMethod(match.result);

  useEffect(() => {
    if (highlighted && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const timer = setTimeout(onClearHighlight, 3000);
      return () => clearTimeout(timer);
    }
  }, [highlighted, onClearHighlight]);

  return (
    <article ref={cardRef} className={`match-card${match.result ? ' complete' : ''}${highlighted ? ' highlighted' : ''}`}>
      <div className="match-topline">
        <strong>{match.label}</strong>
        <span className={`chip${match.result ? ' chip-done dot' : resolved.autoWinnerId ? ' chip-live dot accent' : ' chip-pending dot'}`}>
          {match.result ? 'Done' : resolved.autoWinnerId ? 'Auto' : 'Open'}
        </span>
      </div>
      <div className="slot-list">
        <MatchSlotRow slot={resolved.slotA} competitorById={competitorById} isWinner={match.result?.winnerId === resolved.slotA.competitorId} />
        <MatchSlotRow slot={resolved.slotB} competitorById={competitorById} isWinner={match.result?.winnerId === resolved.slotB.competitorId} />
      </div>
      {winnerName && (
        <div className="winner-line">
          <CheckCircle2 size={14} />
          <span>{winnerName}</span>
          {resultMethod && <em title={resultMethod}>{resultMethod}</em>}
        </div>
      )}
    </article>
  );
}

/* ── Competitors View ── */

interface CompetitorsViewProps {
  competitors: Competitor[];
  divisions: Division[];
  onAdd: (draft: Omit<Competitor, 'id'>) => void;
  onUpdateField: (competitorId: string, field: CompetitorField, value: string) => void;
  onAssign: (competitorId: string, divisionId: string) => void;
  onDelete: (competitorId: string) => void;
}

function CompetitorsView({
  competitors,
  divisions,
  onAdd,
  onUpdateField,
  onAssign,
  onDelete
}: CompetitorsViewProps) {
  const [sortState, setSortState] = useState<CompetitorSortState>({
    key: 'name',
    direction: 'asc'
  });
  const [draft, setDraft] = useState<Omit<Competitor, 'id'>>({
    name: '',
    weightClass: '',
    monthsTrained: '',
    gender: '',
    divisionId: ''
  });
  const [filter, setFilter] = useState('');

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.name.trim()) return;
    onAdd({
      name: draft.name.trim(),
      weightClass: draft.weightClass?.trim() || undefined,
      monthsTrained: draft.monthsTrained?.trim() || undefined,
      gender: draft.gender?.trim() || undefined,
      divisionId: draft.divisionId || undefined
    });
    setDraft({ name: '', weightClass: '', monthsTrained: '', gender: '', divisionId: '' });
  };

  const divisionNameById = useMemo(() => {
    return new Map(divisions.map((division) => [division.id, division.name]));
  }, [divisions]);

  const sortedCompetitors = useMemo(() => {
    let list = [...competitors];
    if (filter) {
      const q = filter.toLowerCase();
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.weightClass && c.weightClass.toLowerCase().includes(q)) ||
          (c.divisionId && (divisionNameById.get(c.divisionId) ?? '').toLowerCase().includes(q))
      );
    }
    return list.sort((left, right) =>
      compareCompetitors(left, right, sortState, divisionNameById)
    );
  }, [competitors, divisionNameById, sortState, filter]);

  const toggleSort = (key: CompetitorSortKey) => {
    setSortState((current) => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const unassignedCount = competitors.filter((c) => !c.divisionId).length;

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-hd">
        <span className="t">Competitors</span>
        <span className="chip mono">{competitors.length} total</span>
        {unassignedCount > 0 && <span className="chip neutral">{unassignedCount} unassigned</span>}
        <span className="spacer" />
        <div className="search-wrap">
          <span className="search-icon"><Search /></span>
          <input
            className="input sm"
            placeholder="Search name, weight, division..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      </div>

      <form className="entry-bar" onSubmit={submit}>
        <div className="field-label">
          <span className="lbl">Name</span>
          <input className="input sm" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required />
        </div>
        <div className="field-label">
          <span className="lbl">Weight</span>
          <input className="input sm" value={draft.weightClass} onChange={(e) => setDraft({ ...draft, weightClass: e.target.value })} />
        </div>
        <div className="field-label">
          <span className="lbl">Months</span>
          <input className="input sm" inputMode="numeric" value={draft.monthsTrained} onChange={(e) => setDraft({ ...draft, monthsTrained: e.target.value })} />
        </div>
        <div className="field-label">
          <span className="lbl">Gender</span>
          <input className="input sm" value={draft.gender} onChange={(e) => setDraft({ ...draft, gender: e.target.value })} />
        </div>
        <div className="field-label">
          <span className="lbl">Division</span>
          <select className="input sm" value={draft.divisionId} onChange={(e) => setDraft({ ...draft, divisionId: e.target.value })}>
            <option value="">Unassigned</option>
            {divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <button className="btn primary sm" type="submit"><span className="ic"><Plus size={13} /></span>Add</button>
      </form>

      <div style={{ flex: 1, overflow: 'auto' }}>
        <table className="tbl">
          <thead>
            <tr>
              <SortableHeader label="Name" sortKey="name" sortState={sortState} onSort={toggleSort} />
              <SortableHeader label="Weight" sortKey="weightClass" sortState={sortState} onSort={toggleSort} />
              <SortableHeader label="Months" sortKey="monthsTrained" sortState={sortState} onSort={toggleSort} />
              <SortableHeader label="Gender" sortKey="gender" sortState={sortState} onSort={toggleSort} />
              <SortableHeader label="Division" sortKey="division" sortState={sortState} onSort={toggleSort} />
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {sortedCompetitors.map((competitor) => (
              <tr key={competitor.id}>
                <td>
                  <input
                    className="inline-input"
                    value={competitor.name}
                    onChange={(e) => onUpdateField(competitor.id, 'name', e.target.value)}
                  />
                </td>
                <td>
                  <input
                    className="inline-input"
                    value={competitor.weightClass ?? ''}
                    onChange={(e) => onUpdateField(competitor.id, 'weightClass', e.target.value)}
                  />
                </td>
                <td>
                  <input
                    className="inline-input"
                    inputMode="numeric"
                    value={competitor.monthsTrained ?? ''}
                    onChange={(e) => onUpdateField(competitor.id, 'monthsTrained', e.target.value)}
                  />
                </td>
                <td>
                  <input
                    className="inline-input"
                    value={competitor.gender ?? ''}
                    onChange={(e) => onUpdateField(competitor.id, 'gender', e.target.value)}
                  />
                </td>
                <td>
                  <select
                    className="inline-select"
                    value={competitor.divisionId ?? ''}
                    onChange={(e) => onAssign(competitor.id, e.target.value)}
                  >
                    <option value="">Unassigned</option>
                    {divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </td>
                <td className="row-actions">
                  <button className="icon-btn danger" type="button" title="Delete" onClick={() => onDelete(competitor.id)}>
                    <Trash2 />
                  </button>
                </td>
              </tr>
            ))}
            {sortedCompetitors.length === 0 && (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: 26, color: 'var(--muted)' }}>
                  {filter ? 'No matches found.' : 'No competitors yet.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SortableHeader({
  label,
  sortKey,
  sortState,
  onSort
}: {
  label: string;
  sortKey: CompetitorSortKey;
  sortState: CompetitorSortState;
  onSort: (key: CompetitorSortKey) => void;
}) {
  const isActive = sortState.key === sortKey;
  const Icon = !isActive ? ArrowUpDown : sortState.direction === 'asc' ? ArrowUp : ArrowDown;

  return (
    <th>
      <button
        className={`sort-btn${isActive ? ' active' : ''}`}
        type="button"
        onClick={() => onSort(sortKey)}
      >
        <span>{label}</span>
        <Icon size={12} />
      </button>
    </th>
  );
}

/* ── Divisions View ── */

interface DivisionsViewProps {
  competitors: Competitor[];
  divisions: Division[];
  onAdd: (name: string, format: TournamentFormat, ruleset: Ruleset) => void;
  onUpdate: (divisionId: string, patch: Partial<Pick<Division, 'name' | 'format' | 'ruleset'>>) => void;
  onDelete: (divisionId: string) => void;
  onAssign: (competitorId: string, divisionId: string) => void;
}

function DivisionsView({ competitors, divisions, onAdd, onUpdate, onDelete, onAssign }: DivisionsViewProps) {
  const [name, setName] = useState('');
  const [format, setFormat] = useState<TournamentFormat>(defaultDivisionFormat);
  const [ruleset, setRuleset] = useState<Ruleset>(defaultRuleset);
  const [pickerDivisionId, setPickerDivisionId] = useState<string | null>(null);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    onAdd(name, format, ruleset);
    setName('');
  };

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-hd">
        <span className="t">Divisions</span>
        <span className="chip mono">{divisions.length} total</span>
        <span className="spacer" />
      </div>

      <form className="entry-bar" onSubmit={submit}>
        <div className="field-label" style={{ flex: 2 }}>
          <span className="lbl">Division name</span>
          <input className="input sm" value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Adult Blue 79kg" />
        </div>
        <div className="field-label">
          <span className="lbl">Format</span>
          <select className="input sm" value={format} onChange={(e) => setFormat(e.target.value as TournamentFormat)}>
            {formatOptions.map((o) => <option key={o} value={o}>{formatLabels[o]}</option>)}
          </select>
        </div>
        <div className="field-label">
          <span className="lbl">Ruleset</span>
          <select className="input sm" value={ruleset} onChange={(e) => setRuleset(e.target.value as Ruleset)}>
            {rulesetOptions.map((o) => <option key={o} value={o}>{rulesetLabels[o]}</option>)}
          </select>
        </div>
        <button className="btn primary sm" type="submit"><span className="ic"><Plus size={13} /></span>Add</button>
      </form>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {divisions.map((division) => {
          const count = competitors.filter((c) => c.divisionId === division.id).length;
          const matchCount = division.bracket?.matches.length ?? 0;
          const doneCount = division.bracket?.matches.filter((m) => m.result).length ?? 0;
          const status = division.bracket
            ? doneCount === matchCount && matchCount > 0 ? 'done' : 'live'
            : count >= 2 ? 'open' : 'pending';

          return (
            <div key={division.id} className="division-row">
              <div className="name-col">
                <div className="t">
                  <input
                    className="inline-input"
                    value={division.name}
                    onChange={(e) => onUpdate(division.id, { name: e.target.value })}
                  />
                </div>
                <div className="s">{division.id.slice(0, 8)}</div>
              </div>
              <div className="meta-col">
                <select
                  className="inline-select"
                  value={division.format}
                  onChange={(e) => onUpdate(division.id, { format: e.target.value as TournamentFormat })}
                >
                  {formatOptions.map((o) => <option key={o} value={o}>{formatLabels[o]}</option>)}
                </select>
                <select
                  className="inline-select"
                  value={division.ruleset}
                  onChange={(e) => onUpdate(division.id, { ruleset: e.target.value as Ruleset })}
                >
                  {rulesetOptions.map((o) => <option key={o} value={o}>{rulesetLabels[o]}</option>)}
                </select>
                <span className="chip"><span className="mono">{count}</span> competitor{count !== 1 ? 's' : ''}</span>
                <span className={`chip dot chip-${status}`}>
                  {status === 'live' ? 'live' : status === 'done' ? 'complete' : status === 'open' ? 'awaiting bracket' : 'needs 2+ competitors'}
                </span>
              </div>
              <div className="progress-col">
                <div className="progress">
                  <div className="fill" style={{ width: matchCount ? `${(doneCount / matchCount) * 100}%` : 0 }} />
                </div>
                <div className="lbl">
                  <span>matches</span>
                  <span>{doneCount} / {matchCount || '—'}</span>
                </div>
              </div>
              <div className="actions-col">
                <button className="btn sm" type="button" title="Add competitors" onClick={() => setPickerDivisionId(division.id)}>
                  <span className="ic"><Plus size={13} /></span>Add
                </button>
                <button className="icon-btn danger" type="button" title="Delete division" onClick={() => onDelete(division.id)}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          );
        })}
        {divisions.length === 0 && (
          <div className="empty-state">
            <LayoutGrid size={32} />
            <p>No divisions yet. Create one above.</p>
          </div>
        )}
      </div>

      {pickerDivisionId && (
        <CompetitorPicker
          divisionId={pickerDivisionId}
          divisionName={divisions.find((d) => d.id === pickerDivisionId)?.name ?? ''}
          competitors={competitors}
          onAssign={onAssign}
          onClose={() => setPickerDivisionId(null)}
        />
      )}
    </div>
  );
}

function CompetitorPicker({
  divisionId,
  divisionName,
  competitors,
  onAssign,
  onClose,
}: {
  divisionId: string;
  divisionName: string;
  competitors: Competitor[];
  onAssign: (competitorId: string, divisionId: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');

  const assigned = useMemo(
    () => new Set(competitors.filter((c) => c.divisionId === divisionId).map((c) => c.id)),
    [competitors, divisionId]
  );

  const filtered = useMemo(() => {
    if (!search) return competitors;
    const q = search.toLowerCase();
    return competitors.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.weightClass && c.weightClass.toLowerCase().includes(q))
    );
  }, [competitors, search]);

  const toggle = (competitorId: string) => {
    if (assigned.has(competitorId)) {
      onAssign(competitorId, '');
    } else {
      onAssign(competitorId, divisionId);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-hd">
          <div>
            <div className="modal-title">Add competitors</div>
            <div className="modal-sub">{divisionName}</div>
          </div>
          <span className="spacer" />
          <span className="chip mono">{assigned.size} assigned</span>
          <button className="icon-btn" type="button" onClick={onClose} title="Close">
            <X size={14} />
          </button>
        </div>

        <div className="modal-search">
          <span className="search-icon"><Search /></span>
          <input
            className="input sm"
            placeholder="Search competitors..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
        </div>

        <div className="modal-list">
          {filtered.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>
              {search ? 'No competitors match your search.' : 'No competitors created yet.'}
            </div>
          )}
          {filtered.map((c) => {
            const isAssigned = assigned.has(c.id);
            const inOtherDivision = c.divisionId && c.divisionId !== divisionId;
            return (
              <button
                key={c.id}
                type="button"
                className={`picker-row${isAssigned ? ' assigned' : ''}`}
                onClick={() => toggle(c.id)}
              >
                <span className={`picker-check${isAssigned ? ' on' : ''}`}>
                  {isAssigned && <CheckCircle2 size={14} />}
                </span>
                <span className="picker-name">{c.name}</span>
                {c.weightClass && <span className="picker-meta">{c.weightClass}</span>}
                {inOtherDivision && <span className="chip neutral" style={{ fontSize: 10 }}>in other division</span>}
                {!c.divisionId && <span className="chip neutral" style={{ fontSize: 10 }}>unassigned</span>}
              </button>
            );
          })}
        </div>

        <div className="modal-foot">
          <span style={{ color: 'var(--muted)', fontSize: 11 }}>{filtered.length} competitor{filtered.length !== 1 ? 's' : ''} shown</span>
          <span className="spacer" />
          <button className="btn primary sm" type="button" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

/* ── Brackets View ── */

interface BracketsViewProps {
  divisions: Division[];
  selectedDivisionId: string;
  onSelectDivision: (divisionId: string) => void;
  competitorById: Map<string, Competitor>;
  onMoveSeed: (divisionId: string, competitorId: string, direction: -1 | 1) => void;
  onReorderSeed: (divisionId: string, draggedId: string, targetId: string) => void;
  onShuffleSeeds: (divisionId: string) => void;
  onGenerateBracket: (divisionId: string) => void;
  onSaveResult: (
    divisionId: string,
    matchId: string,
    winnerId: string,
    method: string,
    submissionType?: string,
    notes?: string
  ) => void;
  onClearResult: (divisionId: string, matchId: string) => void;
  onUpdateMatchSlot: (divisionId: string, matchId: string, side: SlotSide, slot: MatchSlot) => void;
  onAddCustomMatch: (divisionId: string, round: number, slotA: MatchSlot, slotB: MatchSlot) => void;
  highlightedMatchId?: string | null;
  onClearHighlight?: () => void;
}

function BracketsView({
  divisions,
  selectedDivisionId,
  onSelectDivision,
  competitorById,
  onMoveSeed,
  onReorderSeed,
  onShuffleSeeds,
  onGenerateBracket,
  onSaveResult,
  onClearResult,
  onUpdateMatchSlot,
  onAddCustomMatch,
  highlightedMatchId,
  onClearHighlight,
}: BracketsViewProps) {
  const selectedDivision = divisions.find((division) => division.id === selectedDivisionId) ?? divisions[0];
  const [draggedSeedId, setDraggedSeedId] = useState<string>('');

  if (!selectedDivision) {
    return (
      <div className="empty-state">
        <Medal size={32} />
        <p>Create a division before generating brackets.</p>
      </div>
    );
  }

  const syncedDivision = syncDivisionSeeds(selectedDivision);
  const placements = getPlacements(
    syncedDivision.format,
    syncedDivision.competitorIds,
    syncedDivision.bracket
  );

  return (
    <div className="bracket-layout">
      <div className="bracket-sidebar">
        <div className="panel" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="field-label">
            <span className="lbl">Division</span>
            <select className="input sm" value={syncedDivision.id} onChange={(e) => onSelectDivision(e.target.value)}>
              {divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>

          <div className="division-summary">
            <span className="chip mono">{formatLabels[syncedDivision.format]}</span>
            <span className="chip accent">{rulesetLabels[syncedDivision.ruleset]}</span>
            <span className="chip">{syncedDivision.competitorIds.length} competitors</span>
          </div>

          <div className="sidebar-actions">
            <button className="btn primary sm wide" type="button" onClick={() => onGenerateBracket(syncedDivision.id)}>
              <span className="ic"><ListOrdered size={13} /></span>Generate
            </button>
            <button className="btn sm wide" type="button" onClick={() => onShuffleSeeds(syncedDivision.id)} disabled={syncedDivision.seedOrder.length < 2}>
              <span className="ic"><Shuffle size={13} /></span>Shuffle
            </button>
          </div>

          <div className="seed-list">
            <div className="seed-list-hd">
              <span className="t">Seed order</span>
              <span className="mono" style={{ fontSize: 10, color: 'var(--muted-soft)' }}>{syncedDivision.seedOrder.length}</span>
            </div>
            {syncedDivision.seedOrder.map((competitorId, index) => {
              const competitor = competitorById.get(competitorId);
              return (
                <div
                  className="seed-row"
                  key={competitorId}
                  draggable
                  onDragStart={() => setDraggedSeedId(competitorId)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => onReorderSeed(syncedDivision.id, draggedSeedId, competitorId)}
                >
                  <span className="grip-icon"><GripVertical size={12} /></span>
                  <span className="seed-num">{String(index + 1).padStart(2, '0')}</span>
                  <div className="seed-info">
                    <div className="seed-name">{competitor?.name ?? 'Unknown'}</div>
                    {competitor?.team && <div className="seed-team">{competitor.team}</div>}
                  </div>
                  <div className="seed-controls">
                    <button className="icon-btn" type="button" title="Move up" onClick={() => onMoveSeed(syncedDivision.id, competitorId, -1)} disabled={index === 0}>
                      <ArrowUp size={12} />
                    </button>
                    <button className="icon-btn" type="button" title="Move down" onClick={() => onMoveSeed(syncedDivision.id, competitorId, 1)} disabled={index === syncedDivision.seedOrder.length - 1}>
                      <ArrowDown size={12} />
                    </button>
                  </div>
                </div>
              );
            })}
            {syncedDivision.seedOrder.length === 0 && (
              <p style={{ color: 'var(--muted)', fontSize: 12, padding: '12px 0' }}>No competitors assigned.</p>
            )}
          </div>
        </div>
      </div>

      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <PlacementsBar placements={placements} competitorById={competitorById} />

        {syncedDivision.format === 'custom' && (
          <CustomMatchBuilder
            division={syncedDivision}
            competitorById={competitorById}
            onAddCustomMatch={onAddCustomMatch}
          />
        )}

        {syncedDivision.bracket ? (
          <BracketBoard
            division={syncedDivision}
            bracket={syncedDivision.bracket}
            competitorById={competitorById}
            onSaveResult={onSaveResult}
            onClearResult={onClearResult}
            onUpdateMatchSlot={onUpdateMatchSlot}
            highlightedMatchId={highlightedMatchId}
            onClearHighlight={onClearHighlight}
          />
        ) : (
          <div className="empty-state" style={{ background: 'var(--surface)', border: '1px solid var(--divider)', borderRadius: 6 }}>
            <ListOrdered size={32} />
            <p>Generate this division to create its bracket.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function PlacementsBar({
  placements,
  competitorById
}: {
  placements: { gold?: string; silver?: string; bronze?: string };
  competitorById: Map<string, Competitor>;
}) {
  const items = [
    ['Gold', placements.gold],
    ['Silver', placements.silver],
    ['Bronze', placements.bronze]
  ] as const;

  return (
    <div className="placements-bar">
      {items.map(([label, competitorId]) => (
        <div className="placement" key={label}>
          <Medal size={16} />
          <span className="p-label">{label}</span>
          <span className="p-name">{competitorId ? competitorById.get(competitorId)?.name ?? 'Unknown' : 'Open'}</span>
        </div>
      ))}
    </div>
  );
}

function BracketBoard({
  division,
  bracket,
  competitorById,
  onSaveResult,
  onClearResult,
  onUpdateMatchSlot,
  highlightedMatchId,
  onClearHighlight,
}: {
  division: Division;
  bracket: Bracket;
  competitorById: Map<string, Competitor>;
  onSaveResult: BracketsViewProps['onSaveResult'];
  onClearResult: BracketsViewProps['onClearResult'];
  onUpdateMatchSlot: BracketsViewProps['onUpdateMatchSlot'];
  highlightedMatchId?: string | null;
  onClearHighlight?: () => void;
}) {
  const stageOrder: Array<Match['stage']> = ['main', 'bronze', 'round-robin', 'custom'];
  const stages = stageOrder.filter((stage) => bracket.matches.some((match) => match.stage === stage));
  const standings =
    division.format === 'round-robin'
      ? computeRoundRobinStandings(division.competitorIds, bracket.matches)
      : [];

  if (bracket.matches.length === 0) {
    return (
      <div className="empty-state" style={{ background: 'var(--surface)', border: '1px solid var(--divider)', borderRadius: 6 }}>
        <CheckCircle2 size={32} />
        <p>No matches are needed for this division.</p>
      </div>
    );
  }

  return (
    <div className="board-stack">
      {stages.map((stage) => {
        const stageMatches = bracket.matches.filter((match) => match.stage === stage);
        const rounds = [...new Set(stageMatches.map((match) => match.round))].sort((a, b) => a - b);
        return (
          <section className="stage-band" key={stage}>
            <div className="stage-header">
              <h2>{stageLabel(stage)}</h2>
              <span className="stage-count">{stageMatches.length} matches</span>
            </div>
            <div className="rounds-grid">
              {rounds.map((round) => (
                <div className="round-column" key={`${stage}-${round}`}>
                  <h3>{roundLabel(round, rounds.length, stage)}</h3>
                  {stageMatches
                    .filter((match) => match.round === round)
                    .sort((a, b) => a.position - b.position)
                    .map((match) => (
                      <MatchCardComponent
                        key={match.id}
                        division={division}
                        bracket={bracket}
                        match={match}
                        competitorById={competitorById}
                        onSaveResult={onSaveResult}
                        onClearResult={onClearResult}
                        onUpdateMatchSlot={onUpdateMatchSlot}
                        highlighted={match.id === highlightedMatchId}
                        onClearHighlight={onClearHighlight}
                      />
                    ))}
                </div>
              ))}
            </div>
          </section>
        );
      })}

      {standings.length > 0 && (
        <section className="stage-band">
          <div className="stage-header">
            <h2>Standings</h2>
            <span className="stage-count">Round robin</span>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Competitor</th>
                <th>Wins</th>
                <th>Losses</th>
                <th>Sub wins</th>
                <th>Matches</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((standing, index) => (
                <tr key={standing.competitorId}>
                  <td className="num">{index + 1}</td>
                  <td>{competitorById.get(standing.competitorId)?.name ?? 'Unknown'}</td>
                  <td className="num">{standing.wins}</td>
                  <td className="num">{standing.losses}</td>
                  <td className="num">{standing.submissionWins}</td>
                  <td className="num">{standing.matches}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function MatchCardComponent({
  division,
  bracket,
  match,
  competitorById,
  onSaveResult,
  onClearResult,
  onUpdateMatchSlot,
  highlighted,
  onClearHighlight,
}: {
  division: Division;
  bracket: Bracket;
  match: Match;
  competitorById: Map<string, Competitor>;
  onSaveResult: BracketsViewProps['onSaveResult'];
  onClearResult: BracketsViewProps['onClearResult'];
  onUpdateMatchSlot: BracketsViewProps['onUpdateMatchSlot'];
  highlighted?: boolean;
  onClearHighlight?: () => void;
}) {
  const cardRef = useRef<HTMLElement>(null);
  const resolved = resolveMatch(match, bracket.matches);

  useEffect(() => {
    if (highlighted && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const timer = setTimeout(() => onClearHighlight?.(), 3000);
      return () => clearTimeout(timer);
    }
  }, [highlighted]);
  const methods = getWinMethods(division.ruleset);
  const canEditSlotA = isDirectEditableSlot(match.slotA);
  const canEditSlotB = isDirectEditableSlot(match.slotB);
  const canEditSlots = canEditSlotA || canEditSlotB;
  const [isEditingSlots, setIsEditingSlots] = useState(false);
  const [slotAValue, setSlotAValue] = useState(matchSlotToSelectValue(match.slotA));
  const [slotBValue, setSlotBValue] = useState(matchSlotToSelectValue(match.slotB));
  const [winnerId, setWinnerId] = useState(match.result?.winnerId ?? resolved.participantIds[0] ?? '');
  const [method, setMethod] = useState(match.result?.method ?? getDefaultWinMethod(division.ruleset));
  const [submissionType, setSubmissionType] = useState(match.result?.submissionType ?? '');
  const [notes, setNotes] = useState(match.result?.notes ?? '');
  const [isResultFormOpen, setIsResultFormOpen] = useState(!match.result);

  useEffect(() => {
    setWinnerId(match.result?.winnerId ?? resolved.participantIds[0] ?? '');
    setMethod(match.result?.method ?? getDefaultWinMethod(division.ruleset));
    setSubmissionType(match.result?.submissionType ?? '');
    setNotes(match.result?.notes ?? '');
  }, [division.ruleset, match.id, match.result, resolved.participantIds.join('|')]);

  useEffect(() => {
    setSlotAValue(matchSlotToSelectValue(match.slotA));
    setSlotBValue(matchSlotToSelectValue(match.slotB));
    setIsEditingSlots(false);
  }, [match.id, match.slotA, match.slotB]);

  useEffect(() => {
    setIsResultFormOpen(!match.result);
  }, [match.id, match.result?.completedAt]);

  const winnerName = match.result?.winnerId
    ? competitorById.get(match.result.winnerId)?.name ?? 'Unknown'
    : resolved.autoWinnerId
      ? competitorById.get(resolved.autoWinnerId)?.name ?? 'Unknown'
      : undefined;
  const resultMethod = formatResultMethod(match.result);

  const save = () => {
    if (!winnerId || !method) return;
    onSaveResult(division.id, match.id, winnerId, method, submissionType, notes);
    setIsResultFormOpen(false);
  };

  const saveSlotEdits = () => {
    if (canEditSlotA) {
      onUpdateMatchSlot(division.id, match.id, 'A', selectValueToDirectSlot(slotAValue));
    }
    if (canEditSlotB) {
      onUpdateMatchSlot(division.id, match.id, 'B', selectValueToDirectSlot(slotBValue));
    }
    setIsEditingSlots(false);
  };

  return (
    <article ref={cardRef} className={`match-card${match.result ? ' complete' : ''}${highlighted ? ' highlighted' : ''}`}>
      <div className="match-topline">
        <strong>{match.label}</strong>
        <div className="match-top-actions">
          {canEditSlots && (
            <button className="btn ghost sm" type="button" onClick={() => setIsEditingSlots((c) => !c)}>
              <span className="ic"><Pencil size={11} /></span>Edit
            </button>
          )}
          {match.result && resolved.canRecordResult && !isResultFormOpen && (
            <button className="btn ghost sm" type="button" onClick={() => setIsResultFormOpen(true)}>
              <span className="ic"><Pencil size={11} /></span>Result
            </button>
          )}
          <span className={`chip${match.result ? ' chip-done dot' : resolved.autoWinnerId ? ' chip-live dot accent' : ' chip-pending dot'}`}>
            {match.result ? 'Done' : resolved.autoWinnerId ? 'Auto' : 'Open'}
          </span>
        </div>
      </div>

      {isEditingSlots ? (
        <div className="slot-edit-grid">
          <EditableSlotSelect
            label="Slot A"
            value={slotAValue}
            sourceLabel={resolved.slotA.label}
            disabled={!canEditSlotA}
            division={division}
            competitorById={competitorById}
            onChange={setSlotAValue}
          />
          <EditableSlotSelect
            label="Slot B"
            value={slotBValue}
            sourceLabel={resolved.slotB.label}
            disabled={!canEditSlotB}
            division={division}
            competitorById={competitorById}
            onChange={setSlotBValue}
          />
          <div className="slot-edit-actions">
            <button className="btn primary sm" type="button" onClick={saveSlotEdits}>
              <span className="ic"><Save size={11} /></span>Save
            </button>
            <button className="btn sm" type="button" onClick={() => {
              setSlotAValue(matchSlotToSelectValue(match.slotA));
              setSlotBValue(matchSlotToSelectValue(match.slotB));
              setIsEditingSlots(false);
            }}>
              <span className="ic"><X size={11} /></span>Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="slot-list">
          <MatchSlotRow slot={resolved.slotA} competitorById={competitorById} isWinner={match.result?.winnerId === resolved.slotA.competitorId} />
          <MatchSlotRow slot={resolved.slotB} competitorById={competitorById} isWinner={match.result?.winnerId === resolved.slotB.competitorId} />
        </div>
      )}

      {winnerName && (
        <div className="winner-line">
          <CheckCircle2 size={14} />
          <span>{winnerName}</span>
          {resultMethod && <em title={resultMethod}>{resultMethod}</em>}
        </div>
      )}

      {resolved.canRecordResult && isResultFormOpen && (
        <div className="result-form">
          <div className="field-row">
            <div className="field-label">
              <span className="lbl">Winner</span>
              <select className="input sm" value={winnerId} onChange={(e) => setWinnerId(e.target.value)}>
                {resolved.participantIds.map((id) => (
                  <option key={id} value={id}>{competitorById.get(id)?.name ?? 'Unknown'}</option>
                ))}
              </select>
            </div>
            <div className="field-label">
              <span className="lbl">Method</span>
              <select className="input sm" value={method} onChange={(e) => setMethod(e.target.value)}>
                {methods.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>
          {isSubmissionMethod(method) && (
            <div className="field-label field-wide">
              <span className="lbl">Submission type</span>
              <input className="input sm" value={submissionType} onChange={(e) => setSubmissionType(e.target.value)} placeholder="e.g. Triangle, RNC..." />
            </div>
          )}
          <div className="field-label field-wide">
            <span className="lbl">Notes</span>
            <input className="input sm" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional..." />
          </div>
          <div className="form-actions">
            <button className="btn primary sm" type="button" onClick={save}>
              <span className="ic"><Save size={11} /></span>Save
            </button>
            {match.result && (
              <button className="btn danger sm" type="button" onClick={() => onClearResult(division.id, match.id)}>
                <span className="ic"><X size={11} /></span>Clear
              </button>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

function MatchSlotRow({
  slot,
  competitorById,
  isWinner
}: {
  slot: ReturnType<typeof resolveMatch>['slotA'];
  competitorById: Map<string, Competitor>;
  isWinner?: boolean;
}) {
  const competitor = slot.competitorId ? competitorById.get(slot.competitorId) : undefined;
  return (
    <div className={`slot-row${isWinner ? ' winner' : ''}`}>
      <span className="slot-name" style={!slot.competitorId ? { color: 'var(--muted)' } : undefined}>
        {competitor?.name ?? slot.label}
      </span>
      <span style={{ color: 'var(--muted)', fontSize: 10.5 }}>
        {competitor?.team ?? (slot.empty ? 'Bye' : slot.ready ? 'Open' : 'Pending')}
      </span>
    </div>
  );
}

function EditableSlotSelect({
  label,
  value,
  sourceLabel,
  disabled,
  division,
  competitorById,
  onChange
}: {
  label: string;
  value: string;
  sourceLabel: string;
  disabled: boolean;
  division: Division;
  competitorById: Map<string, Competitor>;
  onChange: (value: string) => void;
}) {
  const competitorIds = [
    ...division.seedOrder,
    ...division.competitorIds.filter((id) => !division.seedOrder.includes(id))
  ];

  return (
    <div className="field-label">
      <span className="lbl">{label}</span>
      {disabled ? (
        <input className="input sm" value={sourceLabel} disabled />
      ) : (
        <select className="input sm" value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="bye">Bye</option>
          {competitorIds.map((id) => (
            <option key={id} value={`competitor:${id}`}>{competitorById.get(id)?.name ?? 'Unknown'}</option>
          ))}
        </select>
      )}
    </div>
  );
}

function CustomMatchBuilder({
  division,
  competitorById,
  onAddCustomMatch
}: {
  division: Division;
  competitorById: Map<string, Competitor>;
  onAddCustomMatch: BracketsViewProps['onAddCustomMatch'];
}) {
  const [round, setRound] = useState(1);
  const [slotA, setSlotA] = useState('bye');
  const [slotB, setSlotB] = useState('bye');
  const matches = division.bracket?.matches ?? [];
  const slotOptions = customSlotOptions(division, competitorById, matches, round);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    onAddCustomMatch(
      division.id,
      round,
      parseCustomSlot(slotA, matches),
      parseCustomSlot(slotB, matches)
    );
    setSlotA('bye');
    setSlotB('bye');
  };

  return (
    <form className="custom-builder" onSubmit={submit}>
      <div className="field-label" style={{ maxWidth: 80 }}>
        <span className="lbl">Round</span>
        <input className="input sm" type="number" min={1} value={round} onChange={(e) => setRound(Math.max(1, Number(e.target.value)))} />
      </div>
      <div className="field-label">
        <span className="lbl">Slot A</span>
        <select className="input sm" value={slotA} onChange={(e) => setSlotA(e.target.value)}>
          {slotOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <div className="field-label">
        <span className="lbl">Slot B</span>
        <select className="input sm" value={slotB} onChange={(e) => setSlotB(e.target.value)}>
          {slotOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <button className="btn primary sm" type="submit"><span className="ic"><Plus size={13} /></span>Add</button>
    </form>
  );
}

/* ── Schedule View ── */

function ScheduleView({
  divisions,
  competitorById,
  scheduleOrder = [],
  onScheduleOrderChange,
  onNavigateToMatch,
}: {
  divisions: Division[];
  competitorById: Map<string, Competitor>;
  scheduleOrder?: string[];
  onScheduleOrderChange?: (scheduleOrder: string[]) => void;
  onNavigateToMatch: (divisionId: string, matchId: string) => void;
}) {
  const [matCount, setMatCount] = useState(1);
  const [pressedKey, setPressedKey] = useState<string | null>(null);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null);
  const orderedKeysRef = useRef<string[]>([]);
  const dragStateRef = useRef<{
    key: string;
    pointerId: number;
    startX: number;
    startY: number;
    timerId: number;
    activated: boolean;
    handle: HTMLButtonElement;
  } | null>(null);
  const suppressClickRef = useRef<string | null>(null);

  const generatedSchedule = useMemo(() => {
    const entries = divisions
      .filter((d) => d.bracket && d.bracket.matches.length > 0)
      .map((d) => ({ division: d, matches: d.bracket!.matches }));
    return computeTournamentSchedule(entries, matCount);
  }, [divisions, matCount]);

  const activeDivisions = divisions.filter((d) => d.bracket && d.bracket.matches.length > 0);
  const allMatches = useMemo(
    () => activeDivisions.flatMap((d) => d.bracket!.matches),
    [activeDivisions]
  );
  const canReorder = Boolean(onScheduleOrderChange);

  const { orderedSchedule, orderedKeys, generatedKeys, hasCustomOrder } = useMemo(() => {
    const generatedKeys = generatedSchedule.map(scheduleEntryKey);
    const generatedKeySet = new Set(generatedKeys);
    const validStoredOrder = scheduleOrder.filter((key) => generatedKeySet.has(key));
    const storedKeySet = new Set(validStoredOrder);
    const orderedKeys = [
      ...validStoredOrder,
      ...generatedKeys.filter((key) => !storedKeySet.has(key))
    ];
    const scheduleByKey = new Map(generatedSchedule.map((entry) => [scheduleEntryKey(entry), entry]));
    const orderedSchedule = orderedKeys
      .map((key) => scheduleByKey.get(key))
      .filter((entry): entry is ScheduledMatch => Boolean(entry));

    return {
      orderedSchedule,
      orderedKeys,
      generatedKeys,
      hasCustomOrder:
        validStoredOrder.length > 0 &&
        orderedKeys.some((key, index) => key !== generatedKeys[index])
    };
  }, [generatedSchedule, scheduleOrder]);

  useEffect(() => {
    orderedKeysRef.current = orderedKeys;
  }, [orderedKeys]);

  useEffect(() => {
    return () => {
      if (dragStateRef.current) {
        window.clearTimeout(dragStateRef.current.timerId);
      }
    };
  }, []);

  if (activeDivisions.length === 0) {
    return (
      <div className="empty-state" style={{ background: 'var(--surface)', border: '1px solid var(--divider)', borderRadius: 6, minHeight: 400 }}>
        <CalendarClock size={36} />
        <div className="t">No matches to schedule</div>
        <p style={{ maxWidth: 320, lineHeight: 1.5 }}>Generate brackets in your divisions first, then the schedule will appear here.</p>
      </div>
    );
  }

  const beginSchedulePress = (event: React.PointerEvent<HTMLButtonElement>, key: string) => {
    if (!canReorder || !onScheduleOrderChange) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    event.stopPropagation();
    if (dragStateRef.current) {
      window.clearTimeout(dragStateRef.current.timerId);
    }

    const handle = event.currentTarget;
    setPressedKey(key);
    dragStateRef.current = {
      key,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      activated: false,
      handle,
      timerId: window.setTimeout(() => {
        const state = dragStateRef.current;
        if (!state || state.key !== key) return;
        state.activated = true;
        setDraggingKey(key);
        setDropTargetKey(key);
        try {
          state.handle.setPointerCapture(state.pointerId);
        } catch {
          // Pointer capture can fail if the pointer was already released.
        }
      }, 450)
    };
  };

  const moveSchedulePress = (event: React.PointerEvent<HTMLButtonElement>) => {
    const state = dragStateRef.current;
    if (!state || state.pointerId !== event.pointerId) return;

    event.stopPropagation();
    const deltaX = event.clientX - state.startX;
    const deltaY = event.clientY - state.startY;

    if (!state.activated && Math.hypot(deltaX, deltaY) > 8) {
      window.clearTimeout(state.timerId);
      dragStateRef.current = null;
      setPressedKey(null);
      return;
    }

    if (!state.activated || !onScheduleOrderChange) return;

    event.preventDefault();
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>('[data-schedule-key]')
      ?.dataset.scheduleKey;

    if (!target) return;
    setDropTargetKey(target);
    if (target === state.key) return;

    const nextOrder = moveScheduleKey(orderedKeysRef.current, state.key, target);
    orderedKeysRef.current = nextOrder;
    onScheduleOrderChange(nextOrder);
  };

  const endSchedulePress = (event: React.PointerEvent<HTMLButtonElement>) => {
    const state = dragStateRef.current;
    if (!state || state.pointerId !== event.pointerId) return;

    event.stopPropagation();
    window.clearTimeout(state.timerId);

    if (state.activated) {
      suppressClickRef.current = state.key;
      window.setTimeout(() => {
        if (suppressClickRef.current === state.key) suppressClickRef.current = null;
      }, 120);
    }

    try {
      state.handle.releasePointerCapture(state.pointerId);
    } catch {
      // Ignore release failures when the pointer was not captured.
    }

    dragStateRef.current = null;
    setPressedKey(null);
    setDraggingKey(null);
    setDropTargetKey(null);
  };

  const resetScheduleOrder = () => {
    onScheduleOrderChange?.([]);
  };

  const completedCount = orderedSchedule.filter((s) => {
    const resolved = resolveMatch(s.match, allMatches);
    return Boolean(s.match.result || resolved.autoWinnerId);
  }).length;
  const matColors = ['var(--accent)', 'var(--positive)', 'var(--warn)', '#6b8ec8', '#9b6bb5', '#5bbfbf'];

  return (
    <div className="schedule-page">
      <div className="schedule-toolbar">
        <div className="schedule-toolbar-left">
          <CalendarClock size={16} />
          <span className="schedule-toolbar-title">Match Schedule</span>
          <span className="chip mono">{orderedSchedule.length} matches</span>
          <span className="chip chip-done dot">{completedCount} done</span>
        </div>
        <div className="schedule-toolbar-right">
          {canReorder && (
            <button
              className="icon-btn"
              type="button"
              title="Reset schedule order"
              onClick={resetScheduleOrder}
              disabled={!hasCustomOrder}
            >
              <RotateCcw size={14} />
            </button>
          )}
          <label className="mat-control">
            <span className="lbl-up">Mats</span>
            <div className="mat-stepper">
              <button
                type="button"
                className="mat-stepper-btn"
                onClick={() => setMatCount((c) => Math.max(1, c - 1))}
                disabled={matCount <= 1}
              >−</button>
              <span className="mat-stepper-val mono">{matCount}</span>
              <button
                type="button"
                className="mat-stepper-btn"
                onClick={() => setMatCount((c) => Math.min(8, c + 1))}
                disabled={matCount >= 8}
              >+</button>
            </div>
          </label>
        </div>
      </div>

      {matCount > 1 && (
        <div className="mat-legend">
          {Array.from({ length: matCount }, (_, i) => (
            <div key={i} className="mat-legend-item">
              <span className="mat-legend-dot" style={{ background: matColors[i % matColors.length] }} />
              <span>Mat {i + 1}</span>
            </div>
          ))}
        </div>
      )}

      <div className="schedule-list">
        {orderedSchedule.map((s, idx) => {
          const key = scheduleEntryKey(s);
          const prev = idx > 0 ? orderedSchedule[idx - 1] : null;
          const showFinalSep = s.tag && (!prev || prev.tag !== s.tag);
          const resolved = resolveMatch(s.match, allMatches);
          const aName = resolved.slotA.competitorId
            ? competitorById.get(resolved.slotA.competitorId)?.name ?? resolved.slotA.label
            : resolved.slotA.label;
          const bName = resolved.slotB.competitorId
            ? competitorById.get(resolved.slotB.competitorId)?.name ?? resolved.slotB.label
            : resolved.slotB.label;
          const winnerId = s.match.result?.winnerId ?? resolved.autoWinnerId;
          const isAutoDone = !s.match.result && Boolean(resolved.autoWinnerId);
          const isDone = Boolean(s.match.result || resolved.autoWinnerId);
          const winnerName = winnerId
            ? competitorById.get(winnerId)?.name
            : undefined;
          const resultMethod = formatResultMethod(s.match.result);

          return (
            <div key={key}>
              {showFinalSep && (
                <div className="schedule-sep">
                  <span className="schedule-sep-line" />
                  <span className={`schedule-sep-label ${s.tag === 'gold-final' ? 'gold' : 'bronze'}`}>
                    {s.tag === 'gold-final' ? 'Gold Finals' : 'Bronze Finals'}
                  </span>
                  <span className="schedule-sep-line" />
                </div>
              )}
              <div
                className={`schedule-row${isDone ? ' done' : ''}${s.tag ? ` ${s.tag}` : ''}${canReorder ? ' reorder-enabled' : ''}${pressedKey === key ? ' pressing' : ''}${draggingKey === key ? ' dragging' : ''}${dropTargetKey === key && draggingKey !== key ? ' drop-target' : ''}`}
                data-schedule-key={key}
                onClick={() => onNavigateToMatch(s.divisionId, s.match.id)}
              >
                {canReorder && (
                  <button
                    className="schedule-drag-handle"
                    type="button"
                    title="Move match"
                    aria-label="Move match"
                    onPointerDown={(event) => beginSchedulePress(event, key)}
                    onPointerMove={moveSchedulePress}
                    onPointerUp={endSchedulePress}
                    onPointerCancel={endSchedulePress}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (suppressClickRef.current === key) {
                        event.preventDefault();
                      }
                    }}
                  >
                    <GripVertical size={14} />
                  </button>
                )}
                <span className="schedule-order mono">{idx + 1}</span>
                <span
                  className="schedule-mat mono"
                  style={{ background: matColors[(s.mat - 1) % matColors.length] }}
                >
                  M{s.mat}
                </span>
                <span className="schedule-div">{s.divisionName}</span>
                <span className="schedule-label mono">{s.match.label}</span>
                <div className="schedule-matchup">
                  <span className={isDone && winnerId === resolved.slotA.competitorId ? 'schedule-winner' : ''}>{aName}</span>
                  <span className="schedule-vs">vs</span>
                  <span className={isDone && winnerId === resolved.slotB.competitorId ? 'schedule-winner' : ''}>{bName}</span>
                </div>
                <div className="schedule-result">
                  {isDone ? (
                    <>
                      <CheckCircle2 size={12} />
                      <span className="schedule-winner-name">{winnerName ?? 'Auto winner'}</span>
                      <span className="schedule-method mono" title={isAutoDone ? 'Bye' : resultMethod}>
                        {isAutoDone ? 'Bye' : resultMethod}
                      </span>
                    </>
                  ) : (
                    <span className="chip chip-pending dot">pending</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function scheduleEntryKey(entry: ScheduledMatch): string {
  return `${entry.divisionId}:${entry.match.id}`;
}

function moveScheduleKey(keys: string[], activeKey: string, targetKey: string): string[] {
  const activeIndex = keys.indexOf(activeKey);
  const targetIndex = keys.indexOf(targetKey);
  if (activeIndex < 0 || targetIndex < 0 || activeIndex === targetIndex) return keys;

  const nextKeys = [...keys];
  const [active] = nextKeys.splice(activeIndex, 1);
  nextKeys.splice(targetIndex, 0, active);
  return nextKeys;
}

function formatResultMethod(result?: MatchResult): string | undefined {
  if (!result?.method) return undefined;
  const submissionType = result.submissionType?.trim();
  return submissionType ? `${result.method} - ${submissionType}` : result.method;
}

/* ── Results View ── */

interface DivisionResult {
  division: Division;
  gold?: Competitor;
  silver?: Competitor;
  bronze?: Competitor;
  totalMatches: number;
  completedMatches: number;
  submissionKing?: { competitor: Competitor; count: number };
}

function computeDivisionResults(
  divisions: Division[],
  competitorById: Map<string, Competitor>
): DivisionResult[] {
  return divisions.map((division) => {
    const placements = getPlacements(division.format, division.competitorIds, division.bracket);
    const matches = division.bracket?.matches ?? [];
    const completed = matches.filter((m) => m.result);

    const subCounts = new Map<string, number>();
    for (const m of completed) {
      if (m.result && isSubmissionMethod(m.result.method)) {
        subCounts.set(m.result.winnerId, (subCounts.get(m.result.winnerId) ?? 0) + 1);
      }
    }

    let submissionKing: DivisionResult['submissionKing'];
    if (subCounts.size > 0) {
      const [topId, topCount] = [...subCounts.entries()].sort((a, b) => b[1] - a[1])[0];
      const comp = competitorById.get(topId);
      if (comp) submissionKing = { competitor: comp, count: topCount };
    }

    return {
      division,
      gold: placements.gold ? competitorById.get(placements.gold) : undefined,
      silver: placements.silver ? competitorById.get(placements.silver) : undefined,
      bronze: placements.bronze ? competitorById.get(placements.bronze) : undefined,
      totalMatches: matches.length,
      completedMatches: completed.length,
      submissionKing,
    };
  });
}

function ResultsView({
  divisions,
  competitorById,
}: {
  divisions: Division[];
  competitorById: Map<string, Competitor>;
}) {
  const results = useMemo(
    () => computeDivisionResults(divisions, competitorById),
    [divisions, competitorById]
  );

  const activeDivisions = results.filter((r) => r.totalMatches > 0);

  if (activeDivisions.length === 0) {
    return (
      <div className="empty-state" style={{ background: 'var(--surface)', border: '1px solid var(--divider)', borderRadius: 6, minHeight: 400 }}>
        <Trophy size={36} />
        <div className="t">No results yet</div>
        <p style={{ maxWidth: 320, lineHeight: 1.5 }}>Generate brackets and record match results to see division winners and stats here.</p>
      </div>
    );
  }

  const totalSubs = results.reduce((sum, r) => {
    const matches = r.division.bracket?.matches ?? [];
    return sum + matches.filter((m) => m.result && isSubmissionMethod(m.result.method)).length;
  }, 0);
  const totalCompleted = results.reduce((s, r) => s + r.completedMatches, 0);
  const totalMatches = results.reduce((s, r) => s + r.totalMatches, 0);

  return (
    <div className="results-page">
      <div className="results-hero">
        <div className="results-hero-inner">
          <Trophy size={28} className="results-hero-icon" />
          <div>
            <div className="results-hero-title">Tournament Results</div>
            <div className="results-hero-sub">{activeDivisions.length} division{activeDivisions.length !== 1 ? 's' : ''} &middot; {totalCompleted}/{totalMatches} matches completed &middot; {totalSubs} submission{totalSubs !== 1 ? 's' : ''}</div>
          </div>
        </div>
      </div>

      <div className="results-grid">
        {activeDivisions.map((r) => (
          <div key={r.division.id} className="result-card">
            <div className="result-card-hd">
              <div className="result-card-title">{r.division.name}</div>
              <div className="result-card-meta">
                <span className="chip mono">{formatLabels[r.division.format]}</span>
                <span className="chip accent">{rulesetLabels[r.division.ruleset]}</span>
              </div>
              <div className="result-card-progress">
                <div className="result-card-progress-bar">
                  <div className="result-card-progress-fill" style={{ width: r.totalMatches ? `${(r.completedMatches / r.totalMatches) * 100}%` : 0 }} />
                </div>
                <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>{r.completedMatches}/{r.totalMatches}</span>
              </div>
            </div>

            <div className="podium">
              <div className="podium-slot podium-silver">
                <div className="podium-block silver">
                  <span className="podium-place">2</span>
                </div>
                <div className="podium-name">{r.silver?.name ?? '—'}</div>
                <div className="podium-label">Silver</div>
              </div>
              <div className="podium-slot podium-gold">
                <div className="podium-block gold">
                  <Trophy size={18} />
                </div>
                <div className="podium-name">{r.gold?.name ?? '—'}</div>
                <div className="podium-label">Gold</div>
              </div>
              <div className="podium-slot podium-bronze">
                <div className="podium-block bronze">
                  <span className="podium-place">3</span>
                </div>
                <div className="podium-name">{r.bronze?.name ?? '—'}</div>
                <div className="podium-label">Bronze</div>
              </div>
            </div>

            {r.submissionKing && (
              <div className="sub-king">
                <div className="sub-king-badge">SUB</div>
                <div className="sub-king-info">
                  <span className="sub-king-name">{r.submissionKing.competitor.name}</span>
                  <span className="sub-king-count">{r.submissionKing.count} submission{r.submissionKing.count !== 1 ? 's' : ''}</span>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Import / Export View ── */

function ImportExportView({
  tournament,
  csvPreview,
  onCsvPreviewChange,
  onCsvImport,
  onJsonImport,
  onReset
}: {
  tournament: TournamentState;
  csvPreview: CsvImportPreview;
  onCsvPreviewChange: (preview: CsvImportPreview) => void;
  onCsvImport: (rows: CsvCompetitorRow[]) => void;
  onJsonImport: (tournament: TournamentState) => void;
  onReset: () => void;
}) {
  const [message, setMessage] = useState('');
  const csvRows = csvPreview.rows;
  const csvErrors = csvPreview.errors;

  const exportJson = () => {
    downloadBlob(
      JSON.stringify(tournament, null, 2),
      `${safeFileName(tournament.eventName)}.json`,
      'application/json'
    );
  };

  const handleJsonFile = async (file?: File) => {
    if (!file) return;
    const text = await file.text();
    try {
      const parsed = JSON.parse(text) as unknown;
      if (!isTournamentState(parsed)) {
        setMessage('JSON file does not match the tournament format.');
        return;
      }
      onJsonImport(parsed);
      setMessage('Tournament imported.');
    } catch {
      setMessage('JSON file could not be parsed.');
    }
  };

  const handleCsvFile = async (file?: File) => {
    if (!file) return;
    const text = await file.text();
    const result = parseCompetitorCsv(text);
    if (result.rows.length > 0) {
      onCsvImport(result.rows);
      onCsvPreviewChange({
        rows: [],
        errors: result.errors,
        fileName: file.name
      });
      setMessage(`${result.rows.length} competitors added.`);
      return;
    }

    onCsvPreviewChange({
      rows: [],
      errors: result.errors,
      fileName: file.name
    });
    setMessage('No competitors were added.');
  };

  const jsonPreview = JSON.stringify(tournament, null, 2);
  const jsonSize = new Blob([jsonPreview]).size;

  return (
    <div className="io-layout" style={{ height: '100%' }}>
      <div className="io-sidebar">
        <div className="panel io-panel">
          <div className="panel-hd"><span className="t">Export tournament</span></div>
          <p>Bundle competitors, divisions, brackets, and results into a single JSON file.</p>
          <div className="io-buttons">
            <button className="btn primary sm" type="button" onClick={exportJson}>
              <span className="ic"><Download size={13} /></span>Download JSON
            </button>
          </div>
          <div className="io-meta">
            <div className="io-meta-row"><span className="k">Filename</span><span className="v">{safeFileName(tournament.eventName)}.json</span></div>
            <div className="io-meta-row"><span className="k">Size</span><span className="v">{(jsonSize / 1024).toFixed(1)} kB</span></div>
          </div>
        </div>

        <div className="panel io-panel">
          <div className="panel-hd"><span className="t">Import</span></div>
          <div className="drop-zone">
            <Upload size={18} />
            <div>Drop a JSON file here</div>
            <span style={{ color: 'var(--muted-soft)' }}>or browse below</span>
          </div>
          <div className="io-buttons" style={{ flexDirection: 'column', gap: 6 }}>
            <label className="btn sm file-btn" style={{ width: '100%', justifyContent: 'center' }}>
              <span className="ic"><FileJson size={13} /></span>Import JSON
              <input type="file" accept="application/json,.json" onChange={(e) => handleJsonFile(e.target.files?.[0])} />
            </label>
            <label className="btn sm file-btn" style={{ width: '100%', justifyContent: 'center' }}>
              <span className="ic"><FileSpreadsheet size={13} /></span>Import CSV
              <input type="file" accept=".csv,text/csv" onChange={(e) => handleCsvFile(e.target.files?.[0])} />
            </label>
            <button className="btn ghost sm" type="button" style={{ width: '100%', justifyContent: 'center' }} onClick={() => downloadBlob(csvTemplate(), 'competitors-template.csv', 'text/csv')}>
              <span className="ic"><Download size={13} /></span>CSV Template
            </button>
          </div>
        </div>

        <div className="panel io-panel danger-zone">
          <div className="panel-hd"><span className="t">Reset</span></div>
          <p>Clear all tournament data from local storage.</p>
          <button className="btn danger sm" type="button" onClick={onReset}>
            <span className="ic"><RotateCcw size={13} /></span>Reset tournament
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
        {message && <div className={`notice ${message.includes('imported') || message.includes('added') ? 'success' : 'error'}`}>{message}</div>}
        {csvErrors.length > 0 && (
          <div className="error-list">
            {csvErrors.map((error) => <p key={error}>{error}</p>)}
          </div>
        )}

        <div className="panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div className="panel-hd">
            <span className="t">Preview</span>
            <span className="chip mono">v{tournament.updatedAt ? '0.1' : '—'}</span>
            <span className="chip mono neutral">{(jsonSize / 1024).toFixed(1)} kB</span>
          </div>
          <pre className="code-block" style={{ margin: 0, border: 0, borderRadius: 0 }}>
            {jsonPreview}
          </pre>
        </div>
      </div>
    </div>
  );
}

/* ── Helpers ── */

function compareCompetitors(
  left: Competitor,
  right: Competitor,
  sortState: CompetitorSortState,
  divisionNameById: Map<string, string>
): number {
  const direction = sortState.direction === 'asc' ? 1 : -1;
  const leftValue = getCompetitorSortValue(left, sortState.key, divisionNameById);
  const rightValue = getCompetitorSortValue(right, sortState.key, divisionNameById);
  const comparison =
    sortState.key === 'monthsTrained'
      ? compareNumericValues(leftValue, rightValue)
      : compareTextValues(leftValue, rightValue);

  if (comparison !== 0) return comparison * direction;
  return left.name.localeCompare(right.name, undefined, { sensitivity: 'base', numeric: true });
}

function getCompetitorSortValue(
  competitor: Competitor,
  key: CompetitorSortKey,
  divisionNameById: Map<string, string>
): string {
  if (key === 'division') {
    return competitor.divisionId ? divisionNameById.get(competitor.divisionId) ?? '' : '';
  }

  return competitor[key] ?? '';
}

function compareTextValues(left: string, right: string): number {
  const leftIsEmpty = left.trim().length === 0;
  const rightIsEmpty = right.trim().length === 0;

  if (leftIsEmpty && rightIsEmpty) return 0;
  if (leftIsEmpty) return 1;
  if (rightIsEmpty) return -1;

  return left.localeCompare(right, undefined, { sensitivity: 'base', numeric: true });
}

function compareNumericValues(left: string, right: string): number {
  const leftNumber = Number.parseFloat(left);
  const rightNumber = Number.parseFloat(right);
  const leftIsNumber = Number.isFinite(leftNumber);
  const rightIsNumber = Number.isFinite(rightNumber);

  if (leftIsNumber && rightIsNumber) return leftNumber - rightNumber;
  return compareTextValues(left, right);
}

function syncDivisionSeeds(division: Division): Division {
  const competitorIds = unique(division.competitorIds);
  const seedOrder = [
    ...division.seedOrder.filter((competitorId) => competitorIds.includes(competitorId)),
    ...competitorIds.filter((competitorId) => !division.seedOrder.includes(competitorId))
  ];

  return { ...division, competitorIds, seedOrder };
}

function appendUnique(values: string[], value: string): string[] {
  return values.includes(value) ? values : [...values, value];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function shuffleArray(values: string[]): string[] {
  const nextValues = [...values];
  for (let i = nextValues.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [nextValues[i], nextValues[j]] = [nextValues[j], nextValues[i]];
  }
  return nextValues;
}

function stageLabel(stage: Match['stage']): string {
  if (stage === 'main') return 'Main Bracket';
  if (stage === 'bronze') return 'Bronze Bracket';
  if (stage === 'round-robin') return 'Round Robin';
  return 'Custom Bracket';
}

function roundLabel(round: number, totalRounds: number, stage: Match['stage']): string {
  const prefix = stage === 'bronze' ? 'Bronze ' : '';
  if (round === totalRounds && totalRounds > 1) return `${prefix}Final`;
  if (round === totalRounds - 1 && totalRounds > 2) return `${prefix}Semifinals`;
  if (round === totalRounds - 2 && totalRounds > 3) return `${prefix}Quarterfinals`;
  return `${prefix}Round ${round}`;
}

function customSlotOptions(
  division: Division,
  competitorById: Map<string, Competitor>,
  matches: Match[],
  round: number
) {
  const competitorOptions = division.seedOrder.map((competitorId) => ({
    value: `competitor:${competitorId}`,
    label: competitorById.get(competitorId)?.name ?? 'Unknown competitor'
  }));
  const sourceOptions = matches
    .filter((match) => match.round < round)
    .flatMap((match) => [
      { value: `winner:${match.id}`, label: `Winner of ${match.label}` },
      { value: `loser:${match.id}`, label: `Loser of ${match.label}` }
    ]);

  return [{ value: 'bye', label: 'Bye' }, ...competitorOptions, ...sourceOptions];
}

function parseCustomSlot(value: string, matches: Match[]): MatchSlot {
  if (value === 'bye') return makeByeSlot();

  const [type, id] = value.split(':');
  if (type === 'competitor') return makeCompetitorSlot(id);

  const match = matches.find((candidate) => candidate.id === id);
  if (type === 'winner' || type === 'loser') {
    return makeSourceSlot(id, type, `${type === 'winner' ? 'Winner' : 'Loser'} of ${match?.label ?? id}`);
  }

  return makeByeSlot();
}

function isDirectEditableSlot(slot: MatchSlot): boolean {
  return !slot.sourceMatchId;
}

function matchSlotToSelectValue(slot: MatchSlot): string {
  return slot.competitorId ? `competitor:${slot.competitorId}` : 'bye';
}

function selectValueToDirectSlot(value: string): MatchSlot {
  const [type, id] = value.split(':');
  if (type === 'competitor' && id) return makeCompetitorSlot(id);
  return makeByeSlot();
}

function downloadBlob(contents: string, fileName: string, type: string) {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function safeFileName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'tournament';
}

export default App;
