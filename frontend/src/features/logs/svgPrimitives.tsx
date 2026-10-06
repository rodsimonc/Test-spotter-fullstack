import type { ReactNode } from 'react'
import { INK, PRINT } from './geometry'
import { fitText } from './helvetica'

interface TextProps {
  x: number
  y: number
  size: number
  bold?: boolean
  anchor?: 'start' | 'middle' | 'end'
  fill?: string
  testId?: string
  children: ReactNode
}

/** One line of text. Colours and weights are attributes so the PDF converter reads them directly. */
export function T({
  x,
  y,
  size,
  bold = false,
  anchor = 'start',
  fill = PRINT,
  testId,
  children,
}: TextProps) {
  return (
    <text
      x={x}
      y={y}
      fontSize={size}
      fontWeight={bold ? 'bold' : 'normal'}
      textAnchor={anchor}
      fill={fill}
      data-testid={testId}
    >
      {children}
    </text>
  )
}

/** Text the driver writes: ink blue, never wider than `maxWidth`. */
export function InkText({
  x,
  y,
  size,
  maxWidth,
  anchor = 'start',
  bold = false,
  testId,
  children,
}: Omit<TextProps, 'fill' | 'children'> & { maxWidth: number; children: string }) {
  return (
    <T x={x} y={y} size={size} anchor={anchor} bold={bold} fill={INK} testId={testId}>
      {fitText(children, size, maxWidth)}
    </T>
  )
}

interface FieldProps {
  x1: number
  x2: number
  /** y of the rule. The value sits just above it. */
  y: number
  value: string
  size?: number
  testId?: string
}

/** A printed rule with the driver's entry written on it. */
export function FilledLine({ x1, x2, y, value, size = 11, testId }: FieldProps) {
  return (
    <g>
      <line x1={x1} x2={x2} y1={y} y2={y} stroke={PRINT} strokeWidth={0.9} />
      {value ? (
        <InkText x={x1 + 4} y={y - 4} size={size} maxWidth={x2 - x1 - 8} testId={testId}>
          {value}
        </InkText>
      ) : null}
    </g>
  )
}
