const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Garantir que a pasta db existe
const dbDir = path.join(__dirname, 'db');
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(__dirname, 'db', 'aih.db');

// Pool de conexões para alta concorrência
class DatabasePool {
    constructor(size = 50) { // Aumentado para 50 conexões
        this.size = size;
        this.connections = [];
        this.available = [];
        this.waiting = [];
        
        // Criar pool inicial
        for (let i = 0; i < size; i++) {
            this.createConnection();
        }
        
        console.log(`Pool de ${size} conexões criado`);
    }
    
    createConnection() {
        const conn = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
            if (err) {
                console.error('Erro ao criar conexão:', err);
                return;
            }
            
            // Configurações otimizadas para alto volume
            conn.serialize(() => {
                conn.run("PRAGMA journal_mode = WAL");
                conn.run("PRAGMA synchronous = NORMAL");
                conn.run("PRAGMA cache_size = 100000"); // Cache ainda maior - 100MB
                conn.run("PRAGMA temp_store = MEMORY");
                conn.run("PRAGMA mmap_size = 2147483648"); // 2GB memory-mapped
                conn.run("PRAGMA foreign_keys = ON");
                conn.run("PRAGMA busy_timeout = 120000"); // Timeout maior - 2 minutos
                conn.run("PRAGMA wal_autocheckpoint = 5000"); // Checkpoint menos frequente
                conn.run("PRAGMA page_size = 65536"); // Páginas maiores - 64KB
                conn.run("PRAGMA threads = 8"); // Mais threads
                conn.run("PRAGMA locking_mode = NORMAL"); // Melhor concorrência
                conn.run("PRAGMA wal_checkpoint(TRUNCATE)"); // Limpar WAL
                conn.run("PRAGMA optimize");
            });
        });
        
        this.connections.push(conn);
        this.available.push(conn);
        return conn;
    }
    
    async getConnection() {
        return new Promise((resolve, reject) => {
            if (this.available.length > 0) {
                const conn = this.available.pop();
                resolve(conn);
            } else {
                this.waiting.push({ resolve, reject });
            }
        });
    }
    
    releaseConnection(conn) {
        this.available.push(conn);
        if (this.waiting.length > 0) {
            const waiter = this.waiting.shift();
            const nextConn = this.available.pop();
            waiter.resolve(nextConn);
        }
    }
    
    async closeAll() {
        for (const conn of this.connections) {
            await new Promise((resolve) => conn.close(resolve));
        }
        this.connections = [];
        this.available = [];
    }
}

// Criar pool de conexões - otimizado para maior volume
const pool = new DatabasePool(25); // 25 conexões simultâneas

// Conexão principal para operações especiais
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error('Erro ao conectar:', err);
    else console.log('Conectado ao banco SQLite (conexão principal)');
});

// Configurações de performance do SQLite para conexão principal
db.serialize(() => {
    // Configurações de performance e segurança otimizadas
    db.run("PRAGMA journal_mode = WAL");           
    db.run("PRAGMA synchronous = NORMAL");        
    db.run("PRAGMA cache_size = 200000");         // Cache muito maior - 200MB
    db.run("PRAGMA temp_store = MEMORY");         
    db.run("PRAGMA mmap_size = 4294967296");      // 4GB de memory-mapped I/O
    db.run("PRAGMA foreign_keys = ON");           // Integridade referencial
    db.run("PRAGMA busy_timeout = 180000");       // 3 minutos timeout
    db.run("PRAGMA wal_autocheckpoint = 10000");  // Checkpoint menos frequente
    db.run("PRAGMA secure_delete = OFF");         // Melhor performance
    db.run("PRAGMA locking_mode = NORMAL");       // Melhor concorrência
    db.run("PRAGMA read_uncommitted = true");     // Leituras mais rápidas
    db.run("PRAGMA optimize");                    
});

