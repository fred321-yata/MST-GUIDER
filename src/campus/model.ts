import type { LatLng, Point2D } from './geo'
import { publicAsset } from './assets'
import { gpsFromImagePercent } from './geo'
import { INDOOR_ROOMS } from './indoor'
import type { IndoorRoom } from './indoor'

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SINGLE SOURCE OF TRUTH for the SEAIT campus.
 * Everything here is campus-local: no Google Maps, no online tiles, no APIs.
 *
 * TO ADD THE BLUEPRINT LATER:
 *   1. Drop the blueprint image into /public (e.g. /seait-blueprint.png).
 *   2. Stand at two known spots, read GPS from this app's dev tools, and put
 *      them in CAMPUS_GEO.anchorA / anchorB (src/campus/geo.ts).
 *   3. Add one node for every hallway junction / door / entrance with its
 *      percentage position on the image, and connect them with edges.
 *   4. Add rooms to CAMPUS_ROOMS and attach them to their nearest node.
 * Turn-by-turn directions then work automatically — no other code changes.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** A junction/door/entrance point on the walkway network, positioned on the campus image. */
export type CampusNode = {
  id: string
  name: string
  /** Position as percentages of the campus aerial image (0-100 both axes). */
  image: Point2D
  kind: 'entrance' | 'junction' | 'door' | 'area'
}

/** A walkable connection between two nodes. Length is computed from GPS projection. */
export type CampusEdge = [fromId: string, toId: string]

export type CampusPlace = {
  id: string
  name: string
  category: string
  description: string
  /** Node the walker routes to. */
  nodeId: string
  status: 'verified' | 'pending'
  has360: boolean
  /** Optional GPS spot for the place card display. */
  coordinates?: string
}

/** A searchable room attached to a routable node (blueprint data goes here). */
export type CampusRoom = {
  id: string
  name: string
  building: string
  floor: number
  nodeId: string
}

/* ── Walkway network (percent coordinates on campus-aerial.jpg.png) ───────── */

export const CAMPUS_NODES: CampusNode[] = [
  { id: 'gate', name: 'Main gate', image: { x: 50, y: 93 }, kind: 'entrance' },
  { id: 'drive-junction', name: 'Driveway junction', image: { x: 50, y: 78 }, kind: 'junction' },
  { id: 'mst-front', name: 'MST Building front walk', image: { x: 50, y: 60 }, kind: 'junction' },
  { id: 'mst-entrance', name: 'MST Building entrance', image: { x: 50, y: 49.5 }, kind: 'door' },
  { id: 'mst-left-wing', name: 'MST left wing', image: { x: 30, y: 52 }, kind: 'junction' },
  { id: 'mst-right-wing', name: 'MST right wing', image: { x: 70, y: 52 }, kind: 'junction' },
  { id: 'field', name: 'Field / open area', image: { x: 77, y: 71 }, kind: 'area' },
]

export const CAMPUS_EDGES: CampusEdge[] = [
  ['gate', 'drive-junction'],
  ['drive-junction', 'mst-front'],
  ['mst-front', 'mst-entrance'],
  ['mst-front', 'mst-left-wing'],
  ['mst-front', 'mst-right-wing'],
  ['drive-junction', 'field'],
  ['mst-right-wing', 'field'],
]

/* ── Destinations ──────────────────────────────────────────────────────────── */

export const CAMPUS_PLACES: CampusPlace[] = [
  {
    id: 'mst-building',
    name: 'MST Building',
    category: 'Building',
    description: 'Official MST building information supplied by the project developer.',
    nodeId: 'mst-entrance',
    status: 'verified',
    has360: true,
    coordinates: '6.346549, 124.936164',
  },
  {
    id: 'mst-field',
    name: 'MST Field',
    category: 'Open area / field',
    description: 'Open field area of the SEAIT campus shown in the visual references.',
    nodeId: 'field',
    status: 'verified',
    has360: false,
  },
]

/* ── Room registry — attach blueprint rooms here later ────────────────────── */

