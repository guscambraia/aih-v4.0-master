
const { contextBridge, ipcRenderer } = require('electron');

// Expor APIs seguras para o renderer
contextBridge.exposeInMainWorld('electronAPI', {
    // Exemplo de API segura (adicione conforme necessário)
    showSaveDialog: () => ipcRenderer.invoke('show-save-dialog'),
    makeBackup: () => ipcRenderer.invoke('make-backup'),
    
    // Info da aplicação
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    getPlatform: () => process.platform,
    
    // Eventos
    onAppEvent: (callback) => ipcRenderer.on('app-event', callback),
    removeAppEventListener: (callback) => ipcRenderer.removeListener('app-event', callback)
});
