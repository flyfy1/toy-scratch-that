// Card geometry (spec 3.1, 3.4). Everything on the card is in U; CW = 20 U, CH = 27.6 U.
import { DEG } from './util'

export const CARD_W_U = 20
export const CARD_H_U = 27.6
export const REST_ROT = -2 * DEG

export interface Layout {
  w: number
  h: number
  dpr: number
  CW: number
  CH: number
  /** css px per U */
  U: number
  /** device px per U (bake resolution) */
  K: number
  cx: number
  cy: number
}

export function computeLayout(w: number, h: number, dpr: number): Layout {
  const CW = Math.min(0.86 * w, (0.6 * h) / 1.38, 460)
  const U = CW / CARD_W_U
  return { w, h, dpr, CW, CH: 1.38 * CW, U, K: U * dpr, cx: w / 2, cy: 0.47 * h }
}

/** Where the card is right now (it slides in and out). */
export interface CardPose {
  x: number
  y: number
  rot: number
}

export interface RegionDef {
  id: 'main' | 'prize' | 'void'
  x: number
  y: number
  w: number
  h: number
}

export const REGIONS: RegionDef[] = [
  { id: 'main', x: 1.5, y: 7.0, w: 17, h: 11.6 },
  { id: 'prize', x: 1.5, y: 19.4, w: 17, h: 2.6 },
  { id: 'void', x: 11.5, y: 23.3, w: 7, h: 1.6 },
]

/** Screen (css px) to card space (U). */
export function toCard(L: Layout, p: CardPose, sx: number, sy: number): [number, number] {
  const dx = sx - p.x
  const dy = sy - p.y
  const c = Math.cos(-p.rot)
  const s = Math.sin(-p.rot)
  return [(dx * c - dy * s + L.CW / 2) / L.U, (dx * s + dy * c + L.CH / 2) / L.U]
}

/** Card space (U) to screen (css px). */
export function toScreen(L: Layout, p: CardPose, ux: number, uy: number): [number, number] {
  const x = ux * L.U - L.CW / 2
  const y = uy * L.U - L.CH / 2
  const c = Math.cos(p.rot)
  const s = Math.sin(p.rot)
  return [p.x + x * c - y * s, p.y + x * s + y * c]
}
