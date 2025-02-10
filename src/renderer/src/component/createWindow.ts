import { GenericLogger, isMac, WindowInfoSetMessage, WindowIpcTopic } from '@portal-windows/core'
import { PortalConstructorProps } from './constructor'

import { windowApi } from '../stores/windowStore'

export const createPortalWindow = (props: PortalConstructorProps, _log: GenericLogger): Window => {
  const { frameName, initialMessage, windowOptionsString } = props

  // Helper function to clean up window references
  const cleanupWindow = (win?: Window) => {
    if (win && !win.closed) {
      try {
        win.close()
      } catch (e) {
        _log.info('Failed to close window:', e)
      }
    }
    delete windowApi.getState().windows[frameName]
    props.onClose?.()
  }

  // Clean up any existing window first
  const existingWindow = windowApi.getState().windows[frameName]
  if (existingWindow) {
    cleanupWindow(existingWindow)
  }

  // Create new window
  const win = window.open('', frameName, windowOptionsString || '')
  if (!win) {
    throw 'Failed to create window'
  }

  // Set up window properties
  if (isMac) {
    win.location.href = `about:blank?title=${encodeURIComponent(frameName)}`
  }
  win.document.title = frameName

  // Wait for window to be ready
  const initializeWindow = async () => {
    // Check if window has required APIs
    if (!win.portal?.electronPublish || !win.portal?.electronSubscribe) {
      cleanupWindow(win)
      throw `Window ${frameName} does not have required APIs`
    }

    // Store window reference
    windowApi.getState().windows[frameName] = win

    // Set up close handler
    win.onclose = () => {
      cleanupWindow(win)
    }

    try {
      // Subscribe window
      await windowApi.getState().actions.subscribeWindow(frameName, win)
      _log.debug('Subscribed window:', frameName)

      // Initialize window state
      if (!win.closed) {
        const msg: WindowInfoSetMessage = {
          ...initialMessage,
          zoom: 1,
          frameName: frameName,
        }
        await win.portal.electronPublish(WindowIpcTopic.SET_WINDOW_INFO, {
          ...msg,
          onceId: 'id_' + JSON.stringify(msg, null, ''),
        } as WindowInfoSetMessage)
      }
    } catch (e) {
      _log.info('Failed to initialize window:', e)
      cleanupWindow(win)
      throw e
    }
  }

  // Initialize window and handle errors
  initializeWindow().catch((e) => {
    _log.info('Window initialization failed:', e)
    cleanupWindow(win)
  })

  return win
}