export const CAMPUS_ROOMS: CampusRoom[] = [
  // Example shape (uncomment and edit once room names are verified):
  // { id: 'mst-101', name: 'MST 101', building: 'MST Building', floor: 1, nodeId: 'mst-entrance' },
]

/* ── Numbered street-view capture points on the aerial image ──────────────── */

export const STREET_VIEW_POINTS: { point: number; image: Point2D; panorama?: string }[] = [
  // Marker sits just left of point 19 (37.8, 68.6) so the ring reads 1…20.
  { point: 20, image: { x: 30.8, y: 68.6 }, panorama: publicAsset('point-20-360.jpg.jpg') },
  // Add more capture points as 360 photos are taken:
  // { point: 1, image: { x: 56.4, y: 67.8 }, panorama: '/point-1-360.jpg.jpg' },
]

/** All remaining numbered markers from the original photo overlay. */
export const PENDING_STREET_VIEW_POINTS: Point2D[] = [
  [56.4, 67.8], [63.9, 64.5], [71.4, 57.7], [77.8, 48.9], [82.7, 37.7], [85.8, 25.4], [87.3, 12],
  [69.7, 7.9], [57.3, 7.7], [47, 7.7], [36.9, 7.9], [26.6, 7.9], [16.4, 7.9], [11.3, 15.6],
  [16.4, 29], [18.7, 42.3], [24, 53.6], [31.4, 61.5], [37.8, 68.6],
].map(([x, y]) => ({ x, y }))

/* ── Lookup helpers ───────────────────────────────────────────────────────── */

export function findNode(nodeId: string): CampusNode {
  const node = CAMPUS_NODES.find((candidate) => candidate.id === nodeId)
  if (!node) throw new Error(`Unknown campus node: ${nodeId}`)
  return node
}

export function nodeByIdMap(): Map<string, CampusNode> {
  return new Map(CAMPUS_NODES.map((node) => [node.id, node]))
}

export type SearchHit =
  | { kind: 'place'; place: CampusPlace }
  | { kind: 'room'; room: CampusRoom }
  | { kind: 'indoor'; room: IndoorRoom }

export function searchCampus(query: string): SearchHit[] {
  const needle = query.trim().toLowerCase()
  const placeHits: SearchHit[] = CAMPUS_PLACES.filter(
    (place) => place.status === 'verified' && (place.name.toLowerCase().includes(needle) || place.category.toLowerCase().includes(needle)),
  ).map((place) => ({ kind: 'place' as const, place }))
  const roomHits: SearchHit[] = CAMPUS_ROOMS.filter(
    (room) => room.name.toLowerCase().includes(needle) || room.building.toLowerCase().includes(needle),
  ).map((room) => ({ kind: 'room' as const, room }))
  // Blueprint rooms from the MST indoor navigator (only when the user types).
  const indoorHits: SearchHit[] = needle
    ? INDOOR_ROOMS.filter((room) => room.name.toLowerCase().includes(needle))
        .slice(0, 10)
        .map((room) => ({ kind: 'indoor' as const, room }))
    : []
  return [...placeHits, ...roomHits, ...indoorHits]
}

export function findPlace(placeId: string): CampusPlace | undefined {
  return CAMPUS_PLACES.find((place) => place.id === placeId)
}

export type RoutableTarget = { label: string; nodeId: string; gps: LatLng }

/** Resolve any search hit to a routable target (GPS via the image projection). */
export function targetForHit(hit: SearchHit): RoutableTarget {
  if (hit.kind === 'indoor') {
    // Indoor rooms route outdoors to the MST building entrance first.
    const node = findNode('mst-entrance')
    return { label: hit.room.name, nodeId: node.id, gps: gpsFromImagePercent(node.image) }
  }
  const nodeId = hit.kind === 'place' ? hit.place.nodeId : hit.room.nodeId
  const node = findNode(nodeId)
  const label = hit.kind === 'place' ? hit.place.name : `${hit.room.name} · ${hit.room.building}`
  return { label, nodeId, gps: gpsFromImagePercent(node.image) }
}
