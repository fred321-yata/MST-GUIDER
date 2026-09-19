# School Guider

Mobile-first **offline campus navigator for SEAIT**. The map is the app's own aerial photo — no Google Maps, no online tiles, no external APIs. Directions are computed by an in-app router over a campus walkway graph.

## How it works

- **Own map**: `public/campus-aerial.jpg.png` is the map. Everything (user dot, routes, markers) is positioned by percentage coordinates of that photo.
- **GPS anchoring**: two verified GPS anchors (`CAMPUS_GEO` in `src/campus/geo.ts`) project any live position onto the photo, so the blue dot sits on the exact spot the user stands.
- **Campus-only lock**: a boundary polygon flags when the user is outside school grounds; navigation messages guide them back to campus.
- **In-app directions**: Dijkstra shortest path over the walkway graph (`src/campus/model.ts`), with snap-to-path, off-route detection, and Google-Maps-style turn-by-turn steps ("Turn left at Driveway junction…").
- **360° street views**: panorama points on the aerial photo open spherical viewers (three.js). Point 20 is live; others are pending.
- **Search**: buildings, areas, and (once added) rooms — all resolved to routable walkway nodes.
- **No internet needed**: runs fully offline inside the Capacitor APK. The only external request is a font stylesheet, which degrades gracefully.

## Project layout

```
src/campus/geo.ts         GPS ↔ photo projection, distances, bearings, geofence
src/campus/model.ts       ★ ALL campus data: walkways, places, rooms, 360 points
src/campus/graph.ts       Generic weighted graph + Dijkstra (shared indoor/outdoor)
src/campus/routing.ts     Campus router, snap-to-path, turn-by-turn steps
src/campus/indoor.ts      ★ MST building blueprint: 4 floors, 70 rooms, stairs, routing
src/IndoorNavigator.tsx   Blueprint viewer: floor tabs, tappable rooms, route overlay
src/main.tsx              Screens: map, search, navigate, live overlay, 360 viewer
```

## Run

```bash
npm install
npm run dev
```

The dev server binds `http://127.0.0.1:5173/` (see `vite.config.ts`). No location permission is needed to explore: the navigation overlay offers a **demo walk** that simulates a person walking from the gate to the MST entrance.

## Host it as a website

`npm run build` writes a self-contained site to `dist/` — upload that folder to any static host (Netlify, Vercel, GitHub Pages, cPanel, S3). Every URL in the build is relative (`./assets/…`, `./campus-aerial.jpg.png`, `./blueprints/…`), so the same build works at the domain root, in a subfolder such as `https://school.edu/guider/`, and inside the Capacitor webView. Nothing else is required: no server, database, API key or location permission. Check the build locally with `npm run preview`.

The app keeps working when a browser blocks storage (sandboxed iframes, cookies disabled) or WebGL (360° views then show a fallback message), so a strict host cannot blank the page.

## Build Android APK

```bash
npm run android:apk
```

Debug APK: `android/app/build/outputs/apk/debug/app-debug.apk`.

## Blueprint system (done — MST building is live)

The indoor navigator (`src/campus/indoor.ts` + `src/IndoorNavigator.tsx`) covers the 4-floor MST building from the developer's drawings: **70 rooms**, entrances/exits, comfort rooms, the U-shaped hallway, and both stairwells.

**What it does**: floor tabs (1F–4F), tappable room rectangles over each blueprint image, in-app room search, and real routing — same-floor walks and multi-floor routes that pick a stairwell and announce "Take the stairs to floor 3".

**Adding more buildings** — data only, no code changes:

1. **Images**: drop each floor into `public/blueprints/<building>-floor-<n>.png`.
2. **Rooms**: transcribe every room as an `IndoorRoom` (name, floor, kind, percent `rect`, and the hallway `nodeId` it routes from).
3. **Hallways**: add that building's hallway nodes to the graph and connect them; link floors with `STAIR_LINKS` entries.
4. **Search**: rooms surface in the indoor search and the campus-wide search automatically.

To connect indoor rooms from the outdoor map later: map each building's main entrance to a `CAMPUS_NODES` node and chain the two routers (walk outside → enter building → indoor route). The seam is one node id.

Also add more 360° photos by appending entries to `STREET_VIEW_POINTS` in `src/campus/model.ts`.

## Data policy

Only developer-verified data goes into `src/campus/model.ts`. The router never invents paths: if two places are not connected by added edges, no route is shown.

## Verifying the engine

- `selftest.html` — the canonical check. Serves the **real TypeScript modules** through Vite: run `npm run dev`, open `/selftest.html`. **21 checks** — projection roundtrips, anchors, geofence, Dijkstra, turn steps, walk progress, off-route, data integrity, plus 6 indoor checks (room data, same-floor and cross-floor stair routes, room-to-room routing, route geometry, room search). All pass.
- `mathtest.html` — standalone mirror of the campus math for any browser without Vite. Same math, hand-copied; if the two ever disagree, `selftest.html` wins.
- The blue dot, route line, and pins are positioned relative to the true displayed image rect (`object-fit: contain` aware), so they stay accurate on any screen shape.
