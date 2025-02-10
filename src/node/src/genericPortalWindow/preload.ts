import { ipcRenderer } from 'electron'
import { WindowIpcTopic } from '../../../core/src/consts'

export const preload = {
  electronPublish: (msg: WindowIpcTopic, ...args: any[]) => {
    return ipcRenderer.send(msg, ...args)
  },
  electronSubscribe: (msg: WindowIpcTopic, callback: (...args: any[]) => void) => {
    return ipcRenderer.on(msg, callback)
  },
  electronUnsubscribe: (msg: WindowIpcTopic, callback?: (...args: any[]) => void) => {
    if (callback) {
      return ipcRenderer.removeListener(msg, callback)
    }
    return ipcRenderer.removeAllListeners(msg)
  },
}
