import { jsPDF } from 'jspdf'
import type { PlanResponse, Segment } from '../../src/api/types'
import { midRoadIndex, mileShown, showsNumber } from '../helpers/directions'
import { checkPlan } from '../helpers/hos-check'
import { countPdfPages, startsLikePdf } from '../helpers/pdf'
import { firstNumber, numbersIn, parseMinutes } from '../helpers/parse'
import { decodeTrip, encodeTrip, exampleRequest, safeDeparture } from '../helpers/plan'
import { expect, test } from '../helpers/test'

// These check the helpers the other specs lean on. They need no app and no servers.

test.describe('parsing what the UI prints', () => {
  test('reads numbers with separators and units', () => {
    expect(numbersIn('1,556.8 mi')).toEqual([1556.8])
    expect(numbersIn('Day 3 of 4')).toEqual([3, 4])
    expect(firstNumber('Fuel stops 2')).toBe(2)
    expect(() => firstNumber('none')).toThrow()
  })

  test('reads durations in the formats the app might print', () => {
    expect(parseMinutes('26 h 5 min')).toBe(1565)
    expect(parseMinutes('26h 05m')).toBe(1565)
    expect(parseMinutes('2 d 6 h')).toBe(3240)
    expect(parseMinutes('12.5 h')).toBe(750)
    expect(parseMinutes('45 minutes')).toBe(45)
    expect(parseMinutes('1,557 mi')).toBeNull()
    expect(parseMinutes('6:00 AM')).toBeNull()
  })
})

test.describe('reading a Directions line', () => {
  test('finds the mile note, with or without a thousands separator', () => {
    expect(mileShown('Take I-40 W 212 mi mile 340')).toBe(340)
    expect(mileShown('Continue on Frontage Road 7.1 mi Mile 1,053.4')).toBe(1053.4)
    expect(mileShown('Take I-40 W 212 mi')).toBeNull()
    expect(mileShown('The mileage is 5')).toBeNull()
  })

  test('finds a distance within half a mile of the value', () => {
    expect(showsNumber('Take I-40 W 212 mi mile 340', 212.3)).toBe(true)
    expect(showsNumber('1,053 mi', 1052.7)).toBe(true)
    expect(showsNumber('212 mi', 214)).toBe(false)
    expect(showsNumber('no numbers here', 4)).toBe(false)
  })

  test('picks a road line after the first two lines to click', () => {
    const line = (kind: 'depart' | 'road' | 'arrive') =>
      ({ kind }) as Parameters<typeof midRoadIndex>[0][number]
    expect(midRoadIndex([line('depart'), line('road'), line('road'), line('arrive')])).toBe(2)
    expect(midRoadIndex([line('depart'), line('arrive')])).toBe(-1)
  })
})

test.describe('share link encoding', () => {
  test('round-trips a request, including non-ASCII labels', () => {
    const request = exampleRequest({
      current: { label: 'Köln, Nordrhein-Westfalen <b>', lat: 50.9375, lon: 6.9603 },
    })
    const param = encodeTrip(request)
    expect(param).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(decodeTrip(param)).toEqual(request)
  })

  test('safeDeparture is a Monday at least 10 days out, formatted for datetime-local', () => {
    const departure = safeDeparture(6, new Date('2026-10-06T12:00:00Z'))
    expect(departure).toMatch(/^\d{4}-\d{2}-\d{2}T06:00$/)
    const day = new Date(`${departure.slice(0, 10)}T12:00:00Z`)
    expect(day.getUTCDay()).toBe(1)
    expect(day.getTime() - Date.parse('2026-10-06T12:00:00Z')).toBeGreaterThanOrEqual(
      10 * 86_400_000,
    )
  })

  test('safeDeparture steps over the November clock change', () => {
    // Monday 2026-10-26 is 6 days before the US clocks go back on 2026-11-01.
    const departure = safeDeparture(6, new Date('2026-10-16T12:00:00Z'))
    expect(departure >= '2026-11-02').toBe(true)
  })
})

test.describe('PDF page counting', () => {
  test('counts the pages jsPDF writes', () => {
    const doc = new jsPDF({ unit: 'pt', format: 'letter' })
    doc.text('one', 40, 40)
    doc.addPage()
    doc.addPage()
    const pdf = Buffer.from(doc.output('arraybuffer'))
    expect(startsLikePdf(pdf)).toBe(true)
    expect(countPdfPages(pdf)).toBe(3)
  })

  test('counts the pages Chromium writes', async ({ page }) => {
    await page.setContent(
      '<div style="break-after:page">one</div><div style="break-after:page">two</div><div>three</div>',
    )
    const pdf = await page.pdf({ format: 'Letter' })
    expect(startsLikePdf(pdf)).toBe(true)
    expect(countPdfPages(pdf)).toBe(3)
  })

  test('says zero for something that is not a PDF', () => {
    expect(countPdfPages(Buffer.from('hello'))).toBe(0)
    expect(startsLikePdf(Buffer.from('hello'))).toBe(false)
  })
})

