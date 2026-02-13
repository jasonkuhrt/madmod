export function createDebouncer(ms: number, fn: () => Promise<void>): {
  trigger: () => void
  cancel: () => void
} {
  let timer: ReturnType<typeof setTimeout> | null = null
  let running = false

  const trigger = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      if (running) return
      running = true
      fn().finally(() => {
        running = false
      })
    }, ms)
  }

  const cancel = (): void => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  return { trigger, cancel }
}