// Inicializar tabelas
const initDB = () => {
    db.serialize(() => {
        // Usuarios
        db.run(`CREATE TABLE IF NOT EXISTS usuarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT UNIQUE NOT NULL,
            matricula TEXT UNIQUE NOT NULL,
            senha_hash TEXT NOT NULL,
            criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Adicionar coluna matricula se não existir (para bancos existentes)
        db.run(`ALTER TABLE usuarios ADD COLUMN matricula TEXT`, (err) => {
            // Ignora erro se coluna já existe
        });

        // Administradores
        db.run(`CREATE TABLE IF NOT EXISTS administradores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            usuario TEXT UNIQUE NOT NULL,
            senha_hash TEXT NOT NULL,
            criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
            ultima_alteracao DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // AIHs
        db.run(`CREATE TABLE IF NOT EXISTS aihs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            numero_aih TEXT UNIQUE NOT NULL,
            valor_inicial REAL NOT NULL,
            valor_atual REAL NOT NULL,
            status INTEGER NOT NULL DEFAULT 3,
            competencia TEXT NOT NULL,
            criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
            usuario_cadastro_id INTEGER,
            FOREIGN KEY (usuario_cadastro_id) REFERENCES usuarios(id)
        )`);

        // Atendimentos
        db.run(`CREATE TABLE IF NOT EXISTS atendimentos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            aih_id INTEGER NOT NULL,
            numero_atendimento TEXT NOT NULL,
            FOREIGN KEY (aih_id) REFERENCES aihs(id)
        )`);

        // Movimentações
        db.run(`CREATE TABLE IF NOT EXISTS movimentacoes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            aih_id INTEGER NOT NULL,
            tipo TEXT NOT NULL,
            data_movimentacao DATETIME DEFAULT CURRENT_TIMESTAMP,
            usuario_id INTEGER NOT NULL,
            valor_conta REAL,
            competencia TEXT,
            prof_medicina TEXT,
            prof_enfermagem TEXT,
            prof_fisioterapia TEXT,
            prof_bucomaxilo TEXT,
            status_aih INTEGER NOT NULL,
            observacoes TEXT,
            FOREIGN KEY (aih_id) REFERENCES aihs(id),
            FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
        )`);
        
        // Adicionar coluna observacoes se não existir (para bancos existentes)
        db.run(`ALTER TABLE movimentacoes ADD COLUMN observacoes TEXT`, (err) => {
            // Ignora erro se coluna já existe
        });

        // Glosas
        db.run(`CREATE TABLE IF NOT EXISTS glosas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            aih_id INTEGER NOT NULL,
            linha TEXT NOT NULL,
            tipo TEXT NOT NULL,
            profissional TEXT NOT NULL,
            quantidade INTEGER DEFAULT 1,
            ativa INTEGER DEFAULT 1,
            criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (aih_id) REFERENCES aihs(id)
        )`);

        // Profissionais
        db.run(`CREATE TABLE IF NOT EXISTS profissionais (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL,
            especialidade TEXT NOT NULL
        )`);

        // Tipos de Glosa
        db.run(`CREATE TABLE IF NOT EXISTS tipos_glosa (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            descricao TEXT UNIQUE NOT NULL
        )`);

        // Logs de Acesso
        db.run(`CREATE TABLE IF NOT EXISTS logs_acesso (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            usuario_id INTEGER NOT NULL,
            acao TEXT NOT NULL,
            data_hora DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
        )`);

        // Logs de Exclusão (para auditoria de alterações na BD)
        db.run(`CREATE TABLE IF NOT EXISTS logs_exclusao (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tipo_exclusao TEXT NOT NULL, -- 'movimentacao' ou 'aih_completa'
            usuario_id INTEGER NOT NULL,
            dados_excluidos TEXT NOT NULL, -- JSON com todos os dados excluídos
            justificativa TEXT NOT NULL,
            ip_origem TEXT,
            user_agent TEXT,
            data_exclusao DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
        )`);

        // Popular tipos de glosa padrão
        db.run(`INSERT OR IGNORE INTO tipos_glosa (descricao) VALUES 
            ('Material não autorizado'),
            ('Quantidade excedente'),
            ('Procedimento não autorizado'),
            ('Falta de documentação'),
            ('Divergência de valores')`);

        // Criar administrador padrão (senha: admin)
        const bcrypt = require('bcryptjs');
        bcrypt.hash('admin', 10, (err, hash) => {
            if (!err) {
                db.run(`INSERT OR IGNORE INTO administradores (usuario, senha_hash) VALUES (?, ?)`, 
                    ['admin', hash]);
            }
        });

        // Criar índices otimizados para alto volume
        // Índices únicos (já otimizados automaticamente)
        db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_aih_numero ON aihs(numero_aih)`);
        db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_nome ON usuarios(nome)`);
        db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_matricula ON usuarios(matricula)`);
        
        // Índices compostos para consultas frequentes
        db.run(`CREATE INDEX IF NOT EXISTS idx_aih_status_competencia ON aihs(status, competencia)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_aih_competencia_criado ON aihs(competencia, criado_em DESC)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_aih_status_valor ON aihs(status, valor_atual)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_aih_usuario_criado ON aihs(usuario_cadastro_id, criado_em DESC)`);
        
        // Índices para movimentações (consultas frequentes)
        db.run(`CREATE INDEX IF NOT EXISTS idx_mov_aih_data ON movimentacoes(aih_id, data_movimentacao DESC)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_mov_tipo_competencia ON movimentacoes(tipo, competencia)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_mov_competencia_data ON movimentacoes(competencia, data_movimentacao DESC)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_mov_usuario_data ON movimentacoes(usuario_id, data_movimentacao DESC)`);
        
        // Índices para glosas
        db.run(`CREATE INDEX IF NOT EXISTS idx_glosas_aih_ativa ON glosas(aih_id, ativa)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_glosas_tipo_prof ON glosas(tipo, profissional)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_glosas_prof_ativa ON glosas(profissional, ativa, criado_em DESC)`);
        
        // Índices para relatórios e consultas de auditoria
        db.run(`CREATE INDEX IF NOT EXISTS idx_atendimentos_numero ON atendimentos(numero_atendimento)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_logs_usuario_data ON logs_acesso(usuario_id, data_hora DESC)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_logs_acao_data ON logs_acesso(acao, data_hora DESC)`);
        
        // Índices para logs de exclusão
        db.run(`CREATE INDEX IF NOT EXISTS idx_logs_exclusao_usuario ON logs_exclusao(usuario_id, data_exclusao DESC)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_logs_exclusao_tipo ON logs_exclusao(tipo_exclusao, data_exclusao DESC)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_logs_exclusao_data ON logs_exclusao(data_exclusao DESC)`);
        
        // Índices específicos para dashboard e relatórios (performance crítica)
        db.run(`CREATE INDEX IF NOT EXISTS idx_dashboard_competencia_status ON aihs(competencia, status, valor_inicial, valor_atual)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_mov_tipo_competencia_aih ON movimentacoes(tipo, competencia, aih_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_glosas_ativa_aih_tipo ON glosas(ativa, aih_id, tipo, profissional)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_aih_criado_status ON aihs(criado_em DESC, status, competencia)`);
        
        // Índice composto para consultas de fluxo
        db.run(`CREATE INDEX IF NOT EXISTS idx_mov_competencia_tipo_data ON movimentacoes(competencia, tipo, data_movimentacao DESC)`);
        
        // Índices para texto (FTS seria ideal, mas usando LIKE otimizado)
        db.run(`CREATE INDEX IF NOT EXISTS idx_mov_prof_medicina ON movimentacoes(prof_medicina) WHERE prof_medicina IS NOT NULL`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_mov_prof_enfermagem ON movimentacoes(prof_enfermagem) WHERE prof_enfermagem IS NOT NULL`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_mov_prof_fisio ON movimentacoes(prof_fisioterapia) WHERE prof_fisioterapia IS NOT NULL`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_mov_prof_buco ON movimentacoes(prof_bucomaxilo) WHERE prof_bucomaxilo IS NOT NULL`);
        
        // Novos índices para otimização de consultas pesadas
        db.run(`CREATE INDEX IF NOT EXISTS idx_aih_numero_status ON aihs(numero_aih, status, competencia)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_aih_valor_competencia ON aihs(valor_inicial, valor_atual, competencia)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_mov_aih_usuario_data ON movimentacoes(aih_id, usuario_id, data_movimentacao DESC)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_glosas_criado_ativa ON glosas(criado_em DESC, ativa, profissional)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_atend_aih_numero ON atendimentos(aih_id, numero_atendimento)`);
        
        // Índices para pesquisas por período
        db.run(`CREATE INDEX IF NOT EXISTS idx_aih_criado_competencia_valor ON aihs(criado_em, competencia, valor_inicial DESC)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_mov_data_tipo_valor ON movimentacoes(data_movimentacao DESC, tipo, valor_conta)`);
        
        // Índices para consultas de relatórios complexos
        db.run(`CREATE INDEX IF NOT EXISTS idx_aih_status_criado_valor ON aihs(status, criado_em DESC, valor_inicial, valor_atual)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_glosas_tipo_linha_ativa ON glosas(tipo, linha, ativa, criado_em DESC)`);
        
        // Índice para otimizar JOINs frequentes
        db.run(`CREATE INDEX IF NOT EXISTS idx_mov_aih_tipo_status ON movimentacoes(aih_id, tipo, status_aih, data_movimentacao DESC)`);
        
        console.log('Banco de dados inicializado');
    });
};