// A one-day trip worked by hand: 06:00 depart, 2 h driving (120 mi at 60 mph), 1 h pickup,
// 2 h driving, 1 h dropoff, done at 12:00. 4 h driving and 2 h on duty, so 6 h of cycle used.
const DAY = '2026-10-12'
const iso = (minute: number) =>
  `${DAY}T${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00-05:00`

function segment(
  id: number,
  kind: Segment['kind'],
  status: Segment['status'],
  start: number,
  minutes: number,
  startMile: number,
  endMile: number,
): Segment {
  return {
    id,
    status,
    kind,
    start_at: iso(start),
    end_at: iso(start + minutes),
    minutes,
    start_mile: startMile,
    end_mile: endMile,
    place: '',
    note: '',
  }
}

function tinyPlan(): PlanResponse {
  const log = {
    day: 1,
    date: DAY,
    from_place: 'A',
    to_place: 'B',
    total_miles_driving: 240,
    total_mileage_today: 240,
    entries: [
      { status: 'off_duty', kind: 'idle', start_min: 0, end_min: 360, place: '', note: '' },
      { status: 'driving', kind: 'drive', start_min: 360, end_min: 480, place: '', note: '' },
      { status: 'on_duty', kind: 'pickup', start_min: 480, end_min: 540, place: '', note: '' },
      { status: 'driving', kind: 'drive', start_min: 540, end_min: 660, place: '', note: '' },
      { status: 'on_duty', kind: 'dropoff', start_min: 660, end_min: 720, place: '', note: '' },
      { status: 'off_duty', kind: 'idle', start_min: 720, end_min: 1440, place: '', note: '' },
    ],
    totals: { off_duty: 1080, sleeper: 0, driving: 240, on_duty: 120 },
    remarks: [],
    recap: {
      on_duty_today_minutes: 360,
      a_minutes: 360,
      b_minutes: 3840,
      c_minutes: 360,
      restart_completed: false,
    },
    header: {},
    vehicle: '',
  }
  return {
    request: exampleRequest({ cycle_used_hours: 0, departure: `${DAY}T06:00` }),
    summary: {
      distance_miles: 240,
      driving_minutes: 240,
      on_duty_minutes: 360,
      elapsed_minutes: 360,
      depart_at: iso(360),
      arrive_at: iso(720),
      days: 1,
      fuel_stops: 0,
      breaks: 0,
      rests: 0,
      restarts: 0,
      cycle_used_start_hours: 0,
      cycle_used_end_hours: 6,
      legs: [
        {
          from: 'current',
          to: 'pickup',
          distance_miles: 120,
          duration_minutes: 120,
          osrm_duration_minutes: 110,
        },
        {
          from: 'pickup',
          to: 'dropoff',
          distance_miles: 120,
          duration_minutes: 120,
          osrm_duration_minutes: 100,
        },
      ],
    },
    route: {
      geometry: [],
      bounds: [
        [0, 0],
        [0, 0],
      ],
      leg_end_indices: [0, 0],
    },
    stops: [],
    segments: [
      segment(1, 'drive', 'driving', 360, 120, 0, 120),
      segment(2, 'pickup', 'on_duty', 480, 60, 120, 120),
      segment(3, 'drive', 'driving', 540, 120, 120, 240),
      segment(4, 'dropoff', 'on_duty', 660, 60, 240, 240),
    ],
    logs: [log],
    assumptions: [],
    warnings: [],
  } as unknown as PlanResponse
}

test.describe('the plan checker', () => {
  test('accepts a one-day trip worked by hand', () => {
    expect(checkPlan(tinyPlan())).toEqual([])
  })

  test('flags a pickup shorter than an hour', () => {
    const plan = tinyPlan()
    plan.segments[1].minutes = 45
    expect(checkPlan(plan).join('\n')).toMatch(/pickup lasts 45 min/)
  })

  test('flags driving past 70 hours in the cycle', () => {
    const plan = tinyPlan()
    plan.request.cycle_used_hours = 69.5
    expect(checkPlan(plan).join('\n')).toMatch(/past 70 hours/)
  })

  test('flags 9 hours of driving without a break', () => {
    const plan = tinyPlan()
    plan.segments[0] = segment(1, 'drive', 'driving', 360, 540, 0, 540)
    expect(checkPlan(plan).join('\n')).toMatch(/8 hours without a break/)
  })

  test('flags a log day that does not add up to 24 hours', () => {
    const plan = tinyPlan()
    plan.logs[0].totals.driving += 1
    expect(checkPlan(plan).join('\n')).toMatch(/do not add up to 24 hours/)
  })

  test('flags a leg faster than 60 mph', () => {
    const plan = tinyPlan()
    plan.summary.legs[0].duration_minutes = 90
    expect(checkPlan(plan).join('\n')).toMatch(/leg to pickup/)
  })

  test('flags a gap between segments', () => {
    const plan = tinyPlan()
    plan.segments[2] = segment(3, 'drive', 'driving', 550, 110, 120, 240)
    expect(checkPlan(plan).join('\n')).toMatch(/gap or overlap/)
  })
})
