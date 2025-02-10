import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

import {
  deepCompareIntersection,
  Display,
  DisplayInfoUpdateMessage,
  MouseInfoUpdateMessage,
  loggerWithPrefix,
  SystemInfoUpdateMessage,
  WindowFrameName,
  WindowInfoRequestMessage,
  WindowInfoSetMessage,
  WindowInfoUpdateMessage,
  WindowIpcTopic,
} from '@portal-windows/core'

// Store state interface
export interface WindowStore {
  windows: { [frameName in WindowFrameName]?: Window }
  windowToFrameName: { [windowId: string]: WindowFrameName }
  windowInfo: { [frameName in WindowFrameName]?: WindowInfoUpdateMessage }
  displayInfo: { [id: number]: Display }
  primaryDisplayId: number | undefined
  mouseInfo: MouseInfoUpdateMessage | undefined
  systemInfo: SystemInfoUpdateMessage | undefined
  actions: WindowActions
}

const DEBUG = false
const SHOW_DEV = true
const logger = loggerWithPrefix('[windowStore]')

class WindowActions {
  private rootFrameName: WindowFrameName | null = null

  constructor(
    private set: (fn: (state: WindowStore) => Partial<WindowStore> | WindowStore) => void,
    private get: () => WindowStore
  ) {}

  init = (frameName: WindowFrameName) => {
    if (SHOW_DEV) {
      // @ts-ignore
      window['windowStore'] = this
    }

    this.rootFrameName = frameName
    logger.info(`WINDOWSTORE —— initializing ${frameName}`)
    this.subscribeWindow(frameName, window)

    window.portal.electronUnsubscribe(WindowIpcTopic.UPDATE_DISPLAY_INFO)
    window.portal.electronUnsubscribe(WindowIpcTopic.UPDATE_MOUSE_INFO)
    window.portal.electronUnsubscribe(WindowIpcTopic.UPDATE_SYSTEM_INFO)

    setTimeout(() => {
      window.portal.electronSubscribe(
        WindowIpcTopic.UPDATE_DISPLAY_INFO,
        (_, value: DisplayInfoUpdateMessage) => {
          if (DEBUG) logger.debug(`received display update on ${frameName}:`, value)
          this.set((state) => ({
            ...state,
            displayInfo: value.displays.reduce(
              (prev, curr) => ({
                ...prev,
                [curr.id]: curr,
              }),
              {} as { [id: number]: Display }
            ),
            primaryDisplayId: value.primaryDisplayId,
          }))
        }
      )

      if (DEBUG) logger.info(`request display info from ${frameName}`)
      window.portal.electronPublish(WindowIpcTopic.REQUEST_DISPLAY_INFO)

      window.portal.electronSubscribe(
        WindowIpcTopic.UPDATE_MOUSE_INFO,
        (_, value: MouseInfoUpdateMessage) => {
          if (DEBUG) logger.debug(`received mouse update on ${frameName}:`, value)
          this.set((state) => ({ ...state, mouseInfo: value }))
        }
      )

      if (DEBUG) logger.info(`request mouse info from ${frameName}`)
      window.portal.electronPublish(WindowIpcTopic.REQUEST_MOUSE_INFO)

      window.portal.electronSubscribe(
        WindowIpcTopic.UPDATE_SYSTEM_INFO,
        (_, value: SystemInfoUpdateMessage) => {
          if (DEBUG) logger.debug(`received system update on ${frameName}:`, value)
          this.set((state) => ({ ...state, systemInfo: value }))
        }
      )

      if (DEBUG) logger.info(`request system info from ${frameName}`)
      window.portal.electronPublish(WindowIpcTopic.REQUEST_SYSTEM_INFO)
    }, 1000)
  }

  setWindowInfo = (
    winOrFrameName: WindowFrameName | Window,
    update: Partial<WindowInfoSetMessage>
  ) => {
    const usingFrameName = typeof winOrFrameName === 'string'
    let win: Window | undefined
    let frameName: WindowFrameName

    if (usingFrameName) {
      frameName = winOrFrameName as WindowFrameName
      win = this.get().windows[frameName]
    } else {
      frameName = ((winOrFrameName as Window).name as WindowFrameName) || this.rootFrameName
      win = winOrFrameName as Window
    }

    if (!win) {
      logger.error(`window ${frameName} deallocated early`)
      return
    }

    if (DEBUG) logger.info(`sending update to ${frameName}:`, update)
    win.portal.electronPublish(WindowIpcTopic.SET_WINDOW_INFO, { ...update, frameName })
  }

