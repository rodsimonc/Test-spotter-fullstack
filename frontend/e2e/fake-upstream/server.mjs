// Stand-in for OSRM, Photon and Nominatim, so end-to-end runs never touch the public servers.
//
//   OSRM       GET /route/v1/driving/{lon},{lat};{lon},{lat};...   (add steps=true for turn-by-turn)
//   Photon     GET /api/?q=...&limit=5&lang=en
//   Nominatim  GET /reverse?format=jsonv2&lat=..&lon=..
//
// Each service also answers under a prefix (/osrm, /photon, /nominatim), so Django can point
// its three base URLs at one host and still tell them apart in logs.
//
// The steps request (`steps=true`) answers each leg with 6 to 12 steps along synthetic roads, see
// steps.mjs. magic.mjs has a point that makes only that request fail, and one that puts HTML in a
// street name.
//
// Helpers: GET /health, GET /__calls (what the services were asked), POST /__reset.
// Run it with `node e2e/fake-upstream/server.mjs`. The port comes from FAKE_UPSTREAM_PORT
// (default 8787) and the "slow" delay from FAKE_SLOW_MS (default 2500).

import http from 'node:http'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { CITIES, POIS } from './cities.mjs'
import { haversineMeters, legGeometry } from './geo.mjs'
import {
  MAGIC,
  NOMINATIM_EMPTY_POINT,
  NOMINATIM_FAIL_POINT,
  PHOTON_FAIL_QUERY,
  ROAD_FACTOR,
  STEPS_FAIL_POINT,
  isNear,
  magicAt,
} from './magic.mjs'
import { legSteps } from './steps.mjs'

const METERS_PER_MILE = 1609.344
const SERVICE_PREFIXES = ['osrm', 'photon', 'nominatim']
const MAX_CALLS_KEPT = 500

/** Road speed the fake "router" assumes: city pace on short legs, highway pace on long ones. */
function speedMetersPerSecond(legMeters) {
  const mph = legMeters / METERS_PER_MILE < 120 ? 48 : 63
  return (mph * METERS_PER_MILE) / 3600
}

function sendJson(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    ...extraHeaders,
  })
  res.end(payload)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// OSRM -------------------------------------------------------------------------------------

/**
 * @param {string} rawCoords "lon,lat;lon,lat;..."
 * @returns {[number, number][] | null} [lat, lon] pairs, or null when the string is malformed
 */
function parseWaypoints(rawCoords) {
  const points = rawCoords.split(';').map((pair) => pair.split(',').map(Number))
  const valid = points.every(
    (p) =>
      p.length === 2 && p.every(Number.isFinite) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90,
  )
  if (!valid || points.length < 2 || points.length > 25) return null
  return points.map(([lon, lat]) => [lat, lon])
}

/** Stable small number, 2 to 9, so a snapped waypoint sits a few metres off the request. */
function snapDistance([lat, lon]) {
  const hash = Math.abs(Math.round(lat * 1e4) * 31 + Math.round(lon * 1e4) * 17)
  return 2 + (hash % 80) / 10
}

function buildRoute(waypoints, query) {
  const wantSteps = query.get('steps') === 'true'
  const legs = []
  /** @type {[number, number][]} */
  const geometry = []
  for (let i = 0; i < waypoints.length - 1; i++) {
    const [from, to] = [waypoints[i], waypoints[i + 1]]
    const meters = haversineMeters(from, to) * ROAD_FACTOR
    const entry = {
      distance: Math.round(meters * 10) / 10,
      duration: Math.round((meters / speedMetersPerSecond(meters)) * 10) / 10,
      summary: '',
      steps: [],
    }
    const leg = legGeometry(from, to)
    if (wantSteps) {
      entry.steps = legSteps({
        from,
        to,
        meters: entry.distance,
        seconds: entry.duration,
        geometry: leg,
        legIndex: i,
      })
    }
    legs.push(entry)
    geometry.push(...(i === 0 ? leg : leg.slice(1)))
  }
  const route = {
    distance: Math.round(legs.reduce((sum, l) => sum + l.distance, 0) * 10) / 10,
    duration: Math.round(legs.reduce((sum, l) => sum + l.duration, 0) * 10) / 10,
    legs,
  }
  if (query.get('overview') !== 'false') {
    route.geometry = { type: 'LineString', coordinates: geometry }
  }
  return {
    code: 'Ok',
    routes: [route],
    waypoints: waypoints.map((point) => ({
      location: [point[1], point[0]],
      name: '',
      distance: snapDistance(point),
    })),
  }
}

