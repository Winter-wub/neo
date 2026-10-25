export interface Clock {
  now(): number
  /** Run `fn` every `ms`; returns the cancel function. */
  every(ms: number, fn: () => void): () => void
}

export const systemClock: Clock = {
  now: () => Date.now(),
  every(ms, fn) {
    const timer = setInterval(fn, ms)
    return () => clearInterval(timer)
  },
}
