/*
 * Profile picture processing, all in the browser before anything is uploaded.
 *
 *   1. Check the file really is a still JPEG, PNG or WebP (by its first bytes, not its name or reported type),
 *      at most 2 MB, with sensible dimensions. SVG, GIF, animated PNG and animated WebP are refused.
 *   2. Decode it (a file that does not decode is not a real image).
 *   3. Crop a square, scale to 256x256 and re-encode as WebP (JPEG if the browser cannot write WebP).
 *      Drawing onto a canvas and encoding again drops everything else in the file: EXIF, GPS location,
 *      camera data, colour profiles, embedded thumbnails.
 *
 * The pure helpers (sniffImage, isAnimated, readDimensions, cropRect) have no browser dependencies.
 */

export const MAX_INPUT_BYTES = 2 * 1024 * 1024
export const OUTPUT_SIZE = 256
export const MAX_OUTPUT_BYTES = 512 * 1024 // the bucket enforces the same limit
export const MIN_SIDE = 64
export const MAX_SIDE = 12000
export const MAX_PIXELS = 40_000_000

export type ImageKind = 'jpeg' | 'png' | 'webp'

export type ImageError =
  | 'empty'
  | 'too_big'
  | 'unsupported'
  | 'animated'
  | 'not_image'
  | 'too_small'
  | 'too_large'
  | 'no_canvas'
  | 'encode_failed'

export interface Crop {
  /** 1 = the whole short side, 4 = a quarter of it. */
  zoom: number
  /** Move the square sideways, -1 (far left) to 1 (far right). */
  x: number
  /** Move the square up or down, -1 (top) to 1 (bottom). */
  y: number
}

export const DEFAULT_CROP: Crop = { zoom: 1, x: 0, y: 0 }

/** What the file claims to be, judged only by its first bytes. */
export function sniffImage(bytes: Uint8Array): ImageKind | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg'
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return 'png'
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'webp'
  return null
}

function ascii(bytes: Uint8Array, at: number, length: number): string {
  let out = ''
  for (let i = 0; i < length && at + i < bytes.length; i++) out += String.fromCharCode(bytes[at + i])
  return out
}

const u32be = (b: Uint8Array, at: number): number => (((b[at] ?? 0) << 24) | ((b[at + 1] ?? 0) << 16) | ((b[at + 2] ?? 0) << 8) | (b[at + 3] ?? 0)) >>> 0
const u32le = (b: Uint8Array, at: number): number => ((b[at] ?? 0) | ((b[at + 1] ?? 0) << 8) | ((b[at + 2] ?? 0) << 16) | ((b[at + 3] ?? 0) << 24)) >>> 0

/** True for animated PNG (APNG) and animated WebP. JPEG is always a still. */
export function isAnimated(kind: ImageKind, bytes: Uint8Array): boolean {
  if (kind === 'png') {
    let at = 8
    while (at + 8 <= bytes.length) {
      const length = u32be(bytes, at)
      const type = ascii(bytes, at + 4, 4)
      if (type === 'acTL') return true
      if (type === 'IDAT' || type === 'IEND') return false // the animation header always comes before the pixels
      at += 12 + length
    }
    return false
  }
  if (kind === 'webp') {
    let at = 12
    while (at + 8 <= bytes.length) {
      const type = ascii(bytes, at, 4)
      const size = u32le(bytes, at + 4)
      if (type === 'ANIM' || type === 'ANMF') return true
      if (type === 'VP8X' && ((bytes[at + 8] ?? 0) & 0x02) !== 0) return true
      at += 8 + size + (size & 1)
    }
    return false
  }
  return false
}

/** Width and height from the file header, without decoding any pixels (guards against decompression bombs). */
export function readDimensions(kind: ImageKind, bytes: Uint8Array): { width: number; height: number } | null {
  if (kind === 'png') {
    if (bytes.length < 24 || ascii(bytes, 12, 4) !== 'IHDR') return null
    return { width: u32be(bytes, 16), height: u32be(bytes, 20) }
  }
  if (kind === 'webp') {
    let at = 12
    while (at + 8 <= bytes.length) {
      const type = ascii(bytes, at, 4)
      const size = u32le(bytes, at + 4)
      const d = at + 8
      if (type === 'VP8X' && d + 10 <= bytes.length) {
        const width = 1 + ((bytes[d + 4] ?? 0) | ((bytes[d + 5] ?? 0) << 8) | ((bytes[d + 6] ?? 0) << 16))
        const height = 1 + ((bytes[d + 7] ?? 0) | ((bytes[d + 8] ?? 0) << 8) | ((bytes[d + 9] ?? 0) << 16))
        return { width, height }
      }
      if (type === 'VP8 ' && d + 10 <= bytes.length) {
        return { width: ((bytes[d + 6] ?? 0) | ((bytes[d + 7] ?? 0) << 8)) & 0x3fff, height: ((bytes[d + 8] ?? 0) | ((bytes[d + 9] ?? 0) << 8)) & 0x3fff }
      }
      if (type === 'VP8L' && d + 5 <= bytes.length && bytes[d] === 0x2f) {
        const bits = u32le(bytes, d + 1)
        return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
      }
      at += 8 + size + (size & 1)
    }
    return null
  }
  // JPEG: walk the markers until a start-of-frame segment.
  let at = 2
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return null
    let marker = bytes[at + 1] ?? 0
    while (marker === 0xff && at + 2 < bytes.length) {
      at++
      marker = bytes[at + 1] ?? 0
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2
      continue
    }
    const length = ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0)
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isFrame) {
      if (at + 9 > bytes.length) return null
      return { height: ((bytes[at + 5] ?? 0) << 8) | (bytes[at + 6] ?? 0), width: ((bytes[at + 7] ?? 0) << 8) | (bytes[at + 8] ?? 0) }
    }
    if (length < 2) return null
    at += 2 + length
  }
  return null
}

