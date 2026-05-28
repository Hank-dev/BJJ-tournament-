import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'dist');
const dataDir = path.resolve(
  process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(rootDir, 'data')
);
const dataFile = path.join(dataDir, 'tournament-store.json');
const maxBodyBytes = 10 * 1024 * 1024;
const adminPasscode = process.env.ADMIN_PASSCODE || '';

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.ico', 'image/x-icon'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp']
]);

const server = createServer(async (request, response) => {
  try {
    setCommonHeaders(response);

    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }

    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

    if (url.pathname.startsWith('/api/')) {
      await handleApi(request, response, url);
      return;
    }

    await serveStatic(request, response, url);
  } catch (error) {
    console.error(error);
    const statusCode =
      error && typeof error === 'object' && Number.isInteger(error.statusCode) ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Request failed';
    sendJson(response, statusCode, {
      error: statusCode === 500 ? 'Internal server error' : message
    });
  }
});

async function handleApi(request, response, url) {
  if (url.pathname === '/api/health' && request.method === 'GET') {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (url.pathname === '/api/admin/verify' && request.method === 'POST') {
    const body = await readJsonBody(request);
    const passcode = typeof body.passcode === 'string' ? body.passcode : '';
    sendJson(response, adminPasscode && passcode !== adminPasscode ? 401 : 200, {
      ok: !adminPasscode || passcode === adminPasscode
    });
    return;
  }

  if (url.pathname === '/api/tournament-store' && request.method === 'GET') {
    const store = await readTournamentStore();
    if (!store) {
      sendJson(response, 404, { error: 'Tournament store not found' });
      return;
    }

    sendJson(response, 200, store);
    return;
  }

  if (url.pathname === '/api/tournament-store' && request.method === 'PUT') {
    if (!isAuthorized(request)) {
      sendJson(response, 401, { error: 'Invalid admin passcode' });
      return;
    }

    const body = await readJsonBody(request);
    if (!isTournamentStore(body)) {
      sendJson(response, 400, { error: 'Invalid tournament store payload' });
      return;
    }

    const store = normalizeTournamentStore(body);
    await writeTournamentStore(store);
    sendJson(response, 200, store);
    return;
  }

  const applicationMatch = url.pathname.match(/^\/api\/tournament-store\/([^/]+)\/applications$/);
  if (applicationMatch && request.method === 'POST') {
    const store = await readTournamentStore();
    if (!store) {
      sendJson(response, 404, { error: 'Tournament store not found' });
      return;
    }

    const body = await readJsonBody(request);
    const draft = parseTournamentApplicationDraft(body);
    if (!draft) {
      sendJson(response, 400, { error: 'Invalid application payload' });
      return;
    }

    const tournamentId = decodeURIComponent(applicationMatch[1]);
    const nextStore = addTournamentApplication(store, tournamentId, draft);
    if (!nextStore) {
      sendJson(response, 404, { error: 'Tournament not found' });
      return;
    }

    await writeTournamentStore(nextStore);
    sendJson(response, 201, nextStore);
    return;
  }

  sendJson(response, 404, { error: 'Not found' });
}

async function serveStatic(request, response, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end();
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    response.writeHead(400);
    response.end('Bad request');
    return;
  }

  const requestedFile = pathname === '/' ? 'index.html' : pathname.slice(1);
  const filePath = path.resolve(publicDir, requestedFile);

  if (!filePath.startsWith(`${publicDir}${path.sep}`) && filePath !== publicDir) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  const staticFile = await getExistingFile(filePath);
  if (!staticFile && path.extname(filePath)) {
    response.writeHead(404);
    response.end('Not found');
    return;
  }

  const fallbackFile = path.join(publicDir, 'index.html');
  const finalFile = staticFile || fallbackFile;

  try {
    const contents = await fs.readFile(finalFile);
    response.writeHead(200, {
      'Content-Type': contentTypes.get(path.extname(finalFile)) || 'application/octet-stream',
      'Cache-Control': finalFile === fallbackFile ? 'no-store' : 'public, max-age=31536000, immutable'
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    response.end(contents);
  } catch (error) {
    if (error.code === 'ENOENT') {
      response.writeHead(404);
      response.end('Build output not found. Run npm run build first.');
      return;
    }
    throw error;
  }
}

async function getExistingFile(filePath) {
  try {
    const stat = await fs.stat(filePath);
    if (stat.isFile()) return filePath;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return null;
}

async function readTournamentStore() {
  try {
    const raw = await fs.readFile(dataFile, 'utf8');
    const parsed = JSON.parse(raw);
    return isTournamentStore(parsed) ? normalizeTournamentStore(parsed) : null;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeTournamentStore(store) {
  await fs.mkdir(dataDir, { recursive: true });
  const tempFile = `${dataFile}.${process.pid}.tmp`;
  await fs.writeFile(tempFile, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  await fs.rename(tempFile, dataFile);
}

async function readJsonBody(request) {
  let size = 0;
  const chunks = [];

  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      const error = new Error('Request body too large');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Invalid JSON');
    error.statusCode = 400;
    throw error;
  }
}

function isAuthorized(request) {
  if (!adminPasscode) return true;
  return request.headers['x-admin-passcode'] === adminPasscode;
}

function isTournamentStore(value) {
  if (!value || typeof value !== 'object') return false;
  if (typeof value.activeTournamentId !== 'string') return false;
  if (!Array.isArray(value.tournaments) || value.tournaments.length === 0) return false;

  return value.tournaments.every(
    (record) =>
      record &&
      typeof record === 'object' &&
      typeof record.id === 'string' &&
      isTournamentState(record.tournament)
  );
}

function isTournamentState(value) {
  return (
    value &&
    typeof value === 'object' &&
    typeof value.eventName === 'string' &&
    Array.isArray(value.competitors) &&
    Array.isArray(value.divisions) &&
    (value.scheduleOrder === undefined ||
      (Array.isArray(value.scheduleOrder) && value.scheduleOrder.every((key) => typeof key === 'string'))) &&
    typeof value.updatedAt === 'string'
  );
}

function normalizeTournamentStore(store) {
  const activeTournamentId = store.tournaments.some((record) => record.id === store.activeTournamentId)
    ? store.activeTournamentId
    : store.tournaments[0].id;

  return {
    activeTournamentId,
    tournaments: store.tournaments
  };
}

function parseTournamentApplicationDraft(value) {
  if (!value || typeof value !== 'object') return null;
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  if (!name) return null;

  const draft = { name };
  for (const key of ['weightClass', 'monthsTrained', 'gender', 'divisionId']) {
    if (typeof value[key] === 'string' && value[key].trim()) {
      draft[key] = value[key].trim();
    }
  }
  return draft;
}

function addTournamentApplication(store, tournamentId, draft) {
  let found = false;
  const tournaments = store.tournaments.map((record) => {
    if (record.id !== tournamentId) return record;
    found = true;
    return {
      ...record,
      tournament: addApplicationToTournament(record.tournament, draft)
    };
  });

  return found ? normalizeTournamentStore({ ...store, tournaments }) : null;
}

function addApplicationToTournament(tournament, draft) {
  const validDivisionId =
    draft.divisionId && tournament.divisions.some((division) => division.id === draft.divisionId)
      ? draft.divisionId
      : undefined;
  const competitor = {
    id: createId('competitor'),
    name: draft.name,
    weightClass: draft.weightClass,
    monthsTrained: draft.monthsTrained,
    gender: draft.gender,
    divisionId: validDivisionId
  };

  return {
    ...tournament,
    competitors: [...tournament.competitors, competitor],
    divisions: tournament.divisions.map((division) =>
      division.id === validDivisionId
        ? syncDivisionSeeds({
            ...division,
            competitorIds: appendUnique(
              Array.isArray(division.competitorIds) ? division.competitorIds : [],
              competitor.id
            ),
            seedOrder: appendUnique(
              Array.isArray(division.seedOrder) ? division.seedOrder : [],
              competitor.id
            ),
            bracket: undefined,
            updatedAt: new Date().toISOString()
          })
        : division
    ),
    updatedAt: new Date().toISOString()
  };
}

function syncDivisionSeeds(division) {
  const competitorIds = unique(Array.isArray(division.competitorIds) ? division.competitorIds : []);
  const currentSeedOrder = Array.isArray(division.seedOrder) ? division.seedOrder : [];
  const seedOrder = [
    ...currentSeedOrder.filter((competitorId) => competitorIds.includes(competitorId)),
    ...competitorIds.filter((competitorId) => !currentSeedOrder.includes(competitorId))
  ];

  return { ...division, competitorIds, seedOrder };
}

function appendUnique(values, value) {
  return values.includes(value) ? values : [...values, value];
}

function unique(values) {
  return [...new Set(values)];
}

function createId(prefix) {
  const randomPart = Math.random().toString(36).slice(2, 9);
  return `${prefix}-${Date.now().toString(36)}-${randomPart}`;
}

function setCommonHeaders(response) {
  response.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Passcode');
  response.setHeader('X-Content-Type-Options', 'nosniff');
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

server.on('clientError', (_error, socket) => {
  socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

const port = Number(process.env.PORT || 3000);
server.listen(port, '0.0.0.0', () => {
  console.log(`Tournament backend listening on 0.0.0.0:${port}`);
  console.log(`Tournament data file: ${dataFile}`);
  if (!adminPasscode) {
    console.warn('ADMIN_PASSCODE is not set; remote tournament writes are open.');
  }
});
