// When and where a video was recorded, read from its QuickTime / MP4 metadata —
// the video counterpart to the backend's photo EXIF endpoint, returning the
// same {has_exif, date, time, lat, lng} shape so the "Event from photo" prefill
// works unchanged. Runs client-side and only reads the small `moov` box (seeking
// past the media data), so a multi-hundred-MB video never leaves the device.
//
// Sources, best first:
//   iPhone  moov/meta keys+ilst: com.apple.quicktime.location.ISO6709 and
//           com.apple.quicktime.creationdate (local wall-clock with offset)
//   Android moov/udta/©xyz or 3GPP loci, and moov/mvhd creation_time (UTC)
//
// Keep in sync with mobile/src/lib/videoMetadata.ts (same parser, native reads).

const MAX_MOOV_BYTES = 64 * 1024 * 1024
const KEY_LOCATION = 'com.apple.quicktime.location.ISO6709'
const KEY_CREATED = 'com.apple.quicktime.creationdate'
const MAC_EPOCH_OFFSET_S = 2082844800 // 1904-01-01 → 1970-01-01

export async function extractVideoMetadata(file) {
  const readAt = async (offset, length) =>
    new Uint8Array(await file.slice(offset, offset + length).arrayBuffer())
  return parseVideoMetadata(readAt, file.size)
}

export async function parseVideoMetadata(readAt, size) {
  const moov = await findMoov(readAt, size)
  const found = { location: null, created: null, mvhdTime: null }
  if (moov) walk(moov, 0, moov.length, found)

  const out = { has_exif: false }
  const local = parseLocalDate(found.created) || utcToLocal(found.mvhdTime)
  if (local) {
    out.date = local.date
    out.time = local.time
    out.has_exif = true
  }
  const coords = parseIso6709(found.location)
  if (coords) {
    out.lat = coords.lat
    out.lng = coords.lng
    out.has_exif = true
  }
  return out
}

function u32(b, o) {
  return ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3]
}

function fourcc(b, o) {
  return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3])
}

function utf8(b, start, end) {
  return new TextDecoder().decode(b.subarray(start, end)).replace(/\0+$/, '')
}

// Walk the top-level boxes (ftyp, wide, mdat, moov, …) by header only, then
// read the moov box in full. iPhone files usually put moov after mdat.
async function findMoov(readAt, size) {
  let offset = 0
  for (let i = 0; i < 64 && offset + 8 <= size; i++) {
    const h = await readAt(offset, 16)
    if (h.length < 8) break
    let boxSize = u32(h, 0)
    let headerLen = 8
    if (boxSize === 1) {
      if (h.length < 16) break
      boxSize = u32(h, 8) * 2 ** 32 + u32(h, 12)
      headerLen = 16
    } else if (boxSize === 0) {
      boxSize = size - offset
    }
    if (boxSize < headerLen) break
    if (fourcc(h, 4) === 'moov') {
      if (boxSize > MAX_MOOV_BYTES) return null
      return await readAt(offset + headerLen, boxSize - headerLen)
    }
    offset += boxSize
  }
  return null
}

// Recursively scan the boxes in b[start, end) for the fields we want.
function walk(b, start, end, found, keys = null) {
  let o = start
  while (o + 8 <= end) {
    const size = u32(b, o)
    const type = fourcc(b, o + 4)
    if (size < 8 || o + size > end) break
    const body = o + 8
    const bodyEnd = o + size

    if (type === 'mvhd') {
      // version 0: 32-bit creation_time at +4; version 1: 64-bit at +4.
      const secs = b[body] === 1 ? u32(b, body + 4) * 2 ** 32 + u32(b, body + 8) : u32(b, body + 4)
      if (secs > MAC_EPOCH_OFFSET_S) found.mvhdTime = (secs - MAC_EPOCH_OFFSET_S) * 1000
    } else if (type === 'udta' || type === 'trak') {
      walk(b, body, bodyEnd, found)
    } else if (type === 'meta') {
      // QuickTime meta starts straight with child boxes; ISO meta (inside
      // udta) has a 4-byte version/flags header first.
      const childStart = ['hdlr', 'keys', 'ilst'].includes(fourcc(b, body + 4)) ? body : body + 4
      walk(b, childStart, bodyEnd, found, readKeys(b, childStart, bodyEnd))
    } else if (type === 'ilst') {
      readIlst(b, body, bodyEnd, keys, found)
    } else if (type === '©xyz' && !found.location) {
      // Android-style: u16 length, u16 language, then the ISO 6709 string.
      const len = (b[body] << 8) | b[body + 1]
      found.location = utf8(b, body + 4, Math.min(body + 4 + len, bodyEnd))
    } else if (type === 'loci' && !found.location) {
      found.location = readLoci(b, body, bodyEnd)
    }
    o += size
  }
}

