import { BrowserWindow, BrowserWindowConstructorOptions } from 'electron'
import * as path from 'path'

import { allowOverlaying } from './overlaying'
import { attachWindowStoreListener } from './store-listeners'
import { WindowFrameName, OverlayingProps, isWindows } from '@portal-windows/core'

export class GenericPortalWindow {
  focused: boolean = false
  window: BrowserWindow | null = null

  init = (
    eventOptions: BrowserWindowConstructorOptions,
    frameName: WindowFrameName,
    overlayingProps?: OverlayingProps,
    overrideOptions?: BrowserWindowConstructorOptions
  ) => {
    if (this.window) {
      this.window.destroy()
      this.window = null
    }

    const options: BrowserWindowConstructorOptions = {
      ...eventOptions,

      width: 364,
      height: 400,
      minHeight: 0,
      minWidth: 0,

      backgroundColor: '#00000000',
      transparent: true, // Can cause issues on Windows when combined with `minimizable`
      frame: false,
      show: false,
      acceptFirstMouse: true,

      resizable: process.platform == 'linux',
      hasShadow: false,
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: -100, y: 0 },

      minimizable: isWindows, // Disabling can cause issues on Windows
      maximizable: false,
      closable: true,
      fullscreenable: false,
      skipTaskbar: true,

      webPreferences: {
        preload: path.join(__dirname, `preload.js`),
        nodeIntegration: false,
      },

      ...(overrideOptions || {}),
    }

    let win = new BrowserWindow(options)

    if (overlayingProps) {
      allowOverlaying(win, overlayingProps)
    }

    win.webContents.on('did-finish-load', () => {
      win.setBackgroundColor('#00000000')
    })

    attachWindowStoreListener(win, frameName, win)

    this.window = win
    return win
  }
}
