import type { LatLng, Point2D } from './geo'
import {
  bearingInDegrees,
  distanceInMeters,
  formatDistance,
  gpsFromImagePercent,
  imagePercentFromGps,
  toLocalMeters,
} from './geo'
import { CAMPUS_EDGES, CAMPUS_NODES, nodeByIdMap } from './model'

/**
 * Campus walkway router: Dijkstra over the node graph, snap-to-path for live
 * GPS, off-route detection, and Google-Maps-style turn-by-turn instructions.
 * Fully offline — pure math over the verified campus data.
 */

export type RouteLeg = { fromId: string; toId: string; distance: number; bearing: number }

export type CampusRoute = {
  targetId: string
  targetLabel: string
  nodeIds: string[]
  /** Polyline in image percent coordinates for drawing on the campus photo. */
  linePercent: Point2D[]
  legs: RouteLeg[]
  totalDistance: number
}

const nodeMap = nodeByIdMap()

function nodeGps(nodeId: string): LatLng {
  return gpsFromImagePercent(nodeMap.get(nodeId)!.image)
}

/** Adjacency list with walking distances in meters (via the GPS projection). */
const adjacency = new Map<string, { to: string; distance: number }[]>()
for (const node of CAMPUS_NODES) adjacency.set(node.id, [])
for (const [fromId, toId] of CAMPUS_EDGES) {
  const distance = distanceInMeters(nodeGps(fromId), nodeGps(toId))
  adjacency.get(fromId)!.push({ to: toId, distance })
  adjacency.get(toId)!.push({ to: fromId, distance })
}

/** Dijkstra shortest path between two nodes. */
export function findRoute(fromNodeId: string, toNodeId: string): CampusRoute | null {
  if (!adjacency.has(fromNodeId) || !adjacency.has(toNodeId)) return null
  const distances = new Map<string, number>()
  const previous = new Map<string, string | null>()
  const queue = new Set<string>(CAMPUS_NODES.map((node) => node.id))
  for (const id of queue) distances.set(id, Infinity)
  distances.set(fromNodeId, 0)
  previous.set(fromNodeId, null)

  while (queue.size > 0) {
    let current: string | null = null
    let currentDistance = Infinity
    for (const id of queue) {
      const value = distances.get(id)!
      if (value < currentDistance) {
        current = id
        currentDistance = value
      }
    }
    if (current === null || currentDistance === Infinity) break
    if (current === toNodeId) break
    queue.delete(current)
    for (const edge of adjacency.get(current)!) {
      if (!queue.has(edge.to)) continue
      const candidate = currentDistance + edge.distance
      if (candidate < distances.get(edge.to)!) {
        distances.set(edge.to, candidate)
        previous.set(edge.to, current)
      }
    }
  }

  if (!Number.isFinite(distances.get(toNodeId)!)) return null

  const path: string[] = []
  let step: string | null = toNodeId
  while (step !== null) {
    path.unshift(step)
    step = previous.get(step) ?? null
  }

  const legs: RouteLeg[] = []
  for (let i = 0; i < path.length - 1; i++) {
    legs.push({
      fromId: path[i],
      toId: path[i + 1],
      distance: distanceInMeters(nodeGps(path[i]), nodeGps(path[i + 1])),
      bearing: bearingInDegrees(nodeGps(path[i]), nodeGps(path[i + 1])),
    })
  }

  const targetNode = nodeMap.get(toNodeId)!
  return {
    targetId: toNodeId,
    targetLabel: targetNode.name,
    nodeIds: path,
    linePercent: path.map((id) => nodeMap.get(id)!.image),
    legs,
    totalDistance: legs.reduce((sum, leg) => sum + leg.distance, 0),
  }
}

/** Nearest node to a GPS position (used when the walker is between junctions). */
export function nearestNodeId(location: LatLng): string {
  let bestId = CAMPUS_NODES[0].id
  let bestDistance = Infinity
  for (const node of CAMPUS_NODES) {
    const distance = distanceInMeters(location, nodeGps(node.id))
    if (distance < bestDistance) {
      bestDistance = distance
      bestId = node.id
    }
  }
  return bestId
}

/** Route a live GPS position (snapped to the closest walkway node) to a target. */
export function routeFromLocation(location: LatLng, toNodeId: string): CampusRoute | null {
  return findRoute(nearestNodeId(location), toNodeId)
}

/** How far the position is from the straight-line path between route nodes, in meters. */
function distanceToSegment(location: LatLng, fromGps: LatLng, toGps: LatLng): number {
  const p = toLocalMeters(location)
  const a = toLocalMeters(fromGps)
  const b = toLocalMeters(toGps)
  const abx = b.x - a.x
  const aby = b.y - a.y
  const lengthSquared = abx * abx + aby * aby
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lengthSquared))
  const closest = { x: a.x + t * abx, y: a.y + t * aby }
  return Math.hypot(p.x - closest.x, p.y - closest.y)
}

