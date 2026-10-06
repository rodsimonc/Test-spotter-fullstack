// Turn-by-turn steps for the fake OSRM, in the shape the real one answers when asked for
// `steps=true`. Each leg is cut into 6 to 12 pieces: a street at each end and synthetic
// highways (I-30, I-40, US-287 and so on) in between. Everything is a pure function of the
// leg, so the same request always gets the same answer and the route cache stays honest.

import { HOSTILE_ROAD_NAME, HOSTILE_ROAD_POINT, isNear } from './magic.mjs'

const METERS_PER_MILE = 1609.344
const MIN_PIECES = 6
const MAX_PIECES = 12
/** One more piece for every this many miles, up to the maximum. */
const MILES_PER_EXTRA_PIECE = 150
/** How long the street at each end is, next to a highway piece of weight 2 to 7. */
const STREET_WEIGHT = 0.3

/**
 * `ref` is how OSRM writes it ("I 40", or "I 40;US 64" where two routes share a road). Two
 * entries never sit side by side with the same road, so a condenser sees every change.
 */
const HIGHWAYS = [
  { ref: 'I 30', name: 'Interstate 30', weight: 4 },
  { ref: 'I 40', name: 'Interstate 40', weight: 7 },
  { ref: 'US 287', name: 'US Highway 287', weight: 3 },
  { ref: 'I 40;US 64', name: 'Interstate 40', weight: 5 },
  { ref: 'TX 183', name: 'State Highway 183', weight: 2 },
  { ref: 'I 35', name: 'Interstate 35', weight: 6 },
  { ref: '', name: 'Frontage Road', weight: 2 },
  { ref: 'I 70', name: 'Interstate 70', weight: 7 },
  { ref: 'US 64', name: 'US Highway 64', weight: 3 },
  { ref: 'I 55', name: 'Interstate 55', weight: 5 },
]

const STREETS = [
  'Main Street',
  'Commerce Street',
  'Oak Avenue',
  'Industrial Boulevard',
  'Elm Street',
  'Market Street',
  'Railroad Avenue',
  'Cedar Lane',
]

/** [type, modifier] pairs that follow a departure, as OSRM names them. */
const MANEUVERS = [
  ['turn', 'right'],
  ['on ramp', 'right'],
  ['merge', 'slight left'],
  ['fork', 'right'],
  ['new name', 'straight'],
  ['off ramp', 'right'],
  ['turn', 'left'],
  ['end of road', 'left'],
]

const toRad = (deg) => (deg * Math.PI) / 180
const round1 = (n) => Math.round(n * 10) / 10

/** Stable small integer for a point, so a leg gets the same roads on every request. */
const pointHash = ([lat, lon]) => Math.abs(Math.round(lat * 1e4) * 31 + Math.round(lon * 1e4) * 17)

/**
 * Initial compass bearing from one [lon, lat] point to another, 0 to 359.
 * @param {[number, number]} a
 * @param {[number, number]} b
 */
export function bearingDegrees(a, b) {
  const [lon1, lat1, lon2, lat2] = [toRad(a[0]), toRad(a[1]), toRad(b[0]), toRad(b[1])]
  const y = Math.sin(lon2 - lon1) * Math.cos(lat2)
  const x =
    Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1)
  return Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360) % 360
}

/** The street beside a waypoint. The hostile point gets a name made of HTML. */
function streetNear(point, salt) {
  if (isNear(point[0], point[1], HOSTILE_ROAD_POINT)) return HOSTILE_ROAD_NAME
  return STREETS[(pointHash(point) + salt) % STREETS.length]
}

/** How many pieces a leg of this length is cut into, 6 to 12. */
export function pieceCount(meters) {
  const extra = Math.floor(meters / METERS_PER_MILE / MILES_PER_EXTRA_PIECE)
  return Math.min(MAX_PIECES, MIN_PIECES + extra)
}

/**
 * Splits `total` by weight into pieces rounded to a tenth. The last piece takes what is left,
 * so the pieces always add up to the total.
 * @param {number} total
 * @param {number[]} weights
 */
function splitByWeight(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0)
  const parts = []
  let used = 0
  weights.forEach((weight, i) => {
    const part = i === weights.length - 1 ? round1(total - used) : round1((total * weight) / sum)
    parts.push(part)
    used = round1(used + part)
  })
  return parts
}

/**
 * The `steps` array of one OSRM leg.
 * @param {object} leg
 * @param {[number, number]} leg.from [lat, lon]
 * @param {[number, number]} leg.to [lat, lon]
 * @param {number} leg.meters the leg's distance, already rounded as the response shows it
 * @param {number} leg.seconds the leg's duration
 * @param {[number, number][]} leg.geometry [lon, lat] points from `from` to `to`
 * @param {number} leg.legIndex 0 for the first leg, so neighbouring legs use different roads
 */
export function legSteps({ from, to, meters, seconds, geometry, legIndex }) {
  const pieces = pieceCount(meters)
  const offset = (pointHash(from) + legIndex) % HIGHWAYS.length
  const highwayAt = (piece) => HIGHWAYS[(offset + piece - 1) % HIGHWAYS.length]

  const weights = Array.from({ length: pieces }, (_, i) =>
    i === 0 || i === pieces - 1 ? STREET_WEIGHT : highwayAt(i).weight,
  )
  const lengths = splitByWeight(meters, weights)
  const durations = splitByWeight(seconds, weights)

  // Each piece starts on a real point of the leg's geometry, so a click on the line lands on the road.
  const last = geometry.length - 1
  let before = 0
  const starts = lengths.map((length) => {
    const fraction = meters > 0 ? before / meters : 0
    before += length
    return geometry[Math.min(last, Math.round(fraction * last))]
  })
  const end = geometry[last]
  const finish = [...starts.slice(1), end]
  const bearingFor = (i) => {
    const target =
      finish[i][0] === starts[i][0] && finish[i][1] === starts[i][1] ? [to[1], to[0]] : finish[i]
    return bearingDegrees(starts[i], target)
  }

  const bearings = lengths.map((_, i) => bearingFor(i))
  const steps = lengths.map((length, i) => {
    const isFirst = i === 0
    const isStreetEnd = i === pieces - 1
    const road = isFirst
      ? { ref: '', name: streetNear(from, 0) }
      : isStreetEnd
        ? { ref: '', name: streetNear(to, 3) }
        : highwayAt(i)
    const [type, modifier] = isFirst
      ? ['depart', undefined]
      : MANEUVERS[(offset + i) % MANEUVERS.length]
    return {
      distance: length,
      duration: durations[i],
      name: road.name,
      ...(road.ref ? { ref: road.ref } : {}),
      mode: 'driving',
      driving_side: 'right',
      weight: durations[i],
      maneuver: {
        type,
        ...(modifier ? { modifier } : {}),
        location: starts[i],
        bearing_before: isFirst ? 0 : bearings[i - 1],
        bearing_after: bearings[i],
      },
    }
  })

  steps.push({
    distance: 0,
    duration: 0,
    name: streetNear(to, 3),
    mode: 'driving',
    driving_side: 'right',
    weight: 0,
    maneuver: {
      type: 'arrive',
      modifier: 'right',
      location: end,
      bearing_before: bearings[pieces - 1],
      bearing_after: 0,
    },
  })
  return steps
}