async function handleRoute(pathname, query, res, options) {
  const match = pathname.match(/^\/route\/v1\/([^/]+)\/(.+)$/)
  if (!match) {
    return sendJson(res, 400, { code: 'InvalidUrl', message: 'URL string malformed.' })
  }
  const [, profile, coords] = match
  let waypoints = null
  try {
    waypoints = profile === 'driving' ? parseWaypoints(decodeURIComponent(coords)) : null
  } catch {
    // A bad percent escape is a malformed query, same as any other bad coordinate string.
  }
  if (!waypoints) {
    return sendJson(res, 400, { code: 'InvalidQuery', message: 'Query string malformed.' })
  }

  const effects = waypoints.map(([lat, lon]) => magicAt(lat, lon)?.effect ?? 'none')
  if (effects.includes('osrm-bad-json')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    return res.end('<html><body>Bad gateway page, not JSON.</body></html>')
  }
  if (effects.includes('osrm-500')) {
    return sendJson(res, 500, { code: 'InternalError', message: 'Something broke upstream.' })
  }
  if (effects.includes('osrm-no-route')) {
    return sendJson(res, 200, {
      code: 'NoRoute',
      message: 'Impossible route between points',
      waypoints: [],
      routes: [],
    })
  }
  // Only the steps request fails here. The plain route request for the same points is fine.
  if (
    query.get('steps') === 'true' &&
    waypoints.some(([lat, lon]) => isNear(lat, lon, STEPS_FAIL_POINT))
  ) {
    return sendJson(res, 400, { code: 'TooBig', message: 'Request too big for this server.' })
  }
  if (effects.includes('osrm-slow')) await sleep(options.slowMs)

  return sendJson(res, 200, buildRoute(waypoints, query))
}

// Photon -----------------------------------------------------------------------------------

const fold = (text) => text.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, '').toLowerCase()

const words = (text) =>
  fold(text)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)

/** One searchable record per place, in the shape Photon puts in `properties`. */
function photonRecords() {
  const cities = CITIES.map(([name, state, code, lat, lon, population]) => ({
    properties: {
      osm_type: 'N',
      osm_key: 'place',
      osm_value: population >= 100_000 ? 'city' : 'town',
      type: population >= 100_000 ? 'city' : 'town',
      name,
      state,
      country: 'United States',
      countrycode: 'US',
    },
    lat,
    lon,
    population,
    haystack: words(`${name} ${state} ${code} United States`),
    nameWords: words(name),
  }))
  const pois = POIS.map((poi) => ({
    properties: {
      osm_type: 'W',
      osm_key: poi.osmKey,
      osm_value: poi.osmValue,
      type: 'house',
      name: poi.name,
      street: poi.street,
      ...(poi.housenumber ? { housenumber: poi.housenumber } : {}),
      city: poi.city,
      state: poi.state,
      country: 'United States',
      countrycode: 'US',
    },
    lat: poi.lat,
    lon: poi.lon,
    population: 1000,
    haystack: words(`${poi.name} ${poi.street} ${poi.city} ${poi.state} United States`),
    nameWords: words(`${poi.name} ${poi.street}`),
  }))
  const magic = Object.values(MAGIC).map((place) => ({
    properties: {
      osm_type: 'N',
      osm_key: 'place',
      osm_value: 'locality',
      type: 'locality',
      name: place.name,
      state: place.state,
      country: place.country,
      countrycode: place.countrycode,
    },
    lat: place.lat,
    lon: place.lon,
    population: 500,
    haystack: words(`${place.name} ${place.state} ${place.country}`),
    nameWords: words(place.name),
  }))
  return [...cities, ...pois, ...magic].map((record, index) => ({
    ...record,
    properties: { osm_id: 1_000_000 + index, ...record.properties },
  }))
}

const RECORDS = photonRecords()

function searchPlaces(q, limit, bias) {
  const tokens = words(q)
  if (!tokens.length) return []
  const scored = []
  for (const record of RECORDS) {
    const [first, ...rest] = tokens
    const firstHits = record.nameWords.some((w) => w.startsWith(first))
    const restHit = rest.every((t) => record.haystack.some((w) => w.startsWith(t)))
    if (!firstHits || !restHit) continue
    const exact = record.nameWords.includes(first) ? 100 : 0
    const prefix = record.nameWords[0]?.startsWith(first) ? 40 : 0
    const size = Math.log10(record.population)
    const near = bias ? -haversineMeters(bias, [record.lat, record.lon]) / 1e6 : 0
    scored.push({ record, score: exact + prefix + size + near })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map(({ record }) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [record.lon, record.lat] },
    properties: record.properties,
  }))
}

function handleSearch(query, res) {
  const q = (query.get('q') ?? '').trim()
  if (!query.has('q')) {
    return sendJson(res, 400, { message: "missing search term 'q': /?q=berlin" })
  }
  if (q.toLowerCase() === PHOTON_FAIL_QUERY) {
    return sendJson(res, 503, { message: 'Service temporarily unavailable.' })
  }
  const limit = Math.min(40, Math.max(1, Number.parseInt(query.get('limit') ?? '15', 10) || 15))
  const lat = Number(query.get('lat'))
  const lon = Number(query.get('lon'))
  const bias =
    query.has('lat') && query.has('lon') && Number.isFinite(lat + lon) ? [lat, lon] : null
  const features = q.length < 2 ? [] : searchPlaces(q, limit, bias)
  return sendJson(res, 200, { type: 'FeatureCollection', features })
}

