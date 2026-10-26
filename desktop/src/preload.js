// Мост между страницей и оболочкой: только то, что странице реально нужно.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('deploydock', {
  desktop: true,
  pickFolder: defaultPath => ipcRenderer.invoke('dd:pickFolder', defaultPath ?? null),
  pickProject: defaultPath => ipcRenderer.invoke('dd:pickProject', defaultPath ?? null),
  openPath: p => ipcRenderer.invoke('dd:openPath', p),
  openLogs: () => ipcRenderer.invoke('dd:openLogs'),
  info: () => ipcRenderer.invoke('dd:info'),
  titlebar: () => ipcRenderer.invoke('dd:titlebar'),
  retry: () => ipcRenderer.invoke('dd:retry'),
})
