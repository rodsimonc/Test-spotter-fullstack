// Checks the fake upstream against the response shapes in SPEC section 4. Run with:
//   node --test "e2e/fake-upstream/*.test.mjs"
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { haversineMeters } from './geo.mjs'
import {
  HOSTILE_ROAD_NAME,
  HOSTILE_ROAD_POINT,
  MAGIC,
  NOMINATIM_EMPTY_POINT,
  NOMINATIM_FAIL_POINT,
  ROAD_FACTOR,
  STEPS_FAIL_POINT,
} from './magic.mjs'
import { createFakeUpstream } from './server.mjs'

const SLOW_MS = 120
const DALLAS = { lat: 32.7767, lon: -96.797 }
const MEMPHIS = { lat: 35.1495, lon: -90.049 }
const DENVER = { lat: 39.7392, lon: -104.9903 }

/** @type {import('node:http').Server & {calls: object[]}} */
let server
let base = ''

before(async () => {
  server = createFakeUpstream({ slowMs: SLOW_MS })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  await new Promise((resolve) => server.close(resolve))
})

const lonLat = (p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`
const routeUrl = (...points) =>
  `${base}/route/v1/driving/${points.map(lonLat).join(';')}?overview=full&geometries=geojson&steps=false`

async function getJson(url) {
  const res = await fetch(url)
  return { res, body: await res.json() }
}

describe('OSRM', () => {
  test('answers a three-waypoint route in the real response shape', async () => {
    const { res, body } = await getJson(routeUrl(DALLAS, MEMPHIS, DENVER))
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type'), /^application\/json/)
    assert.equal(body.code, 'Ok')
    assert.equal(body.routes.length, 1)

    const [route] = body.routes
    assert.equal(route.legs.length, 2)
    assert.equal(route.geometry.type, 'LineString')
    assert.ok(route.geometry.coordinates.length > 100)
    for (const leg of route.legs) {
      assert.equal(typeof leg.distance, 'number')
      assert.equal(typeof leg.duration, 'number')
      assert.equal(leg.summary, '')
      assert.deepEqual(leg.steps, [])
    }

    assert.equal(body.waypoints.length, 3)
    for (const waypoint of body.waypoints) {
      assert.equal(waypoint.location.length, 2)
      assert.equal(waypoint.name, '')
      assert.ok(waypoint.distance > 0 && waypoint.distance < 10)
    }
  })

  test('uses [lon, lat] order and metres and seconds', async () => {
    const { body } = await getJson(routeUrl(DALLAS, MEMPHIS))
    const [first] = body.routes[0].geometry.coordinates
    assert.deepEqual(first, [DALLAS.lon, DALLAS.lat])
    assert.deepEqual(body.waypoints[1].location, [MEMPHIS.lon, MEMPHIS.lat])

    const straight = haversineMeters([DALLAS.lat, DALLAS.lon], [MEMPHIS.lat, MEMPHIS.lon])
    const distance = body.routes[0].distance
    assert.ok(
      Math.abs(distance - straight * ROAD_FACTOR) < 1,
      'road distance is straight line times the road factor',
    )
    const mph = distance / 1609.344 / (body.routes[0].duration / 3600)
    assert.ok(mph > 55 && mph < 70, `highway speed looks wrong: ${mph}`)
  })

  test('route totals equal the sum of the legs', async () => {
    const { body } = await getJson(routeUrl(DALLAS, MEMPHIS, DENVER))
    const [route] = body.routes
    const legDistance = route.legs.reduce((sum, leg) => sum + leg.distance, 0)
    const legDuration = route.legs.reduce((sum, leg) => sum + leg.duration, 0)
    assert.ok(Math.abs(route.distance - legDistance) < 0.5)
    assert.ok(Math.abs(route.duration - legDuration) < 0.5)
  })

  test('the interior waypoint is an exact point on the geometry', async () => {
    const { body } = await getJson(routeUrl(DALLAS, MEMPHIS, DENVER))
    const coordinates = body.routes[0].geometry.coordinates
    const interior = body.waypoints[1].location
    assert.ok(coordinates.some(([lon, lat]) => lon === interior[0] && lat === interior[1]))
    assert.deepEqual(coordinates.at(-1), [DENVER.lon, DENVER.lat])
  })

  test('short legs run slower than long ones', async () => {
    const near = { lat: 32.8, lon: -96.8 }
    const short = (await getJson(routeUrl(DALLAS, near))).body.routes[0]
    const long = (await getJson(routeUrl(DALLAS, DENVER))).body.routes[0]
    const speed = (r) => r.distance / r.duration
    assert.ok(speed(short) < speed(long))
  })

  test('overview=false leaves the geometry out', async () => {
    const url = routeUrl(DALLAS, MEMPHIS).replace('overview=full', 'overview=false')
    const { body } = await getJson(url)
    assert.equal(body.code, 'Ok')
    assert.equal(body.routes[0].geometry, undefined)
  })

  test('returns NoRoute with HTTP 200 for the unreachable place', async () => {
    const { res, body } = await getJson(routeUrl(DALLAS, MAGIC.noRoute, DENVER))
    assert.equal(res.status, 200)
    assert.equal(body.code, 'NoRoute')
    assert.deepEqual(body.routes, [])
  })

  test('returns HTTP 500 for the broken-bridge place', async () => {
    const { res, body } = await getJson(routeUrl(DALLAS, MAGIC.brokenBridge, DENVER))
    assert.equal(res.status, 500)
    assert.equal(body.code, 'InternalError')
  })

  test('returns a non-JSON body for the garbled place', async () => {
    const res = await fetch(routeUrl(DALLAS, MAGIC.garbled, DENVER))
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type'), /^text\/html/)
    await assert.rejects(() => res.json())
  })

  test('waits before answering for the slow place, then answers normally', async () => {
    const started = performance.now()
    const { res, body } = await getJson(routeUrl(DALLAS, MAGIC.slowpoke, DENVER))
    assert.ok(performance.now() - started >= SLOW_MS - 10)
    assert.equal(res.status, 200)
    assert.equal(body.code, 'Ok')
  })

  test('rejects malformed coordinates, profiles and paths with 400', async () => {
    for (const path of [
      '/route/v1/driving/abc;def',
      '/route/v1/driving/-96.8,32.7',
      '/route/v1/driving/-96.8,95;-90,35',
      '/route/v1/driving/%E0%A4%A;-90,35',
      '/route/v1/walking/-96.8,32.7;-90,35',
      '/route/v1/driving',
    ]) {
      const { res, body } = await getJson(`${base}${path}`)
      assert.equal(res.status, 400, path)
      assert.ok(['InvalidQuery', 'InvalidUrl'].includes(body.code), path)
    }
  })

  test('answers the same under the /osrm prefix', async () => {
    const plain = await getJson(routeUrl(DALLAS, MEMPHIS))
    const prefixed = await getJson(routeUrl(DALLAS, MEMPHIS).replace(base, `${base}/osrm`))
    assert.deepEqual(prefixed.body, plain.body)
  })
})

describe('OSRM steps', () => {
  const stepsUrl = (...points) =>
    `${base}/route/v1/driving/${points.map(lonLat).join(';')}?overview=false&steps=true&geometries=polyline&annotations=false`
  const legsOf = async (...points) => (await getJson(stepsUrl(...points))).body.routes[0].legs
  const sum = (steps, key) => steps.reduce((total, step) => total + step[key], 0)

  test('cuts each leg into 6 to 12 pieces and a final arrive step', async () => {
    const { res, body } = await getJson(stepsUrl(DALLAS, MEMPHIS, DENVER))
    assert.equal(res.status, 200)
    assert.equal(body.code, 'Ok')
    const [route] = body.routes
    assert.equal(route.geometry, undefined, 'overview=false keeps the geometry out')
    assert.equal(route.legs.length, 2)
    for (const leg of route.legs) {
      const pieces = leg.steps.slice(0, -1)
      assert.ok(pieces.length >= 6 && pieces.length <= 12, `pieces: ${pieces.length}`)
      assert.equal(leg.steps[0].maneuver.type, 'depart')
      assert.ok(pieces.slice(1).every((step) => step.maneuver.type !== 'depart'))
      const arrive = leg.steps.at(-1)
      assert.equal(arrive.maneuver.type, 'arrive')
      assert.equal(arrive.distance, 0)
      assert.equal(arrive.duration, 0)
    }
  })

  test('the pieces add up to the leg distance and duration', async () => {
    for (const leg of await legsOf(DALLAS, MEMPHIS, DENVER)) {
      assert.ok(Math.abs(sum(leg.steps, 'distance') - leg.distance) < 0.5)
      assert.ok(Math.abs(sum(leg.steps, 'duration') - leg.duration) < 0.5)
      assert.ok(leg.steps.slice(0, -1).every((step) => step.distance > 0 && step.duration > 0))
    }
  })

  test('steps carry the fields the backend reads, in OSRM units and order', async () => {
    for (const leg of await legsOf(DALLAS, MEMPHIS)) {
      for (const step of leg.steps) {
        assert.equal(typeof step.name, 'string')
        assert.ok(step.ref === undefined || (typeof step.ref === 'string' && step.ref !== ''))
        const { location, bearing_after: bearing, type } = step.maneuver
        assert.equal(typeof type, 'string')
        assert.equal(location.length, 2)
        assert.ok(location[0] < -80 && location[0] > -125, 'longitude comes first')
        assert.ok(location[1] > 25 && location[1] < 50, 'latitude comes second')
        assert.ok(Number.isInteger(bearing) && bearing >= 0 && bearing < 360)
      }
    }
  })

  test('starts and ends each leg on the waypoints, and the legs join at the middle one', async () => {
    const [first, second] = await legsOf(DALLAS, MEMPHIS, DENVER)
    assert.deepEqual(first.steps[0].maneuver.location, [DALLAS.lon, DALLAS.lat])
    assert.deepEqual(first.steps.at(-1).maneuver.location, [MEMPHIS.lon, MEMPHIS.lat])
    assert.deepEqual(second.steps[0].maneuver.location, [MEMPHIS.lon, MEMPHIS.lat])
    assert.deepEqual(second.steps.at(-1).maneuver.location, [DENVER.lon, DENVER.lat])
  })

  test('every step starts on a point of the route geometry, in order', async () => {
    const url = stepsUrl(DALLAS, MEMPHIS, DENVER)
      .replace('overview=false', 'overview=full')
      .replace('geometries=polyline', 'geometries=geojson')
    const { body } = await getJson(url)
    const [route] = body.routes
    const index = new Map(route.geometry.coordinates.map(([lon, lat], i) => [`${lon},${lat}`, i]))
    let previous = -1
    for (const step of route.legs.flatMap((leg) => leg.steps)) {
      const at = index.get(step.maneuver.location.join(','))
      assert.notEqual(at, undefined, `not on the route: ${step.maneuver.location}`)
      assert.ok(at >= previous, 'steps follow the route in order')
      previous = at
    }
  })

  test('heads toward the next piece: east to Memphis, west to Denver', async () => {
    const [toMemphis, toDenver] = await legsOf(DALLAS, MEMPHIS, DENVER)
    const east = toMemphis.steps[0].maneuver.bearing_after
    const west = toDenver.steps[0].maneuver.bearing_after
    assert.ok(east > 45 && east < 135, `east: ${east}`)
    assert.ok(west > 225 && west < 315, `west: ${west}`)
  })

  test('puts a street at each end and highways between, never one road twice in a row', async () => {
    for (const leg of await legsOf(DALLAS, MEMPHIS, DENVER)) {
      const road = (step) => (step.ref ?? step.name).split(';')[0]
      assert.equal(leg.steps[0].ref, undefined)
      assert.equal(leg.steps.at(-2).ref, undefined)
      const highways = leg.steps.slice(1, -2)
      assert.ok(highways.length >= 4)
      assert.ok(highways.some((step) => /^(I|US|TX) \d+/.test(step.ref ?? '')))
      for (let i = 1; i < leg.steps.length - 1; i++) {
        assert.notEqual(road(leg.steps[i]), road(leg.steps[i - 1]), `repeat at step ${i}`)
      }
    }
  })

  test('uses a mix of roads, among them an interstate and a US route', async () => {
    const refs = (await legsOf(DALLAS, MEMPHIS, DENVER)).flatMap((leg) =>
      leg.steps.map((s) => s.ref),
    )
    assert.ok(refs.some((ref) => ref?.startsWith('I ')))
    assert.ok(refs.some((ref) => ref?.startsWith('US ')))
  })

  test('gives the same answer every time, and the same under the /osrm prefix', async () => {
    const plain = await getJson(stepsUrl(DALLAS, MEMPHIS, DENVER))
    const again = await getJson(stepsUrl(DALLAS, MEMPHIS, DENVER))
    const prefixed = await getJson(stepsUrl(DALLAS, MEMPHIS, DENVER).replace(base, `${base}/osrm`))
    assert.deepEqual(again.body, plain.body)
    assert.deepEqual(prefixed.body, plain.body)
  })

  test('leaves the steps empty when the request does not ask for them', async () => {
    for (const leg of (await getJson(routeUrl(DALLAS, MEMPHIS, DENVER))).body.routes[0].legs) {
      assert.deepEqual(leg.steps, [])
    }
  })

  test('copes with a leg shorter than a mile', async () => {
    const near = { lat: DALLAS.lat + 0.004, lon: DALLAS.lon }
    const [leg] = await legsOf(DALLAS, near)
    assert.ok(leg.distance < 1609)
    assert.equal(leg.steps[0].maneuver.type, 'depart')
    assert.equal(leg.steps.at(-1).maneuver.type, 'arrive')
    assert.ok(Math.abs(sum(leg.steps, 'distance') - leg.distance) < 0.5)
  })

  test('answers 400 TooBig to the steps request at the failure point, and only that one', async () => {
    const { res, body } = await getJson(stepsUrl(DALLAS, STEPS_FAIL_POINT, DENVER))
    assert.equal(res.status, 400)
    assert.equal(body.code, 'TooBig')
    assert.equal(body.routes, undefined)

    const plain = await getJson(routeUrl(DALLAS, STEPS_FAIL_POINT, DENVER))
    assert.equal(plain.res.status, 200)
    assert.equal(plain.body.code, 'Ok')
    assert.equal(plain.body.routes[0].legs.length, 2)
  })

  test('names the street at the hostile point with HTML, unescaped', async () => {
    const [toHostile, fromHostile] = await legsOf(DALLAS, HOSTILE_ROAD_POINT, DENVER)
    assert.equal(toHostile.steps.at(-2).name, HOSTILE_ROAD_NAME)
    assert.equal(toHostile.steps.at(-1).name, HOSTILE_ROAD_NAME)
    assert.equal(fromHostile.steps[0].name, HOSTILE_ROAD_NAME)
    assert.match(HOSTILE_ROAD_NAME, /^<img src=x onerror=/)
    const others = [...toHostile.steps.slice(0, -2), ...fromHostile.steps.slice(1, -2)]
    assert.ok(
      others.every((step) => !step.name.includes('<')),
      'only the street beside the point',
    )
  })
})

describe('Photon', () => {
  const search = (q, extra = '') =>
    getJson(`${base}/api/?q=${encodeURIComponent(q)}&limit=5&lang=en${extra}`)

  test('returns GeoJSON features with [lon, lat] and the documented properties', async () => {
    const { res, body } = await search('Dallas')
    assert.equal(res.status, 200)
    assert.equal(body.type, 'FeatureCollection')
    assert.ok(body.features.length >= 1)
    const [top] = body.features
    assert.equal(top.type, 'Feature')
    assert.equal(top.geometry.type, 'Point')
    assert.deepEqual(top.geometry.coordinates, [DALLAS.lon, DALLAS.lat])
    for (const key of ['name', 'state', 'country', 'countrycode', 'osm_key', 'osm_value']) {
      assert.equal(typeof top.properties[key], 'string', key)
    }
    assert.equal(top.properties.name, 'Dallas')
    assert.equal(top.properties.state, 'Texas')
  })

  test('ranks the larger Dallas first and honours the limit', async () => {
    const { body } = await search('Dallas')
    assert.deepEqual(
      body.features.map((f) => f.properties.state),
      ['Texas', 'Georgia'],
    )
    const limited = await getJson(`${base}/api/?q=s&limit=1`)
    assert.equal(limited.body.features.length, 0, 'one-letter queries return nothing')
    const two = await getJson(`${base}/api/?q=spring&limit=1`)
    assert.equal(two.body.features.length, 1)
  })

  test('matches state names and codes after the first word', async () => {
    const byCode = await search('Dallas, GA')
    assert.deepEqual(
      byCode.body.features.map((f) => f.properties.state),
      ['Georgia'],
    )
    const byName = await search('Springfield Illinois')
    assert.deepEqual(
      byName.body.features.map((f) => f.properties.state),
      ['Illinois'],
    )
  })

  test('returns two Springfields for an ambiguous name', async () => {
    const { body } = await search('Springfield')
    assert.equal(body.features.length, 2)
  })

  test('returns address-style results with street and city', async () => {
    const { body } = await search('Union Station')
    const [hit] = body.features
    assert.equal(hit.properties.name, 'Union Station')
    assert.equal(hit.properties.street, '17th Street')
    assert.equal(hit.properties.housenumber, '1701')
    assert.equal(hit.properties.city, 'Denver')
  })

  test('is case and accent insensitive', async () => {
    const { body } = await search('LOVE’S travel')
    assert.equal(body.features[0]?.properties.name, 'Love’s Travel Stop')
  })

  test('bias coordinates break ties toward the nearer match', async () => {
    const west = await search('Portland', '&lat=45.5&lon=-122.6')
    assert.equal(west.body.features[0].properties.state, 'Oregon')
    const east = await search('Portland', '&lat=43.6&lon=-70.3')
    assert.equal(east.body.features[0].properties.state, 'Maine')
  })

  test('returns an empty list for short or unmatched queries', async () => {
    assert.deepEqual((await search('a')).body.features, [])
    assert.deepEqual((await search('zzzzqq')).body.features, [])
  })

  test('returns the HTML place as plain strings, unescaped', async () => {
    const { body } = await search('Pwned')
    const [hit] = body.features
    assert.equal(hit.properties.name, MAGIC.xss.name)
    assert.equal(hit.properties.state, MAGIC.xss.state)
    assert.deepEqual(hit.geometry.coordinates, [MAGIC.xss.lon, MAGIC.xss.lat])
  })

  test('lists every magic place so a spec can pick it by name', async () => {
    for (const [key, place] of Object.entries(MAGIC)) {
      const first = place.name.replace(/<[^>]*>/g, '').split(' ')[0]
      const { body } = await search(first)
      assert.ok(
        body.features.some((f) => f.geometry.coordinates[1] === place.lat),
        `${key} should be searchable`,
      )
    }
  })

  test('fails with 400 when q is missing and 503 for the failure query', async () => {
    const missing = await getJson(`${base}/api/`)
    assert.equal(missing.res.status, 400)
    const boom = await search('boom')
    assert.equal(boom.res.status, 503)
  })

  test('answers under the /photon prefix', async () => {
    const { body } = await getJson(`${base}/photon/api/?q=Denver&limit=5&lang=en`)
    assert.equal(body.features[0].properties.name, 'Denver')
  })
})

describe('Nominatim', () => {
  const reverse = (lat, lon) =>
    getJson(`${base}/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=14&addressdetails=1`)

  test('names the nearest town in the jsonv2 shape', async () => {
    const { res, body } = await reverse(40.69, -99.08)
    assert.equal(res.status, 200)
    assert.equal(typeof body.display_name, 'string')
    assert.equal(body.address.town, 'Kearney')
    assert.equal(body.address.state, 'Nebraska')
    assert.equal(body.address.country_code, 'us')
    assert.match(body.display_name, /Kearney/)
    assert.equal(body.lat, '40.6900000')
  })

  test('uses city for large places and town for small ones', async () => {
    const big = await reverse(32.78, -96.8)
    assert.equal(big.body.address.city, 'Dallas')
    assert.equal(big.body.address.town, undefined)
  })

  test('returns "Unable to geocode" off the map', async () => {
    const empty = await reverse(NOMINATIM_EMPTY_POINT.lat, NOMINATIM_EMPTY_POINT.lon)
    assert.deepEqual(empty.body, { error: 'Unable to geocode' })
    const abroad = await reverse(48.85, 2.35)
    assert.deepEqual(abroad.body, { error: 'Unable to geocode' })
  })

  test('answers 503 at the failure point', async () => {
    const res = await fetch(
      `${base}/reverse?format=jsonv2&lat=${NOMINATIM_FAIL_POINT.lat}&lon=${NOMINATIM_FAIL_POINT.lon}`,
    )
    assert.equal(res.status, 503)
  })

  test('answers 400 when coordinates are missing or not numbers', async () => {
    assert.equal((await getJson(`${base}/reverse?format=jsonv2`)).res.status, 400)
    assert.equal((await getJson(`${base}/reverse?lat=x&lon=y`)).res.status, 400)
  })

  test('answers under the /nominatim prefix', async () => {
    const { body } = await getJson(`${base}/nominatim/reverse?format=jsonv2&lat=39.74&lon=-104.99`)
    assert.equal(body.address.city, 'Denver')
  })
})

describe('Housekeeping', () => {
  test('records calls, filters them and resets', async () => {
    await fetch(`${base}/__reset`, { method: 'POST' })
    await getJson(routeUrl(DALLAS, MEMPHIS))
    await getJson(`${base}/api/?q=Denver`)
    const all = (await getJson(`${base}/__calls`)).body.calls
    assert.deepEqual(
      all.map((c) => c.service),
      ['osrm', 'photon'],
    )

    const osrmOnly = (await getJson(`${base}/__calls?service=osrm`)).body.calls
    assert.equal(osrmOnly.length, 1)
    const byText = (await getJson(`${base}/__calls?contains=-96.797000`)).body.calls
    assert.equal(byText.length, 1)

    await fetch(`${base}/__reset`, { method: 'POST' })
    assert.deepEqual((await getJson(`${base}/__calls`)).body.calls, [])
  })

  test('health answers without being counted as a call', async () => {
    await fetch(`${base}/__reset`, { method: 'POST' })
    const { res, body } = await getJson(`${base}/health`)
    assert.equal(res.status, 200)
    assert.deepEqual(body, { status: 'ok' })
    assert.deepEqual((await getJson(`${base}/__calls`)).body.calls, [])
  })

  test('refuses other methods and unknown paths', async () => {
    const post = await fetch(`${base}/api/?q=Dallas`, { method: 'POST' })
    assert.equal(post.status, 405)
    assert.equal(post.headers.get('allow'), 'GET')
    assert.equal((await getJson(`${base}/nope`)).res.status, 404)
  })
})
