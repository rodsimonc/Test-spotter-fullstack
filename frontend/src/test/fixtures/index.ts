// Typed access to the two hand-built plans. JSON imports widen the status strings, so they are cast once here.
import type { PlanResponse } from '@/api/types'
import multiDay from './plan-multiday.json'
import short from './plan-short.json'

/** One log day: Dallas to San Antonio by way of Waco. */
export const shortPlan = short as unknown as PlanResponse

/** Three log days with a fuel stop, a 30-minute break, 10-hour rests and a 34-hour restart. */
export const multiDayPlan = multiDay as unknown as PlanResponse
