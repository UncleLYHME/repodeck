/* The Home banner: a pixel-art coast whose light follows the time of day.

Layers from data/hero/<phase>/ are drawn with nearest-neighbour scaling so pixels stay crisp.
Motion is slow and stepped in whole art pixels: clouds drift, stars twinkle and the lighthouse
beam pulses. A change of phase cross-fades. Motion stops while the banner is off screen, when
the system asks for reduced motion, or when "Animated Banner" is off in Preferences.
*/

import { useEffect, useRef } from 'react'
import { phaseFor, type Phase } from '@shared/time'

const urls = import.meta.glob('@data/hero/*/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
const LAYERS = ['sky', 'sky2', 'clouds', 'beam', 'fg'] as const
type Layer = (typeof LAYERS)[number]

export const ART_W = 480
export const ART_H = 118
const TICK_MS = 500
const DRIFT_MS = 1500 // per art pixel of cloud drift
const BEAM_STEPS = [1.0, 0.85, 0.6, 0.4, 0.6, 0.85] // a slow sweep, one step per tick
const FADE_MS = 2500

const images = new Map<string, HTMLImageElement>()
function image(phase: Phase, layer: Layer): HTMLImageElement | null {
  const key = `${phase}/${layer}`
  let img = images.get(key)
  if (!img) {
    const url = Object.entries(urls).find(([path]) => path.endsWith(`/hero/${phase}/${layer}.png`))?.[1]
    if (!url) return null
    img = new Image()
    img.src = url
    images.set(key, img)
  }
  return img.complete && img.naturalWidth ? img : null
}

export function Hero({ motion, onPhase }: { motion: boolean; onPhase?: (p: Phase) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const el = canvas.current!
    const ctx = el.getContext('2d')!
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    const moving = () => motion && !reduced.matches
    const start = performance.now()
    let phase = phaseFor(new Date().getHours())
    let previous: Phase | null = null
    let fadeStart = 0
    let twinkle = false
    let beam = 0
    let frame = 0
    for (const p of [phase]) for (const l of LAYERS) image(p, l)?.decode?.()

    const layer = (p: Phase, l: Layer, x: number, y: number, scale: number, alpha = 1) => {
      const img = image(p, l)
      if (!img) return
      ctx.globalAlpha = alpha
      ctx.drawImage(img, x, y, ART_W * scale, ART_H * scale)
    }
    const scene = (p: Phase, x0: number, y0: number, scale: number, alpha: number) => {
      layer(p, twinkle ? 'sky2' : 'sky', x0, y0, scale, alpha)
      const off = (moving() ? Math.floor((performance.now() - start) / DRIFT_MS) % ART_W : 0) * scale // clouds wrap: two copies
      layer(p, 'clouds', x0 - off, y0, scale, alpha)
      layer(p, 'clouds', x0 - off + ART_W * scale, y0, scale, alpha)
      layer(p, 'beam', x0, y0, scale, alpha * (moving() ? BEAM_STEPS[beam] : 1))
      layer(p, 'fg', x0, y0, scale, alpha)
    }
    const draw = () => {
      frame = 0
      const dpr = window.devicePixelRatio || 1
      const w = el.clientWidth
      const h = el.clientHeight
      if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
        el.width = Math.round(w * dpr)
        el.height = Math.round(h * dpr)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.imageSmoothingEnabled = false
      const scale = Math.max(w / ART_W, h / ART_H) // cover, like a background image
      const x0 = (w - ART_W * scale) / 2
      const y0 = (h - ART_H * scale) / 2
      ctx.clearRect(0, 0, w, h)
      const fade = previous ? Math.min(1, (performance.now() - fadeStart) / FADE_MS) : 1
      if (previous) scene(previous, x0, y0, scale, 1)
      scene(phase, x0, y0, scale, previous ? fade : 1)
      ctx.globalAlpha = 1
      if (previous && fade < 1) frame = requestAnimationFrame(draw)
      else previous = null
    }
    const redraw = () => {
      if (!frame) frame = requestAnimationFrame(draw)
    }

    const tick = setInterval(() => {
      if (!moving()) return
      if (Math.random() < 0.3) twinkle = !twinkle
      beam = (beam + 1) % BEAM_STEPS.length
      redraw()
    }, TICK_MS)
    const phaseCheck = setInterval(() => {
      const next = phaseFor(new Date().getHours())
      if (next === phase) return
      previous = moving() ? phase : null
      phase = next
      fadeStart = performance.now()
      onPhase?.(next)
      redraw()
    }, 60_000)
    const resize = new ResizeObserver(redraw)
    resize.observe(el)
    // images arrive asynchronously the first time
    const pending = LAYERS.map((l) => images.get(`${phase}/${l}`)).filter((img): img is HTMLImageElement => !!img && !img.complete)
    for (const img of pending) img.addEventListener('load', redraw, { once: true })
    redraw()
    return () => {
      clearInterval(tick)
      clearInterval(phaseCheck)
      resize.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [motion, onPhase])

  return <canvas ref={canvas} className="absolute inset-0 h-full w-full" aria-hidden="true" />
}
