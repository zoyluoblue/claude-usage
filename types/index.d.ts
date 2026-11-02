export type Quota = { kind: string; percentUsed: number; resetsAt?: string }

// `checked` false until the profile request finished; `expiresAt` null when it held no date.
export type Account = { checked: boolean; expiresAt: string | null }

declare module 'claude-code' {
  interface PluginState {
    'quota-ring': { limits: Quota[]; now: number; account: Account }
  }
}
