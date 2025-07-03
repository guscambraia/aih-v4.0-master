# 📚 Guia de Desenvolvimento - Sistema de Controle de Auditoria AIH

## 📋 Índice
1. [Visão Geral do Sistema](#visão-geral)
2. [Estrutura de Arquivos](#estrutura-de-arquivos)
3. [Arquitetura do Sistema](#arquitetura)
4. [Banco de Dados](#banco-de-dados)
5. [API e Rotas](#api-e-rotas)
6. [Frontend](#frontend)
7. [Como Adicionar Novas Funcionalidades](#novas-funcionalidades)
8. [Padrões e Convenções](#padrões)
9. [Comandos Úteis](#comandos)

## 🎯 Visão Geral do Sistema {#visão-geral}

### Propósito
Sistema web para controle e auditoria de AIH (Autorização de Internação Hospitalar), gerenciando o fluxo entre auditoria hospitalar e auditoria do SUS.

### Tecnologias Utilizadas
- **Backend**: Node.js + Express.js
- **Banco de Dados**: SQLite
- **Frontend**: HTML5 + CSS3 + JavaScript puro
- **Autenticação**: JWT (JSON Web Tokens)
- **Hash de Senha**: bcryptjs

### Funcionalidades Principais
- Sistema de login multiusuário
- Cadastro e gestão de AIHs
- Controle de movimentações (entrada/saída)
- Gestão de glosas e pendências
- Relatórios e análises
- Exportação de dados (CSV, Excel, JSON)
- Backup do sistema

## 📁 Estrutura de Arquivos {#estrutura-de-arquivos}

```
projeto-aih/
│
├── 📄 server.js              # Servidor principal e rotas da API
├── 📄 database.js            # Configuração e funções do banco de dados
├── 📄 auth.js               # Sistema de autenticação
├── 📄 package.json          # Dependências do projeto
├── 📄 update-db.js          # Script para atualizar estrutura do banco
│
├── 📁 db/                   # Pasta do banco de dados
│   └── 📄 aih.db           # Arquivo do banco SQLite
│
├── 📁 public/               # Arquivos estáticos (frontend)
│   ├── 📄 index.html       # Página HTML única (SPA)
│   ├── 📄 style.css        # Estilos CSS
│   └── 📄 app.js          # Lógica JavaScript do frontend
│
└── 📁 docs/                 # Documentação
    ├── 📄 estrutura-db.md  # Estrutura das tabelas
    ├── 📄 api-endpoints.md # Documentação da API
    └── 📄 fluxo-telas.md   # Fluxo de navegação
```

## 🏗️ Arquitetura do Sistema {#arquitetura}

### Backend (Node.js)

#### server.js
- **Função**: Servidor Express principal
- **Responsabilidades**:
  - Configurar middlewares
  - Definir todas as rotas da API
  - Servir arquivos estáticos
  - Implementar lógica de negócios

#### database.js
- **Função**: Gerenciamento do banco de dados
- **Exports**:
  - `initDB()`: Inicializa tabelas
  - `run()`: Executa comandos INSERT/UPDATE/DELETE
  - `get()`: Busca um registro
  - `all()`: Busca múltiplos registros

#### auth.js
- **Função**: Autenticação e segurança
- **Exports**:
  - `verificarToken()`: Middleware de autenticação
  - `login()`: Função de login
  - `cadastrarUsuario()`: Criar novo usuário

### Frontend (SPA - Single Page Application)

#### index.html
- Contém todas as telas em divs com classe `tela`
- Apenas uma tela visível por vez (classe `ativa`)
- IDs importantes das telas:
  - `telaLogin`
  - `telaPrincipal`
  - `telaInformarAIH`
  - `telaCadastroAIH`
  - `telaInfoAIH`
  - `telaMovimentacao`
  - `telaPendencias`
  - `telaPesquisa`
  - `telaConfiguracoes`
  - `telaRelatorios`

#### app.js
- **Estado Global**: objeto `state`
- **Funções Principais**:
  - `api()`: Helper para chamadas à API
  - `mostrarTela()`: Navegação entre telas
  - `carregarDashboard()`: Atualiza estatísticas
  - Handlers de eventos para cada formulário

#### style.css
- Estilos modernos com variáveis CSS
- Classes importantes:
  - `.tela` / `.tela.ativa`: Controle de visibilidade
  - `.stat-card`: Cards de estatísticas
  - `.status-badge`: Badges de status
  - `.modal`: Sistema de modais

## 💾 Banco de Dados {#banco-de-dados}

### Tabelas Principais

#### usuarios
```sql
- id (PK)
- nome (UNIQUE)
- senha_hash
- criado_em
```

#### aihs
```sql
- id (PK)
- numero_aih (UNIQUE)
- valor_inicial
- valor_atual
- status (1-4)
- competencia
- criado_em
- usuario_cadastro_id (FK)
```

#### movimentacoes
```sql
- id (PK)
- aih_id (FK)
- tipo (entrada_sus/saida_hospital)
- data_movimentacao
- usuario_id (FK)
- valor_conta
- competencia
- prof_medicina
- prof_enfermagem
- prof_fisioterapia
- prof_bucomaxilo
- status_aih
```

#### glosas
```sql
- id (PK)
- aih_id (FK)
- linha
- tipo
- profissional
- quantidade
- ativa
- criado_em
```

#### tipos_glosa
```sql
- id (PK)
- descricao (UNIQUE)
```

#### profissionais
```sql
- id (PK)
- nome
- especialidade
```

#### logs_acesso
```sql
- id (PK)
- usuario_id (FK)
- acao
- data_hora
```

### Status da AIH
1. **Finalizada com aprovação direta**
2. **Ativa com aprovação indireta**
3. **Ativa em discussão** (padrão)
4. **Finalizada após discussão**

## 🌐 API e Rotas {#api-e-rotas}

### Autenticação
- `POST /api/login` - Login
- `POST /api/cadastrar` - Criar usuário

### AIH
- `GET /api/dashboard` - Estatísticas
- `GET /api/aih/:numero` - Buscar AIH
- `POST /api/aih` - Cadastrar AIH
- `POST /api/aih/:id/movimentacao` - Nova movimentação

### Glosas
- `GET /api/aih/:id/glosas` - Listar glosas
- `POST /api/aih/:id/glosas` - Adicionar glosa
- `DELETE /api/glosas/:id` - Remover glosa

### Configurações
- `GET /api/profissionais` - Listar profissionais
- `POST /api/profissionais` - Adicionar profissional
- `DELETE /api/profissionais/:id` - Remover profissional
- `GET /api/tipos-glosa` - Listar tipos
- `POST /api/tipos-glosa` - Adicionar tipo
- `DELETE /api/tipos-glosa/:id` - Remover tipo

### Pesquisa e Exportação
- `POST /api/pesquisar` - Pesquisa avançada
- `GET /api/export/:formato` - Exportar (csv/excel/json)
- `GET /api/backup` - Download do banco

### Relatórios
- `GET /api/relatorios/:tipo` - Gerar relatório
  - Tipos: acessos, glosas-profissional, aihs-profissional, aprovacoes, tipos-glosa, analise-preditiva

## 🎨 Frontend {#frontend}

### Fluxo de Navegação
```
Login → Principal → Informar AIH → Cadastro/Info AIH → Movimentação → Pendências
                 ↓
                 → Pesquisar
                 → Configurações
                 → Relatórios
                 → Backup/Exportar
```

### Padrão de Comunicação
1. Usuário interage com formulário
2. JavaScript captura evento
3. Chama API via fetch
4. Atualiza interface com resposta
5. Navega para próxima tela se necessário

### Estado da Aplicação
```javascript
state = {
    token: String,        // JWT token
    usuario: Object,      // Dados do usuário
    aihAtual: Object,     // AIH sendo editada
    telaAnterior: String, // Para navegação
    glosasPendentes: Array // Glosas temporárias
}
```

## 🚀 Como Adicionar Novas Funcionalidades {#novas-funcionalidades}

### 1. Adicionar Nova Tabela no Banco

**Em database.js**, na função `initDB()`:
```javascript
db.run(`CREATE TABLE IF NOT EXISTS nova_tabela (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campo1 TEXT NOT NULL,
    campo2 INTEGER DEFAULT 0
)`);
```

### 2. Criar Nova Rota na API

**Em server.js**:
```javascript
app.get('/api/nova-rota', verificarToken, async (req, res) => {
    try {
        const dados = await all('SELECT * FROM nova_tabela');
        res.json({ dados });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
```

### 3. Adicionar Nova Tela

**Em index.html**:
```html
<div id="telaNova" class="tela">
    <header>
        <button class="btn-voltar" onclick="voltarTelaPrincipal()">← Voltar</button>
        <h2>Nova Funcionalidade</h2>
    </header>
    <div class="container">
        <!-- Conteúdo da tela -->
    </div>
</div>
```

### 4. Adicionar Lógica no Frontend

**Em app.js**:
```javascript
// Adicionar botão no menu
document.getElementById('btnNovaFuncao').addEventListener('click', () => {
    mostrarTela('telaNova');
    carregarDadosNovaTela();
});

// Função para carregar dados
const carregarDadosNovaTela = async () => {
    try {
        const response = await api('/nova-rota');
        // Processar e exibir dados
    } catch (err) {
        console.error('Erro:', err);
    }
};
```

### 5. Atualizar Banco Existente

Criar script de atualização:
```javascript
// update-nova-funcao.js
db.run(`ALTER TABLE tabela_existente ADD COLUMN novo_campo TEXT`);
```

## 📏 Padrões e Convenções {#padrões}

### Nomenclatura
- **Tabelas**: snake_case plural (ex: `tipos_glosa`)
- **Colunas**: snake_case (ex: `numero_aih`)
- **Rotas API**: kebab-case (ex: `/api/tipos-glosa`)
- **IDs HTML**: camelCase (ex: `btnNovaFuncao`)
- **Funções JS**: camelCase (ex: `carregarDados`)

### Estrutura de Resposta da API
```javascript
// Sucesso
{ success: true, data: {...} }

// Erro
{ error: "Mensagem de erro" }

// Lista
{ items: [...], total: 10 }
```

### Validações
- Sempre validar no frontend E backend
- Usar try/catch em funções assíncronas
- Retornar mensagens de erro claras

### Segurança
- Todas rotas (exceto login) protegidas por token
- Senhas hasheadas com bcrypt
- Sanitizar inputs antes de salvar

## 🛠️ Comandos Úteis {#comandos}

### Desenvolvimento
```bash
# Instalar dependências
npm install

# Iniciar servidor
npm start

# Desenvolvimento com auto-reload
npm run dev

# Criar/recriar banco
node database.js
```

### Manutenção
```bash
# Atualizar estrutura do banco
node update-db.js

# Backup manual
cp db/aih.db db/backup-$(date +%Y%m%d).db
```

### Debug
```javascript
// Ver queries SQL
db.on('trace', (sql) => console.log('SQL:', sql));

// Log de requisições
app.use((req, res, next) => {
    console.log(`${req.method} ${req.path}`);
    next();
});
```

## 📝 Checklist para Nova Funcionalidade

- [ ] Definir requisitos claramente
- [ ] Criar/alterar tabelas necessárias
- [ ] Implementar rotas da API
- [ ] Testar API com Postman/Insomnia
- [ ] Criar interface HTML
- [ ] Implementar lógica JavaScript
- [ ] Adicionar estilos CSS
- [ ] Testar fluxo completo
- [ ] Documentar alterações
- [ ] Criar script de atualização se necessário

## 🔍 Dicas para IA/Desenvolvimento Futuro

1. **Sempre verifique o estado atual**: Use `state` no console para debug
2. **Teste incrementalmente**: Teste API primeiro, depois frontend
3. **Mantenha consistência**: Siga os padrões existentes
4. **Documente mudanças**: Atualize este guia com novas funcionalidades
5. **Backup antes de grandes mudanças**: `cp -r projeto-aih projeto-aih-backup`

## 📞 Estrutura de Comunicação

```
Frontend (app.js) → API (server.js) → Database (database.js)
                                    ↓
                                  Auth (auth.js)
```

Este documento deve ser atualizado sempre que novas funcionalidades forem adicionadas ao sistema.