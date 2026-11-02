import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Account, Quota } from '../types'

const limits = atom({ plugin: 'quota-ring', key: 'limits' } as const, [] as Quota[])
// Ticks every 30s so the countdown in the middle moves without a new reply.
const now = atom({ plugin: 'quota-ring', key: 'now' } as const, 0)
const account = atom({ plugin: 'quota-ring', key: 'account' } as const, {
  checked: false,
  expiresAt: null,
} as Account)

const API = 'https://api.anthropic.com/api/oauth'
// The account-wide figures, the same /usage reads; a reply's own reading still lands in between.
const PULL_EVERY = 5 * 60_000

const RING = 26
const WIDTH = 248
const OUTER_R = 11.5
const INNER_R = 8
const STROKE = 2.2
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

const pick = (list: Quota[], kind: string) => list.find(q => q.kind === kind)

const left = (q: Quota | undefined) => (q === undefined ? undefined : Math.min(100, Math.max(0, 100 - q.percentUsed)))

// Colored by what is left: 75%+ green, 50%+ yellow, 25%+ orange, below red.
const tone = (rest: number | undefined) =>
  rest === undefined ? 'mute' : rest >= 75 ? 'ok' : rest >= 50 ? 'mid' : rest >= 25 ? 'low' : 'bad'

type Left = { h: number; m: number }

const remaining = (iso: string | undefined, t: number): Left | undefined => {
  if (iso === undefined || t === 0) return undefined
  const minutes = Math.ceil(Math.max(0, Date.parse(iso) - t) / 60000)
  return { h: Math.floor(minutes / 60), m: minutes % 60 }
}

const clockText = (r: Left | undefined) => (r === undefined ? '--' : `${r.h}:${String(r.m).padStart(2, '0')}`)

const pct = (rest: number | undefined) => (rest === undefined ? '--' : `${Math.round(rest)}%`)

// The profile has no end date: a monthly Stripe subscription renews on the day it was created.
const nextRenewal = (createdIso: string, t: number): string | null => {
  const created = new Date(createdIso)
  if (Number.isNaN(created.getTime())) return null
  const day = created.getDate()
  for (let k = 1; k < 1200; k++) {
    const y = created.getFullYear() + Math.floor((created.getMonth() + k) / 12)
    const m = (created.getMonth() + k) % 12
    const last = new Date(y, m + 1, 0).getDate()
    const at = new Date(y, m, Math.min(day, last), created.getHours(), created.getMinutes())
    if (at.getTime() > t) return at.toISOString()
  }
  return null
}

const dayText = (iso: string) => {
  const d = new Date(iso)
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`
}

const dayPlain = (iso: string) => {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// The ring holds what is left, like a fuel gauge: full and green when fresh.
const arc = (r: number, rest: number | undefined) => {
  if (rest === undefined || rest <= 0) return ''
  const len = 2 * Math.PI * r
  const c = RING / 2
  return `<circle class="s-${tone(rest)}" cx="${c}" cy="${c}" r="${r}" fill="none" stroke-width="${STROKE}" stroke-linecap="round" stroke-dasharray="${((len * rest) / 100).toFixed(2)} ${len.toFixed(2)}" transform="rotate(-90 ${c} ${c})"/>`
}

const metric = (label: string, rest: number | undefined, gap: number) =>
  `<tspan dx="${gap}" class="label">${label}</tspan><tspan dx="4" class="value f-${tone(rest)}">${pct(rest)}</tspan>`

const svg = (five: number | undefined, week: number | undefined, center: string, renew: string) => {
  const c = RING / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${RING}" viewBox="0 0 ${WIDTH} ${RING}">
<style>
text{font-family:ui-rounded,"SF Pro Rounded",-apple-system,BlinkMacSystemFont,sans-serif}
.track{stroke:rgba(0,0,0,.08)}
.center{fill:#57606a;font-size:5.2px;font-weight:700}
.label{fill:#8c959f;font-size:7.5px;font-weight:600;letter-spacing:1.1px}
.value{font-size:12px;font-weight:700;font-variant-numeric:tabular-nums}
.date{fill:#57606a;font-size:11px;font-weight:600;letter-spacing:.3px}
.dot{fill:#d0d7de}
.s-ok{stroke:#1a7f37}.s-mid{stroke:#bf8700}.s-low{stroke:#d1580a}.s-bad{stroke:#cf222e}
.f-ok{fill:#1a7f37}.f-mid{fill:#bf8700}.f-low{fill:#d1580a}.f-bad{fill:#cf222e}.f-mute{fill:#8c959f}
@media (prefers-color-scheme: dark){
.track{stroke:rgba(255,255,255,.12)}
.center{fill:#c9d1d9}.label{fill:#6e7681}.date{fill:#adbac7}.dot{fill:#3d444d}
.s-ok{stroke:#3fb950}.s-mid{stroke:#e3b341}.s-low{stroke:#f0883e}.s-bad{stroke:#f85149}
.f-ok{fill:#3fb950}.f-mid{fill:#e3b341}.f-low{fill:#f0883e}.f-bad{fill:#f85149}.f-mute{fill:#6e7681}
}
</style>
<circle class="track" cx="${c}" cy="${c}" r="${OUTER_R}" fill="none" stroke-width="${STROKE}"/>
<circle class="track" cx="${c}" cy="${c}" r="${INNER_R}" fill="none" stroke-width="${STROKE}"/>
${arc(OUTER_R, week)}
${arc(INNER_R, five)}
<text class="center" x="${c}" y="${c}" text-anchor="middle" dominant-baseline="central">${center}</text>
<text x="${RING + 8}" y="${c}" dominant-baseline="central">${metric('5H', five, 0)}<tspan dx="7" class="dot">•</tspan>${metric('7D', week, 7)}<tspan dx="7" class="dot">•</tspan><tspan dx="7" class="label">EXP</tspan><tspan dx="4" class="date">${renew}</tspan></text>
</svg>`
}

