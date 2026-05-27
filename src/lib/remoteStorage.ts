import {
  isTournamentStore,
  normalizeTournamentStore,
  type TournamentStore
} from './storage';

const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/$/, '') ?? '';
const remoteStoreEnabled = Boolean(configuredApiBaseUrl) || import.meta.env.PROD;

export function isRemoteStoreEnabled(): boolean {
  return remoteStoreEnabled;
}

export async function loadRemoteTournamentStore(signal?: AbortSignal): Promise<TournamentStore | null> {
  if (!remoteStoreEnabled) return null;

  const response = await fetch(`${configuredApiBaseUrl}/api/tournament-store`, {
    headers: { Accept: 'application/json' },
    signal
  });

  if (response.status === 404 || response.status === 204) return null;
  if (!response.ok) throw new Error(`Failed to load tournament store: ${response.status}`);

  const payload = (await response.json()) as unknown;
  if (!isTournamentStore(payload)) return null;
  return normalizeTournamentStore(payload);
}

export async function saveRemoteTournamentStore(
  store: TournamentStore,
  adminPasscode: string,
  signal?: AbortSignal
): Promise<void> {
  if (!remoteStoreEnabled) return;

  const response = await fetch(`${configuredApiBaseUrl}/api/tournament-store`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Passcode': adminPasscode
    },
    body: JSON.stringify(normalizeTournamentStore(store)),
    signal
  });

  if (!response.ok) throw new Error(`Failed to save tournament store: ${response.status}`);
}

export async function verifyRemoteAdminPasscode(
  passcode: string,
  signal?: AbortSignal
): Promise<boolean> {
  if (!remoteStoreEnabled) return true;

  const response = await fetch(`${configuredApiBaseUrl}/api/admin/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passcode }),
    signal
  });

  if (response.status === 401) return false;
  if (!response.ok) throw new Error(`Failed to verify admin passcode: ${response.status}`);
  const payload = (await response.json()) as { ok?: boolean };
  return payload.ok === true;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