// Nominatim --------------------------------------------------------------------------------

const insideUnitedStates = (lat, lon) => lat >= 24 && lat <= 50 && lon >= -125 && lon <= -66

function handleReverse(query, res) {
  const lat = Number(query.get('lat'))
  const lon = Number(query.get('lon'))
  if (!query.has('lat') || !query.has('lon') || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return sendJson(res, 400, {
      error: { code: 400, message: "Floating-point number expected for parameter 'lat'" },
    })
  }
  if (isNear(lat, lon, NOMINATIM_FAIL_POINT)) {
    res.writeHead(503, { 'Content-Type': 'text/plain' })
    return res.end('Service Unavailable')
  }
  if (isNear(lat, lon, NOMINATIM_EMPTY_POINT) || !insideUnitedStates(lat, lon)) {
    return sendJson(res, 200, { error: 'Unable to geocode' })
  }

  const [name, state, code, , , population] = CITIES.reduce((best, city) =>
    haversineMeters([lat, lon], [city[3], city[4]]) <
    haversineMeters([lat, lon], [best[3], best[4]])
      ? city
      : best,
  )
  const settlement = population >= 100_000 ? 'city' : 'town'
  const address = {
    road: 'County Road 12',
    [settlement]: name,
    county: `${name} County`,
    state,
    'ISO3166-2-lvl4': `US-${code}`,
    postcode: '00000',
    country: 'United States',
    country_code: 'us',
  }
  return sendJson(res, 200, {
    place_id: 424242,
    licence: 'Data © OpenStreetMap contributors, ODbL 1.0. http://osm.org/copyright',
    osm_type: 'way',
    osm_id: 424242,
    lat: lat.toFixed(7),
    lon: lon.toFixed(7),
    category: 'highway',
    type: 'residential',
    place_rank: 26,
    importance: 0.0533,
    addresstype: 'road',
    name: address.road,
    display_name: `${address.road}, ${name}, ${address.county}, ${state}, ${address.postcode}, United States`,
    address,
    boundingbox: [
      (lat - 0.001).toFixed(7),
      (lat + 0.001).toFixed(7),
      (lon - 0.001).toFixed(7),
      (lon + 0.001).toFixed(7),
    ],
  })
}

// Server -----------------------------------------------------------------------------------

/**
 * @param {{slowMs?: number}} [options]
 * @returns {http.Server & {calls: object[]}}
 */
export function createFakeUpstream(options = {}) {
  const settings = { slowMs: options.slowMs ?? Number(process.env.FAKE_SLOW_MS ?? 2500) }
  /** @type {object[]} */
  const calls = []

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://fake.local')
      let pathname = url.pathname
      let service = null
      for (const prefix of SERVICE_PREFIXES) {
        if (pathname === `/${prefix}` || pathname.startsWith(`/${prefix}/`)) {
          pathname = pathname.slice(prefix.length + 1) || '/'
          service = prefix
          break
        }
      }

      if (pathname === '/health') return sendJson(res, 200, { status: 'ok' })
      if (pathname === '/__calls' && req.method === 'GET') {
        const wanted = url.searchParams.get('service')
        const contains = url.searchParams.get('contains')
        return sendJson(res, 200, {
          calls: calls.filter(
            (c) => (!wanted || c.service === wanted) && (!contains || c.url.includes(contains)),
          ),
        })
      }
      if (pathname === '/__reset' && req.method === 'POST') {
        calls.length = 0
        return sendJson(res, 200, { status: 'reset' })
      }
      if (req.method !== 'GET') {
        return sendJson(res, 405, { message: 'Only GET is supported.' }, { Allow: 'GET' })
      }

      const kind = pathname.startsWith('/route/')
        ? 'osrm'
        : pathname === '/api' || pathname === '/api/'
          ? 'photon'
          : pathname === '/reverse'
            ? 'nominatim'
            : null
      if (!kind) return sendJson(res, 404, { message: 'Not found.' })

      calls.push({ service: kind, prefix: service, url: req.url, at: new Date().toISOString() })
      if (calls.length > MAX_CALLS_KEPT) calls.shift()

      if (kind === 'osrm') return await handleRoute(pathname, url.searchParams, res, settings)
      if (kind === 'photon') return handleSearch(url.searchParams, res)
      return handleReverse(url.searchParams, res)
    } catch (error) {
      console.error('[fake-upstream] unexpected error', error)
      if (!res.headersSent) sendJson(res, 500, { message: 'Fake upstream crashed.' })
      else res.end()
    }
  })
  return Object.assign(server, { calls })
}

function main() {
  const port = Number(process.env.FAKE_UPSTREAM_PORT ?? 8787)
  const server = createFakeUpstream()
  server.listen(port, '127.0.0.1', () => {
    console.log(`[fake-upstream] listening on http://127.0.0.1:${port}`)
  })
  const stop = () => server.close(() => process.exit(0))
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (invokedDirectly) main()