const authed = async ($: EngineInterface, path: string) => {
  const auth = await $.session.authorize()
  if (auth?.kind !== 'bearer') return undefined
  return $.http.fetch(`${API}/${path}`, { auth: auth.handle, headers: { 'anthropic-beta': 'oauth-2025-04-20' } })
}

type Window = { utilization?: number | null; resets_at?: string | null } | null | undefined

const pullUsage = async ($: EngineInterface) => {
  try {
    const res = await authed($, 'usage')
    if (!res?.ok) return
    const body = JSON.parse(res.text) as Record<string, Window>
    const fresh: Quota[] = []
    for (const kind of ['five_hour', 'seven_day']) {
      const w = body[kind]
      if (typeof w?.utilization !== 'number') continue
      fresh.push({ kind, percentUsed: w.utilization, ...(w.resets_at ? { resetsAt: w.resets_at } : {}) })
    }
    if (fresh.length > 0) await update($, limits, () => fresh)
  } catch {
    // Keep the last reading.
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const usage = await $.session.usage()
    if (usage.rateLimits.length > 0) await update($, limits, () => usage.rateLimits)
    const t = await $.clock.now()
    await update($, now, () => t)
    $.clock.every(30_000, () => {
      void $.clock.now().then(t => update($, now, () => t))
    })

    void pullUsage($)
    $.clock.every(PULL_EVERY, () => void pullUsage($))

    void (async () => {
      let expiresAt: string | null = null
      try {
        const res = await authed($, 'profile')
        if (res?.ok) {
          const created = (JSON.parse(res.text) as { organization?: { subscription_created_at?: string } })
            .organization?.subscription_created_at
          if (created) expiresAt = nextRenewal(created, await $.clock.now())
        }
      } catch {
        // No profile: EXP shows --.
      }
      await update($, account, () => ({ checked: true, expiresAt }))
    })()

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits') && e.rateLimits.length > 0) {
      await update($, limits, () => e.rateLimits)
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const list = await read($, limits)
    const t = await read($, now)
    const acct = await read($, account)
    const five = pick(list, 'five_hour')
    const week = pick(list, 'seven_day')
    const fiveLeft = left(five)
    const weekLeft = left(week)
    const expires = acct.expiresAt
    const alt = `5H ${pct(fiveLeft)} left, 7D ${pct(weekLeft)} left, renews ${expires ? dayPlain(expires) : '--'}`
    const ui = $.ui.resolve(e)

    if (e.surface === 'desktop' && 'Svg' in ui) {
      const { Svg } = ui
      return (
        <Svg
          source={svg(
            fiveLeft,
            weekLeft,
            five ? clockText(remaining(five.resetsAt, t)) : '--',
            !acct.checked ? '…' : expires ? dayText(expires) : '--',
          )}
          alt={alt}
          width={WIDTH}
          height={RING}
        />
      )
    }

    const { Text } = ui
    return <Text dimColor>{alt}</Text>
  })
}