// Cache para consultas frequentes - otimizado para alto volume
const queryCache = new Map();
const CACHE_TTL = 15 * 60 * 1000; // 15 minutos
const MAX_CACHE_SIZE = 20000; // Cache muito maior para mais consultas

const clearExpiredCache = () => {
    const now = Date.now();
    for (const [key, value] of queryCache.entries()) {
        if (now - value.timestamp > CACHE_TTL) {
            queryCache.delete(key);
        }
    }
};

// Limpar cache expirado a cada 2 minutos (menos overhead)
setInterval(clearExpiredCache, 120000);

// Funções auxiliares com pool de conexões
const run = async (sql, params = []) => {
    const conn = await pool.getConnection();
    return new Promise((resolve, reject) => {
        conn.run(sql, params, function(err) {
            pool.releaseConnection(conn);
            if (err) {
                console.error('Erro SQL:', { sql: sql.substring(0, 100), params, error: err.message });
                reject(err);
            } else {
                resolve({ id: this.lastID, changes: this.changes });
            }
        });
    });
};

const get = async (sql, params = [], useCache = false) => {
    // Verificar cache se solicitado
    if (useCache) {
        const cacheKey = sql + JSON.stringify(params);
        const cached = queryCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
            return cached.data;
        }
    }
    
    const conn = await pool.getConnection();
    return new Promise((resolve, reject) => {
        conn.get(sql, params, (err, row) => {
            pool.releaseConnection(conn);
            if (err) {
                console.error('Erro SQL:', { sql: sql.substring(0, 100), params, error: err.message });
                reject(err);
            } else {
                // Adicionar ao cache se solicitado
                if (useCache && row) {
                    const cacheKey = sql + JSON.stringify(params);
                    if (queryCache.size >= MAX_CACHE_SIZE) {
                        // Remover entrada mais antiga
                        const firstKey = queryCache.keys().next().value;
                        queryCache.delete(firstKey);
                    }
                    queryCache.set(cacheKey, { data: row, timestamp: Date.now() });
                }
                resolve(row);
            }
        });
    });
};