/** Remaining walking distance along the route from the walker's live position. */
export function remainingDistance(route: CampusRoute, location: LatLng): number {
  const nodes = route.nodeIds
  let best = distanceInMeters(location, nodeGps(nodes[nodes.length - 1]))
  for (let i = 0; i < nodes.length - 1; i++) {
    const offPath = distanceToSegment(location, nodeGps(nodes[i]), nodeGps(nodes[i + 1]))
    if (offPath > 25) continue
    let remaining = distanceInMeters(location, nodeGps(nodes[i + 1]))
    for (let j = i + 1; j < nodes.length - 1; j++) remaining += route.legs[j].distance
    best = Math.min(best, remaining)
  }
  return best
}

export type TurnStep = {
  index: number
  /** 'depart' | 'straight' | 'left' | 'right' | 'arrive' */
  action: 'depart' | 'straight' | 'left' | 'right' | 'arrive'
  instruction: string
  /** Node where this step happens. */
  nodeId: string
  distance: number
}

/** Google-Maps-style step list computed from the route geometry. */
export function buildTurnSteps(route: CampusRoute): TurnStep[] {
  const steps: TurnStep[] = []
  const legs = route.legs
  if (legs.length === 0) return steps

  steps.push({
    index: 0,
    action: 'depart',
    instruction: `Head toward ${nodeMap.get(legs[0].toId)!.name}`,
    nodeId: legs[0].fromId,
    distance: legs[0].distance,
  })

  for (let i = 1; i < legs.length; i++) {
    const turn = angleBetweenLegs(legs[i - 1].bearing, legs[i].bearing)
    const node = nodeMap.get(legs[i].fromId)!
    steps.push({
      index: i,
      action: turn.action,
      instruction: `${turn.verb} at ${node.name}`,
      nodeId: node.id,
      distance: legs[i].distance,
    })
  }

  const last = nodeMap.get(legs[legs.length - 1].toId)!
  steps.push({
    index: legs.length,
    action: 'arrive',
    instruction: `Arrive at ${last.name}`,
    nodeId: last.id,
    distance: 0,
  })
  return steps
}

function angleBetweenLegs(previousBearing: number, nextBearing: number) {
  const diff = ((nextBearing - previousBearing + 540) % 360) - 180
  if (diff > 45) return { action: 'right' as const, verb: 'Turn right' }
  if (diff < -45) return { action: 'left' as const, verb: 'Turn left' }
  return { action: 'straight' as const, verb: 'Continue straight' }
}

/** The next step to show the walker, based on progress along the route. */
export function currentStep(route: CampusRoute, location: LatLng): TurnStep {
  const steps = buildTurnSteps(route)
  if (steps.length === 0) {
    return { index: 0, action: 'arrive', instruction: 'You have arrived', nodeId: route.targetId, distance: 0 }
  }
  // The walker is between the two nodes of the leg whose segment they are nearest.
  let bestIndex = 0
  let bestDistance = Infinity
  for (let i = 0; i < route.legs.length; i++) {
    const leg = route.legs[i]
    const offPath = distanceToSegment(location, nodeGps(leg.fromId), nodeGps(leg.toId))
    if (offPath < bestDistance) {
      bestDistance = offPath
      bestIndex = i
    }
  }
  return steps[Math.min(bestIndex + 1, steps.length - 1)]
}

export type WalkProgress = { remaining: number; offRoute: number; bearing: number }

/**
 * Live progress along the route: remaining walking distance, how far the
 * walker is from the path (off-route meters), and the bearing of the leg they
 * are on. Used every GPS tick by the navigation overlay.
 */
export function walkProgress(route: CampusRoute, location: LatLng): WalkProgress {
  if (route.legs.length === 0) {
    return {
      remaining: distanceInMeters(location, nodeGps(route.targetId)),
      offRoute: 0,
      bearing: 0,
    }
  }
  let bestIndex = 0
  let bestOff = Infinity
  for (let i = 0; i < route.legs.length; i++) {
    const leg = route.legs[i]
    const off = distanceToSegment(location, nodeGps(leg.fromId), nodeGps(leg.toId))
    if (off < bestOff) {
      bestOff = off
      bestIndex = i
    }
  }
  const leg = route.legs[bestIndex]
  let remaining = distanceInMeters(location, nodeGps(leg.toId))
  for (let j = bestIndex + 1; j < route.legs.length; j++) remaining += route.legs[j].distance
  return { remaining, offRoute: bestOff, bearing: leg.bearing }
}

/** Direct-to-target fallback bearing used when GPS drifts far off the walkways. */
export function directBearing(location: LatLng, toNodeId: string): number {
  return bearingInDegrees(location, nodeGps(toNodeId))
}

/** Image-percent point for the live user dot. */
export function userImagePercent(location: LatLng): Point2D | null {
  return imagePercentFromGps(location)
}

export function formatRouteDistance(meters: number): string {
  return formatDistance(meters)
}
