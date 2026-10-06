import type { DailyLog } from '@/api/types'
import { parseLogDate, wholeMiles } from './describe'
import { PRINT } from './geometry'
import { FilledLine, InkText, T } from './svgPrimitives'

interface BoxProps {
  x: number
  y: number
  width: number
  height: number
}

function Box({ x, y, width, height }: BoxProps) {
  return (
    <rect
      x={x}
      y={y}
      width={width}
      height={height}
      rx={2}
      fill="none"
      stroke={PRINT}
      strokeWidth={1.3}
    />
  )
}

/** Title, date, from and to, mileage boxes and the carrier lines: everything above the grid. */
export function SheetHeader({ log }: { log: DailyLog }) {
  const { header } = log
  const date = parseLogDate(log.date)

  return (
    <g>
      <T x={30} y={56} size={27} bold>
        Drivers Daily Log
      </T>
      <T x={152} y={71} size={9} anchor="middle">
        (24 hours)
      </T>

      <DateFields month={date?.month} day={date?.day} year={date?.year} />

      <T x={572} y={42} size={7.5} bold>
        Original - File at home terminal.
      </T>
      <T x={572} y={55} size={7.5} bold>
        Duplicate - Driver retains in his/her possession for 8 days.
      </T>

      <T x={30} y={91} size={9} bold>
        Driver
      </T>
      <FilledLine x1={68} x2={300} y={94} value={header.driver_name} testId="log-driver" />
      <T x={330} y={91} size={9} bold>
        Co-driver
      </T>
      <FilledLine x1={384} x2={620} y={94} value={header.co_driver_name} testId="log-co-driver" />

      <T x={30} y={126} size={12} bold>
        From:
      </T>
      <FilledLine x1={72} x2={400} y={129} value={log.from_place} size={12} testId="log-from" />
      <T x={432} y={126} size={12} bold>
        To:
      </T>
      <FilledLine x1={456} x2={820} y={129} value={log.to_place} size={12} testId="log-to" />

      <Box x={30} y={150} width={160} height={44} />
      <Box x={200} y={150} width={160} height={44} />
      <InkText
        x={110}
        y={180}
        size={22}
        bold
        anchor="middle"
        maxWidth={140}
        testId="log-miles-driving"
      >
        {wholeMiles(log.total_miles_driving)}
      </InkText>
      <InkText
        x={280}
        y={180}
        size={22}
        bold
        anchor="middle"
        maxWidth={140}
        testId="log-mileage-today"
      >
        {wholeMiles(log.total_mileage_today)}
      </InkText>
      <T x={110} y={207} size={8.5} bold anchor="middle">
        Total Miles Driving Today
      </T>
      <T x={280} y={207} size={8.5} bold anchor="middle">
        Total Mileage Today
      </T>

      <Box x={30} y={220} width={330} height={44} />
      <InkText x={195} y={248} size={14} anchor="middle" maxWidth={312} testId="log-vehicle">
        {log.vehicle}
      </InkText>
      <T x={195} y={277} size={8.5} bold anchor="middle">
        Truck/Tractor and Trailer Numbers or
      </T>
      <T x={195} y={288} size={8.5} bold anchor="middle">
        License Plate(s)/State (show each unit)
      </T>

      <CarrierLine
        y={180}
        caption="Name of Carrier or Carriers"
        value={header.carrier_name}
        testId="log-carrier"
      />
      <CarrierLine
        y={224}
        caption="Main Office Address"
        value={header.main_office_address}
        testId="log-main-office"
      />
      <CarrierLine
        y={268}
        caption="Home Terminal Address"
        value={header.home_terminal_address}
        testId="log-home-terminal"
      />
    </g>
  )
}

function CarrierLine({
  y,
  caption,
  value,
  testId,
}: {
  y: number
  caption: string
  value: string
  testId: string
}) {
  return (
    <g>
      <FilledLine x1={385} x2={820} y={y} value={value} size={12} testId={testId} />
      <T x={602.5} y={y + 12} size={8.5} bold anchor="middle">
        {caption}
      </T>
    </g>
  )
}

function DateFields({ month, day, year }: { month?: number; day?: number; year?: number }) {
  const fields = [
    { x1: 336, x2: 396, caption: '(month)', value: month, id: 'log-month' },
    { x1: 412, x2: 472, caption: '(day)', value: day, id: 'log-day' },
    { x1: 488, x2: 556, caption: '(year)', value: year, id: 'log-year' },
  ]
  return (
    <g>
      {fields.map((field) => {
        const center = (field.x1 + field.x2) / 2
        return (
          <g key={field.id}>
            <line x1={field.x1} x2={field.x2} y1={52} y2={52} stroke={PRINT} strokeWidth={0.9} />
            {field.value !== undefined ? (
              <InkText
                x={center}
                y={48}
                size={14}
                bold
                anchor="middle"
                maxWidth={60}
                testId={field.id}
              >
                {String(field.value)}
              </InkText>
            ) : null}
            <T x={center} y={65} size={8} bold anchor="middle">
              {field.caption}
            </T>
          </g>
        )
      })}
      <T x={404} y={54} size={15} anchor="middle">
        /
      </T>
      <T x={480} y={54} size={15} anchor="middle">
        /
      </T>
    </g>
  )
}