  private updateWindowInfo(
    frameName: WindowFrameName,
    info: Partial<WindowInfoUpdateMessage>
  ): boolean {
    const state = this.get()
    const existingInfo = state.windowInfo[frameName]

    if (existingInfo && deepCompareIntersection(existingInfo, info)) {
      return false
    }

    const newInfo = { ...existingInfo, ...info }
    this.set((state) => ({
      ...state,
      windowInfo: { ...state.windowInfo, [frameName]: newInfo },
    }))

    return true
  }

  subscribeWindow = (frameName: WindowFrameName, win: Window, proxied?: boolean) => {
    if (!win) return
    if (DEBUG) logger.info(`subscribed to changes from ${frameName}. Closed: ${win.closed}`)

    if (!proxied) {
      this.set((state) => ({
        ...state,
        windows: { ...state.windows, [frameName]: win },
      }))
      win.portal.electronUnsubscribe(WindowIpcTopic.UPDATE_WINDOW_INFO)
    }

    const requestInfo = () => {
      const requestMsg: WindowInfoRequestMessage = {
        frameName: frameName,
      }
      win.portal.electronPublish(WindowIpcTopic.REQUEST_WINDOW_INFO, requestMsg)
    }

    setTimeout(() => {
      if (!win || win.closed) {
        logger.error(`Window closed during subscribeWindow: ${frameName}`)
        return
      }

      if (!proxied) {
        win.portal.electronSubscribe(
          WindowIpcTopic.UPDATE_WINDOW_INFO,
          (_, value: WindowInfoUpdateMessage) => {
            if (DEBUG) logger.debug(`received update to ${frameName} (${value.frameName}):`, value)
            const applyUpdate = this.updateWindowInfo(value.frameName, value)
            if (applyUpdate && DEBUG) logger.debug(`applied update to ${value.frameName}:`, value)
          }
        )

        win.addEventListener('resize', requestInfo)
      }

      if (DEBUG) logger.info(`request info from ${frameName}`)
      requestInfo()
    }, 1000)
  }

  pingWindow = async (frameName: WindowFrameName): Promise<void> => {
    return new Promise<void>((resolve, reject) => {
      const win = this.get().windows[frameName]
      if (!win) {
        reject('no valid window')
        return
      }

      const pong = () => {
        resolve()
        win.portal.electronUnsubscribe(WindowIpcTopic.UPDATE_WINDOW_INFO, pong)
      }
      win.portal.electronSubscribe(WindowIpcTopic.UPDATE_WINDOW_INFO, pong)

      setTimeout(() => {
        if (!win || win.closed) {
          reject(`Window closed during subscribeWindow: ${frameName}`)
          return
        }

        const msg: WindowInfoRequestMessage = { frameName: frameName }
        win.portal.electronPublish(WindowIpcTopic.REQUEST_WINDOW_INFO, msg)
      }, 1000)

      setTimeout(() => {
        reject('ping timed out')
        win.portal.electronUnsubscribe(WindowIpcTopic.UPDATE_WINDOW_INFO, pong)
      }, 2000)
    })
  }

  requestMousePosition = (win: Window) => {
    win.portal.electronPublish(WindowIpcTopic.REQUEST_MOUSE_INFO)
  }
}

// Create the store with middleware
export const useWindowStore = create<WindowStore>()(
  devtools(
    (set, get) => ({
      windows: {},
      windowToFrameName: {},
      windowInfo: {},
      displayInfo: {},
      primaryDisplayId: undefined,
      mouseInfo: undefined,
      systemInfo: undefined,
      actions: new WindowActions(
        (fn) => set(fn),
        () => get()
      ),
    }),
    {
      name: 'WindowStore',
      enabled: true,
    }
  )
)

// Export the actions singleton
export const windowActions = useWindowStore.getState().actions

// Export the store API
export const windowApi = {
  getState: useWindowStore.getState,
  setState: useWindowStore.setState,
  subscribe: useWindowStore.subscribe,
  destroy: useWindowStore.destroy,
}
