# Hours-of-service rules the planner follows

Source: FMCSA, *Interstate Truck Driver's Guide to Hours of Service* (2022), 49 CFR Part 395. The assessment fixes the rest: property-carrying driver, 70 hours in 8 days, no adverse driving conditions, fuel at least every 1,000 miles, 1 hour at pickup and at dropoff.

## Limits

| Rule | Limit | What the planner does |
|---|---|---|
| 11-hour driving | 11 hours of driving after 10 hours off | After 11 hours behind the wheel, 10 hours in the sleeper berth. |
| 14-hour window | No driving after the 14th hour since coming on duty | The clock runs through breaks, fuel and pickup. Past it, 10 hours in the sleeper berth. |
| 30-minute break | 30 consecutive minutes non-driving once 8 hours of driving pile up | Off Duty break. Any non-driving stop of 30 minutes or more (fuel, pickup, dropoff, rest, restart) counts and resets the 8-hour counter. |
| 70-hour / 8-day | No driving after 70 hours on duty in 8 days | When the cycle hits 70, a 34-hour Off Duty restart, then the cycle starts at 0. |
| 34-hour restart | 34 consecutive hours off duty resets the cycle | Also resets the 11-hour and 14-hour clocks. |
| Fuel | At least once every 1,000 miles (assessment rule) | 30 minutes On Duty (not driving), taken just short of 1,000 miles since the last fill, never past it. A trip of exactly 1,000 miles needs no stop. |
| Pickup, dropoff | 1 hour each (assessment rule) | On Duty (not driving). |

## Trip order

1. Off duty until the departure time.
2. Drive from the current location to the pickup.
3. One hour on duty at the pickup.
4. Drive from the pickup to the dropoff.
5. One hour on duty at the dropoff.
6. Off duty until midnight.

Both driving legs count. The deadhead leg to the pickup eats hours like any other driving.

## Order of events when limits collide

When more than one limit hits at the same minute, the engine handles them in this order:

1. Fuel (it is on duty, and it also counts as the 30-minute break).
2. 34-hour restart, if the cycle is used up.
3. 10-hour sleeper rest, if the 11-hour or 14-hour limit is reached.
4. 30-minute break.

Work that is not driving may run past the 14th hour or past 70 hours. Only driving is capped. So a pickup that starts with 20 minutes left in the window still takes its full hour, and the rest follows.

A cycle already at 70 hours or more starts the trip with the restart, before any driving.

## Assumptions

These are printed in the app and returned in `assumptions`.

- Property-carrying driver, 70-hour/8-day schedule, no adverse driving conditions.
- The driver starts rested (10 or more hours off) with a full tank. The 14-hour window starts at departure.
- Hours already used in the cycle never drop out of the 8-day window during the trip. That is the cautious reading, since the app only knows one number.
- Overnight rest is logged in the sleeper berth. The 34-hour restart is logged Off Duty.
- Drive time is the slower of the OSRM estimate and distance divided by 60 mph, rounded up to a whole minute. OSRM uses a car profile.
- No split sleeper pairing, no short-haul exception, no personal conveyance.
- Place names come from the nearest town of 5,000 people or more in the bundled GeoNames list (United States, Canada and Mexico).

## Time zones

FMCSA wants every sheet in the home terminal's time. The planner resolves the zone you pick, reads its UTC offset at the departure time you enter, and keeps that one offset for the whole trip. Every sheet is then exactly 24 hours, and every timestamp in the response carries the same offset, for example `-05:00`. The returned assumptions name the zone and the offset.

- The clock reading you type is never changed. A departure of 06:00 is 06:00 on the sheet.
- On a morning when clocks change, a reading can be missing (02:30 on spring-forward day) or happen twice (01:30 on fall-back day). The planner uses the offset in force just before the change in both cases.
- A trip that runs across a clock change in the real zone shows a warning. Times after the change then differ from wall clocks in that zone by the size of the shift (1 hour in the United States and Canada).
- Zones without daylight time (America/Phoenix, Pacific/Honolulu) never warn. Zones with a half-hour offset (America/St_Johns) work the same way.

The real zone would give two days a year of 23 and 25 hours, and the 24-hour grid on the form cannot draw those. A fixed offset keeps every sheet and total correct, and the warning tells the driver where clocks disagree.

## Daily log rules

- One sheet per calendar day at the home terminal, midnight to midnight. The four status totals add up to 24 hours.
- Before departure on day 1 and after arrival on the last day, the driver is Off Duty. A trip that ends exactly at midnight does not start another sheet.
- A stop that spans midnight is split across two sheets. A status that carries on past midnight gets no new remark on the next sheet.
- Remarks list the city, town or village and state at every change of duty status and at every change of stop kind (a fuel stop right after loading gets its own remark). Where the truck is not in a town, the remark reads like "12 mi SW of Kearney, NE". Within 3 miles of a town it is just the town. With no town within 150 miles it is the coordinates.
- Miles driven are split across sheets in proportion to the driving minutes on each. The daily whole miles add up to the trip's rounded distance.
- Recap, 70-hour/8-day drivers: A is on-duty hours for the last 8 days including today. B is 70 minus A, never below 0. C is on-duty hours for the last 7 days including today. Hours already in the cycle when the trip began are in A and C until a 34-hour restart finishes. After that, counting starts at zero from the minute the restart ends, and `restart_completed` is true on that sheet.
- On-duty work after the 70th hour (a pickup that starts at 70 hours exactly) can push A past 70. B then reads 0.

The blank form we were given prints the 70-hour and 60-hour labels over the wrong A/B/C text. The app prints the standard pairing: 70-hour A/B/C = 8 days, 70 minus A, 7 days. The 60-hour block stays empty because this driver is on 70/8.
