
# Sistema de Controle de AIH - Versão Desktop

## 📱 Aplicativo Desktop Offline

Esta é a versão desktop do Sistema de Controle de Auditoria de AIH, desenvolvida com Electron para funcionar completamente offline no seu computador.

## ✨ Funcionalidades

- **100% Offline**: Funciona sem necessidade de internet
- **Banco Local**: SQLite integrado para armazenamento local
- **Interface Nativa**: Aplicativo desktop com menu nativo
- **Backup Automático**: Sistema de backup integrado
- **Multiplataforma**: Funciona em Windows, macOS e Linux

## 🚀 Como Usar

### Para Desenvolvimento

1. **Instalar dependências:**
```bash
npm install
```

2. **Executar em modo desenvolvimento:**
```bash
npm run electron-dev
```

3. **Executar apenas o Electron:**
```bash
npm run electron
```

### Para Distribuição

1. **Preparar aplicação:**
```bash
node scripts/prepare-dist.js
```

2. **Gerar executável:**

**Windows:**
```bash
npm run build-win
```

**macOS:**
```bash
npm run build-mac
```

**Linux:**
```bash
npm run build-linux
```

**Todas as plataformas:**
```bash
npm run build
```

## 📦 Instalação

### Windows
- Execute o arquivo `.exe` gerado na pasta `dist/`
- O instalador criará atalhos no Desktop e Menu Iniciar

### macOS
- Abra o arquivo `.dmg` e arraste o app para a pasta Applications
- Se aparecer aviso de segurança, vá em Preferências > Segurança e clique em "Abrir mesmo assim"

### Linux
- **AppImage**: Torne executável e execute: `chmod +x *.AppImage && ./Sistema-AIH-*.AppImage`
- **DEB**: Instale com: `sudo dpkg -i sistema-aih_*.deb`

## 🔧 Estrutura do Projeto

```
sistema-aih-desktop/
├── main.js              # Processo principal do Electron
├── preload.js           # Script de preload (segurança)
├── server.js            # Servidor backend integrado
├── database.js          # Banco de dados SQLite
├── public/              # Frontend da aplicação
├── db/                  # Banco de dados local
├── assets/              # Ícones e recursos
└── dist/               # Executáveis gerados
```

## 💾 Backup e Dados

- **Localização do banco**: `db/aih.db`
- **Backup automático**: Menu > Arquivo > Backup do Banco
- **Backup programático**: Disponível no menu da aplicação

## ⚡ Performance

- **Inicialização**: ~3-5 segundos
- **Banco de dados**: SQLite otimizado para alta performance
- **Memoria**: ~150-200MB RAM típico
- **Espaço em disco**: ~100MB instalado

## 🔒 Segurança

- Banco de dados local (não enviado para internet)
- Senhas hasheadas com bcrypt
- Logs de auditoria completos
- Validação de dados em frontend e backend

## 🆘 Solução de Problemas

### Aplicação não inicia
1. Verifique se todas as dependências estão instaladas
2. Execute `npm run electron-dev` para ver logs detalhados
3. Verifique se a porta 5000 não está em uso

### Banco de dados corrompido
1. Use Menu > Arquivo > Backup do Banco para salvar dados
2. Exclua `db/aih.db`
3. Reinicie a aplicação (novo banco será criado)

### Performance lenta
1. Verifique espaço livre em disco (mínimo 1GB)
2. Feche outras aplicações pesadas
3. Execute backup e reinicie a aplicação

## 📞 Suporte

- **Desenvolvedor**: Gustavo Cambraia
- **Versão**: 3.4 Desktop
- **Tecnologias**: Electron, Node.js, Express, SQLite
- **Compatibilidade**: Windows 10+, macOS 10.14+, Ubuntu 18.04+

## 🔄 Atualizações

Para atualizar:
1. Baixe a nova versão
2. Instale sobre a versão atual
3. Seus dados serão preservados automaticamente

---

**⚠️ Importante**: Faça backup regular dos seus dados usando o menu integrado!