const all = async (sql, params = [], useCache = false) => {
    // Verificar cache se solicitado
    if (useCache) {
        const cacheKey = sql + JSON.stringify(params);
        const cached = queryCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
            return cached.data;
        }
    }
    
    const conn = await pool.getConnection();
    return new Promise((resolve, reject) => {
        conn.all(sql, params, (err, rows) => {
            pool.releaseConnection(conn);
            if (err) {
                console.error('Erro SQL:', { sql: sql.substring(0, 100), params, error: err.message });
                reject(err);
            } else {
                // Adicionar ao cache se solicitado
                if (useCache && rows) {
                    const cacheKey = sql + JSON.stringify(params);
                    if (queryCache.size >= MAX_CACHE_SIZE) {
                        const firstKey = queryCache.keys().next().value;
                        queryCache.delete(firstKey);
                    }
                    queryCache.set(cacheKey, { data: rows, timestamp: Date.now() });
                }
                resolve(rows);
            }
        });
    });
};

// Função para transações robustas
const runTransaction = async (operations) => {
    const conn = await pool.getConnection();
    
    return new Promise((resolve, reject) => {
        conn.serialize(() => {
            conn.run("BEGIN IMMEDIATE TRANSACTION", async (err) => {
                if (err) {
                    pool.releaseConnection(conn);
                    return reject(err);
                }
                
                try {
                    const results = [];
                    
                    for (const op of operations) {
                        const result = await new Promise((resolveOp, rejectOp) => {
                            conn.run(op.sql, op.params || [], function(opErr) {
                                if (opErr) rejectOp(opErr);
                                else resolveOp({ id: this.lastID, changes: this.changes });
                            });
                        });
                        results.push(result);
                    }
                    
                    conn.run("COMMIT", (commitErr) => {
                        pool.releaseConnection(conn);
                        if (commitErr) reject(commitErr);
                        else resolve(results);
                    });
                    
                } catch (error) {
                    conn.run("ROLLBACK", (rollbackErr) => {
                        pool.releaseConnection(conn);
                        if (rollbackErr) console.error('Erro no rollback:', rollbackErr);
                        reject(error);
                    });
                }
            });
        });
    });
};

