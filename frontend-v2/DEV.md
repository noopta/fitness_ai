# Local Development

## Why the server keeps stopping

1. **Background process lifecycle**: When the dev server is started from Cursor's "Run" or a background terminal, it can stop when you switch contexts, close the terminal, or the IDE restarts.

2. **Windows port 5000**: On Windows, port 5000 is sometimes used by system services (RPC). This can cause "address already in use" or connection issues.

3. **Crashes**: Unhandled errors can crash the Node process.

## Solutions

### 1. Run in a dedicated terminal (recommended)

Open a terminal in Cursor and run:

```bash
cd frontend-v2
npm run dev
```

**Keep this terminal tab open** while developing. The app will be at **http://localhost:3000**.

### 2. Use port 3000 (default now)

The dev script now uses port **3000** by default to avoid Windows port 5000 conflicts. Use **http://localhost:3000** in your browser.

To use port 5000 instead:
```bash
PORT=5000 npm run dev
```
(PowerShell: `$env:PORT="5000"; npm run dev`)

### 3. Auto-restart on crash

Use `npm run dev:watch` to run with nodemon. If the server crashes, it will restart automatically:

```bash
cd frontend-v2
npm run dev:watch
```

### 4. First-time setup

Install dependencies (including new `cross-env` and `nodemon`):

```bash
cd frontend-v2
npm install
```
