/**
 * Minimal weighted undirected graph with Dijkstra shortest paths.
 * Shared by the outdoor campus router and the indoor blueprint router.
 */
export type Graph = Map<string, { to: string; distance: number }[]>

export function createGraph(): Graph {
  return new Map()
}

export function addNode(graph: Graph, id: string): void {
  if (!graph.has(id)) graph.set(id, [])
}

/** Undirected edge with a positive walking distance weight. */
export function addEdge(graph: Graph, a: string, b: string, distance: number): void {
  if (!(distance > 0)) return
  addNode(graph, a)
  addNode(graph, b)
  graph.get(a)!.push({ to: b, distance })
  graph.get(b)!.push({ to: a, distance })
}

export type GraphPath = { nodeIds: string[]; totalDistance: number }

/** Dijkstra shortest path; returns null when the target is unreachable. */
export function shortestPath(graph: Graph, fromId: string, toId: string): GraphPath | null {
  if (!graph.has(fromId) || !graph.has(toId)) return null
  const distances = new Map<string, number>()
  const previous = new Map<string, string | null>()
  const queue = new Set<string>()
  for (const id of graph.keys()) {
    distances.set(id, Infinity)
    queue.add(id)
  }
  distances.set(fromId, 0)
  previous.set(fromId, null)

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
    if (current === toId) break
    queue.delete(current)
    for (const edge of graph.get(current)!) {
      if (!queue.has(edge.to)) continue
      const candidate = currentDistance + edge.distance
      if (candidate < distances.get(edge.to)!) {
        distances.set(edge.to, candidate)
        previous.set(edge.to, current)
      }
    }
  }

  if (!Number.isFinite(distances.get(toId)!)) return null

  const nodeIds: string[] = []
  for (let step: string | null = toId; step !== null; step = previous.get(step) ?? null) {
    nodeIds.unshift(step)
  }
  return { nodeIds, totalDistance: distances.get(toId)! }
}
