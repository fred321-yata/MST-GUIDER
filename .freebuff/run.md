# Run doc — School Guider (Vite + React + Capacitor)

## Reproduce artifacts

- No env files, secrets, or generated assets are needed.
- Dependencies: install with the project's package manager — `npm install` (lockfile: `package-lock.json`).
- Blueprint images are committed under `public/blueprints/` (MST floors 1–4) and the campus photo under `public/` — nothing to copy.

## Run the server

1. `npm run dev` (Vite). `vite.config.ts` already pins host `127.0.0.1` and port **5173**, so no flags are needed — if the port is busy, stop the stale Vite process first instead of letting it drift to 5174 (the preview is registered against 5173).
2. Register the preview with the Vite process id and `http://127.0.0.1:5173/`.
3. Sanity checks: `/` renders the campus map; `/selftest.html` must print `RESULT: ALL 21 PASSED` (and title `SELFTEST-PASS`).

Note (Windows): start detached via
`powershell -NoProfile -Command "(Start-Process -FilePath 'npm.cmd' -ArgumentList 'run','dev','--','--host','127.0.0.1','--port','5173' -RedirectStandardOutput '<log>' -RedirectStandardError '<log>.err' -WindowStyle Hidden -PassThru).Id"`
— stdout and stderr must go to different files.
