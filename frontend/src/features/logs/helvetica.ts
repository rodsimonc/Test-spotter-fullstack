// Advance widths of Helvetica (regular), in 1/1000 em, for printable ASCII.
// The sheet only uses the PDF-safe family "Helvetica, Arial, sans-serif", so a fixed table
// is enough to lay text out the same way in the browser and in the exported PDF.
const ASCII_WIDTHS = [
  // space ! " # $ % & ' ( ) * + , - . /
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  // 0 1 2 3 4 5 6 7 8 9 : ; < = > ?
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  // @ A B C D E F G H I J K L M N O
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  // P Q R S T U V W X Y Z [ \ ] ^ _
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  // ` a b c d e f g h i j k l m n o
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  // p q r s t u v w x y z { | } ~
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
]

const FALLBACK_WIDTH = 556
const ELLIPSIS = '...'

/** Width in SVG user units of `text` set in Helvetica at `fontSize`. */
export function textWidth(text: string, fontSize: number): number {
  let units = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    units += code >= 32 && code <= 126 ? ASCII_WIDTHS[code - 32] : FALLBACK_WIDTH
  }
  return (units * fontSize) / 1000
}

/** Shortens `text` with "..." until it fits in `maxWidth`. Returns it unchanged when it already fits. */
export function fitText(text: string, fontSize: number, maxWidth: number): string {
  if (textWidth(text, fontSize) <= maxWidth) return text
  const chars = Array.from(text)
  while (chars.length > 1) {
    chars.pop()
    const candidate = chars.join('').trimEnd() + ELLIPSIS
    if (textWidth(candidate, fontSize) <= maxWidth) return candidate
  }
  return ELLIPSIS
}
