// Places that make the fake upstream misbehave on purpose. The specs and the server both read
// this file, so a coordinate only ever lives in one spot.

/** Multiplier from straight-line distance to a believable road distance. */
export const ROAD_FACTOR = 1.2

/** Two points closer than this (in degrees, per axis) count as the same magic point. */
export const MATCH_TOLERANCE_DEG = 0.005

/**
 * @typedef {object} MagicPlace
 * @property {string} name
 * @property {string} state
 * @property {string} country
 * @property {string} countrycode
 * @property {number} lat
 * @property {number} lon
 * @property {'osrm-no-route'|'osrm-500'|'osrm-bad-json'|'osrm-slow'|'none'} effect
 */

/** @type {Record<'noRoute'|'brokenBridge'|'garbled'|'slowpoke'|'xss', MagicPlace>} */
export const MAGIC = {
  // OSRM answers HTTP 200 with code "NoRoute". The API should return 422 no_route.
  noRoute: {
    name: 'Nowhere Reef',
    state: 'Atlantic Ocean',
    country: 'International Waters',
    countrycode: 'XX',
    lat: 30.0,
    lon: -40.0,
    effect: 'osrm-no-route',
  },
  // OSRM answers HTTP 500. The API retries once, then returns 502 upstream_error.
  brokenBridge: {
    name: 'Brokenbridge',
    state: 'Kansas',
    country: 'United States',
    countrycode: 'US',
    lat: 38.4,
    lon: -98.8,
    effect: 'osrm-500',
  },
  // OSRM answers HTTP 200 with a body that is not JSON. The API should return 502.
  garbled: {
    name: 'Garbled Gulch',
    state: 'Oklahoma',
    country: 'United States',
    countrycode: 'US',
    lat: 36.0,
    lon: -100.0,
    effect: 'osrm-bad-json',
  },
  // OSRM waits before answering (see FAKE_SLOW_MS), then answers normally.
  slowpoke: {
    name: 'Slowpoke Springs',
    state: 'Nebraska',
    country: 'United States',
    countrycode: 'US',
    lat: 40.2,
    lon: -99.9,
    effect: 'osrm-slow',
  },
  // A land location whose name and state are HTML. Nothing upstream breaks, but every layer
  // that renders it has to treat it as text.
  xss: {
    name: '<img src=x onerror="window.__xss=1">Pwned Plains',
    state: '<script>window.__xss=1</script>Texas',
    country: 'United States',
    countrycode: 'US',
    lat: 32.95,
    lon: -97.2,
    effect: 'none',
  },
}

/** Typing this into Photon search makes the fake answer 503. */
export const PHOTON_FAIL_QUERY = 'boom'

/** Reverse lookups near this point make the fake Nominatim answer 503. */
export const NOMINATIM_FAIL_POINT = { lat: 31.0, lon: -92.0 }

/** Reverse lookups near this point get Nominatim's "Unable to geocode" body. */
export const NOMINATIM_EMPTY_POINT = { lat: 28.0, lon: -45.0 }

/**
 * A route request that asks for steps and passes through this point answers 400 TooBig. The
 * plain route request for the same points still answers normally, so a plan succeeds and its
 * directions come back empty. Near Amarillo, Texas.
 */
export const STEPS_FAIL_POINT = { lat: 35.2, lon: -101.8 }

/**
 * A steps request that passes through this point names the street next to it with HTML. Nothing
 * upstream breaks, but every layer that shows a road name has to treat it as text. Near Oklahoma
 * City.
 */
export const HOSTILE_ROAD_POINT = { lat: 35.47, lon: -97.52 }
export const HOSTILE_ROAD_NAME = '<img src=x onerror="window.__xss=1">Pwned Parkway'

/**
 * @param {number} lat
 * @param {number} lon
 * @param {{lat: number, lon: number}} point
 */
export function isNear(lat, lon, point) {
  return (
    Math.abs(lat - point.lat) < MATCH_TOLERANCE_DEG &&
    Math.abs(lon - point.lon) < MATCH_TOLERANCE_DEG
  )
}

/**
 * Finds the magic place, if any, that a route waypoint sits on.
 * @param {number} lat
 * @param {number} lon
 * @returns {MagicPlace | undefined}
 */
export function magicAt(lat, lon) {
  return Object.values(MAGIC).find((place) => isNear(lat, lon, place))
}
