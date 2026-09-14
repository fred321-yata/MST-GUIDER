export type LatLng = { latitude: number; longitude: number }
export type Point2D = { x: number; y: number }

/**
 * Campus calibration. Each anchor is a spot with KNOWN GPS coordinates whose
 * position on the campus photo is also known (in percent of the image).
 *
 * Defaults: anchor A is the verified MST coordinate mapped onto the MST
 * entrance area of the photo; anchor B is the main gate. The distance between
 * them sets the photo's ground scale (~120 × 67 m footprint).
 *
 * TO CALIBRATE PRECISELY: stand at two visible spots, read the GPS from the
 * app/dev tools, tap their pixel positions on the photo, and update both
 * anchors. Everything else (dot, routes, distances) adjusts automatically.
 */
export const CAMPUS_GEO = {
  anchorA: {
    gps: { latitude: 6.346549, longitude: 124.936164 },
    image: { x: 50, y: 49.5 },
  },
  anchorB: {
    gps: { latitude: 6.346285, longitude: 124.936164 },
    image: { x: 50, y: 93 },
  },
  /** Degrees the photo is rotated clockwise from true north. Calibrate if needed. */
  rotationDegrees: 0,
  // Campus bounds polygon (lat/lng) — the app says "outside the school" when
  // the user crosses it. Slightly larger than the photo footprint.
  boundary: [
    { latitude: 6.34619, longitude: 124.93557 },
    { latitude: 6.34619, longitude: 124.93676 },
    { latitude: 6.3469, longitude: 124.93676 },
    { latitude: 6.3469, longitude: 124.93557 },
  ] as LatLng[],
}

/** Aspect ratio of campus-aerial.jpg.png (1414 × 793 px). Update if the image changes. */
export const CAMPUS_IMAGE_ASPECT = 1414 / 793

const EARTH_RADIUS = 6371000
const DEG = Math.PI / 180

