import { useMemo, type ReactNode } from 'react'
import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native'
import { font, useTheme } from '@/theme'

// Just enough Markdown for chat replies: paragraphs, headings, bullet and
// numbered lists (nested by indent), **bold**, *italic* and `code`. Hand-rolled
// rather than a library so it stays tiny and pure JS. It's re-parsed on every
// streamed token, so an unclosed marker mid-stream simply shows as-is until its
// closing half arrives. `_underscore_` emphasis is deliberately not supported —
// it would mangle snake_case words.

type Block =
  | { kind: 'p'; text: string }
  | { kind: 'h'; text: string }
  | { kind: 'li'; text: string; marker: string; indent: number }

const HEADING = /^#{1,6}\s+(.*)$/
const BULLET = /^(\s*)[-*•]\s+(.*)$/
const NUMBERED = /^(\s*)(\d+[.)])\s+(.*)$/
const RULE = /^\s*([-*_])\1{2,}\s*$/

function parse(src: string): Block[] {
  const blocks: Block[] = []
  let para: string[] = []
  const flush = () => {
    if (para.length) blocks.push({ kind: 'p', text: para.join('\n') })
    para = []
  }
  for (const line of src.split('\n')) {
    if (!line.trim() || RULE.test(line)) {
      flush()
      continue
    }
    let m: RegExpMatchArray | null
    if ((m = line.match(HEADING))) {
      flush()
      blocks.push({ kind: 'h', text: m[1] })
    } else if ((m = line.match(BULLET))) {
      flush()
      blocks.push({ kind: 'li', text: m[2], marker: '•', indent: Math.floor(m[1].length / 2) })
    } else if ((m = line.match(NUMBERED))) {
      flush()
      blocks.push({ kind: 'li', text: m[3], marker: m[2].replace(')', '.'), indent: Math.floor(m[1].length / 2) })
    } else {
      const prev = blocks[blocks.length - 1]
      // An indented line straight after a list item continues that item.
      if (!para.length && prev?.kind === 'li' && /^\s/.test(line)) prev.text += `\n${line.trim()}`
      else para.push(line)
    }
  }
  flush()
  return blocks
}

const INLINE = /(\*\*[^*\n]+?\*\*|\*[^*\s][^*\n]*?\*|`[^`\n]+`)/g

function inline(text: string, codeStyle: TextStyle): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) {
      return (
        <Text key={i} style={styles.bold}>
          {inline(part.slice(2, -2), codeStyle)}
        </Text>
      )
    }
    if (part.length > 2 && part.startsWith('*') && part.endsWith('*')) {
      return (
        <Text key={i} style={styles.italic}>
          {part.slice(1, -1)}
        </Text>
      )
    }
    if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
      return (
        <Text key={i} style={codeStyle}>
          {part.slice(1, -1)}
        </Text>
      )
    }
    return part
  })
}

export default function Markdown({
  text,
  style,
  containerStyle,
}: {
  text: string
  style: StyleProp<TextStyle>
  containerStyle?: StyleProp<ViewStyle>
}) {
  const t = useTheme()
  const blocks = useMemo(() => parse(text), [text])
  const base = StyleSheet.flatten(style) ?? {}
  const fontSize = base.fontSize ?? 17
  const codeStyle: TextStyle = { fontFamily: 'Menlo', fontSize: fontSize - 2, backgroundColor: t.fill }

  return (
    <View style={containerStyle}>
      {blocks.map((b, i) => {
        // Tight spacing inside a list, paragraph spacing everywhere else.
        const gap = i === 0 ? 0 : b.kind === 'li' && blocks[i - 1].kind === 'li' ? 4 : 12
        if (b.kind === 'li') {
          return (
            <View key={i} style={[styles.item, { marginTop: gap, paddingLeft: b.indent * 18 }]}>
              <Text style={[base, styles.marker, { minWidth: b.marker === '•' ? 16 : 24 }]}>{b.marker}</Text>
              <Text style={[base, styles.itemText]} selectable>
                {inline(b.text, codeStyle)}
              </Text>
            </View>
          )
        }
        return (
          <Text
            key={i}
            style={[base, { marginTop: gap }, b.kind === 'h' && { fontSize: fontSize + 2, fontFamily: font.serif }]}
            selectable
          >
            {inline(b.text, codeStyle)}
          </Text>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  // Each Lato weight is its own family; fontWeight would fall back to SF.
  bold: { fontFamily: font.heavy },
  italic: { fontFamily: font.bodyItalic },
  item: { flexDirection: 'row' },
  marker: { paddingRight: 4 },
  itemText: { flex: 1 },
})
