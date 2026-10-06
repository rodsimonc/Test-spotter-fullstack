// Geometry for the fake OSRM: great-circle distance, interpolation and a gentle sideways bend so
// routes look like roads on the map and give the polyline simplifier something to chew on.

const EARTH_RADIUS_M = 6_371_008.8
const toRad = (deg) => (deg * Math.PI) / 180
const toDeg = (rad) => (rad * 180) / Math.PI

/** @typedef {[lat: number, lon: number]} LatLon */

/**
 * @param {LatLon} a
 * @param {LatLon} b
 * @returns {number} metres
 */
export function haversineMeters(a, b) {
  const dLat = toRad(b[0] - a[0])
  const dLon = toRad(b[1] - a[1])
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * Point a fraction `t` of the way along the great circle from `a` to `b`.
 * @param {LatLon} a
 * @param {LatLon} b
 * @param {number} t 0 to 1
 * @returns {LatLon}
 */
export function interpolateGreatCircle(a, b, t) {
  const delta = haversineMeters(a, b) / EARTH_RADIUS_M
  if (delta < 1e-9) return [a[0], a[1]]
  const [lat1, lon1, lat2, lon2] = [toRad(a[0]), toRad(a[1]), toRad(b[0]), toRad(b[1])]
  const wa = Math.sin((1 - t) * delta) / Math.sin(delta)
  const wb = Math.sin(t * delta) / Math.sin(delta)
  const x = wa * Math.cos(lat1) * Math.cos(lon1) + wb * Math.cos(lat2) * Math.cos(lon2)
  const y = wa * Math.cos(lat1) * Math.sin(lon1) + wb * Math.cos(lat2) * Math.sin(lon2)
  const z = wa * Math.sin(lat1) + wb * Math.sin(lat2)
  return [toDeg(Math.atan2(z, Math.hypot(x, y))), toDeg(Math.atan2(y, x))]
}

const round6 = (n) => Math.round(n * 1e6) / 1e6

/**
 * Polyline from `a` to `b` as [lon, lat] pairs (GeoJSON order). Both ends are returned exactly
 * as given, so a waypoint always sits on a geometry point.
 * @param {LatLon} a
 * @param {LatLon} b
 * @param {{spacingKm?: number}} [options]
 * @returns {[number, number][]}
 */
export function legGeometry(a, b, { spacingKm = 1.5 } = {}) {
  const lengthKm = haversineMeters(a, b) / 1000
  const steps = Math.min(4000, Math.max(2, Math.ceil(lengthKm / spacingKm)))
  const meanLat = toRad((a[0] + b[0]) / 2)
  const dx = (b[1] - a[1]) * Math.cos(meanLat)
  const dy = b[0] - a[0]
  const norm = Math.hypot(dx, dy) || 1
  const amplitudeDeg = Math.min(0.3, lengthKm * 0.00015)

  /** @type {[number, number][]} */
  const points = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const [lat, lon] = interpolateGreatCircle(a, b, t)
    // Both terms are zero at t = 0 and t = 1, so the ends stay put.
    const bend = amplitudeDeg * (Math.sin(Math.PI * t) + 0.25 * Math.sin(3 * Math.PI * t))
    const lat2 = lat + (dx / norm) * bend
    const lon2 = lon - ((dy / norm) * bend) / Math.cos(meanLat)
    points.push(i === 0 ? [a[1], a[0]] : i === steps ? [b[1], b[0]] : [round6(lon2), round6(lat2)])
  }
  return points
}