/** Which square of the picture is used: the source rectangle for drawImage. */
export function cropRect(width: number, height: number, crop: Crop): { sx: number; sy: number; side: number } {
  const zoom = Math.min(4, Math.max(1, Number.isFinite(crop.zoom) ? crop.zoom : 1))
  const side = Math.max(1, Math.min(width, height) / zoom)
  const clamp = (v: number) => Math.min(1, Math.max(-1, Number.isFinite(v) ? v : 0))
  const sx = ((width - side) / 2) * (1 + clamp(crop.x))
  const sy = ((height - side) / 2) * (1 + clamp(crop.y))
  return { sx, sy, side }
}

export interface Inspected {
  kind: ImageKind
  width: number
  height: number
  /** The decoded picture, ready to draw. Call close() when finished. */
  source: CanvasImageSource
  close: () => void
}

export type Result<T> = ({ ok: true } & T) | { ok: false; error: ImageError }

/** Steps 1 and 2: is this a real, still, reasonably sized JPEG/PNG/WebP, and does it decode? */
export async function inspectFile(file: File): Promise<Result<{ image: Inspected }>> {
  if (!file || file.size === 0) return { ok: false, error: 'empty' }
  if (file.size > MAX_INPUT_BYTES) return { ok: false, error: 'too_big' }

  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await file.arrayBuffer())
  } catch {
    return { ok: false, error: 'not_image' }
  }
  const kind = sniffImage(bytes)
  if (!kind) return { ok: false, error: 'unsupported' } // SVG, GIF, HEIC, PDF, renamed files...
  if (isAnimated(kind, bytes)) return { ok: false, error: 'animated' }

  const header = readDimensions(kind, bytes)
  if (!header) return { ok: false, error: 'not_image' }
  if (header.width < MIN_SIDE || header.height < MIN_SIDE) return { ok: false, error: 'too_small' }
  if (header.width > MAX_SIDE || header.height > MAX_SIDE || header.width * header.height > MAX_PIXELS) return { ok: false, error: 'too_large' }

  const decoded = await decode(file)
  if (!decoded) return { ok: false, error: 'not_image' }
  if (decoded.width < MIN_SIDE || decoded.height < MIN_SIDE) {
    decoded.close()
    return { ok: false, error: 'too_small' }
  }
  return { ok: true, image: { kind, ...decoded } }
}

async function decode(file: File): Promise<{ width: number; height: number; source: CanvasImageSource; close: () => void } | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      let bitmap: ImageBitmap
      try {
        bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      } catch {
        bitmap = await createImageBitmap(file) // older browsers do not know the option
      }
      return { width: bitmap.width, height: bitmap.height, source: bitmap, close: () => bitmap.close() }
    } catch {
      return null
    }
  }
  if (typeof Image === 'undefined' || typeof URL === 'undefined') return null
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return { width: img.naturalWidth, height: img.naturalHeight, source: img, close: () => URL.revokeObjectURL(url) }
  } catch {
    URL.revokeObjectURL(url)
    return null
  }
}

/** Step 3a: draw the chosen square, scaled to 256x256, onto a canvas (also used for the live preview). */
export function drawSquare(canvas: HTMLCanvasElement, image: Pick<Inspected, 'source' | 'width' | 'height'>, crop: Crop, size = OUTPUT_SIZE): boolean {
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return false
  const { sx, sy, side } = cropRect(image.width, image.height, crop)
  ctx.fillStyle = '#ffffff' // transparent areas of a PNG become white
  ctx.fillRect(0, 0, size, size)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image.source, sx, sy, side, side, 0, 0, size, size)
  return true
}

export interface Encoded {
  blob: Blob
  type: 'image/webp' | 'image/jpeg'
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b), type, quality)
    } catch {
      resolve(null)
    }
  })
}

/** Step 3b: encode the canvas as WebP, or JPEG when the browser cannot write WebP. Nothing else from the original survives. */
export async function encodeAvatar(canvas: HTMLCanvasElement): Promise<Result<{ encoded: Encoded }>> {
  const webp = await toBlob(canvas, 'image/webp', 0.85)
  if (webp && webp.type === 'image/webp' && webp.size > 0 && webp.size <= MAX_OUTPUT_BYTES) return { ok: true, encoded: { blob: webp, type: 'image/webp' } }
  const jpeg = await toBlob(canvas, 'image/jpeg', 0.88)
  if (jpeg && jpeg.type === 'image/jpeg' && jpeg.size > 0 && jpeg.size <= MAX_OUTPUT_BYTES) return { ok: true, encoded: { blob: jpeg, type: 'image/jpeg' } }
  return { ok: false, error: 'encode_failed' }
}

/** The whole pipeline in one call (the upload screen uses the pieces so it can show a live preview). */
export async function processAvatar(file: File, crop: Crop = DEFAULT_CROP): Promise<Result<{ encoded: Encoded }>> {
  const inspected = await inspectFile(file)
  if (!inspected.ok) return inspected
  try {
    if (typeof document === 'undefined') return { ok: false, error: 'no_canvas' }
    const canvas = document.createElement('canvas')
    if (!drawSquare(canvas, inspected.image, crop)) return { ok: false, error: 'no_canvas' }
    return await encodeAvatar(canvas)
  } finally {
    inspected.image.close()
  }
}