// Validações de dados
const validateAIH = (data) => {
    const errors = [];
    
    if (!data.numero_aih || typeof data.numero_aih !== 'string' || data.numero_aih.trim().length === 0) {
        errors.push('Número da AIH é obrigatório');
    }
    
    if (!data.valor_inicial || isNaN(parseFloat(data.valor_inicial)) || parseFloat(data.valor_inicial) <= 0) {
        errors.push('Valor inicial deve ser um número positivo');
    }
    
    if (!data.competencia || !/^\d{2}\/\d{4}$/.test(data.competencia)) {
        errors.push('Competência deve estar no formato MM/AAAA');
    }
    
    if (!data.atendimentos || (Array.isArray(data.atendimentos) && data.atendimentos.length === 0)) {
        errors.push('Pelo menos um atendimento deve ser informado');
    }
    
    return errors;
};

const validateMovimentacao = (data) => {
    const errors = [];
    
    if (!data.tipo || !['entrada_sus', 'saida_hospital'].includes(data.tipo)) {
        errors.push('Tipo de movimentação inválido');
    }
    
    if (!data.status_aih || ![1, 2, 3, 4].includes(parseInt(data.status_aih))) {
        errors.push('Status da AIH inválido');
    }
    
    if (data.valor_conta && (isNaN(parseFloat(data.valor_conta)) || parseFloat(data.valor_conta) < 0)) {
        errors.push('Valor da conta deve ser um número não negativo');
    }
    
    return errors;
};

// Limpar cache quando necessário
const clearCache = (pattern = null) => {
    if (!pattern) {
        queryCache.clear();
        console.log('Cache de consultas limpo');
    } else {
        let cleared = 0;
        for (const key of queryCache.keys()) {
            if (key.includes(pattern)) {
                queryCache.delete(key);
                cleared++;
            }
        }
        console.log(`Cache limpo: ${cleared} entradas removidas`);
    }
};

// Se executado diretamente, inicializa o banco
if (require.main === module) {
    const fs = require('fs');
    if (!fs.existsSync('./db')) {
        fs.mkdirSync('./db');
    }
    initDB();
}

// Estatísticas do banco
const getDbStats = async () => {
    try {
        const stats = await get(`
            SELECT 
                (SELECT COUNT(*) FROM aihs) as total_aihs,
                (SELECT COUNT(*) FROM movimentacoes) as total_movimentacoes,
                (SELECT COUNT(*) FROM glosas WHERE ativa = 1) as total_glosas_ativas,
                (SELECT COUNT(*) FROM usuarios) as total_usuarios,
                (SELECT COUNT(*) FROM logs_acesso) as total_logs
        `, [], true); // Usar cache
        
        const dbSize = await get("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()");
        const walSize = fs.existsSync(dbPath + '-wal') ? fs.statSync(dbPath + '-wal').size : 0;
        
        return {
            ...stats,
            db_size_mb: Math.round((dbSize.size || 0) / (1024 * 1024) * 100) / 100,
            wal_size_mb: Math.round(walSize / (1024 * 1024) * 100) / 100,
            cache_entries: queryCache.size,
            pool_connections: pool.connections.length,
            available_connections: pool.available.length,
            timestamp: new Date().toISOString()
        };
    } catch (err) {
        console.error('Erro ao obter estatísticas:', err);
        return null;
    }
};

// Backup automático
const createBackup = async () => {
    try {
        const backupDir = path.join(__dirname, 'backups');
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
        const backupPath = path.join(backupDir, `aih-backup-${timestamp}.db`);
        
        // Fazer checkpoint do WAL antes do backup
        await run("PRAGMA wal_checkpoint(FULL)");
        
        // Copiar arquivo
        fs.copyFileSync(dbPath, backupPath);
        
        console.log(`Backup criado: ${backupPath}`);
        
        // Limpar backups antigos (manter apenas os últimos 7)
        const backups = fs.readdirSync(backupDir)
            .filter(f => f.startsWith('aih-backup-') && f.endsWith('.db'))
            .sort()
            .reverse();
            
        if (backups.length > 7) {
            for (let i = 7; i < backups.length; i++) {
                fs.unlinkSync(path.join(backupDir, backups[i]));
                console.log(`Backup antigo removido: ${backups[i]}`);
            }
        }
        
        return backupPath;
    } catch (err) {
        console.error('Erro ao criar backup:', err);
        throw err;
    }
};

// Fechar pool graciosamente
const closePool = async () => {
    console.log('Fechando pool de conexões...');
    await pool.closeAll();
    db.close();
    console.log('Pool fechado');
};

// Interceptar sinais para fechar conexões
process.on('SIGINT', closePool);
process.on('SIGTERM', closePool);

module.exports = { 
    db, 
    pool,
    initDB, 
    run, 
    get, 
    all, 
    runTransaction,
    validateAIH,
    validateMovimentacao,
    clearCache,
    getDbStats,
    createBackup,
    closePool
};