// The meta/keys box: 1-based list of key names that ilst items index into.
function readKeys(b, start, end) {
  let o = start
  while (o + 8 <= end) {
    const size = u32(b, o)
    if (size < 8 || o + size > end) return null
    if (fourcc(b, o + 4) === 'keys') {
      const keys = []
      const count = u32(b, o + 12)
      let k = o + 16
      for (let i = 0; i < count && k + 8 <= o + size; i++) {
        const ksize = u32(b, k)
        if (ksize < 8) break
        keys.push(utf8(b, k + 8, k + ksize))
        k += ksize
      }
      return keys
    }
    o += size
  }
  return null
}

function readIlst(b, start, end, keys, found) {
  let o = start
  while (o + 8 <= end) {
    const size = u32(b, o)
    if (size < 8 || o + size > end) break
    const type = fourcc(b, o + 4)
    const name = keys ? keys[u32(b, o + 4) - 1] : type
    const value = readDataValue(b, o + 8, o + size)
    if (value != null) {
      if (name === KEY_LOCATION || name === '©xyz') found.location = found.location || value
      else if (name === KEY_CREATED) found.created = value
    }
    o += size
  }
}

// 3GPP `loci`: version/flags (4), language (2), NUL-terminated name, role (1),
// then longitude, latitude as signed 16.16 fixed point. Returned as ISO 6709
// so there's a single coordinate parser.
function readLoci(b, start, end) {
  let o = start + 6
  while (o < end && b[o] !== 0) o++
  o += 2 // name terminator + role
  if (o + 8 > end) return null
  const fixed = (p) => (((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) / 65536)
  const lng = fixed(o)
  const lat = fixed(o + 4)
  const sign = (v) => (v < 0 ? '-' : '+')
  return `${sign(lat)}${Math.abs(lat).toFixed(5).padStart(8, '0')}${sign(lng)}${Math.abs(lng).toFixed(5).padStart(9, '0')}/`
}

// An ilst item's `data` box: type (4) + locale (4) + UTF-8 value.
function readDataValue(b, start, end) {
  if (start + 16 > end || fourcc(b, start + 4) !== 'data') return null
  const size = u32(b, start)
  return utf8(b, start + 16, Math.min(start + size, end))
}

// "+48.2763-116.5494+000.000/" — degrees, or DDMM / DDDMM(SS) forms.
export function parseIso6709(s) {
  const m = /^([+-])(\d+)(\.\d+)?([+-])(\d+)(\.\d+)?/.exec(s || '')
  if (!m) return null
  const lat = iso6709Part(m[1], m[2], m[3], 2)
  const lng = iso6709Part(m[4], m[5], m[6], 3)
  if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  if (lat === 0 && lng === 0) return null
  return { lat, lng }
}

function iso6709Part(sign, intDigits, frac, degDigits) {
  const f = frac ? parseFloat(`0${frac}`) : 0
  const extra = intDigits.length - degDigits
  let val
  if (extra === 0) val = parseInt(intDigits, 10) + f
  else if (extra === 2) val = parseInt(intDigits.slice(0, degDigits), 10) + (parseInt(intDigits.slice(degDigits), 10) + f) / 60
  else if (extra === 4) {
    val = parseInt(intDigits.slice(0, degDigits), 10)
      + parseInt(intDigits.slice(degDigits, degDigits + 2), 10) / 60
      + (parseInt(intDigits.slice(degDigits + 2), 10) + f) / 3600
  } else return null
  return sign === '-' ? -val : val
}

// Apple's creationdate is local wall-clock plus offset ("2024-06-01T18:23:11-0700").
// Keep the wall-clock part, matching how photo EXIF times are treated.
function parseLocalDate(s) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(s || '')
  return m ? { date: m[1], time: m[2] } : null
}

// mvhd creation_time is UTC; show it in this device's local time.
function utcToLocal(ms) {
  if (ms == null) return null
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return null
  const pad = (n) => String(n).padStart(2, '0')
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  }
}
