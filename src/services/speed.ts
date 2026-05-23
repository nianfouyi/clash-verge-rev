import { cmdTestProxySpeed } from '@/services/cmds'
import { debugLog } from '@/utils/debug'

const hashKey = (name: string, group: string) => `${group ?? ''}::${name}`

export interface SpeedUpdate {
  speed: number
  updatedAt: number
}

const CACHE_TTL = 30 * 60 * 1000
const DEFAULT_SPEED_URL = 'https://speed.cloudflare.com/__down?bytes=10000000'
const DEFAULT_TIMEOUT = 30000

class SpeedManager {
  private cache = new Map<string, SpeedUpdate>()
  private urlMap = new Map<string, string>()

  private listenerMap = new Map<string, (update: SpeedUpdate) => void>()
  private groupListenerMap = new Map<string, () => void>()

  private pendingItemUpdates = new Map<string, SpeedUpdate[]>()
  private pendingGroupUpdates = new Set<string>()
  private itemFlushScheduled = false
  private groupFlushScheduled = false

  private scheduleOnNextFrame(run: () => void): void {
    if (typeof window !== 'undefined') {
      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(run)
        return
      }
      if (typeof window.setTimeout === 'function') {
        window.setTimeout(run, 0)
        return
      }
    }
    Promise.resolve().then(run)
  }

  private scheduleItemFlush() {
    if (this.itemFlushScheduled) return
    this.itemFlushScheduled = true

    this.scheduleOnNextFrame(() => {
      this.itemFlushScheduled = false
      const updates = this.pendingItemUpdates
      this.pendingItemUpdates = new Map()

      updates.forEach((queue, key) => {
        const listener = this.listenerMap.get(key)
        if (!listener) return

        queue.forEach((update) => {
          try {
            listener(update)
          } catch (error) {
            console.error(
              `[SpeedManager] Failed to notify listener: ${key}`,
              error,
            )
          }
        })
      })
    })
  }

  private scheduleGroupFlush() {
    if (this.groupFlushScheduled) return
    this.groupFlushScheduled = true

    this.scheduleOnNextFrame(() => {
      this.groupFlushScheduled = false
      const groups = this.pendingGroupUpdates
      this.pendingGroupUpdates = new Set()

      groups.forEach((group) => {
        const listener = this.groupListenerMap.get(group)
        if (!listener) return
        try {
          listener()
        } catch (error) {
          console.error(
            `[SpeedManager] Failed to notify group listener: ${group}`,
            error,
          )
        }
      })
    })
  }

  private queueGroupNotification(group: string) {
    this.pendingGroupUpdates.add(group)
    this.scheduleGroupFlush()
  }

  setUrl(group: string, url: string) {
    debugLog(
      `[SpeedManager] Set speed test URL for group: ${group}, URL: ${url}`,
    )
    this.urlMap.set(group, url)
  }

  getUrl(group: string) {
    const url = this.urlMap.get(group)
    return url || DEFAULT_SPEED_URL
  }

  setListener(
    name: string,
    group: string,
    listener: (update: SpeedUpdate) => void,
  ) {
    const key = hashKey(name, group)
    this.listenerMap.set(key, listener)
  }

  removeListener(name: string, group: string) {
    const key = hashKey(name, group)
    this.listenerMap.delete(key)
  }

  setGroupListener(group: string, listener: () => void) {
    this.groupListenerMap.set(group, listener)
  }

  removeGroupListener(group: string) {
    this.groupListenerMap.delete(group)
  }

  setSpeed(name: string, group: string, speed: number): SpeedUpdate {
    const key = hashKey(name, group)
    debugLog(
      `[SpeedManager] Set speed, proxy: ${name}, group: ${group}, speed: ${speed}`,
    )

    const update: SpeedUpdate = {
      speed,
      updatedAt: Date.now(),
    }

    this.cache.set(key, update)

    const queue = this.pendingItemUpdates.get(key)
    if (queue) {
      queue.push(update)
    } else {
      this.pendingItemUpdates.set(key, [update])
    }
    this.scheduleItemFlush()

    return update
  }

  getSpeedUpdate(name: string, group: string) {
    const key = hashKey(name, group)
    const entry = this.cache.get(key)
    if (!entry) return undefined

    if (Date.now() - entry.updatedAt > CACHE_TTL) {
      this.cache.delete(key)
      return undefined
    }

    return { ...entry }
  }

  getSpeed(name: string, group: string) {
    const update = this.getSpeedUpdate(name, group)
    return update ? update.speed : -1
  }

  async checkSpeed(
    name: string,
    group: string,
    timeout: number = DEFAULT_TIMEOUT,
  ): Promise<SpeedUpdate> {
    debugLog(
      `[SpeedManager] Start speed test, proxy: ${name}, group: ${group}, timeout: ${timeout}ms`,
    )

    // Set testing state
    this.setSpeed(name, group, -2)

    const startTime = Date.now()

    try {
      const url = this.getUrl(group)
      debugLog(`[SpeedManager] Testing speed, proxy: ${name}, URL: ${url}`)

      const speed = await cmdTestProxySpeed(name, url, timeout)

      // Ensure minimum 500ms loading animation
      const elapsedTime = Date.now() - startTime
      if (elapsedTime < 500) {
        await new Promise((resolve) => setTimeout(resolve, 500 - elapsedTime))
      }

      debugLog(
        `[SpeedManager] Speed test done, proxy: ${name}, result: ${speed} bytes/s`,
      )
      return this.setSpeed(name, group, speed)
    } catch (error) {
      await new Promise((resolve) => setTimeout(resolve, 500))
      console.error(`[SpeedManager] Speed test error, proxy: ${name}`, error)
      return this.setSpeed(name, group, 0)
    }
  }

  async checkListSpeed(
    nameList: string[],
    group: string,
    timeout: number = DEFAULT_TIMEOUT,
    concurrency = 3,
  ) {
    debugLog(
      `[SpeedManager] Batch speed test start, group: ${group}, count: ${nameList.length}, concurrency: ${concurrency}`,
    )
    const names = nameList.filter(Boolean)
    names.forEach((name) => this.setSpeed(name, group, -2))

    let index = 0
    const startTime = Date.now()
    const listener = this.groupListenerMap.get(group)

    const help = async (): Promise<void> => {
      const currName = names[index++]
      if (!currName) return

      try {
        this.setSpeed(currName, group, -2)

        // Add random delay between requests (except first)
        if (index > 1) {
          await new Promise((resolve) =>
            setTimeout(resolve, Math.random() * 500),
          )
        }

        await this.checkSpeed(currName, group, timeout)
        if (listener) {
          this.queueGroupNotification(group)
        }
      } catch (error) {
        console.error(
          `[SpeedManager] Batch speed test error for proxy: ${currName}`,
          error,
        )
        this.setSpeed(currName, group, 0)
      }

      return help()
    }

    const actualConcurrency = Math.min(concurrency, names.length, 3)
    debugLog(`[SpeedManager] Actual concurrency: ${actualConcurrency}`)

    const promiseList: Promise<void>[] = []
    for (let i = 0; i < actualConcurrency; i++) {
      promiseList.push(help())
    }

    await Promise.all(promiseList)
    const totalTime = Date.now() - startTime
    debugLog(
      `[SpeedManager] Batch speed test done, group: ${group}, total time: ${totalTime}ms`,
    )
  }

  // Format speed to human-readable string
  formatSpeed(speed: number): string {
    if (speed === -1) return '-'
    if (speed === -2) return 'testing'
    if (speed <= 0) return 'Timeout'

    if (speed >= 1024 * 1024) {
      return `${(speed / 1024 / 1024).toFixed(1)} MB/s`
    }
    if (speed >= 1024) {
      return `${(speed / 1024).toFixed(0)} KB/s`
    }
    return `${speed} B/s`
  }

  // Color coding based on speed
  formatSpeedColor(speed: number): string {
    if (speed <= 0) return 'error.main'
    // > 5 MB/s
    if (speed >= 5 * 1024 * 1024) return 'success.main'
    // 1-5 MB/s
    if (speed >= 1024 * 1024) return 'primary.main'
    // < 1 MB/s
    return 'warning.main'
  }
}

export default new SpeedManager()
