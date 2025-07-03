
const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

let mainWindow;
let serverProcess;
const isDev = process.env.NODE_ENV === 'development';
const serverPort = 5000;

// Configurar menu da aplicação
function createMenu() {
    const template = [
        {
            label: 'Arquivo',
            submenu: [
                {
                    label: 'Backup do Banco',
                    click: async () => {
                        const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
                            title: 'Salvar Backup do Banco de Dados',
                            defaultPath: `backup-aih-${new Date().toISOString().split('T')[0]}.db`,
                            filters: [
                                { name: 'Banco SQLite', extensions: ['db'] },
                                { name: 'Todos os arquivos', extensions: ['*'] }
                            ]
                        });

                        if (!canceled && filePath) {
                            try {
                                const sourcePath = path.join(__dirname, 'db', 'aih.db');
                                if (fs.existsSync(sourcePath)) {
                                    fs.copyFileSync(sourcePath, filePath);
                                    dialog.showMessageBox(mainWindow, {
                                        type: 'info',
                                        title: 'Backup Concluído',
                                        message: 'Backup do banco de dados salvo com sucesso!'
                                    });
                                } else {
                                    throw new Error('Arquivo do banco não encontrado');
                                }
                            } catch (error) {
                                dialog.showErrorBox('Erro no Backup', `Erro ao fazer backup: ${error.message}`);
                            }
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: 'Sair',
                    accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
                    click: () => {
                        app.quit();
                    }
                }
            ]
        },
        {
            label: 'Editar',
            submenu: [
                { label: 'Desfazer', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
                { label: 'Refazer', accelerator: 'Shift+CmdOrCtrl+Z', role: 'redo' },
                { type: 'separator' },
                { label: 'Recortar', accelerator: 'CmdOrCtrl+X', role: 'cut' },
                { label: 'Copiar', accelerator: 'CmdOrCtrl+C', role: 'copy' },
                { label: 'Colar', accelerator: 'CmdOrCtrl+V', role: 'paste' }
            ]
        },
        {
            label: 'Visualizar',
            submenu: [
                { label: 'Recarregar', accelerator: 'CmdOrCtrl+R', role: 'reload' },
                { label: 'Forçar Recarregar', accelerator: 'CmdOrCtrl+Shift+R', role: 'forceReload' },
                { label: 'Ferramentas do Desenvolvedor', accelerator: process.platform === 'darwin' ? 'Alt+Cmd+I' : 'Ctrl+Shift+I', role: 'toggleDevTools' },
                { type: 'separator' },
                { label: 'Zoom Real', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
                { label: 'Ampliar', accelerator: 'CmdOrCtrl+Plus', role: 'zoomIn' },
                { label: 'Reduzir', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
                { type: 'separator' },
                { label: 'Tela Cheia', accelerator: process.platform === 'darwin' ? 'Ctrl+Cmd+F' : 'F11', role: 'togglefullscreen' }
            ]
        },
        {
            label: 'Ajuda',
            submenu: [
                {
                    label: 'Sobre o Sistema AIH',
                    click: () => {
                        dialog.showMessageBox(mainWindow, {
                            type: 'info',
                            title: 'Sobre',
                            message: 'Sistema de Controle de Auditoria de AIH',
                            detail: `Versão: 3.4\nDesenvolvido por: Gustavo Cambraia\nTecnologia: Electron + Node.js + SQLite`
                        });
                    }
                }
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}

// Iniciar servidor backend
function startServer() {
    return new Promise((resolve, reject) => {
        console.log('🚀 Iniciando servidor backend...');
        
        // Garantir que a pasta db existe
        const dbDir = path.join(__dirname, 'db');
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }

        serverProcess = spawn('node', ['server.js'], {
            cwd: __dirname,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, NODE_ENV: 'production', PORT: serverPort }
        });

        serverProcess.stdout.on('data', (data) => {
            console.log(`[SERVER] ${data.toString().trim()}`);
            if (data.toString().includes('5000')) {
                resolve();
            }
        });

        serverProcess.stderr.on('data', (data) => {
            console.error(`[SERVER ERROR] ${data.toString().trim()}`);
        });

        serverProcess.on('error', (error) => {
            console.error('Erro ao iniciar servidor:', error);
            reject(error);
        });

        serverProcess.on('close', (code) => {
            console.log(`Servidor encerrado com código: ${code}`);
        });

        // Timeout de segurança
        setTimeout(() => {
            resolve(); // Assume que o servidor está pronto após 3 segundos
        }, 3000);
    });
}

// Criar janela principal
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1200,
        minHeight: 800,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            enableRemoteModule: false,
            webSecurity: true
        },
        icon: path.join(__dirname, 'assets', 'icon.png'), // Adicione um ícone se desejar
        show: false,
        titleBarStyle: 'default'
    });

    // Carregar a aplicação
    mainWindow.loadURL(`http://localhost:${serverPort}`);

    // Mostrar janela quando estiver pronta
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        console.log('✅ Aplicação carregada com sucesso!');
    });

    // Interceptar links externos
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });

    // Evento ao fechar
    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // Prevenir navegação externa
    mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
        const parsedUrl = new URL(navigationUrl);
        if (parsedUrl.origin !== `http://localhost:${serverPort}`) {
            event.preventDefault();
        }
    });
}

// Quando o Electron estiver pronto
app.whenReady().then(async () => {
    try {
        console.log('🔄 Iniciando Sistema de Controle de AIH...');
        
        // Criar menu
        createMenu();
        
        // Iniciar servidor
        await startServer();
        
        // Aguardar um pouco para o servidor estabilizar
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Criar janela
        createWindow();
        
    } catch (error) {
        console.error('Erro ao inicializar aplicação:', error);
        dialog.showErrorBox('Erro de Inicialização', `Não foi possível iniciar a aplicação: ${error.message}`);
        app.quit();
    }
});

// Fechar servidor ao sair
app.on('before-quit', () => {
    if (serverProcess) {
        console.log('🛑 Encerrando servidor...');
        serverProcess.kill();
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

// Tratar erros não capturados
process.on('uncaughtException', (error) => {
    console.error('Erro não capturado:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Promise rejeitada:', reason);
});
