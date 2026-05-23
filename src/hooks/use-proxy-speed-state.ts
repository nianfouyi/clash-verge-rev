import { useLockFn } from 'ahooks'
import { useCallback, useEffect, useReducer } from 'react'

import speedManager, { type SpeedUpdate } from '@/services/speed'

const PRESET_PROXY_NAMES = [
  'DIRECT',
  'REJECT',
  'REJECT-DROP',
  'PASS',
  'COMPATIBLE',
]

const identity = (_: SpeedUpdate, next: SpeedUpdate): SpeedUpdate => next

const INITIAL_SPEED: SpeedUpdate = { speed: -1, updatedAt: 0 }

export interface UseProxySpeedState {
  speedState: SpeedUpdate
  speedValue: number
  isPreset: boolean
  timeout: number
  onSpeed: () => Promise<void>
}

export function useProxySpeedState(
  proxy: IProxyItem,
  groupName: string,
): UseProxySpeedState {
  const isPreset = PRESET_PROXY_NAMES.includes(proxy.name)
  const [speedState, setSpeedState] = useReducer(identity, INITIAL_SPEED)
  const timeout = 30000 // 下载测速用 30 秒超时

  useEffect(() => {
    if (isPreset) return
    speedManager.setListener(proxy.name, groupName, setSpeedState)
    return () => {
      speedManager.removeListener(proxy.name, groupName)
    }
  }, [proxy.name, groupName, isPreset])

  const updateSpeed = useCallback(() => {
    if (!proxy) return
    const cachedUpdate = speedManager.getSpeedUpdate(proxy.name, groupName)
    if (cachedUpdate) {
      setSpeedState({ ...cachedUpdate })
      return
    }
    setSpeedState({ speed: -1, updatedAt: 0 })
  }, [proxy, groupName])

  useEffect(() => {
    updateSpeed()
  }, [updateSpeed])

  const onSpeed = useLockFn(async () => {
    setSpeedState({ speed: -2, updatedAt: Date.now() })
    setSpeedState(await speedManager.checkSpeed(proxy.name, groupName, timeout))
  })

  return {
    speedState,
    speedValue: speedState.speed,
    isPreset,
    timeout,
    onSpeed,
  }
}
