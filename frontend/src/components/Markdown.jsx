// Just enough Markdown for chat replies: paragraphs, headings, bullet and
// numbered lists (nested by indent), **bold**, *italic* and `code`. Builds
// React elements directly (no innerHTML), so model output can't inject markup.
// Re-parsed on every streamed token — an unclosed marker mid-stream shows as-is
// until its closing half arrives. `_underscore_` emphasis is deliberately not
// supported; it would mangle snake_case words. Mirrors mobile/src/components/
// Markdown.tsx.

const HEADING = /^#{1,6}\s+(.*)$/
const BULLET = /^(\s*)[-*•]\s+(.*)$/
const NUMBERED = /^(\s*)(\d+)[.)]\s+(.*)$/
const RULE = /^\s*([-*_])\1{2,}\s*$/

function parse(src) {
  const blocks = []
  let para = []
  const flush = () => {
    if (para.length) blocks.push({ kind: 'p', text: para.join('\n') })
    para = []
  }
  for (const line of src.split('\n')) {
    if (!line.trim() || RULE.test(line)) {
      flush()
      continue
    }
    let m
    if ((m = line.match(HEADING))) {
      flush()
      blocks.push({ kind: 'h', text: m[1] })
    } else if ((m = line.match(BULLET))) {
      flush()
      blocks.push({ kind: 'li', ordered: false, text: m[2], indent: Math.floor(m[1].length / 2) })
    } else if ((m = line.match(NUMBERED))) {
      flush()
      blocks.push({ kind: 'li', ordered: true, value: Number(m[2]), text: m[3], indent: Math.floor(m[1].length / 2) })
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

function inline(text) {
  return text.split(INLINE).map((part, i) => {
    if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{inline(part.slice(2, -2))}</strong>
    }
    if (part.length > 2 && part.startsWith('*') && part.endsWith('*')) {
      return <em key={i}>{part.slice(1, -1)}</em>
    }
    if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
      return <code key={i}>{part.slice(1, -1)}</code>
    }
    // Keep single line breaks inside a paragraph / list item.
    return part.split('\n').flatMap((seg, j) => (j ? [<br key={`${i}-${j}`} />, seg] : [seg]))
  })
}

export default function Markdown({ text }) {
  const blocks = parse(text)
  const out = []
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    if (b.kind === 'li') {
      // Group a run of same-type items into one <ul>/<ol>.
      const items = []
      while (i < blocks.length && blocks[i].kind === 'li' && blocks[i].ordered === b.ordered) {
        items.push(blocks[i])
        i++
      }
      i--
      const List = b.ordered ? 'ol' : 'ul'
      out.push(
        <List key={i}>
          {items.map((it, j) => (
            <li key={j} value={it.ordered ? it.value : undefined} style={it.indent ? { marginLeft: it.indent * 18 } : undefined}>
              {inline(it.text)}
            </li>
          ))}
        </List>,
      )
    } else if (b.kind === 'h') {
      out.push(<h4 key={i}>{inline(b.text)}</h4>)
    } else {
      out.push(<p key={i}>{inline(b.text)}</p>)
    }
  }
  return <div className="md">{out}</div>
}
