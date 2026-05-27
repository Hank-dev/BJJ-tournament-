# BJJ Tournament App

Vite + React tournament desk with a small Node backend for shared tournament storage.

## Local Development

```bash
npm install
npm run dev
```

The Vite dev server uses browser `localStorage` by default. To develop against the backend API too:

```bash
npm run build
ADMIN_PASSCODE=local-admin npm run dev:server
```

Then open the backend URL from the terminal output. The backend serves `dist/` and stores data in `./data/tournament-store.json` unless `DATA_DIR` is set.

## Railway Deployment

Railway reads `railway.json`, builds with Railpack, runs `npm run build`, then starts the backend with `npm start`.

Set these Railway variables:

```text
ADMIN_PASSCODE=<choose-a-real-admin-passcode>
```

For persistent tournament data, attach a Railway volume to the service. The backend automatically uses Railway's `RAILWAY_VOLUME_MOUNT_PATH` when a volume is attached. Without a volume, stored tournament data can be lost when the service is rebuilt or moved.

The server listens on `0.0.0.0:$PORT`, which is required for Railway public networking.
