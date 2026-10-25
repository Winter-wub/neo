import { appendFile, mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface RotatingLogOptions {
  file: string
  maxBytes?: number
  /** How many rotated files (`file.1` … `file.N`) to keep besides the live one. */
  keep?: number
}

/** Append-only log that rolls `daemon.log` → `.1` → `.2` → `.3` once a line would pass `maxBytes`. */
export class RotatingLog {
  static readonly DEFAULT_MAX_BYTES = 5 * 1024 * 1024
  static readonly DEFAULT_KEEP = 3

  readonly #file: string
  readonly #maxBytes: number
  readonly #keep: number
  #size: number | undefined
  #queue: Promise<unknown> = Promise.resolve()

  constructor({ file, maxBytes = RotatingLog.DEFAULT_MAX_BYTES, keep = RotatingLog.DEFAULT_KEEP }: RotatingLogOptions) {
    this.#file = file
    this.#maxBytes = maxBytes
    this.#keep = keep
  }

  /** Serialised so concurrent appends can't interleave a rotation. */
  append(text: string) {
    const next = this.#queue.then(() => this.#write(text))
    this.#queue = next.catch(() => {})
    return next
  }

  async #write(text: string) {
    const bytes = Buffer.byteLength(text)
    this.#size ??= await stat(this.#file).then(s => s.size, () => 0)
    if (this.#size > 0 && this.#size + bytes > this.#maxBytes) {
      await this.#rotate()
      this.#size = 0
    }
    await mkdir(dirname(this.#file), { recursive: true })
    await appendFile(this.#file, text)
    this.#size += bytes
  }

  async #rotate() {
    await rm(`${this.#file}.${this.#keep}`, { force: true })
    for (let n = this.#keep - 1; n >= 1; n--) {
      await rename(`${this.#file}.${n}`, `${this.#file}.${n + 1}`).catch(() => {})
    }
    await rename(this.#file, `${this.#file}.1`).catch(() => {})
  }
}