/** Great-circle distance in meters. */
export function distanceInMeters(from: LatLng, to: LatLng): number {
  const latDelta = (to.latitude - from.latitude) * DEG
  const lngDelta = (to.longitude - from.longitude) * DEG
  const lat1 = from.latitude * DEG
  const lat2 = to.latitude * DEG
  const a = Math.sin(latDelta / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(lngDelta / 2) ** 2
  return EARTH_RADIUS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** Initial bearing from point A to point B, degrees clockwise from north (0-360). */
export function bearingInDegrees(from: LatLng, to: LatLng): number {
  const lat1 = from.latitude * DEG
  const lat2 = to.latitude * DEG
  const lngDelta = (to.longitude - from.longitude) * DEG
  const x = Math.sin(lngDelta) * Math.cos(lat2)
  const y = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lngDelta)
  return (Math.atan2(x, y) / DEG + 360) % 360
}

/** Shortest signed difference between two headings, -180..180. */
export function angleDifference(fromHeading: number, toHeading: number): number {
  const diff = (toHeading - fromHeading) % 360
  return diff > 180 ? diff - 360 : diff < -180 ? diff + 360 : diff
}

export function compassLabel(bearing: number): string {
  const labels = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest']
  return labels[Math.round((((bearing % 360) + 360) % 360) / 45) % 8]
}

export function formatDistance(meters: number): string {
  if (meters < 10) return `${Math.max(0, Math.round(meters))} m`
  if (meters < 1000) return `${Math.round(meters / 5) * 5} m`
  return `${(meters / 1000).toFixed(1)} km`
}

export function formatHeading(bearing: number): string {
  return `${Math.round(((bearing % 360) + 360) % 360)}° ${compassLabel(bearing)}`
}

/** Equirectangular meters-per-degree at the campus latitude (~6.35°). */
function metersPerDegree(latitude: number) {
  const north = 111132
  const east = Math.cos(latitude * DEG) * 111320
  return { north, east }
}

/**
 * Local tangent-plane projection anchored at anchor A. Positive y = north,
 * positive x = east. Used for flat-earth math over the small campus area.
 */
export function toLocalMeters(point: LatLng): Point2D {
  const scale = metersPerDegree(CAMPUS_GEO.anchorA.gps.latitude)
  return {
    x: (point.longitude - CAMPUS_GEO.anchorA.gps.longitude) * scale.east,
    y: (point.latitude - CAMPUS_GEO.anchorA.gps.latitude) * scale.north,
  }
}

export function fromLocalMeters(local: Point2D): LatLng {
  const scale = metersPerDegree(CAMPUS_GEO.anchorA.gps.latitude)
  return {
    latitude: CAMPUS_GEO.anchorA.gps.latitude + local.y / scale.north,
    longitude: CAMPUS_GEO.anchorA.gps.longitude + local.x / scale.east,
  }
}

/**
 * Projection parameters derived from the two anchors. The anchors are mapped
 * into square normalized image space (x multiplied by the aspect ratio) so a
 * single uniform scale (meters per unit, i.e. uniform ground resolution)
 * describes the whole photo — correct for an unrotated aerial image.
 */
function projection() {
  const A = CAMPUS_GEO.anchorA
  const B = CAMPUS_GEO.anchorB
  const a = toLocalMeters(A.gps)
  const b = toLocalMeters(B.gps)
  const ua = A.image.x * CAMPUS_IMAGE_ASPECT
  const va = A.image.y
  const ub = B.image.x * CAMPUS_IMAGE_ASPECT
  const vb = B.image.y
  const gpsDistance = Math.hypot(b.x - a.x, b.y - a.y)
  const squareDistance = Math.hypot(ub - ua, vb - va)
  if (gpsDistance < 0.5 || squareDistance < 1e-6) return null
  return { a, ua, va, scale: gpsDistance / squareDistance }
}

/**
 * Project a GPS position into percentage coordinates of the campus image
 * (0-100 on both axes), so the blue "you are here" dot sits on the exact spot
 * of the photo the user is physically standing on.
 */
export function imagePercentFromGps(location: LatLng): Point2D | null {
  const proj = projection()
  if (!proj) return null
  const p = toLocalMeters(location)
  let de = p.x - proj.a.x
  let dn = p.y - proj.a.y
  const rotation = CAMPUS_GEO.rotationDegrees
  if (rotation) {
    const r = -rotation * DEG
    const de2 = de * Math.cos(r) - dn * Math.sin(r)
    const dn2 = de * Math.sin(r) + dn * Math.cos(r)
    de = de2
    dn = dn2
  }
  const qx = proj.ua + de / proj.scale
  // Image y grows downward (south) while ground y grows northward — flip it.
  const qy = proj.va - dn / proj.scale
  return { x: qx / CAMPUS_IMAGE_ASPECT, y: qy }
}

/** Inverse: percentage coordinates on the image -> GPS position. */
export function gpsFromImagePercent(percent: Point2D): LatLng {
  const proj = projection()
  if (!proj) return CAMPUS_GEO.anchorA.gps
  const qx = percent.x * CAMPUS_IMAGE_ASPECT
  const qy = percent.y
  // Inverse of the y flip in imagePercentFromGps.
  let de = (qx - proj.ua) * proj.scale
  let dn = -(qy - proj.va) * proj.scale
  const rotation = CAMPUS_GEO.rotationDegrees
  if (rotation) {
    const r = rotation * DEG
    const de2 = de * Math.cos(r) - dn * Math.sin(r)
    const dn2 = de * Math.sin(r) + dn * Math.cos(r)
    de = de2
    dn = dn2
  }
  return fromLocalMeters({ x: proj.a.x + de, y: proj.a.y + dn })
}

/** Ray-casting point-in-polygon test against the campus fence. */
export function isInsideCampus(location: LatLng): boolean {
  const polygon = CAMPUS_GEO.boundary
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i]
    const pj = polygon[j]
    const intersects =
      pi.longitude > location.longitude !== (pj.longitude > location.longitude) &&
      location.latitude <
        ((pj.latitude - pi.latitude) * (location.longitude - pi.longitude)) / (pj.longitude - pi.longitude) +
          pi.latitude
    if (intersects) inside = !inside
  }
  return inside
}
