const express = require('express');
const cors = require('cors');
const path = require('path');
const XLSX = require('xlsx');
const { initDB, run, get, all, runTransaction, validateAIH, validateMovimentacao, clearCache, getDbStats, createBackup } = require('./database');
const { verificarToken, login, cadastrarUsuario, loginAdmin, alterarSenhaAdmin, listarUsuarios, excluirUsuario } = require('./auth');
const { rateLimitMiddleware, validateInput, clearRateLimit, detectSuspiciousActivity, getSecurityLogs } = require('./middleware');

const app = express();
const PORT = process.env.PORT || 5000;

// Middlewares de segurança e otimização
app.use(cors({
    origin: process.env.NODE_ENV === 'production' ? false : true,
    credentials: true
}));

app.use(express.json({ limit: '50mb' })); // Aumentar limite para uploads maiores
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Aplicar rate limiting globalmente
app.use(rateLimitMiddleware);

// Detectar atividade suspeita
app.use(detectSuspiciousActivity);

// Validação de entrada
app.use('/api', validateInput);

// Headers de segurança
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    if (process.env.NODE_ENV === 'production') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
});

app.use(express.static('public'));

// Log de requisições para debug
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// Inicializar banco
initDB();

// Inicializar sistema de manutenção
const { scheduleMaintenance } = require('./cleanup');
scheduleMaintenance();

// Inicializar monitoramento
const { logPerformance } = require('./monitor');
setTimeout(logPerformance, 30000); // Log inicial após 30s

// Backup automático mais frequente com limpeza automática
const scheduleBackups = () => {
    const BACKUP_INTERVAL = 8 * 60 * 60 * 1000; // 8 horas (3x por dia)
    const MAX_BACKUPS = 21; // Manter 21 backups (1 semana com 3 por dia)

    const performBackup = async () => {
        try {
            console.log('🔄 Iniciando backup automático...');
            const backupPath = await createBackup();
            
            // Limpeza automática de backups antigos
            await cleanOldBackups(MAX_BACKUPS);
            
            console.log(`✅ Backup automático concluído: ${backupPath}`);
        } catch (err) {
            console.error('❌ Erro no backup automático:', err);
        }
    };

    // Primeiro backup após 30 minutos
    setTimeout(performBackup, 30 * 60 * 1000);

    // Backups subsequentes a cada 8 horas
    setInterval(performBackup, BACKUP_INTERVAL);

    console.log('📅 Backup automático agendado (a cada 8 horas)');
};

// Função para limpar backups antigos automaticamente
const cleanOldBackups = async (maxBackups) => {
    try {
        const fs = require('fs');
        const backupDir = path.join(__dirname, 'backups');
        
        if (!fs.existsSync(backupDir)) {
            return;
        }
        
        const backups = fs.readdirSync(backupDir)
            .filter(f => f.startsWith('aih-backup-') && f.endsWith('.db'))
            .map(f => ({
                name: f,
                path: path.join(backupDir, f),
                stats: fs.statSync(path.join(backupDir, f))
            }))
            .sort((a, b) => b.stats.mtime - a.stats.mtime); // Mais recentes primeiro
            
        if (backups.length > maxBackups) {
            const toDelete = backups.slice(maxBackups);
            for (const backup of toDelete) {
                fs.unlinkSync(backup.path);
                console.log(`🗑️ Backup antigo removido: ${backup.name}`);
            }
            console.log(`🧹 Limpeza concluída: ${toDelete.length} backups removidos, ${maxBackups} mantidos`);
        }
    } catch (err) {
        console.error('❌ Erro na limpeza de backups:', err);
    }
};

scheduleBackups();

// Middleware para logs
const logAcao = async (usuarioId, acao) => {
    await run('INSERT INTO logs_acesso (usuario_id, acao) VALUES (?, ?)', [usuarioId, acao]);
};

// Rotas de autenticação
app.post('/api/login', async (req, res) => {
    try {
        console.log('Tentativa de login:', req.body?.nome);
        const { nome, senha } = req.body;

        if (!nome || !senha) {
            return res.status(400).json({ error: 'Nome e senha são obrigatórios' });
        }

        const result = await login(nome, senha);
        await logAcao(result.usuario.id, 'Login');
        console.log('Login bem-sucedido:', result.usuario.nome);
        res.json(result);
    } catch (err) {
        console.error('Erro no login:', err.message);
        res.status(401).json({ error: err.message });
    }
});

// Login de administrador
app.post('/api/admin/login', async (req, res) => {
    try {
        console.log('Tentativa de login admin:', req.body?.usuario);
        const { usuario, senha } = req.body;

        if (!usuario || !senha) {
            return res.status(400).json({ error: 'Usuário e senha são obrigatórios' });
        }

        const result = await loginAdmin(usuario, senha);
        console.log('Login admin bem-sucedido:', result.admin.usuario);
        res.json(result);
    } catch (err) {
        console.error('Erro no login admin:', err.message);
        res.status(401).json({ error: err.message });
    }
});

// Listar usuários (apenas admin)
app.get('/api/admin/usuarios', verificarToken, async (req, res) => {
    try {
        // Verificar se é admin consultando o banco
        const admin = await get('SELECT id FROM administradores WHERE id = ?', [req.usuario.id]);
        if (!admin) {
            return res.status(403).json({ error: 'Acesso negado - apenas administradores' });
        }
        const usuarios = await listarUsuarios();
        res.json({ usuarios });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Cadastrar usuário (apenas admin)
app.post('/api/admin/usuarios', verificarToken, async (req, res) => {
    try {
        // Verificar se é admin consultando o banco
        const admin = await get('SELECT id FROM administradores WHERE id = ?', [req.usuario.id]);
        if (!admin) {
            return res.status(403).json({ error: 'Acesso negado - apenas administradores' });
        }
        const { nome, matricula, senha } = req.body;
        const usuario = await cadastrarUsuario(nome, matricula, senha);
        res.json({ success: true, usuario });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Excluir usuário (apenas admin)
app.delete('/api/admin/usuarios/:id', verificarToken, async (req, res) => {
    try {
        // Verificar se é admin consultando o banco
        const admin = await get('SELECT id FROM administradores WHERE id = ?', [req.usuario.id]);
        if (!admin) {
            return res.status(403).json({ error: 'Acesso negado - apenas administradores' });
        }
        await excluirUsuario(req.params.id);
        res.json({ success: true });
    } catch (err) {
        console.error('Erro ao excluir usuário:', err);
        res.status(400).json({ error: err.message });
    }
});

// Alterar senha do administrador
app.post('/api/admin/alterar-senha', verificarToken, async (req, res) => {
    try {
        if (req.usuario.tipo !== 'admin') {
            return res.status(403).json({ error: 'Acesso negado' });
        }
        const { novaSenha } = req.body;
        await alterarSenhaAdmin(novaSenha);
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Validar senha do usuário logado
app.post('/api/validar-senha', verificarToken, async (req, res) => {
    try {
        const { senha } = req.body;

        if (!senha) {
            return res.status(400).json({ error: 'Senha é obrigatória' });
        }

        // Buscar usuário no banco
        const usuario = await get('SELECT senha_hash FROM usuarios WHERE id = ?', [req.usuario.id]);

        if (!usuario) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }

        // Verificar senha
        const bcrypt = require('bcryptjs');
        const senhaValida = await bcrypt.compare(senha, usuario.senha_hash);

        if (!senhaValida) {
            return res.status(401).json({ error: 'Senha incorreta' });
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Erro na validação de senha:', err);
        res.status(500).json({ error: err.message });
    }
});

// Deletar movimentação (para usuários logados com senha confirmada)
app.delete('/api/admin/deletar-movimentacao', verificarToken, async (req, res) => {
    try {
        console.log('Usuário tentando deletar movimentação:', req.usuario);

        // Verificar apenas se o usuário está autenticado (tem ID e nome)
        if (!req.usuario.id || !req.usuario.nome) {
            console.log('Acesso negado - usuário não autenticado corretamente');
            return res.status(403).json({ error: 'Acesso negado - usuário não autenticado corretamente' });
        }

        const { movimentacao_id, justificativa } = req.body;

        if (!movimentacao_id || !justificativa) {
            return res.status(400).json({ error: 'ID da movimentação e justificativa são obrigatórios' });
        }

        if (justificativa.length < 10) {
            return res.status(400).json({ error: 'Justificativa deve ter pelo menos 10 caracteres' });
        }

        // Buscar detalhes da movimentação antes de deletar
        const movimentacao = await get(`
            SELECT m.*, a.numero_aih 
            FROM movimentacoes m 
            JOIN aihs a ON m.aih_id = a.id 
            WHERE m.id = ?
        `, [movimentacao_id]);

        if (!movimentacao) {
            return res.status(404).json({ error: 'Movimentação não encontrada' });
        }

        // Registrar log de exclusão
        await run(`
            INSERT INTO logs_exclusao (
                tipo_exclusao, usuario_id, dados_excluidos, justificativa, 
                ip_origem, user_agent, data_exclusao
            ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `, [
            'movimentacao',
            req.usuario.id,
            JSON.stringify({
                id: movimentacao.id,
                numero_aih: movimentacao.numero_aih,
                tipo: movimentacao.tipo,
                data_movimentacao: movimentacao.data_movimentacao,
                valor_conta: movimentacao.valor_conta,
                prof_medicina: movimentacao.prof_medicina,
                prof_enfermagem: movimentacao.prof_enfermagem,
                prof_fisioterapia: movimentacao.prof_fisioterapia,
                prof_bucomaxilo: movimentacao.prof_bucomaxilo
            }),
            justificativa,
            req.ip || req.connection.remoteAddress,
            req.get('User-Agent') || 'Unknown'
        ]);

        // Deletar movimentação
        await run('DELETE FROM movimentacoes WHERE id = ?', [movimentacao_id]);

        console.log(`✅ Movimentação ${movimentacao_id} da AIH ${movimentacao.numero_aih} deletada por ${req.usuario.nome}`);

        res.json({ 
            success: true, 
            message: 'Movimentação deletada com sucesso',
            movimentacao_deletada: {
                id: movimentacao_id,
                aih: movimentacao.numero_aih,
                tipo: movimentacao.tipo
            }
        });

    } catch (err) {
        console.error('Erro ao deletar movimentação:', err);
        res.status(500).json({ error: err.message });
    }
});

// Deletar AIH completa (para usuários logados com senha confirmada)
app.delete('/api/admin/deletar-aih', verificarToken, async (req, res) => {
    try {
        console.log('Usuário tentando deletar AIH:', req.usuario);

        // Verificar apenas se o usuário está autenticado (tem ID e nome)
        if (!req.usuario.id || !req.usuario.nome) {
            console.log('Acesso negado - usuário não autenticado corretamente');
            return res.status(403).json({ error: 'Acesso negado - usuário não autenticado corretamente' });
        }

        const { numero_aih, justificativa } = req.body;

        if (!numero_aih || !justificativa) {
            return res.status(400).json({ error: 'Número da AIH e justificativa são obrigatórios' });
        }

        if (justificativa.length < 10) {
            return res.status(400).json({ error: 'Justificativa deve ter pelo menos 10 caracteres' });
        }

        // Buscar AIH e todos os dados relacionados
        const aih = await get('SELECT * FROM aihs WHERE numero_aih = ?', [numero_aih]);

        if (!aih) {
            return res.status(404).json({ error: 'AIH não encontrada' });
        }

        const movimentacoes = await all('SELECT * FROM movimentacoes WHERE aih_id = ?', [aih.id]);
        const glosas = await all('SELECT * FROM glosas WHERE aih_id = ?', [aih.id]);
        const atendimentos = await all('SELECT * FROM atendimentos WHERE aih_id = ?', [aih.id]);

        // Registrar log de exclusão com todos os dados
        await run(`
            INSERT INTO logs_exclusao (
                tipo_exclusao, usuario_id, dados_excluidos, justificativa, 
                ip_origem, user_agent, data_exclusao
            ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `, [
            'aih_completa',
            req.usuario.id,
            JSON.stringify({
                aih: aih,
                movimentacoes: movimentacoes,
                glosas: glosas,
                atendimentos: atendimentos,
                totais: {
                    movimentacoes: movimentacoes.length,
                    glosas: glosas.length,
                    atendimentos: atendimentos.length
                }
            }),
            justificativa,
            req.ip || req.connection.remoteAddress,
            req.get('User-Agent') || 'Unknown'
        ]);

        // Usar transação para deletar tudo
        const operations = [
            { sql: 'DELETE FROM glosas WHERE aih_id = ?', params: [aih.id] },
            { sql: 'DELETE FROM movimentacoes WHERE aih_id = ?', params: [aih.id] },
            { sql: 'DELETE FROM atendimentos WHERE aih_id = ?', params: [aih.id] },
            { sql: 'DELETE FROM aihs WHERE id = ?', params: [aih.id] }
        ];

        await runTransaction(operations);

        console.log(`✅ AIH ${numero_aih} completamente deletada por ${req.usuario.nome} - ${movimentacoes.length} movimentações, ${glosas.length} glosas, ${atendimentos.length} atendimentos`);

        res.json({ 
            success: true, 
            message: 'AIH deletada completamente com sucesso',
            aih_deletada: {
                numero_aih: numero_aih,
                movimentacoes_removidas: movimentacoes.length,
                glosas_removidas: glosas.length,
                atendimentos_removidos: atendimentos.length
            }
        });

    } catch (err) {
        console.error('Erro ao deletar AIH:', err);
        res.status(500).json({ error: err.message });
    }
});

// Dashboard aprimorado com filtro por competência
app.get('/api/dashboard', verificarToken, async (req, res) => {
    try {
        console.log('📊 Carregando dashboard para usuário:', req.usuario?.nome);
        
        // Pegar competência da query ou usar atual
        const competencia = req.query.competencia || getCompetenciaAtual();
        console.log('📅 Competência selecionada:', competencia);

        // 1. AIH em processamento na competência - consulta otimizada
        const processamentoCompetencia = await get(`
            SELECT 
                COUNT(DISTINCT CASE WHEN m.tipo = 'entrada_sus' THEN m.aih_id END) as entradas,
                COUNT(DISTINCT CASE WHEN m.tipo = 'saida_hospital' THEN m.aih_id END) as saidas
            FROM movimentacoes m
            WHERE m.competencia = ?
        `, [competencia], true); // Usar cache

        const emProcessamentoCompetencia = (processamentoCompetencia.entradas || 0) - (processamentoCompetencia.saidas || 0);

        // 2. AIH finalizadas na competência (status 1 e 4)
        const finalizadasCompetencia = await get(`
            SELECT COUNT(*) as count 
            FROM aihs 
            WHERE status IN (1, 4) 
            AND competencia = ?
        `, [competencia]);

        // 3. AIH com pendências/glosas na competência (status 2 e 3)
        const comPendenciasCompetencia = await get(`
            SELECT COUNT(*) as count 
            FROM aihs 
            WHERE status IN (2, 3) 
            AND competencia = ?
        `, [competencia]);

        // 4. Total geral de entradas SUS vs saídas Hospital (desde o início)
        const totalEntradasSUS = await get(`
            SELECT COUNT(DISTINCT aih_id) as count 
            FROM movimentacoes 
            WHERE tipo = 'entrada_sus'
        `);

        const totalSaidasHospital = await get(`
            SELECT COUNT(DISTINCT aih_id) as count 
            FROM movimentacoes 
            WHERE tipo = 'saida_hospital'
        `);

        const totalEmProcessamento = (totalEntradasSUS.count || 0) - (totalSaidasHospital.count || 0);

        // 5. Total de AIHs finalizadas desde o início (status 1 e 4)
        const totalFinalizadasGeral = await get(`
            SELECT COUNT(*) as count 
            FROM aihs 
            WHERE status IN (1, 4)
        `);

        // 6. Total de AIHs cadastradas desde o início
        const totalAIHsGeral = await get(`
            SELECT COUNT(*) as count 
            FROM aihs
        `);

        // Dados adicionais para contexto
        const totalAIHsCompetencia = await get(`
            SELECT COUNT(*) as count 
            FROM aihs 
            WHERE competencia = ?
        `, [competencia]);

        // Lista de competências disponíveis
        const competenciasDisponiveis = await all(`
            SELECT DISTINCT competencia 
            FROM aihs 
            ORDER BY 
                CAST(SUBSTR(competencia, 4, 4) AS INTEGER) DESC,
                CAST(SUBSTR(competencia, 1, 2) AS INTEGER) DESC
        `);

        // Estatísticas de valores para a competência
        const valoresGlosasPeriodo = await get(`
            SELECT 
                SUM(valor_inicial) as valor_inicial_total,
                SUM(valor_atual) as valor_atual_total,
                AVG(valor_inicial - valor_atual) as media_glosa
            FROM aihs 
            WHERE competencia = ?
        `, [competencia]);

        res.json({
            competencia_selecionada: competencia,
            competencias_disponiveis: competenciasDisponiveis.map(c => c.competencia),

            // Métricas da competência
            em_processamento_competencia: emProcessamentoCompetencia,
            finalizadas_competencia: finalizadasCompetencia.count,
            com_pendencias_competencia: comPendenciasCompetencia.count,
            total_aihs_competencia: totalAIHsCompetencia.count,

            // Métricas gerais (desde o início)
            total_entradas_sus: totalEntradasSUS.count,
            total_saidas_hospital: totalSaidasHospital.count,
            total_em_processamento_geral: totalEmProcessamento,
            total_finalizadas_geral: totalFinalizadasGeral.count,
            total_aihs_geral: totalAIHsGeral.count,

            // Valores financeiros da competência
            valores_competencia: {
                inicial: valoresGlosasPeriodo.valor_inicial_total || 0,
                atual: valoresGlosasPeriodo.valor_atual_total || 0,
                media_glosa: valoresGlosasPeriodo.media_glosa || 0
            }
        });
    } catch (err) {
        console.error('❌ Erro no dashboard:', {
            message: err.message,
            stack: err.stack,
            usuario: req.usuario?.nome,
            competencia: req.query.competencia
        });
        res.status(500).json({ 
            error: err.message,
            details: process.env.NODE_ENV === 'development' ? err.stack : undefined
        });
    }
});

// Helper para obter competência atual
const getCompetenciaAtual = () => {
    const hoje = new Date();
    const mes = String(hoje.getMonth() + 1).padStart(2, '0');
    const ano = hoje.getFullYear();
    return `${mes}/${ano}`;
};

// Buscar AIH
app.get('/api/aih/:numero', verificarToken, async (req, res) => {
    try {
        const aih = await get(
            'SELECT * FROM aihs WHERE numero_aih = ?',
            [req.params.numero]
        );

        if (!aih) {
            return res.status(404).json({ error: 'AIH não encontrada' });
        }

        const atendimentos = await all(
            'SELECT numero_atendimento FROM atendimentos WHERE aih_id = ?',
            [aih.id]
        );

        const movimentacoes = await all(
            'SELECT * FROM movimentacoes WHERE aih_id = ? ORDER BY data_movimentacao DESC',
            [aih.id]
        );

        const glosas = await all(
            'SELECT * FROM glosas WHERE aih_id = ? AND ativa = 1',
            [aih.id]
        );

        res.json({
            ...aih,
            atendimentos: atendimentos.map(a => a.numero_atendimento),
            movimentacoes,
            glosas
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Cadastrar AIH com transação robusta
app.post('/api/aih', verificarToken, async (req, res) => {
    try {
        const dadosAIH = { ...req.body };

        console.log('📝 Dados recebidos no servidor:', { 
            numero_aih: dadosAIH.numero_aih, 
            valor_inicial: dadosAIH.valor_inicial, 
            competencia: dadosAIH.competencia, 
            atendimentos: dadosAIH.atendimentos, 
            tipo_atendimentos: typeof dadosAIH.atendimentos,
            eh_array: Array.isArray(dadosAIH.atendimentos)
        });

        // Validações rigorosas usando função específica
        const validationErrors = validateAIH(dadosAIH);
        if (validationErrors.length > 0) {
            console.log('❌ Erros de validação:', validationErrors);
            return res.status(400).json({ error: validationErrors.join(', ') });
        }

        const { numero_aih, valor_inicial, competencia, atendimentos } = dadosAIH;

        // Processar atendimentos - aceitar array, string ou objeto
        let atendimentosProcessados = [];

        if (typeof atendimentos === 'string') {
            atendimentosProcessados = atendimentos.split(/[,\n\r]/)
                .map(a => a.trim())
                .filter(a => a && a.length > 0 && a.length <= 50); // Limitar tamanho
        } else if (Array.isArray(atendimentos)) {
            atendimentosProcessados = atendimentos
                .map(a => String(a).trim())
                .filter(a => a && a.length > 0 && a.length <= 50);
        } else if (typeof atendimentos === 'object' && atendimentos !== null) {
            atendimentosProcessados = Object.values(atendimentos)
                .map(a => String(a).trim())
                .filter(a => a && a.length > 0 && a.length <= 50);
        }

        console.log('🔄 Atendimentos processados:', atendimentosProcessados);

        if (atendimentosProcessados.length === 0) {
            console.log('❌ Nenhum atendimento válido encontrado');
            return res.status(400).json({ error: 'Pelo menos um número de atendimento válido deve ser informado' });
        }

        if (atendimentosProcessados.length > 100) {
            return res.status(400).json({ error: 'Muitos atendimentos informados (máximo 100)' });
        }

        // Verificar se já existe (com cache para performance)
        const existe = await get('SELECT id FROM aihs WHERE numero_aih = ?', [numero_aih], true);
        if (existe) {
            console.log('❌ AIH já existe');
            return res.status(400).json({ error: 'AIH já cadastrada' });
        }

        // Usar transação para garantir consistência
        const operations = [
            {
                sql: `INSERT INTO aihs (numero_aih, valor_inicial, valor_atual, competencia, usuario_cadastro_id, status) 
                      VALUES (?, ?, ?, ?, ?, 3)`,
                params: [numero_aih, parseFloat(valor_inicial), parseFloat(valor_inicial), competencia, req.usuario.id]
            }
        ];

        const results = await runTransaction(operations);
        const aihId = results[0].id;

        // Inserir atendimentos em lote (mais eficiente)
        const atendimentosOperations = atendimentosProcessados.map(atend => ({
            sql: 'INSERT INTO atendimentos (aih_id, numero_atendimento) VALUES (?, ?)',
            params: [aihId, atend.trim()]
        }));

        if (atendimentosOperations.length > 0) {
            await runTransaction(atendimentosOperations);
        }

        // Primeira movimentação (entrada SUS) - OBRIGATÓRIA
        await run(
            `INSERT INTO movimentacoes (aih_id, tipo, usuario_id, valor_conta, competencia, status_aih, observacoes, data_movimentacao) 
             VALUES (?, 'entrada_sus', ?, ?, ?, 3, ?, CURRENT_TIMESTAMP)`,
            [aihId, req.usuario.id, parseFloat(valor_inicial), competencia, 'Entrada inicial da AIH na Auditoria SUS']
        );

        // Log de auditoria
        await logAcao(req.usuario.id, `Cadastrou AIH ${numero_aih}`);

        // Limpar cache relacionado
        clearCache('aihs');
        clearCache('dashboard');

        console.log(`✅ AIH ${numero_aih} cadastrada com sucesso - ID: ${aihId} - Atendimentos: ${atendimentosProcessados.length}`);

        res.json({ 
            success: true, 
            id: aihId, 
            numero_aih, 
            atendimentos_inseridos: atendimentosProcessados.length,
            valor_inicial: parseFloat(valor_inicial),
            competencia 
        });

    } catch (err) {
        console.error('❌ Erro ao cadastrar AIH:', err);
        res.status(500).json({ error: 'Erro interno do servidor ao cadastrar AIH' });
    }
});

// Obter próxima movimentação possível
app.get('/api/aih/:id/proxima-movimentacao', verificarToken, async (req, res) => {
    try {
        const aihId = req.params.id;

        // Buscar última movimentação
        const ultimaMovimentacao = await get(
            'SELECT tipo FROM movimentacoes WHERE aih_id = ? ORDER BY data_movimentacao DESC LIMIT 1',
            [aihId]
        );

        let proximoTipo, proximaDescricao, explicacao;

        if (!ultimaMovimentacao) {
            // Primeira movimentação sempre é entrada SUS
            proximoTipo = 'entrada_sus';
            proximaDescricao = 'Entrada na Auditoria SUS';
            explicacao = 'Esta é a primeira movimentação da AIH. Deve ser registrada como entrada na Auditoria SUS.';
        } else if (ultimaMovimentacao.tipo === 'entrada_sus') {
            // Se última foi entrada SUS, próxima deve ser saída hospital
            proximoTipo = 'saida_hospital';
            proximaDescricao = 'Saída para Auditoria Hospital';
            explicacao = 'A última movimentação foi entrada na Auditoria SUS. A próxima deve ser saída para Auditoria Hospital.';
        } else {
            // Se última foi saída hospital, próxima deve ser entrada SUS
            proximoTipo = 'entrada_sus';
            proximaDescricao = 'Entrada na Auditoria SUS';
            explicacao = 'A última movimentação foi saída para Hospital. A próxima deve ser entrada na Auditoria SUS.';
        }

        res.json({
            proximo_tipo: proximoTipo,
            descricao: proximaDescricao,
            explicacao: explicacao,
            ultima_movimentacao: ultimaMovimentacao?.tipo || null
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Buscar última movimentação com profissionais para pré-seleção
app.get('/api/aih/:id/ultima-movimentacao', verificarToken, async (req, res) => {
    try {
        const aihId = req.params.id;

        // Buscar última movimentação com todos os dados dos profissionais
        const ultimaMovimentacao = await get(
            `SELECT * FROM movimentacoes 
             WHERE aih_id = ? AND 
                   (prof_medicina IS NOT NULL OR prof_enfermagem IS NOT NULL OR 
                    prof_fisioterapia IS NOT NULL OR prof_bucomaxilo IS NOT NULL)
             ORDER BY data_movimentacao DESC LIMIT 1`,
            [aihId]
        );

        if (!ultimaMovimentacao) {
            return res.json({ 
                success: true, 
                movimentacao: null, 
                message: 'Nenhuma movimentação anterior com profissionais encontrada' 
            });
        }

        res.json({
            success: true,
            movimentacao: {
                prof_medicina: ultimaMovimentacao.prof_medicina,
                prof_enfermagem: ultimaMovimentacao.prof_enfermagem,
                prof_fisioterapia: ultimaMovimentacao.prof_fisioterapia,
                prof_bucomaxilo: ultimaMovimentacao.prof_bucomaxilo,
                data_movimentacao: ultimaMovimentacao.data_movimentacao,
                tipo: ultimaMovimentacao.tipo
            }
        });
    } catch (err) {
        console.error('Erro ao buscar última movimentação:', err);
        res.status(500).json({ error: err.message });
    }
});

// Nova movimentação
app.post('/api/aih/:id/movimentacao', verificarToken, async (req, res) => {
    try {
        const aihId = req.params.id;
        const {
            tipo, status_aih, valor_conta, competencia,
            prof_medicina, prof_enfermagem, prof_fisioterapia, prof_bucomaxilo, observacoes
        } = req.body;

        // Validação de profissionais obrigatórios
        const errosValidacao = [];

        // Enfermagem é SEMPRE obrigatória
        if (!prof_enfermagem || prof_enfermagem.trim() === '') {
            errosValidacao.push('Profissional de Enfermagem é obrigatório');
        }

        // Pelo menos um entre Medicina ou Bucomaxilo deve ser preenchido
        const temMedicina = prof_medicina && prof_medicina.trim() !== '';
        const temBucomaxilo = prof_bucomaxilo && prof_bucomaxilo.trim() !== '';

        if (!temMedicina && !temBucomaxilo) {
            errosValidacao.push('É necessário informar pelo menos um profissional de Medicina ou Cirurgião Bucomaxilo');
        }

        if (errosValidacao.length > 0) {
            return res.status(400).json({ 
                error: `Profissionais obrigatórios não informados: ${errosValidacao.join('; ')}` 
            });
        }

        // Validar se o tipo está correto conforme a sequência
        const ultimaMovimentacao = await get(
            'SELECT tipo FROM movimentacoes WHERE aih_id = ? ORDER BY data_movimentacao DESC LIMIT 1',
            [aihId]
        );

        let tipoPermitido;
        if (!ultimaMovimentacao) {
            tipoPermitido = 'entrada_sus';
        } else if (ultimaMovimentacao.tipo === 'entrada_sus') {
            tipoPermitido = 'saida_hospital';
        } else {
            tipoPermitido = 'entrada_sus';
        }

        if (tipo !== tipoPermitido) {
            return res.status(400).json({ 
                error: `Tipo de movimentação inválido. Esperado: ${tipoPermitido}, recebido: ${tipo}` 
            });
        }

        // Inserir movimentação
        await run(
            `INSERT INTO movimentacoes 
             (aih_id, tipo, usuario_id, valor_conta, competencia, 
              prof_medicina, prof_enfermagem, prof_fisioterapia, prof_bucomaxilo, status_aih, observacoes) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [aihId, tipo, req.usuario.id, valor_conta, competencia,
             prof_medicina, prof_enfermagem, prof_fisioterapia, prof_bucomaxilo, status_aih, observacoes]
        );

        // Atualizar AIH
        await run(
            'UPDATE aihs SET status = ?, valor_atual = ? WHERE id = ?',
            [status_aih, valor_conta, aihId]
        );

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Glosas
app.get('/api/aih/:id/glosas', verificarToken, async (req, res) => {
    try {
        const glosas = await all(
            'SELECT * FROM glosas WHERE aih_id = ? AND ativa = 1',
            [req.params.id]
        );
        res.json({ glosas });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/aih/:id/glosas', verificarToken, async (req, res) => {
    try {
        const { linha, tipo, profissional, quantidade } = req.body;

        // Validar dados obrigatórios
        if (!linha || !tipo || !profissional) {
            return res.status(400).json({ error: 'Linha, tipo e profissional são obrigatórios' });
        }

        const result = await run(
            'INSERT INTO glosas (aih_id, linha, tipo, profissional, quantidade) VALUES (?, ?, ?, ?, ?)',
            [req.params.id, linha, tipo, profissional, quantidade || 1]
        );

        // Log da ação
        await logAcao(req.usuario.id, `Adicionou glosa na AIH ID ${req.params.id}: ${linha} - ${tipo}`);

        res.json({ success: true, id: result.id });
    } catch (err) {
        console.error('Erro ao adicionar glosa:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/glosas/:id', verificarToken, async (req, res) => {
    try {
        await run('UPDATE glosas SET ativa = 0 WHERE id = ?', [req.params.id]);

        // Log da ação
        await logAcao(req.usuario.id, `Removeu glosa ID ${req.params.id}`);

        res.json({ success: true });
    } catch (err) {
        console.error('Erro ao remover glosa:', err);
        res.status(500).json({ error: err.message });
    }
});

// Tipos de Glosa
app.get('/api/tipos-glosa', verificarToken, async (req, res) => {
    try {
        const tipos = await all('SELECT * FROM tipos_glosa ORDER BY descricao');
        res.json({ tipos });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/tipos-glosa', verificarToken, async (req, res) => {
    try {
        const { descricao } = req.body;
        const result = await run('INSERT INTO tipos_glosa (descricao) VALUES (?)', [descricao]);
        res.json({ success: true, id: result.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/tipos-glosa/:id', verificarToken, async (req, res) => {
    try {
        await run('DELETE FROM tipos_glosa WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Pesquisa avançada
app.post('/api/pesquisar', verificarToken, async (req, res) => {
    try {
        const { filtros } = req.body;
        let sql = `SELECT a.*, COUNT(g.id) as total_glosas 
                   FROM aihs a 
                   LEFT JOIN glosas g ON a.id = g.aih_id AND g.ativa = 1 
                   WHERE 1=1`;
        const params = [];

        // Filtro especial para AIHs em processamento por competência
        if (filtros.em_processamento_competencia) {
            const competencia = filtros.em_processamento_competencia;

            // Buscar AIHs que tiveram entrada SUS mas não saída hospital na competência específica
            sql = `
                SELECT a.*, COUNT(g.id) as total_glosas 
                FROM aihs a 
                LEFT JOIN glosas g ON a.id = g.aih_id AND g.ativa = 1 
                WHERE a.id IN (
                    SELECT DISTINCT m1.aih_id 
                    FROM movimentacoes m1 
                    WHERE m1.tipo = 'entrada_sus' 
                    AND m1.competencia = ?
                    AND m1.aih_id NOT IN (
                        SELECT DISTINCT m2.aih_id 
                        FROM movimentacoes m2 
                        WHERE m2.tipo = 'saida_hospital' 
                        AND m2.competencia = ?
                    )
                )
            `;
            params.push(competencia, competencia);
        }
        // Filtro especial para AIHs em processamento geral
        else if (filtros.em_processamento_geral) {
            sql = `
                SELECT a.*, COUNT(g.id) as total_glosas 
                FROM aihs a 
                LEFT JOIN glosas g ON a.id = g.aih_id AND g.ativa = 1 
                WHERE a.id IN (
                    SELECT DISTINCT m1.aih_id 
                    FROM movimentacoes m1 
                    WHERE m1.tipo = 'entrada_sus' 
                    AND m1.aih_id NOT IN (
                        SELECT DISTINCT m2.aih_id 
                        FROM movimentacoes m2 
                        WHERE m2.tipo = 'saida_hospital'
                    )
                )
            `;
        }
        else {
            // Filtros normais
            if (filtros.status?.length) {
                sql += ` AND a.status IN (${filtros.status.map(() => '?').join(',')})`;
                params.push(...filtros.status);
            }

            if (filtros.competencia) {
                sql += ' AND a.competencia = ?';
                params.push(filtros.competencia);
            }

            if (filtros.data_inicio) {
                sql += ' AND a.criado_em >= ?';
                params.push(filtros.data_inicio);
            }

            if (filtros.data_fim) {
                sql += ' AND a.criado_em <= ?';
                params.push(filtros.data_fim + ' 23:59:59');
            }

            if (filtros.valor_min) {
                sql += ' AND a.valor_atual >= ?';
                params.push(filtros.valor_min);
            }

            if (filtros.valor_max) {
                sql += ' AND a.valor_atual <= ?';
                params.push(filtros.valor_max);
            }

            if (filtros.numero_aih) {
                sql += ' AND a.numero_aih LIKE ?';
                params.push(`%${filtros.numero_aih}%`);
            }

            if (filtros.numero_atendimento) {
                sql += ` AND a.id IN (
                    SELECT DISTINCT aih_id FROM atendimentos 
                    WHERE numero_atendimento LIKE ?
                )`;
                params.push(`%${filtros.numero_atendimento}%`);
            }

            if (filtros.profissional) {
                sql += ` AND a.id IN (
                    SELECT DISTINCT aih_id FROM movimentacoes 
                    WHERE prof_medicina LIKE ? OR prof_enfermagem LIKE ? 
                    OR prof_fisioterapia LIKE ? OR prof_bucomaxilo LIKE ?
                )`;
                const prof = `%${filtros.profissional}%`;
                params.push(prof, prof, prof, prof);
            }
        }

        sql += ' GROUP BY a.id ORDER BY a.criado_em DESC';

        const resultados = await all(sql, params);
        res.json({ resultados });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Profissionais
app.get('/api/profissionais', verificarToken, async (req, res) => {
    try {
        const profissionais = await all('SELECT * FROM profissionais');
        res.json({ profissionais });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/profissionais', verificarToken, async (req, res) => {
    try {
        const { nome, especialidade } = req.body;
        const result = await run(
            'INSERT INTO profissionais (nome, especialidade) VALUES (?, ?)',
            [nome, especialidade]
        );
        res.json({ success: true, id: result.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/profissionais/:id', verificarToken, async (req, res) => {
    try {
        await run('DELETE FROM profissionais WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Limpar rate limit (apenas para desenvolvimento)
app.post('/api/admin/clear-rate-limit', verificarToken, (req, res) => {
    try {
        if (req.usuario.tipo !== 'admin') {
            return res.status(403).json({ error: 'Acesso negado' });
        }
        const { ip } = req.body;
        clearRateLimit(ip);
        res.json({ success: true, message: 'Rate limit limpo com sucesso' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Estatísticas do sistema (admin)
app.get('/api/admin/stats', verificarToken, async (req, res) => {
    try {
        if (req.usuario.tipo !== 'admin') {
            return res.status(403).json({ error: 'Acesso negado' });
        }

        const stats = await getDbStats();
        res.json({ success: true, stats });
    } catch (err) {
        console.error('Erro ao obter estatísticas:', err);
        res.status(500).json({ error: err.message });
    }
});

// Logs de segurança (admin)
app.get('/api/admin/security-logs', verificarToken, (req, res) => {
    try {
        if (req.usuario.tipo !== 'admin') {
            return res.status(403).json({ error: 'Acesso negado' });
        }

        const logs = getSecurityLogs();
        res.json({ success: true, logs });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Limpar cache manualmente (admin)
app.post('/api/admin/clear-cache', verificarToken, (req, res) => {
    try {
        if (req.usuario.tipo !== 'admin') {
            return res.status(403).json({ error: 'Acesso negado' });
        }

        const { pattern } = req.body;
        clearCache(pattern);
        res.json({ success: true, message: 'Cache limpo com sucesso' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Backup manual (admin)
app.post('/api/admin/backup', verificarToken, async (req, res) => {
    try {
        if (req.usuario.tipo !== 'admin') {
            return res.status(403).json({ error: 'Acesso negado' });
        }

        const backupPath = await createBackup();
        res.json({ success: true, message: 'Backup criado com sucesso', path: backupPath });
    } catch (err) {
        console.error('Erro ao criar backup:', err);
        res.status(500).json({ error: err.message });
    }
});

// Health check endpoint
app.get('/api/health', async (req, res) => {
    try {
        const stats = await getDbStats();
        const health = {
            status: 'ok',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            database: {
                total_aihs: stats?.total_aihs || 0,
                db_size: stats?.db_size_mb || 0,
                connections: stats?.pool_connections || 0
            }
        };

        res.json(health);
    } catch (err) {
        res.status(500).json({ 
            status: 'error', 
            timestamp: new Date().toISOString(),
            error: err.message 
        });
    }
});

// Backup do banco de dados SQLite
app.get('/api/backup', verificarToken, async (req, res) => {
    try {
        const fs = require('fs');
        const dbPath = path.join(__dirname, 'db', 'aih.db');

        // Verificar se o arquivo existe
        if (!fs.existsSync(dbPath)) {
            return res.status(404).json({ error: 'Arquivo de banco de dados não encontrado' });
        }

        // Fazer checkpoint do WAL antes do backup para garantir consistência
        await run("PRAGMA wal_checkpoint(FULL)");

        const nomeArquivo = `backup-aih-${new Date().toISOString().split('T')[0]}.db`;

        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);
        res.setHeader('Cache-Control', 'no-cache');

        // Usar createReadStream para arquivos grandes
        const fileStream = fs.createReadStream(dbPath);
        fileStream.pipe(res);

        fileStream.on('error', (err) => {
            console.error('Erro ao fazer backup:', err);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Erro ao fazer backup do banco de dados' });
            }
        });

        console.log(`Backup do banco iniciado: ${nomeArquivo}`);

    } catch (err) {
        console.error('Erro no backup:', err);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Erro interno ao fazer backup' });
        }
    }
});

// Backup completo programático (para admins)
app.post('/api/admin/backup-completo', verificarToken, async (req, res) => {
    try {
        if (req.usuario.tipo !== 'admin') {
            return res.status(403).json({ error: 'Acesso negado' });
        }

        const backupPath = await createBackup();
        res.json({ 
            success: true, 
            message: 'Backup completo criado com sucesso', 
            path: backupPath,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.error('Erro ao criar backup completo:', err);
        res.status(500).json({ error: err.message });
    }
});

// Export completo de todos os dados da base
app.get('/api/export/:formato', verificarToken, async (req, res) => {
    try {
        console.log(`Iniciando exportação completa em formato: ${req.params.formato}`);

        // Buscar TODOS os dados da base de dados
        const aihs = await all(`
            SELECT a.*, 
                   COUNT(DISTINCT g.id) as total_glosas,
                   GROUP_CONCAT(DISTINCT at.numero_atendimento, ', ') as atendimentos,
                   u.nome as usuario_cadastro_nome,
                   COUNT(DISTINCT m.id) as total_movimentacoes
            FROM aihs a
            LEFT JOIN glosas g ON a.id = g.aih_id AND g.ativa = 1
            LEFT JOIN atendimentos at ON a.id = at.aih_id
            LEFT JOIN usuarios u ON a.usuario_cadastro_id = u.id
            LEFT JOIN movimentacoes m ON a.id = m.aih_id
            GROUP BY a.id
            ORDER BY a.criado_em DESC
        `);

        // Buscar todas as movimentações
        const movimentacoes = await all(`
            SELECT m.*, u.nome as usuario_nome, a.numero_aih
            FROM movimentacoes m
            LEFT JOIN usuarios u ON m.usuario_id = u.id
            LEFT JOIN aihs a ON m.aih_id = a.id
            ORDER BY m.data_movimentacao DESC
        `);

        // Buscar todas as glosas ativas
        const glosas = await all(`
            SELECT g.*, a.numero_aih
            FROM glosas g
            LEFT JOIN aihs a ON g.aih_id = a.id
            WHERE g.ativa = 1
            ORDER BY g.criado_em DESC
        `);

        // Buscar todos os usuários
        const usuarios = await all(`
            SELECT id, nome, matricula, criado_em
            FROM usuarios
            ORDER BY criado_em DESC
        `);

        // Buscar todos os profissionais
        const profissionais = await all(`
            SELECT * FROM profissionais
            ORDER BY nome
        `);

        // Buscar tipos de glosa
        const tiposGlosa = await all(`
            SELECT * FROM tipos_glosa
            ORDER BY descricao
        `);

        const nomeBase = `export-completo-aih-${new Date().toISOString().split('T')[0]}`;

        if (req.params.formato === 'json') {
            // Export JSON estruturado completo
            const dadosCompletos = {
                metadata: {
                    exportado_em: new Date().toISOString(),
                    usuario_export: req.usuario.nome,
                    versao_sistema: '2.0',
                    total_aihs: aihs.length,
                    total_movimentacoes: movimentacoes.length,
                    total_glosas_ativas: glosas.length,
                    total_usuarios: usuarios.length,
                    total_profissionais: profissionais.length
                },
                aihs: aihs.map(a => ({
                    ...a,
                    atendimentos: a.atendimentos ? a.atendimentos.split(', ') : [],
                    status_descricao: getStatusExcel(a.status)
                })),
                movimentacoes: movimentacoes.map(m => ({
                    ...m,
                    tipo_descricao: m.tipo === 'entrada_sus' ? 'Entrada na Auditoria SUS' : 'Saída para Auditoria Hospital',
                    status_descricao: getStatusExcel(m.status_aih)
                })),
                glosas: glosas,
                usuarios: usuarios,
                profissionais: profissionais,
                tipos_glosa: tiposGlosa
            };

            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${nomeBase}.json"`);
            res.setHeader('Cache-Control', 'no-cache');
            return res.json(dadosCompletos);

        } else if (req.params.formato === 'excel') {
            // Excel com múltiplas abas para todos os dados
            const workbook = XLSX.utils.book_new();

            // Aba 1: AIHs
            const dadosAIHs = aihs.map((a, index) => {
                const diferenca = (a.valor_inicial || 0) - (a.valor_atual || 0);
                return {
                    'ID': a.id,
                    'Número AIH': a.numero_aih || '',
                    'Valor Inicial': a.valor_inicial || 0,
                    'Valor Atual': a.valor_atual || 0,
                    'Diferença (Glosas)': diferenca,
                    'Percentual Glosa': a.valor_inicial > 0 ? ((diferenca / a.valor_inicial) * 100).toFixed(2) + '%' : '0%',
                    'Status Código': a.status,
                    'Status Descrição': getStatusExcel(a.status),
                    'Competência': a.competencia || '',
                    'Total Glosas': a.total_glosas || 0,
                    'Total Movimentações': a.total_movimentacoes || 0,
                    'Atendimentos': a.atendimentos || '',
                    'Usuário Cadastro': a.usuario_cadastro_nome || '',
                    'Data Criação': new Date(a.criado_em).toLocaleDateString('pt-BR'),
                    'Hora Criação': new Date(a.criado_em).toLocaleTimeString('pt-BR')
                };
            });
            const wsAIHs = XLSX.utils.json_to_sheet(dadosAIHs);
            XLSX.utils.book_append_sheet(workbook, wsAIHs, 'AIHs');

            // Aba 2: Movimentações
            const dadosMovimentacoes = movimentacoes.map(m => ({
                'ID': m.id,
                'AIH ID': m.aih_id,
                'Número AIH': m.numero_aih || '',
                'Tipo': m.tipo === 'entrada_sus' ? 'Entrada SUS' : 'Saída Hospital',
                'Data/Hora': new Date(m.data_movimentacao).toLocaleString('pt-BR'),
                'Usuário': m.usuario_nome || '',
                'Valor Conta': m.valor_conta || 0,
                'Competência': m.competencia || '',
                'Prof. Medicina': m.prof_medicina || '',
                'Prof. Enfermagem': m.prof_enfermagem || '',
                'Prof. Fisioterapia': m.prof_fisioterapia || '',
                'Prof. Bucomaxilo': m.prof_bucomaxilo || '',
                'Status AIH': getStatusExcel(m.status_aih),
                'Observações': m.observacoes || ''
            }));
            const wsMovimentacoes = XLSX.utils.json_to_sheet(dadosMovimentacoes);
            XLSX.utils.book_append_sheet(workbook, wsMovimentacoes, 'Movimentações');

            // Aba 3: Glosas
            const dadosGlosas = glosas.map(g => ({
                'ID': g.id,
                'AIH ID': g.aih_id,
                'Número AIH': g.numero_aih || '',
                'Linha': g.linha,
                'Tipo': g.tipo,
                'Profissional': g.profissional,
                'Quantidade': g.quantidade || 1,
                'Ativa': g.ativa ? 'Sim' : 'Não',
                'Data Criação': new Date(g.criado_em).toLocaleDateString('pt-BR'),
                'Hora Criação': new Date(g.criado_em).toLocaleTimeString('pt-BR')
            }));
            const wsGlosas = XLSX.utils.json_to_sheet(dadosGlosas);
            XLSX.utils.book_append_sheet(workbook, wsGlosas, 'Glosas');

            // Aba 4: Usuários
            const dadosUsuarios = usuarios.map(u => ({
                'ID': u.id,
                'Nome': u.nome,
                'Matrícula': u.matricula || '',
                'Data Criação': new Date(u.criado_em).toLocaleDateString('pt-BR'),
                'Hora Criação': new Date(u.criado_em).toLocaleTimeString('pt-BR')
            }));
            const wsUsuarios = XLSX.utils.json_to_sheet(dadosUsuarios);
            XLSX.utils.book_append_sheet(workbook, wsUsuarios, 'Usuários');

            // Aba 5: Profissionais
            if (profissionais.length > 0) {
                const wsProfissionais = XLSX.utils.json_to_sheet(profissionais);
                XLSX.utils.book_append_sheet(workbook, wsProfissionais, 'Profissionais');
            }

            // Aba 6: Tipos de Glosa
            if (tiposGlosa.length > 0) {
                const wsTiposGlosa = XLSX.utils.json_to_sheet(tiposGlosa);
                XLSX.utils.book_append_sheet(workbook, wsTiposGlosa, 'Tipos de Glosa');
            }

            // Aba 7: Resumo Estatísticas
            const resumo = {
                'Total de AIHs': aihs.length,
                'Total de Movimentações': movimentacoes.length,
                'Total de Glosas Ativas': glosas.length,
                'Total de Usuários': usuarios.length,
                'Total de Profissionais': profissionais.length,
                'Valor Total Inicial': aihs.reduce((sum, a) => sum + (a.valor_inicial || 0), 0).toFixed(2),
                'Valor Total Atual': aihs.reduce((sum, a) => sum + (a.valor_atual || 0), 0).toFixed(2),
                'Total de Perdas (Glosas)': (aihs.reduce((sum, a) => sum + (a.valor_inicial || 0), 0) - aihs.reduce((sum, a) => sum + (a.valor_atual || 0), 0)).toFixed(2),
                'AIHs com Glosas': aihs.filter(a => a.total_glosas > 0).length,
                'Percentual AIHs com Glosas': aihs.length > 0 ? ((aihs.filter(a => a.total_glosas > 0).length / aihs.length) * 100).toFixed(2) + '%' : '0%',
                'Status 1 (Aprovação Direta)': aihs.filter(a => a.status === 1).length,
                'Status 2 (Aprovação Indireta)': aihs.filter(a => a.status === 2).length,
                'Status 3 (Em Discussão)': aihs.filter(a => a.status === 3).length,
                'Status 4 (Finalizada Pós-Discussão)': aihs.filter(a => a.status === 4).length,
                'Data/Hora Exportação': new Date().toLocaleString('pt-BR')
            };
            const wsResumo = XLSX.utils.json_to_sheet([resumo]);
            XLSX.utils.book_append_sheet(workbook, wsResumo, 'Resumo Estatísticas');

            const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="${nomeBase}.xlsx"`);
            res.setHeader('Cache-Control', 'no-cache');
            return res.send(buffer);

        } else {
            return res.status(400).json({ error: 'Formato não suportado. Use: json ou excel' });
        }

    } catch (err) {
        console.error('Erro na exportação completa:', err);
        return res.status(500).json({ error: 'Erro interno ao exportar dados: ' + err.message });
    }
});

// Endpoint para exportação de dados personalizados (resultados de pesquisa)
app.post('/api/export/:formato', verificarToken, async (req, res) => {
    try {
        const { dados, titulo, tipo } = req.body;

        if (!dados || !Array.isArray(dados) || dados.length === 0) {
            return res.status(400).json({ error: 'Dados não fornecidos ou inválidos' });
        }

        const nomeArquivo = `${tipo || 'exportacao'}-${new Date().toISOString().split('T')[0]}`;

        if (req.params.formato === 'excel') {
            // Criar workbook Excel
            const worksheet = XLSX.utils.json_to_sheet(dados);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, titulo || 'Dados');

            const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xls' });

            res.setHeader('Content-Type', 'application/vnd.ms-excel');
            res.setHeader('Content-Disposition', `attachment; filename=${nomeArquivo}.xls`);
            return res.send(buffer);
        } else if (req.params.formato === 'csv') {
            // Criar CSV
            const cabecalhos = Object.keys(dados[0]);
            const csv = [
                cabecalhos.join(','),
                ...dados.map(item => 
                    cabecalhos.map(header => `"${(item[header] || '').toString().replace(/"/g, '""')}"`).join(',')
                )
            ].join('\n');

            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename=${nomeArquivo}.csv`);
            return res.send('\ufeff' + csv); // BOM para UTF-8
        } else {
            return res.status(400).json({ error: 'Formato não suportado' });
        }
    } catch (err) {
        console.error('Erro na exportação personalizada:', err);
        return res.status(500).json({ error: err.message });
    }
});

// Helper para status no Excel
const getStatusExcel = (status) => {
    const statusMap = {
        1: 'Finalizada com aprovação direta',
        2: 'Ativa com aprovação indireta',
        3: 'Ativa em discussão',
        4: 'Finalizada após discussão'
    };
    return statusMap[status] || 'Desconhecido';
};

// Relatórios aprimorados com filtros por período
app.post('/api/relatorios/:tipo', verificarToken, async (req, res) => {
    try {
        const tipo = req.params.tipo;
        const { data_inicio, data_fim, competencia } = req.body;
        let resultado;

        console.log(`Gerando relatório tipo: ${tipo} - página: 1`);

        // VALIDAÇÃO OBRIGATÓRIA: deve ter competência OU período de datas
        // EXCEÇÃO: logs-exclusao não precisa de filtros obrigatórios
        if (tipo !== 'logs-exclusao' && !competencia && (!data_inicio || !data_fim)) {
            return res.status(400).json({ 
                error: 'É obrigatório informar uma COMPETÊNCIA (MM/AAAA) OU um PERÍODO com data de início E data de fim para gerar o relatório.',
                exemplo_competencia: '07/2025',
                exemplo_periodo: 'data_inicio: 2025-01-01, data_fim: 2025-12-31'
            });
        }

        // Validar formato da competência se informada
        if (competencia && !/^\d{2}\/\d{4}$/.test(competencia)) {
            return res.status(400).json({ 
                error: 'Competência deve estar no formato MM/AAAA (exemplo: 07/2025)' 
            });
        }

        // Validar formato das datas se informadas
        if (data_inicio && !/^\d{4}-\d{2}-\d{2}$/.test(data_inicio)) {
            return res.status(400).json({ 
                error: 'Data de início deve estar no formato AAAA-MM-DD (exemplo: 2025-01-01)' 
            });
        }

        if (data_fim && !/^\d{4}-\d{2}-\d{2}$/.test(data_fim)) {
            return res.status(400).json({ 
                error: 'Data de fim deve estar no formato AAAA-MM-DD (exemplo: 2025-12-31)' 
            });
        }

        // Validar se data de início não é maior que data de fim
        if (data_inicio && data_fim && data_inicio > data_fim) {
            return res.status(400).json({ 
                error: 'Data de início não pode ser maior que data de fim' 
            });
        }

        // Construir filtros de período
        let filtroWhere = '';
        let params = [];

        if (competencia) {
            filtroWhere = ' AND competencia = ?';
            params.push(competencia);
            console.log(`📅 Relatório ${tipo} - Filtro por competência: ${competencia}`);
        } else if (data_inicio && data_fim) {
            filtroWhere = ' AND DATE(criado_em) BETWEEN ? AND ?';
            params.push(data_inicio, data_fim);
            console.log(`📅 Relatório ${tipo} - Filtro por período: ${data_inicio} até ${data_fim}`);
        } else if (tipo === 'logs-exclusao') {
            // Para logs de exclusão sem filtros, mostrar todos os registros
            filtroWhere = '';
            params = [];
            console.log(`📅 Relatório ${tipo} - Sem filtros (todos os registros)`);
        }

        switch(tipo) {
            case 'tipos-glosa-periodo':
                resultado = await all(`
                    SELECT g.tipo, COUNT(*) as total_ocorrencias, 
                           SUM(g.quantidade) as quantidade_total,
                           GROUP_CONCAT(DISTINCT g.profissional) as profissionais
                    FROM glosas g
                    JOIN aihs a ON g.aih_id = a.id
                    WHERE g.ativa = 1 ${filtroWhere.replace('criado_em', 'a.criado_em')}
                    GROUP BY g.tipo
                    ORDER BY total_ocorrencias DESC
                `, params);
                break;

            case 'aihs-profissional-periodo':
                // AIHs auditadas por profissional no período - incluindo todos os profissionais
                let sqlAihsProfissional = `
                    SELECT 
                        p.nome as profissional,
                        p.especialidade,
                        COALESCE(COUNT(DISTINCT CASE 
                            WHEN p.especialidade = 'Medicina' AND m.prof_medicina = p.nome THEN m.aih_id
                            WHEN p.especialidade = 'Enfermagem' AND m.prof_enfermagem = p.nome THEN m.aih_id
                            WHEN p.especialidade = 'Fisioterapia' AND m.prof_fisioterapia = p.nome THEN m.aih_id
                            WHEN p.especialidade = 'Bucomaxilo' AND m.prof_bucomaxilo = p.nome THEN m.aih_id
                        END), 0) as total_aihs_auditadas,
                        COALESCE(COUNT(CASE 
                            WHEN p.especialidade = 'Medicina' AND m.prof_medicina = p.nome THEN 1
                            WHEN p.especialidade = 'Enfermagem' AND m.prof_enfermagem = p.nome THEN 1
                            WHEN p.especialidade = 'Fisioterapia' AND m.prof_fisioterapia = p.nome THEN 1
                            WHEN p.especialidade = 'Bucomaxilo' AND m.prof_bucomaxilo = p.nome THEN 1
                        END), 0) as total_movimentacoes
                    FROM profissionais p
                    LEFT JOIN movimentacoes m ON (
                        (p.especialidade = 'Medicina' AND m.prof_medicina = p.nome) OR
                        (p.especialidade = 'Enfermagem' AND m.prof_enfermagem = p.nome) OR
                        (p.especialidade = 'Fisioterapia' AND m.prof_fisioterapia = p.nome) OR
                        (p.especialidade = 'Bucomaxilo' AND m.prof_bucomaxilo = p.nome)
                    )
                    LEFT JOIN aihs a ON m.aih_id = a.id
                `;

                // Adicionar filtros de período
                if (competencia) {
                    sqlAihsProfissional += ' AND (m.competencia = ? OR m.competencia IS NULL)';
                } else if (data_inicio && data_fim) {
                    sqlAihsProfissional += ' AND (DATE(m.data_movimentacao) BETWEEN ? AND ? OR m.data_movimentacao IS NULL)';
                } else if (data_inicio) {
                    sqlAihsProfissional += ' AND (DATE(m.data_movimentacao) >= ? OR m.data_movimentacao IS NULL)';
                } else if (data_fim) {
                    sqlAihsProfissional += ' AND (DATE(m.data_movimentacao) <= ? OR m.data_movimentacao IS NULL)';
                }

                sqlAihsProfissional += ` 
                    GROUP BY p.id, p.nome, p.especialidade
                    ORDER BY total_aihs_auditadas DESC, p.especialidade, p.nome`;

                resultado = await all(sqlAihsProfissional, params);
                break;

            case 'glosas-profissional-periodo':
                // Glosas por profissional no período
                resultado = await all(`
                    SELECT g.profissional,
                           COUNT(*) as total_glosas,
                           SUM(g.quantidade) as quantidade_total,
                           GROUP_CONCAT(DISTINCT g.tipo) as tipos_glosa,
                           COUNT(DISTINCT g.tipo) as tipos_diferentes
                    FROM glosas g
                    JOIN aihs a ON g.aih_id = a.id
                    WHERE g.ativa = 1 ${filtroWhere.replace('criado_em', 'a.criado_em')}
                    GROUP BY g.profissional
                    ORDER BY total_glosas DESC
                `, params);
                break;

            case 'valores-glosas-periodo':
                // Análise financeira das glosas no período
                const valoresGlosasPeriodo = await get(`
                    SELECT 
                        COUNT(DISTINCT a.id) as aihs_com_glosas,
                        SUM(a.valor_inicial) as valor_inicial_total,
                        SUM(a.valor_atual) as valor_atual_total,
                        SUM(a.valor_inicial - a.valor_atual) as total_glosas,
                        AVG(a.valor_inicial - a.valor_atual) as media_glosa_por_aih,
                        MIN(a.valor_inicial - a.valor_atual) as menor_glosa,
                        MAX(a.valor_inicial - a.valor_atual) as maior_glosa
                    FROM aihs a
                    WHERE EXISTS (SELECT 1 FROM glosas g WHERE g.aih_id = a.id AND g.ativa = 1)
                    ${filtroWhere}
                `, params);

                const totalAihsPeriodo = await get(`
                    SELECT COUNT(*) as total,
                           SUM(valor_inicial) as valor_inicial_periodo,
                           SUM(valor_atual) as valor_atual_periodo
                    FROM aihs a
                    WHERE 1=1 ${filtroWhere}
                `, params);

                resultado = {
                    ...valoresGlosasPeriodo,
                    total_aihs_periodo: totalAihsPeriodo.total,
                    valor_inicial_periodo: totalAihsPeriodo.valor_inicial_periodo,
                    valor_atual_periodo: totalAihsPeriodo.valor_atual_periodo,
                    percentual_aihs_com_glosas: totalAihsPeriodo.total > 0 ? 
                        ((valoresGlosasPeriodo.aihs_com_glosas / totalAihsPeriodo.total) * 100).toFixed(2) : 0
                };
                break;

            case 'estatisticas-periodo':
                // Estatísticas gerais do período
                const stats = await get(`
                    SELECT 
                        COUNT(*) as total_aihs,
                        SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) as aprovacao_direta,
                        SUM(CASE WHEN status = 2 THEN 1 ELSE 0 END) as aprovacao_indireta,
                        SUM(CASE WHEN status = 3 THEN 1 ELSE 0 END) as em_discussao,
                        SUM(CASE WHEN status = 4 THEN 1 ELSE 0 END) as finalizada_pos_discussao,
                        AVG(valor_inicial) as valor_medio_inicial,
                        AVG(valor_atual) as valor_medio_atual,
                        SUM(valor_inicial) as valor_total_inicial,
                        SUM(valor_atual) as valor_total_atual
                    FROM aihs a
                    WHERE 1=1 ${filtroWhere.replace('criado_em', 'a.criado_em')}
                `, params);

                const totalGlosasPeriodo = await get(`
                    SELECT COUNT(*) as total_glosas,
                           COUNT(DISTINCT aih_id) as aihs_com_glosas
                    FROM glosas g
                    JOIN aihs a ON g.aih_id = a.id
                    WHERE g.ativa = 1 ${filtroWhere.replace('criado_em', 'a.criado_em')}
                `, params);

                const movimentacoesPeriodo = await get(`
                    SELECT 
                        COUNT(*) as total_movimentacoes,
                        SUM(CASE WHEN tipo = 'entrada_sus' THEN 1 ELSE 0 END) as entradas_sus,
                        SUM(CASE WHEN tipo = 'saida_hospital' THEN 1 ELSE 0 END) as saidas_hospital
                    FROM movimentacoes m
                    JOIN aihs a ON m.aih_id = a.id
                    WHERE 1=1 ${filtroWhere.replace('competencia', 'm.competencia').replace('criado_em', 'm.data_movimentacao')}
                `, params);

                resultado = {
                    ...stats,
                    ...totalGlosasPeriodo,
                    ...movimentacoesPeriodo,
                    diferenca_valores: (stats.valor_total_inicial || 0) - (stats.valor_total_atual || 0),
                    percentual_glosas: stats.total_aihs > 0 ? 
                        ((totalGlosasPeriodo.aihs_com_glosas / stats.total_aihs) * 100).toFixed(2) : 0
                };
                break;

            // Manter relatórios existentes para compatibilidade
            case 'acessos':
                resultado = await all(`
                    SELECT u.nome, COUNT(l.id) as total_acessos, 
                           MAX(l.data_hora) as ultimo_acesso
                    FROM logs_acesso l
                    JOIN usuarios u ON l.usuario_id = u.id
                    WHERE l.acao = 'Login'
                    GROUP BY u.id
                    ORDER BY total_acessos DESC
                `);
                break;

            case 'glosas-profissional':
                resultado = await all(`
                    SELECT profissional, COUNT(*) as total_glosas,
                           SUM(quantidade) as total_itens
                    FROM glosas
                    WHERE ativa = 1
                    GROUP BY profissional
                    ORDER BY total_glosas DESC
                `);
                break;

            case 'aihs-profissional':
                resultado = await all(`
                    SELECT 
                        COALESCE(prof_medicina, prof_enfermagem, prof_fisioterapia, prof_bucomaxilo) as profissional,
                        COUNT(DISTINCT aih_id) as total_aihs,
                        COUNT(*) as total_movimentacoes
                    FROM movimentacoes
                    WHERE prof_medicina IS NOT NULL 
                       OR prof_enfermagem IS NOT NULL 
                       OR prof_fisioterapia IS NOT NULL 
                       OR prof_bucomaxilo IS NOT NULL
                    GROUP BY profissional
                    ORDER BY total_aihs DESC
                `);
                break;

            case 'aprovacoes':
                resultado = await all(`
                    SELECT 
                        SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) as aprovacao_direta,
                        SUM(CASE WHEN status = 2 THEN 1 ELSE 0 END) as aprovacao_indireta,
                        SUM(CASE WHEN status = 3 THEN 1 ELSE 0 END) as em_discussao,
                        SUM(CASE WHEN status = 4 THEN 1 ELSE 0 END) as finalizada_pos_discussao,
                        COUNT(*) as total
                    FROM aihs
                `);
                break;

            case 'tipos-glosa':
                resultado = await all(`
                    SELECT tipo, COUNT(*) as total, SUM(quantidade) as quantidade_total
                    FROM glosas
                    WHERE ativa = 1
                    GROUP BY tipo
                    ORDER BY total DESC
                `);
                break;

            case 'fluxo-movimentacoes':
                // Análise de fluxo de movimentações por período
                const fluxoEntradasSUS = await get(`
                    SELECT COUNT(DISTINCT m.aih_id) as total_entradas
                    FROM movimentacoes m
                    JOIN aihs a ON m.aih_id = a.id
                    WHERE m.tipo = 'entrada_sus' ${filtroWhere.replace('competencia', 'm.competencia').replace('criado_em', 'm.data_movimentacao')}
                `, params);

                const fluxoSaidasHospital = await get(`
                    SELECT COUNT(DISTINCT m.aih_id) as total_saidas
                    FROM movimentacoes m
                    JOIN aihs a ON m.aih_id = a.id
                    WHERE m.tipo = 'saida_hospital' ${filtroWhere.replace('competencia', 'm.competencia').replace('criado_em', 'm.data_movimentacao')}
                `, params);

                const fluxoMensalMovimentacoes = await all(`
                    SELECT 
                        strftime('%Y-%m', m.data_movimentacao) as mes,
                        COUNT(DISTINCT CASE WHEN m.tipo = 'entrada_sus' THEN m.aih_id END) as entradas,
                        COUNT(DISTINCT CASE WHEN m.tipo = 'saida_hospital' THEN m.aih_id END) as saidas,
                        COUNT(DISTINCT CASE WHEN m.tipo = 'entrada_sus' THEN m.aih_id END) - 
                        COUNT(DISTINCT CASE WHEN m.tipo = 'saida_hospital' THEN m.aih_id END) as saldo_mensal
                    FROM movimentacoes m
                    JOIN aihs a ON m.aih_id = a.id
                    WHERE 1=1 ${filtroWhere.replace('competencia', 'm.competencia').replace('criado_em', 'm.data_movimentacao')}
                    GROUP BY mes
                    ORDER BY mes DESC
                `, params);

                resultado = {
                    resumo: {
                        total_entradas_sus: fluxoEntradasSUS.total_entradas || 0,
                        total_saidas_hospital: fluxoSaidasHospital.total_saidas || 0,
                        diferenca_fluxo: (fluxoEntradasSUS.total_entradas || 0) - (fluxoSaidasHospital.total_saidas || 0),
                        aihs_em_processamento: (fluxoEntradasSUS.total_entradas || 0) - (fluxoSaidasHospital.total_saidas || 0)
                    },
                    fluxo_mensal: fluxoMensalMovimentacoes
                };
                break;

            case 'produtividade-auditores':
                // Análise detalhada de produtividade dos auditores
                resultado = await all(`
                    SELECT 
                        p.nome as profissional,
                        p.especialidade,
                        COALESCE(COUNT(DISTINCT CASE 
                            WHEN p.especialidade = 'Medicina' AND m.prof_medicina = p.nome THEN m.aih_id
                            WHEN p.especialidade = 'Enfermagem' AND m.prof_enfermagem = p.nome THEN m.aih_id
                            WHEN p.especialidade = 'Fisioterapia' AND m.prof_fisioterapia = p.nome THEN m.aih_id
                            WHEN p.especialidade = 'Bucomaxilo' AND m.prof_bucomaxilo = p.nome THEN m.aih_id
                        END), 0) as aihs_auditadas,
                        COALESCE(COUNT(DISTINCT g.id), 0) as glosas_identificadas,
                        COALESCE(COUNT(CASE 
                            WHEN p.especialidade = 'Medicina' AND m.prof_medicina = p.nome THEN 1
                            WHEN p.especialidade = 'Enfermagem' AND m.prof_enfermagem = p.nome THEN 1
                            WHEN p.especialidade = 'Fisioterapia' AND m.prof_fisioterapia = p.nome THEN 1
                            WHEN p.especialidade = 'Bucomaxilo' AND m.prof_bucomaxilo = p.nome THEN 1
                        END), 0) as movimentacoes_realizadas,
                        COALESCE(SUM(CASE 
                            WHEN p.especialidade = 'Medicina' AND m.prof_medicina = p.nome THEN m.valor_conta
                            WHEN p.especialidade = 'Enfermagem' AND m.prof_enfermagem = p.nome THEN m.valor_conta
                            WHEN p.especialidade = 'Fisioterapia' AND m.prof_fisioterapia = p.nome THEN m.valor_conta
                            WHEN p.especialidade = 'Bucomaxilo' AND m.prof_bucomaxilo = p.nome THEN m.valor_conta
                        END), 0) as valor_total_auditado
                    FROM profissionais p
                    LEFT JOIN movimentacoes m ON (
                        (p.especialidade = 'Medicina' AND m.prof_medicina = p.nome) OR
                        (p.especialidade = 'Enfermagem' AND m.prof_enfermagem = p.nome) OR
                        (p.especialidade = 'Fisioterapia' AND m.prof_fisioterapia = p.nome) OR
                        (p.especialidade = 'Bucomaxilo' AND m.prof_bucomaxilo = p.nome)
                    )
                    LEFT JOIN aihs a ON m.aih_id = a.id
                    LEFT JOIN glosas g ON a.id = g.aih_id AND g.ativa = 1 AND g.profissional = p.nome
                    WHERE 1=1 ${filtroWhere.replace('competencia', 'COALESCE(m.competencia, "")').replace('criado_em', 'COALESCE(m.data_movimentacao, "")')}
                    GROUP BY p.id, p.nome, p.especialidade
                    ORDER BY aihs_auditadas DESC, glosas_identificadas DESC
                `, params);
                break;

            case 'analise-valores-glosas':
                // Análise financeira detalhada das glosas - apenas 3 métricas principais
                
                // AIHs com glosas (apenas as que têm glosas ativas)
                const aihsComGlosas = await get(`
                    SELECT COUNT(DISTINCT a.id) as aihs_com_glosas
                    FROM aihs a
                    WHERE EXISTS (SELECT 1 FROM glosas g WHERE g.aih_id = a.id AND g.ativa = 1)
                    ${filtroWhere.replace('criado_em', 'a.criado_em')}
                `, params);

                // Total de glosas (apenas contar as glosas ativas)
                const totalGlosas = await get(`
                    SELECT COUNT(g.id) as total_glosas
                    FROM glosas g
                    JOIN aihs a ON g.aih_id = a.id
                    WHERE g.ativa = 1
                    ${filtroWhere.replace('criado_em', 'a.criado_em')}
                `, params);

                // Valor total das glosas = diferença entre soma total de valores iniciais e valores atuais de TODAS as AIHs
                const valorTotalGlosas = await get(`
                    SELECT 
                        SUM(a.valor_inicial) as soma_valores_iniciais,
                        SUM(a.valor_atual) as soma_valores_atuais,
                        SUM(a.valor_inicial) - SUM(a.valor_atual) as valor_total_glosas
                    FROM aihs a
                    WHERE 1=1
                    ${filtroWhere.replace('criado_em', 'a.criado_em')}
                `, params);

                resultado = {
                    resumo_financeiro: {
                        aihs_com_glosas: aihsComGlosas.aihs_com_glosas || 0,
                        total_glosas: totalGlosas.total_glosas || 0,
                        valor_total_glosas: valorTotalGlosas.valor_total_glosas || 0
                    }
                };
                break;

            case 'performance-competencias':
                // Performance comparativa entre competências
                resultado = await all(`
                    SELECT 
                        a.competencia,
                        COUNT(*) as total_aihs,
                        COUNT(DISTINCT CASE WHEN g.id IS NOT NULL THEN a.id END) as aihs_com_glosas,
                        SUM(a.valor_inicial) as valor_inicial_competencia,
                        SUM(a.valor_atual) as valor_atual_competencia,
                        SUM(a.valor_inicial - a.valor_atual) as total_glosas_competencia,
                        AVG(a.valor_inicial - a.valor_atual) as media_glosa_competencia,
                        SUM(CASE WHEN a.status IN (1, 4) THEN 1 ELSE 0 END) as aihs_finalizadas,
                        SUM(CASE WHEN a.status IN (2, 3) THEN 1 ELSE 0 END) as aihs_pendentes
                    FROM aihs a
                    LEFT JOIN glosas g ON a.id = g.aih_id AND g.ativa = 1
                    WHERE 1=1 ${filtroWhere}
                    GROUP BY a.competencia
                    ORDER BY a.competencia DESC
                `, params);
                break;

            case 'ranking-glosas-frequentes':
                // Ranking das glosas mais frequentes e impactantes
                resultado = await all(`
                    SELECT 
                        g.tipo as tipo_glosa,
                        g.linha as linha_glosa,
                        COUNT(*) as frequencia,
                        COUNT(DISTINCT g.aih_id) as aihs_afetadas,
                        COUNT(DISTINCT g.profissional) as profissionais_envolvidos,
                        GROUP_CONCAT(DISTINCT g.profissional) as lista_profissionais,
                        SUM(a.valor_inicial - a.valor_atual) as impacto_financeiro_total,
                        AVG(a.valor_inicial - a.valor_atual) as impacto_financeiro_medio
                    FROM glosas g
                    JOIN aihs a ON g.aih_id = a.id
                    WHERE g.ativa = 1 ${filtroWhere.replace('criado_em', 'a.criado_em')}
                    GROUP BY g.tipo, g.linha
                    ORDER BY frequencia DESC, impacto_financeiro_total DESC
                `, params);
                break;

            case 'analise-temporal-cadastros':
                // Análise temporal de cadastros e finalizações
                resultado = await all(`
                    SELECT 
                        DATE(a.criado_em) as data_cadastro,
                        COUNT(*) as aihs_cadastradas,
                        SUM(a.valor_inicial) as valor_total_cadastrado,
                        COUNT(CASE WHEN a.status IN (1, 4) THEN 1 END) as finalizadas_no_dia,
                        AVG(a.valor_inicial) as valor_medio_aih
                    FROM aihs a
                    WHERE 1=1 ${filtroWhere}
                    GROUP BY DATE(a.criado_em)
                    ORDER BY data_cadastro DESC
                `, params);
                break;

            case 'comparativo-auditorias':
                // Comparativo entre auditoria SUS e Hospital
                const movimentacoesPorTipo = await all(`
                    SELECT 
                        m.tipo as tipo_movimentacao,
                        COUNT(*) as total_movimentacoes,
                        COUNT(DISTINCT m.aih_id) as aihs_movimentadas,
                        AVG(m.valor_conta) as valor_medio_conta,
                        SUM(m.valor_conta) as valor_total_contas
                    FROM movimentacoes m
                    JOIN aihs a ON m.aih_id = a.id
                    WHERE 1=1 ${filtroWhere.replace('competencia', 'm.competencia').replace('criado_em', 'm.data_movimentacao')}
                    GROUP BY m.tipo
                `, params);

                resultado = movimentacoesPorTipo;
                break;

            case 'detalhamento-status':
                // Detalhamento completo por status das AIHs
                resultado = await all(`
                    SELECT 
                        CASE a.status
                            WHEN 1 THEN 'Finalizada com aprovação direta'
                            WHEN 2 THEN 'Ativa com aprovação indireta'
                            WHEN 3 THEN 'Ativa em discussão'
                            WHEN 4 THEN 'Finalizada após discussão'
                            ELSE 'Status desconhecido'
                        END as status_descricao,
                        a.status as status_codigo,
                        COUNT(*) as quantidade_aihs,
                        SUM(a.valor_inicial) as valor_inicial_total,
                        SUM(a.valor_atual) as valor_atual_total,
                        SUM(a.valor_inicial - a.valor_atual) as diferenca_valores,
                        AVG(a.valor_inicial) as valor_inicial_medio,
                        AVG(a.valor_atual) as valor_atual_medio,
                        COUNT(DISTINCT g.id) as total_glosas,
                        ROUND((COUNT(*) * 100.0 / (SELECT COUNT(*) FROM aihs)), 2) as percentual
                    FROM aihs a
                    LEFT JOIN glosas g ON a.id = g.aih_id AND g.ativa = 1
                    WHERE 1=1 ${filtroWhere.replace('criado_em', 'a.criado_em')}
                    GROUP BY a.status
                    ORDER BY a.status
                `, params);
                break;

            case 'analise-financeira':
                // Análise financeira completa
                const analiseFinanceira = await get(`
                    SELECT 
                        COUNT(*) as total_aihs,
                        SUM(a.valor_inicial) as valor_inicial_geral,
                        SUM(a.valor_atual) as valor_atual_geral,
                        SUM(a.valor_inicial - a.valor_atual) as perdas_glosas,
                        AVG(a.valor_inicial) as valor_inicial_medio,
                        AVG(a.valor_atual) as valor_atual_medio,
                        AVG(a.valor_inicial - a.valor_atual) as perda_media_por_aih,
                        MIN(a.valor_inicial) as menor_valor_inicial,
                        MAX(a.valor_inicial) as maior_valor_inicial,
                        MIN(a.valor_atual) as menor_valor_atual,
                        MAX(a.valor_atual) as maior_valor_atual
                    FROM aihs a
                    WHERE 1=1 ${filtroWhere}
                `, params);

                const faixasValor = await all(`
                    SELECT 
                        CASE 
                            WHEN a.valor_inicial <= 1000 THEN 'Até R$ 1.000'
                            WHEN a.valor_inicial <= 5000 THEN 'R$ 1.001 - R$ 5.000'
                            WHEN a.valor_inicial <= 10000 THEN 'R$ 5.001 - R$ 10.000'
                            WHEN a.valor_inicial <= 50000 THEN 'R$ 10.001 - R$ 50.000'
                            ELSE 'Acima de R$ 50.000'
                        END as faixa_valor,
                        COUNT(*) as quantidade,
                        SUM(a.valor_inicial) as valor_total_faixa,
                        SUM(a.valor_inicial - a.valor_atual) as glosas_faixa
                    FROM aihs a
                    WHERE 1=1 ${filtroWhere}
                    GROUP BY faixa_valor
                    ORDER BY MIN(a.valor_inicial)
                `, params);

                resultado = {
                    resumo_geral: analiseFinanceira,
                    distribuicao_por_faixa: faixasValor
                };
                break;

            case 'eficiencia-processamento':
                // Análise de eficiência de processamento
                resultado = await all(`
                    SELECT 
                        a.competencia,
                        COUNT(*) as aihs_competencia,
                        AVG(JULIANDAY(CURRENT_TIMESTAMP) - JULIANDAY(a.criado_em)) as tempo_medio_dias,
                        COUNT(CASE WHEN a.status IN (1, 4) THEN 1 END) as finalizadas,
                        COUNT(CASE WHEN a.status IN (2, 3) THEN 1 END) as em_andamento,
                        COUNT(DISTINCT m.id) as total_movimentacoes,
                        ROUND(COUNT(DISTINCT m.id) * 1.0 / COUNT(*), 2) as movimentacoes_por_aih
                    FROM aihs a
                    LEFT JOIN movimentacoes m ON a.id = m.aih_id
                    WHERE 1=1 ${filtroWhere}
                    GROUP BY a.competencia
                    ORDER BY a.competencia DESC
                `, params);
                break;

            case 'cruzamento-profissional-glosas':
                // Cruzamento entre profissionais e tipos de glosa
                resultado = await all(`
                    SELECT 
                        g.profissional,
                        g.tipo as tipo_glosa,
                        COUNT(*) as ocorrencias,
                        COUNT(DISTINCT g.aih_id) as aihs_afetadas
                    FROM glosas g
                    JOIN aihs a ON g.aih_id = a.id
                    WHERE g.ativa = 1 ${filtroWhere.replace('criado_em', 'g.criado_em')}
                    GROUP BY g.profissional, g.tipo
                    ORDER BY g.profissional, ocorrencias DESC
                `, params);
                break;

            case 'analise-preditiva':
                const mediaTempo = await get(`
                    SELECT AVG(JULIANDAY(CURRENT_TIMESTAMP) - JULIANDAY(criado_em)) as media_dias
                    FROM aihs WHERE status IN (1, 4)
                `);

                const tendenciaGlosas = await all(`
                    SELECT strftime('%Y-%m', criado_em) as mes, COUNT(*) as total
                    FROM glosas
                    WHERE ativa = 1
                    GROUP BY mes
                    ORDER BY mes DESC
                    LIMIT 6
                `);

                const valorMedioGlosa = await get(`
                    SELECT AVG(a.valor_inicial - a.valor_atual) as valor_medio
                    FROM aihs a
                    WHERE EXISTS (SELECT 1 FROM glosas g WHERE g.aih_id = a.id AND g.ativa = 1)
                `);

                resultado = {
                    tempo_medio_processamento: Math.round(mediaTempo.media_dias || 0),
                    tendencia_glosas: tendenciaGlosas,
                    valor_medio_glosa: valorMedioGlosa.valor_medio || 0,
                    previsao: "Com base nos dados, espera-se manter a média de processamento"
                };
                break;

            case 'logs-exclusao':
                // Relatório de logs de exclusão (usuários autenticados podem ver)
                // Não restringir apenas para admins, pois usuários podem querer ver logs de suas próprias exclusões

                resultado = await all(`
                    SELECT 
                        le.id,
                        le.tipo_exclusao,
                        u.nome as usuario_nome,
                        le.justificativa,
                        le.ip_origem,
                        le.data_exclusao,
                        CASE 
                            WHEN le.tipo_exclusao = 'movimentacao' THEN 
                                json_extract(le.dados_excluidos, '$.numero_aih')
                            WHEN le.tipo_exclusao = 'aih_completa' THEN 
                                json_extract(le.dados_excluidos, '$.aih.numero_aih')
                        END as numero_aih_afetado
                    FROM logs_exclusao le
                    LEFT JOIN usuarios u ON le.usuario_id = u.id
                    WHERE 1=1 ${filtroWhere.replace('competencia', 'le.data_exclusao').replace('criado_em', 'le.data_exclusao')}
                    ORDER BY le.data_exclusao DESC
                `, params);
                break;
        }

        // Verificar se o resultado foi definido
        if (resultado === undefined) {
            console.log(`Tipo de relatório não suportado: ${tipo}`);
            return res.status(400).json({ 
                error: `Tipo de relatório não suportado: ${tipo}`,
                tipos_disponiveis: [
                    'tipos-glosa-periodo', 'aihs-profissional-periodo', 'glosas-profissional-periodo',
                    'valores-glosas-periodo', 'estatisticas-periodo', 'acessos', 'aprovacoes',
                    'tipos-glosa', 'fluxo-movimentacoes', 'produtividade-auditores', 
                    'analise-valores-glosas', 'performance-competencias', 'ranking-glosas-frequentes',
                    'analise-temporal-cadastros', 'comparativo-auditorias', 'detalhamento-status',
                    'analise-financeira', 'eficiencia-processamento', 'cruzamento-profissional-glosas',
                    'distribuicao-valores', 'analise-preditiva', 'logs-exclusao'
                ]
            });
        }

        console.log(`Relatório ${tipo} gerado com sucesso`);
        res.json({ tipo, resultado, filtros: { data_inicio, data_fim, competencia } });
    } catch (err) {
        console.error(`Erro ao gerar relatório ${req.params.tipo}:`, err);
        res.status(500).json({ error: err.message });
    }
});

// Exportar histórico de movimentações de uma AIH
app.get('/api/aih/:id/movimentacoes/export/:formato', verificarToken, async (req, res) => {
    try {
        const aihId = req.params.id;
        const formato = req.params.formato;

        console.log(`📊 Exportando histórico da AIH ID ${aihId} em formato ${formato}`);

        // Buscar dados da AIH
        const aih = await get('SELECT numero_aih FROM aihs WHERE id = ?', [aihId]);
        if (!aih) {
            console.log(`❌ AIH com ID ${aihId} não encontrada`);
            return res.status(404).json({ error: 'AIH não encontrada' });
        }

        // Buscar movimentações com detalhes
        const movimentacoes = await all(`
            SELECT 
                m.*,
                u.nome as usuario_nome
            FROM movimentacoes m
            LEFT JOIN usuarios u ON m.usuario_id = u.id
            WHERE m.aih_id = ?
            ORDER BY m.data_movimentacao DESC
        `, [aihId]);

        console.log(`📋 Encontradas ${movimentacoes.length} movimentações para a AIH ${aih.numero_aih}`);

        if (movimentacoes.length === 0) {
            return res.status(404).json({ error: 'Nenhuma movimentação encontrada para esta AIH' });
        }

        const nomeArquivo = `historico-movimentacoes-AIH-${aih.numero_aih}-${new Date().toISOString().split('T')[0]}`;

        if (formato === 'csv') {
            const cabecalhos = 'Data,Tipo,Status,Valor,Competencia,Prof_Medicina,Prof_Enfermagem,Prof_Fisioterapia,Prof_Bucomaxilo,Usuario,Observacoes';
            const linhas = movimentacoes.map(m => {
                const data = new Date(m.data_movimentacao).toLocaleString('pt-BR');
                const tipo = m.tipo === 'entrada_sus' ? 'Entrada SUS' : 'Saída Hospital';
                const status = getStatusExcel(m.status_aih);
                const valor = (m.valor_conta || 0).toFixed(2);
                const competencia = m.competencia || '';
                const profMed = m.prof_medicina || '';
                const profEnf = m.prof_enfermagem || '';
                const profFisio = m.prof_fisioterapia || '';
                const profBuco = m.prof_bucomaxilo || '';
                const usuario = m.usuario_nome || '';
                const obs = (m.observacoes || '').replace(/"/g, '""');

                return `"${data}","${tipo}","${status}","R$ ${valor}","${competencia}","${profMed}","${profEnf}","${profFisio}","${profBuco}","${usuario}","${obs}"`;
            });

            const csv = [cabecalhos, ...linhas].join('\n');

            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}.csv"`);
            res.setHeader('Cache-Control', 'no-cache');
            res.send('\ufeff' + csv); // BOM para UTF-8

        } else if (formato === 'xlsx') {
            const dadosFormatados = movimentacoes.map((m, index) => ({
                'Sequência': index + 1,
                'Data/Hora': new Date(m.data_movimentacao).toLocaleString('pt-BR'),
                'Tipo de Movimentação': m.tipo === 'entrada_sus' ? 'Entrada na Auditoria SUS' : 'Saída para Auditoria Hospital',
                'Status da AIH': getStatusExcel(m.status_aih),
                'Valor da Conta': `R$ ${(m.valor_conta || 0).toFixed(2)}`,
                'Competência': m.competencia || 'Não informada',
                'Profissional Medicina': m.prof_medicina || 'Não informado',
                'Profissional Enfermagem': m.prof_enfermagem || 'Não informado',
                'Profissional Fisioterapia': m.prof_fisioterapia || 'Não informado',
                'Profissional Bucomaxilo': m.prof_bucomaxilo || 'Não informado',
                'Usuário Responsável': m.usuario_nome || 'Sistema',
                'Observações': m.observacoes || 'Nenhuma observação'
            }));

            const worksheet = XLSX.utils.json_to_sheet(dadosFormatados);

            // Configurar largura das colunas
            worksheet['!cols'] = [
                { wch: 10 }, // Sequência
                { wch: 20 }, // Data/Hora
                { wch: 25 }, // Tipo
                { wch: 25 }, // Status
                { wch: 15 }, // Valor
                { wch: 12 }, // Competência
                { wch: 20 }, // Prof Medicina
                { wch: 20 }, // Prof Enfermagem
                { wch: 20 }, // Prof Fisioterapia
                { wch: 20 }, // Prof Bucomaxilo
                { wch: 20 }, // Usuário
                { wch: 30 }  // Observações
            ];

            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, `Movimentações AIH ${aih.numero_aih}`);

            const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xls' });

            res.setHeader('Content-Type', 'application/vnd.ms-excel');
            res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}.xls"`);
            res.setHeader('Cache-Control', 'no-cache');
            res.send(buffer);

        } else {
            return res.status(400).json({ error: 'Formato não suportado. Use "csv" ou "xlsx"' });
        }

        console.log(`✅ Histórico da AIH ${aih.numero_aih} exportado com sucesso em formato ${formato}`);

    } catch (err) {
        console.error('❌ Erro ao exportar histórico:', err);
        res.status(500).json({ error: 'Erro interno do servidor ao exportar histórico' });
    }
});

// Exportar relatórios com filtros por período
app.post('/api/relatorios/:tipo/export', verificarToken, async (req, res) => {
    try {
        const tipo = req.params.tipo;
        const { data_inicio, data_fim, competencia } = req.body;
        let dados = [];
        let nomeArquivo = `relatorio-${tipo}-${new Date().toISOString().split('T')[0]}`;

        console.log(`📊 Exportando relatório: ${tipo}`);

        // VALIDAÇÃO OBRIGATÓRIA: deve ter competência OU período de datas
        // EXCEÇÃO: logs-exclusao não precisa de filtros obrigatórios
        if (tipo !== 'logs-exclusao' && !competencia && (!data_inicio || !data_fim)) {
            return res.status(400).json({ 
                error: 'É obrigatório informar uma COMPETÊNCIA (MM/AAAA) OU um PERÍODO com data de início E data de fim para exportar o relatório.',
                exemplo_competencia: '07/2025',
                exemplo_periodo: 'data_inicio: 2025-01-01, data_fim: 2025-12-31'
            });
        }

        // Validar formato da competência se informada
        if (competencia && !/^\d{2}\/\d{4}$/.test(competencia)) {
            return res.status(400).json({ 
                error: 'Competência deve estar no formato MM/AAAA (exemplo: 07/2025)' 
            });
        }

        // Validar formato das datas se informadas
        if (data_inicio && !/^\d{4}-\d{2}-\d{2}$/.test(data_inicio)) {
            return res.status(400).json({ 
                error: 'Data de início deve estar no formato AAAA-MM-DD (exemplo: 2025-01-01)' 
            });
        }

        if (data_fim && !/^\d{4}-\d{2}-\d{2}$/.test(data_fim)) {
            return res.status(400).json({ 
                error: 'Data de fim deve estar no formato AAAA-MM-DD (exemplo: 2025-12-31)' 
            });
        }

        // Validar se data de início não é maior que data de fim
        if (data_inicio && data_fim && data_inicio > data_fim) {
            return res.status(400).json({ 
                error: 'Data de início não pode ser maior que data de fim' 
            });
        }

        // Construir filtros de período
        let filtroWhere = '';
        let params = [];

        if (competencia) {
            filtroWhere = ' AND competencia = ?';
            params.push(competencia);
            nomeArquivo += `-${competencia.replace('/', '-')}`;
            console.log(`📅 Exportação ${tipo} - Filtro por competência: ${competencia}`);
        } else if (data_inicio && data_fim) {
            filtroWhere = ' AND DATE(criado_em) BETWEEN ? AND ?';
            params.push(data_inicio, data_fim);
            nomeArquivo += `-${data_inicio}-a-${data_fim}`;
            console.log(`📅 Exportação ${tipo} - Filtro por período: ${data_inicio} até ${data_fim}`);
        }

        switch(tipo) {
            case 'tipos-glosa-periodo':
                dados = await all(`
                    SELECT 
                        g.tipo as 'Tipo de Glosa',
                        COUNT(*) as 'Total Ocorrencias', 
                        SUM(g.quantidade) as 'Quantidade Total',
                        GROUP_CONCAT(DISTINCT g.profissional) as 'Profissionais Envolvidos'
                    FROM glosas g
                    JOIN aihs a ON g.aih_id = a.id
                    WHERE g.ativa = 1 ${filtroWhere.replace('criado_em', 'a.criado_em')}
                    GROUP BY g.tipo
                    ORDER BY COUNT(*) DESC
                `, params);
                break;

            case 'aihs-profissional-periodo':
                let sqlAihsExport = `
                    SELECT 
                        p.nome as 'Profissional',
                        p.especialidade as 'Especialidade',
                        COALESCE(COUNT(DISTINCT CASE 
                            WHEN p.especialidade = 'Medicina' AND m.prof_medicina = p.nome THEN m.aih_id
                            WHEN p.especialidade = 'Enfermagem' AND m.prof_enfermagem = p.nome THEN m.aih_id
                            WHEN p.especialidade = 'Fisioterapia' AND m.prof_fisioterapia = p.nome THEN m.aih_id
                            WHEN p.especialidade = 'Bucomaxilo' AND m.prof_bucomaxilo = p.nome THEN m.aih_id
                        END), 0) as 'Total AIHs Auditadas',
                        COALESCE(COUNT(CASE 
                            WHEN p.especialidade = 'Medicina' AND m.prof_medicina = p.nome THEN 1
                            WHEN p.especialidade = 'Enfermagem' AND m.prof_enfermagem = p.nome THEN 1
                            WHEN p.especialidade = 'Fisioterapia' AND m.prof_fisioterapia = p.nome THEN 1
                            WHEN p.especialidade = 'Bucomaxilo' AND m.prof_bucomaxilo = p.nome THEN 1
                        END), 0) as 'Total Movimentacoes'
                    FROM profissionais p
                    LEFT JOIN movimentacoes m ON (
                        (p.especialidade = 'Medicina' AND m.prof_medicina = p.nome) OR
                        (p.especialidade = 'Enfermagem' AND m.prof_enfermagem = p.nome) OR
                        (p.especialidade = 'Fisioterapia' AND m.prof_fisioterapia = p.nome) OR
                        (p.especialidade = 'Bucomaxilo' AND m.prof_bucomaxilo = p.nome)
                    )
                    LEFT JOIN aihs a ON m.aih_id = a.id
                `;

                // Adicionar filtros de período
                if (competencia) {
                    sqlAihsExport += ' WHERE (m.competencia = ? OR m.competencia IS NULL)';
                } else if (data_inicio && data_fim) {
                    sqlAihsExport += ' WHERE (DATE(m.data_movimentacao) BETWEEN ? AND ? OR m.data_movimentacao IS NULL)';
                } else if (data_inicio) {
                    sqlAihsExport += ' WHERE (DATE(m.data_movimentacao) >= ? OR m.data_movimentacao IS NULL)';
                } else if (data_fim) {
                    sqlAihsExport += ' WHERE (DATE(m.data_movimentacao) <= ? OR m.data_movimentacao IS NULL)';
                } else {
                    sqlAihsExport += ' WHERE 1=1';
                }

                sqlAihsExport += ` 
                    GROUP BY p.id, p.nome, p.especialidade
                    ORDER BY COALESCE(COUNT(DISTINCT CASE 
                        WHEN p.especialidade = 'Medicina' AND m.prof_medicina = p.nome THEN m.aih_id
                        WHEN p.especialidade = 'Enfermagem' AND m.prof_enfermagem = p.nome THEN m.aih_id
                        WHEN p.especialidade = 'Fisioterapia' AND m.prof_fisioterapia = p.nome THEN m.aih_id
                        WHEN p.especialidade = 'Bucomaxilo' AND m.prof_bucomaxilo = p.nome THEN m.aih_id
                    END), 0) DESC, p.especialidade, p.nome`;

                dados = await all(sqlAihsExport, params);
                break;

            case 'glosas-profissional-periodo':
                dados = await all(`
                    SELECT 
                        g.profissional as 'Profissional',
                        COUNT(*) as 'Total Glosas',
                        SUM(g.quantidade) as 'Quantidade Total',
                        GROUP_CONCAT(DISTINCT g.tipo) as 'Tipos de Glosa',
                        COUNT(DISTINCT g.tipo) as 'Tipos Diferentes'
                    FROM glosas g
                    JOIN aihs a ON g.aih_id = a.id
                    WHERE g.ativa = 1 ${filtroWhere}
                    GROUP BY g.profissional
                    ORDER BY COUNT(*) DESC
                `, params);
                break;

            case 'valores-glosas-periodo':
                const dadosValoresGlosas = await get(`
                    SELECT 
                        COUNT(DISTINCT a.id) as aihs_com_glosas,
                        SUM(a.valor_inicial) as valor_inicial_total,
                        SUM(a.valor_atual) as valor_atual_total,
                        SUM(a.valor_inicial - a.valor_atual) as total_glosas,
                        AVG(a.valor_inicial - a.valor_atual) as media_glosa_por_aih,
                        MIN(a.valor_inicial - a.valor_atual) as menor_glosa,
                        MAX(a.valor_inicial - a.valor_atual) as maior_glosa
                    FROM aihs a
                    WHERE EXISTS (SELECT 1 FROM glosas g WHERE g.aih_id = a.id AND g.ativa = 1)
                    ${filtroWhere}
                `, params);

                dados = [{
                    'AIHs com Glosas': dadosValoresGlosas.aihs_com_glosas || 0,
                    'Valor Inicial Total': `R$ ${(dadosValoresGlosas.valor_inicial_total || 0).toFixed(2)}`,
                    'Valor Atual Total': `R$ ${(dadosValoresGlosas.valor_atual_total || 0).toFixed(2)}`,
                    'Total de Glosas': `R$ ${(dadosValoresGlosas.total_glosas || 0).toFixed(2)}`,
                    'Média por AIH': `R$ ${(dadosValoresGlosas.media_glosa_por_aih || 0).toFixed(2)}`,
                    'Menor Glosa': `R$ ${(dadosValoresGlosas.menor_glosa || 0).toFixed(2)}`,
                    'Maior Glosa': `R$ ${(dadosValoresGlosas.maior_glosa || 0).toFixed(2)}`
                }];
                break;

            case 'estatisticas-periodo':
                const stats = await get(`
                    SELECT 
                        COUNT(*) as total_aihs,
                        SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) as aprovacao_direta,
                        SUM(CASE WHEN status = 2 THEN 1 ELSE 0 END) as aprovacao_indireta,
                        SUM(CASE WHEN status = 3 THEN 1 ELSE 0 END) as em_discussao,
                        SUM(CASE WHEN status = 4 THEN 1 ELSE 0 END) as finalizada_pos_discussao,
                        AVG(valor_inicial) as valor_medio_inicial,
                        AVG(valor_atual) as valor_medio_atual,
                        SUM(valor_inicial) as valor_total_inicial,
                        SUM(valor_atual) as valor_total_atual
                    FROM aihs a
                    WHERE 1=1 ${filtroWhere.replace('criado_em', 'a.criado_em')}
                `, params);

                const totalGlosasPeriodo = await get(`
                    SELECT COUNT(*) as total_glosas,
                           COUNT(DISTINCT aih_id) as aihs_com_glosas
                    FROM glosas g
                    JOIN aihs a ON g.aih_id = a.id
                    WHERE g.ativa = 1 ${filtroWhere.replace('criado_em', 'a.criado_em')}
                `, params);

                dados = [{
                    'Total AIHs': stats.total_aihs || 0,
                    'Aprovação Direta': stats.aprovacao_direta || 0,
                    'Aprovação Indireta': stats.aprovacao_indireta || 0,
                    'Em Discussão': stats.em_discussao || 0,
                    'Finalizada Pós-Discussão': stats.finalizada_pos_discussao || 0,
                    'Total Glosas': totalGlosasPeriodo.total_glosas || 0,
                    'AIHs com Glosas': totalGlosasPeriodo.aihs_com_glosas || 0,
                    'Valor Médio Inicial': `R$ ${(stats.valor_medio_inicial || 0).toFixed(2)}`,
                    'Valor Médio Atual': `R$ ${(stats.valor_medio_atual || 0).toFixed(2)}`,
                    'Valor Total Inicial': `R$ ${(stats.valor_total_inicial || 0).toFixed(2)}`,
                    'Valor Total Atual': `R$ ${(stats.valor_total_atual || 0).toFixed(2)}`,
                    'Diferença Total': `R$ ${((stats.valor_total_inicial || 0) - (stats.valor_total_atual || 0)).toFixed(2)}`,
                    'Percentual com Glosas': stats.total_aihs > 0 ? `${((totalGlosasPeriodo.aihs_com_glosas / stats.total_aihs) * 100).toFixed(2)}%` : '0%'
                }];
                break;

            // Novos relatórios avançados
            case 'performance-competencias':
                dados = await all(`
                    SELECT 
                        a.competencia as 'Competência',
                        COUNT(*) as 'Total AIHs',
                        COUNT(DISTINCT CASE WHEN g.id IS NOT NULL THEN a.id END) as 'AIHs com Glosas',
                        ROUND((COUNT(DISTINCT CASE WHEN g.id IS NOT NULL THEN a.id END) * 100.0 / COUNT(*)), 2) as 'Percentual com Glosas (%)',
                        SUM(a.valor_inicial) as 'Valor Inicial Total',
                        SUM(a.valor_atual) as 'Valor Atual Total',
                        SUM(a.valor_inicial - a.valor_atual) as 'Total Glosas (R$)',
                        ROUND(AVG(a.valor_inicial - a.valor_atual), 2) as 'Média Glosa por AIH',
                        SUM(CASE WHEN a.status IN (1, 4) THEN 1 ELSE 0 END) as 'AIHs Finalizadas',
                        SUM(CASE WHEN a.status IN (2, 3) THEN 1 ELSE 0 END) as 'AIHs Pendentes'
                    FROM aihs a
                    LEFT JOIN glosas g ON a.id = g.aih_id AND g.ativa = 1
                    WHERE 1=1 ${filtroWhere}
                    GROUP BY a.competencia
                    ORDER BY a.competencia DESC
                `, params);
                break;

            case 'logs-exclusao':
                dados = await all(`
                    SELECT 
                        le.id as 'ID Log',
                        CASE le.tipo_exclusao
                            WHEN 'movimentacao' THEN 'Movimentação'
                            WHEN 'aih_completa' THEN 'AIH Completa'
                            ELSE le.tipo_exclusao
                        END as 'Tipo Exclusão',
                        u.nome as 'Usuário',
                        le.justificativa as 'Justificativa',
                        datetime(le.data_exclusao, 'localtime') as 'Data/Hora Exclusão',
                        CASE 
                            WHEN le.tipo_exclusao = 'movimentacao' THEN 
                                json_extract(le.dados_excluidos, '$.numero_aih')
                            WHEN le.tipo_exclusao = 'aih_completa' THEN 
                                json_extract(le.dados_excluidos, '$.aih.numero_aih')
                        END as 'AIH Afetada'
                    FROM logs_exclusao le
                    LEFT JOIN usuarios u ON le.usuario_id = u.id
                    WHERE 1=1 ${filtroWhere.replace('competencia', 'DATE(le.data_exclusao)').replace('criado_em', 'DATE(le.data_exclusao)')}
                    ORDER BY le.data_exclusao DESC
                `, params);
                break;

            case 'analise-preditiva':
                const mediaTempo = await get(`
                    SELECT AVG(JULIANDAY(CURRENT_TIMESTAMP) - JULIANDAY(criado_em)) as media_dias
                    FROM aihs WHERE status IN (1, 4)
                `);

                const tendenciaGlosas = await all(`
                    SELECT 
                        strftime('%Y-%m', criado_em) as 'Mês',
                        COUNT(*) as 'Total Glosas'
                    FROM glosas
                    WHERE ativa = 1
                    GROUP BY strftime('%Y-%m', criado_em)
                    ORDER BY strftime('%Y-%m', criado_em) DESC
                    LIMIT 12
                `);

                dados = [
                    {
                        'Métrica': 'Tempo Médio de Processamento',
                        'Valor': `${Math.round(mediaTempo.media_dias || 0)} dias`,
                        'Observação': 'Tempo médio para finalização de AIHs'
                    },
                    {
                        'Métrica': 'Tendência de Glosas',
                        'Valor': `${tendenciaGlosas.length} meses analisados`,
                        'Observação': 'Histórico de glosas por mês'
                    }
                ];

                // Adicionar dados da tendência
                tendenciaGlosas.forEach(t => {
                    dados.push({
                        'Métrica': `Glosas em ${t['Mês']}`,
                        'Valor': t['Total Glosas'],
                        'Observação': 'Quantidade de glosas no período'
                    });
                });
                break;

            case 'detalhamento-status':
                dados = await all(`
                    SELECT 
                        CASE a.status
                            WHEN 1 THEN 'Finalizada com aprovação direta'
                            WHEN 2 THEN 'Ativa com aprovação indireta'
                            WHEN 3 THEN 'Ativa em discussão'
                            WHEN 4 THEN 'Finalizada após discussão'
                            ELSE 'Status desconhecido'
                        END as 'Status',
                        a.status as 'Código Status',
                        COUNT(*) as 'Quantidade AIHs',
                        ROUND(SUM(a.valor_inicial), 2) as 'Valor Inicial Total (R$)',
                        ROUND(SUM(a.valor_atual), 2) as 'Valor Atual Total (R$)',
                        ROUND(SUM(a.valor_inicial - a.valor_atual), 2) as 'Diferença Valores (R$)',
                        ROUND(AVG(a.valor_inicial), 2) as 'Valor Inicial Médio (R$)',
                        ROUND(AVG(a.valor_atual), 2) as 'Valor Atual Médio (R$)',
                        COUNT(DISTINCT g.id) as 'Total Glosas',
                        ROUND((COUNT(*) * 100.0 / (SELECT COUNT(*) FROM aihs)), 2) as 'Percentual (%)'
                    FROM aihs a
                    LEFT JOIN glosas g ON a.id = g.aih_id AND g.ativa = 1
                    WHERE 1=1 ${filtroWhere}
                    GROUP BY a.status
                    ORDER BY a.status
                `, params);
                break;

            case 'ranking-glosas-frequentes':
                dados = await all(`
                    SELECT 
                        g.tipo as 'Tipo de Glosa',
                        g.linha as 'Linha Item',
                        COUNT(*) as 'Frequência',
                        COUNT(DISTINCT g.aih_id) as 'AIHs Afetadas',
                        COUNT(DISTINCT g.profissional) as 'Profissionais Envolvidos',
                        GROUP_CONCAT(DISTINCT g.profissional) as 'Lista Profissionais',
                        ROUND(SUM(a.valor_inicial - a.valor_atual), 2) as 'Impacto Financeiro Total (R$)',
                        ROUND(AVG(a.valor_inicial - a.valor_atual), 2) as 'Impacto Financeiro Médio (R$)'
                    FROM glosas g
                    JOIN aihs a ON g.aih_id = a.id
                    WHERE g.ativa = 1 ${filtroWhere.replace('criado_em', 'a.criado_em')}
                    GROUP BY g.tipo, g.linha
                    ORDER BY COUNT(*) DESC, SUM(a.valor_inicial - a.valor_atual) DESC
                `, params);
                break;

            case 'analise-financeira':
                const analiseFinanceira = await get(`
                    SELECT 
                        COUNT(*) as total_aihs,
                        SUM(a.valor_inicial) as valor_inicial_geral,
                        SUM(a.valor_atual) as valor_atual_geral,
                        SUM(a.valor_inicial - a.valor_atual) as perdas_glosas,
                        AVG(a.valor_inicial) as valor_inicial_medio,
                        AVG(a.valor_atual) as valor_atual_medio,
                        AVG(a.valor_inicial - a.valor_atual) as perda_media_por_aih,
                        MIN(a.valor_inicial) as menor_valor_inicial,
                        MAX(a.valor_inicial) as maior_valor_inicial,
                        MIN(a.valor_atual) as menor_valor_atual,
                        MAX(a.valor_atual) as maior_valor_atual
                    FROM aihs a
                    WHERE 1=1 ${filtroWhere}
                `, params);

                dados = [{
                    'Total AIHs': analiseFinanceira.total_aihs || 0,
                    'Valor Inicial Geral': `R$ ${(analiseFinanceira.valor_inicial_geral || 0).toFixed(2)}`,
                    'Valor Atual Geral': `R$ ${(analiseFinanceira.valor_atual_geral || 0).toFixed(2)}`,
                    'Perdas por Glosas': `R$ ${(analiseFinanceira.perdas_glosas || 0).toFixed(2)}`,
                    'Valor Inicial Médio': `R$ ${(analiseFinanceira.valor_inicial_medio || 0).toFixed(2)}`,
                    'Valor Atual Médio': `R$ ${(analiseFinanceira.valor_atual_medio || 0).toFixed(2)}`,
                    'Perda Média por AIH': `R$ ${(analiseFinanceira.perda_media_por_aih || 0).toFixed(2)}`,
                    'Menor Valor Inicial': `R$ ${(analiseFinanceira.menor_valor_inicial || 0).toFixed(2)}`,
                    'Maior Valor Inicial': `R$ ${(analiseFinanceira.maior_valor_inicial || 0).toFixed(2)}`,
                    'Menor Valor Atual': `R$ ${(analiseFinanceira.menor_valor_atual || 0).toFixed(2)}`,
                    'Maior Valor Atual': `R$ ${(analiseFinanceira.maior_valor_atual || 0).toFixed(2)}`
                }];
                break;

            case 'analise-valores-glosas':
                // AIHs com glosas (apenas as que têm glosas ativas)
                const aihsComGlosasExport = await get(`
                    SELECT COUNT(DISTINCT a.id) as aihs_com_glosas
                    FROM aihs a
                    WHERE EXISTS (SELECT 1 FROM glosas g WHERE g.aih_id = a.id AND g.ativa = 1)
                    ${filtroWhere.replace('criado_em', 'a.criado_em')}
                `, params);

                // Total de glosas (apenas contar as glosas ativas)
                const totalGlosasExport = await get(`
                    SELECT COUNT(g.id) as total_glosas
                    FROM glosas g
                    JOIN aihs a ON g.aih_id = a.id
                    WHERE g.ativa = 1
                    ${filtroWhere.replace('criado_em', 'a.criado_em')}
                `, params);

                // Valor total das glosas = diferença entre soma total de valores iniciais e valores atuais de TODAS as AIHs
                const valorTotalGlosasExport = await get(`
                    SELECT 
                        SUM(a.valor_inicial) as soma_valores_iniciais,
                        SUM(a.valor_atual) as soma_valores_atuais,
                        SUM(a.valor_inicial) - SUM(a.valor_atual) as valor_total_glosas
                    FROM aihs a
                    WHERE 1=1
                    ${filtroWhere.replace('criado_em', 'a.criado_em')}
                `, params);

                dados = [{
                    'AIHs com Glosas': aihsComGlosasExport.aihs_com_glosas || 0,
                    'Total de Glosas': totalGlosasExport.total_glosas || 0,
                    'Valor Inicial Total (Todas AIHs)': `R$ ${(valorTotalGlosasExport.soma_valores_iniciais || 0).toFixed(2)}`,
                    'Valor Atual Total (Todas AIHs)': `R$ ${(valorTotalGlosasExport.soma_valores_atuais || 0).toFixed(2)}`,
                    'Valor Total Glosas (Diferença Geral)': `R$ ${(valorTotalGlosasExport.valor_total_glosas || 0).toFixed(2)}`
                }];
                break;

            case 'cruzamento-profissional-glosas':
                dados = await all(`
                    SELECT 
                        g.profissional as 'Profissional',
                        g.tipo as 'Tipo de Glosa',
                        COUNT(*) as 'Ocorrências',
                        COUNT(DISTINCT g.aih_id) as 'AIHs Afetadas'
                    FROM glosas g
                    JOIN aihs a ON g.aih_id = a.id
                    WHERE g.ativa = 1 ${filtroWhere}
                    GROUP BY g.profissional, g.tipo
                    ORDER BY g.profissional, COUNT(*) DESC
                `, params);
                break;

            case 'produtividade-auditores':
                dados = await all(`
                    SELECT 
                        p.nome as 'Profissional',
                        p.especialidade as 'Especialidade',
                        COALESCE(COUNT(DISTINCT CASE 
                            WHEN p.especialidade = 'Medicina' AND m.prof_medicina = p.nome THEN m.aih_id
                            WHEN p.especialidade = 'Enfermagem' AND m.prof_enfermagem = p.nome THEN m.aih_id
                            WHEN p.especialidade = 'Fisioterapia' AND m.prof_fisioterapia = p.nome THEN m.aih_id
                            WHEN p.especialidade = 'Bucomaxilo' AND m.prof_bucomaxilo = p.nome THEN m.aih_id
                        END), 0) as 'AIHs Auditadas (Quantidade)',
                        COALESCE(COUNT(DISTINCT g.id), 0) as 'Glosas Identificadas (Quantidade)',
                        COALESCE(COUNT(CASE 
                            WHEN p.especialidade = 'Medicina' AND m.prof_medicina = p.nome THEN 1
                            WHEN p.especialidade = 'Enfermagem' AND m.prof_enfermagem = p.nome THEN 1
                            WHEN p.especialidade = 'Fisioterapia' AND m.prof_fisioterapia = p.nome THEN 1
                            WHEN p.especialidade = 'Bucomaxilo' AND m.prof_bucomaxilo = p.nome THEN 1
                        END), 0) as 'Movimentações Realizadas (Quantidade)',
                        COALESCE(ROUND(SUM(CASE 
                            WHEN p.especialidade = 'Medicina' AND m.prof_medicina = p.nome THEN m.valor_conta
                            WHEN p.especialidade = 'Enfermagem' AND m.prof_enfermagem = p.nome THEN m.valor_conta
                            WHEN p.especialidade = 'Fisioterapia' AND m.prof_fisioterapia = p.nome THEN m.valor_conta
                            WHEN p.especialidade = 'Bucomaxilo' AND m.prof_bucomaxilo = p.nome THEN m.valor_conta
                        END), 2), 0) as 'Valor Total Auditado (R$)'
                    FROM profissionais p
                    LEFT JOIN movimentacoes m ON (
                        (p.especialidade = 'Medicina' AND m.prof_medicina = p.nome) OR
                        (p.especialidade = 'Enfermagem' AND m.prof_enfermagem = p.nome) OR
                        (p.especialidade = 'Fisioterapia' AND m.prof_fisioterapia = p.nome) OR
                        (p.especialidade = 'Bucomaxilo' AND m.prof_bucomaxilo = p.nome)
                    )
                    LEFT JOIN aihs a ON m.aih_id = a.id
                    LEFT JOIN glosas g ON a.id = g.aih_id AND g.ativa = 1 AND g.profissional = p.nome
                    WHERE 1=1 ${filtroWhere.replace('competencia', 'COALESCE(m.competencia, "")').replace('criado_em', 'COALESCE(m.data_movimentacao, "")')}
                    GROUP BY p.id, p.nome, p.especialidade
                    ORDER BY COALESCE(COUNT(DISTINCT CASE 
                        WHEN p.especialidade = 'Medicina' AND m.prof_medicina = p.nome THEN m.aih_id
                        WHEN p.especialidade = 'Enfermagem' AND m.prof_enfermagem = p.nome THEN m.aih_id
                        WHEN p.especialidade = 'Fisioterapia' AND m.prof_fisioterapia = p.nome THEN m.aih_id
                        WHEN p.especialidade = 'Bucomaxilo' AND m.prof_bucomaxilo = p.nome THEN m.aih_id
                    END), 0) DESC, COALESCE(COUNT(DISTINCT g.id), 0) DESC
                `, params);
                break;

            case 'comparativo-auditorias':
                dados = await all(`
                    SELECT 
                        CASE m.tipo
                            WHEN 'entrada_sus' THEN 'Entrada na Auditoria SUS'
                            WHEN 'saida_hospital' THEN 'Saída para Auditoria Hospital'
                            ELSE m.tipo
                        END as 'Tipo de Movimentação',
                        COUNT(*) as 'Total de Movimentações (Quantidade)',
                        COUNT(DISTINCT m.aih_id) as 'AIHs Movimentadas (Quantidade)',
                        ROUND(AVG(m.valor_conta), 2) as 'Valor Médio das Contas (R$)',
                        ROUND(SUM(m.valor_conta), 2) as 'Valor Total das Contas (R$)'
                    FROM movimentacoes m
                    JOIN aihs a ON m.aih_id = a.id
                    WHERE 1=1 ${filtroWhere.replace('competencia', 'm.competencia').replace('criado_em', 'm.data_movimentacao')}
                    GROUP BY m.tipo
                `, params);
                break;

            case 'eficiencia-processamento':
                dados = await all(`
                    SELECT 
                        a.competencia as 'Competência',
                        COUNT(*) as 'AIHs na Competência',
                        ROUND(AVG(JULIANDAY(CURRENT_TIMESTAMP) - JULIANDAY(a.criado_em)), 1) as 'Tempo Médio (dias)',
                        COUNT(CASE WHEN a.status IN (1, 4) THEN 1 END) as 'Finalizadas',
                        COUNT(CASE WHEN a.status IN (2, 3) THEN 1 END) as 'Em Andamento',
                        COUNT(DISTINCT m.id) as 'Total Movimentações',
                        ROUND(COUNT(DISTINCT m.id) * 1.0 / COUNT(*), 2) as 'Movimentações por AIH'
                    FROM aihs a
                    LEFT JOIN movimentacoes m ON a.id = m.aih_id
                    WHERE 1=1 ${filtroWhere}
                    GROUP BY a.competencia
                    ORDER BY a.competencia DESC
                `, params);
                break;

            case 'analise-temporal-cadastros':
                dados = await all(`
                    SELECT 
                        DATE(a.criado_em) as 'Data Cadastro',
                        COUNT(*) as 'AIHs Cadastradas',
                        ROUND(SUM(a.valor_inicial), 2) as 'Valor Total Cadastrado (R$)',
                        COUNT(CASE WHEN a.status IN (1, 4) THEN 1 END) as 'Finalizadas',
                        ROUND(AVG(a.valor_inicial), 2) as 'Valor Médio AIH (R$)'
                    FROM aihs a
                    WHERE 1=1 ${filtroWhere}
                    GROUP BY DATE(a.criado_em)
                    ORDER BY DATE(a.criado_em) DESC
                `, params);
                break;

            case 'fluxo-movimentacoes':
                const fluxoEntradas = await get(`
                    SELECT COUNT(DISTINCT m.aih_id) as total_entradas
                    FROM movimentacoes m
                    JOIN aihs a ON m.aih_id = a.id
                    WHERE m.tipo = 'entrada_sus' ${filtroWhere.replace('competencia', 'm.competencia').replace('criado_em', 'm.data_movimentacao')}
                `, params);

                const fluxoSaidas = await get(`
                    SELECT COUNT(DISTINCT m.aih_id) as total_saidas
                    FROM movimentacoes m
                    JOIN aihs a ON m.aih_id = a.id
                    WHERE m.tipo = 'saida_hospital' ${filtroWhere.replace('competencia', 'm.competencia').replace('criado_em', 'm.data_movimentacao')}
                `, params);

                const fluxoMensal = await all(`
                    SELECT 
                        strftime('%Y-%m', m.data_movimentacao) as 'Mês/Ano',
                        COUNT(DISTINCT CASE WHEN m.tipo = 'entrada_sus' THEN m.aih_id END) as 'Entradas SUS (Qtd AIHs)',
                        COUNT(DISTINCT CASE WHEN m.tipo = 'saida_hospital' THEN m.aih_id END) as 'Saídas Hospital (Qtd AIHs)',
                        COUNT(DISTINCT CASE WHEN m.tipo = 'entrada_sus' THEN m.aih_id END) - 
                        COUNT(DISTINCT CASE WHEN m.tipo = 'saida_hospital' THEN m.aih_id END) as 'Saldo Mensal (Qtd AIHs)'
                    FROM movimentacoes m
                    JOIN aihs a ON m.aih_id = a.id
                    WHERE 1=1 ${filtroWhere.replace('competencia', 'm.competencia').replace('criado_em', 'm.data_movimentacao')}
                    GROUP BY strftime('%Y-%m', m.data_movimentacao)
                    ORDER BY strftime('%Y-%m', m.data_movimentacao) DESC
                `, params);

                // Dados do resumo geral
                const resumoGeral = [
                    {
                        'Tipo de Movimentação': 'Entradas na Auditoria SUS',
                        'Quantidade de AIHs': fluxoEntradas.total_entradas || 0,
                        'Descrição': 'AIHs que entraram na auditoria SUS no período'
                    },
                    {
                        'Tipo de Movimentação': 'Saídas para Auditoria Hospital',
                        'Quantidade de AIHs': fluxoSaidas.total_saidas || 0,
                        'Descrição': 'AIHs enviadas para auditoria do hospital no período'
                    },
                    {
                        'Tipo de Movimentação': 'Saldo (Em Processamento)',
                        'Quantidade de AIHs': (fluxoEntradas.total_entradas || 0) - (fluxoSaidas.total_saidas || 0),
                        'Descrição': 'AIHs atualmente em processamento na auditoria SUS'
                    }
                ];

                // Combinar resumo e fluxo mensal
                dados = [...resumoGeral, ...fluxoMensal];
                break;

            // Relatórios originais (sem filtros)
            case 'acessos':
                dados = await all(`
                    SELECT u.nome as Usuario, COUNT(l.id) as 'Total Acessos', 
                           MAX(l.data_hora) as 'Ultimo Acesso'
                    FROM logs_acesso l
                    JOIN usuarios u ON l.usuario_id = u.id
                    WHERE l.acao = 'Login'
                    GROUP BY u.id
                    ORDER BY COUNT(l.id) DESC
                `);
                break;

            case 'glosas-profissional':
                dados = await all(`
                    SELECT profissional as Profissional, 
                           COUNT(*) as 'Total Glosas',
                           SUM(quantidade) as 'Quantidade Total'
                    FROM glosas
                    WHERE ativa = 1
                    GROUP BY profissional
                    ORDER BY COUNT(*) DESC
                `);
                break;

            case 'aihs-profissional':
                dados = await all(`
                    SELECT 
                        COALESCE(prof_medicina, prof_enfermagem, prof_fisioterapia, prof_bucomaxilo) as Profissional,
                        COUNT(DISTINCT aih_id) as 'Total AIHs',
                        COUNT(*) as 'Total Movimentacoes'
                    FROM movimentacoes
                    WHERE prof_medicina IS NOT NULL 
                       OR prof_enfermagem IS NOT NULL 
                       OR prof_fisioterapia IS NOT NULL 
                       OR prof_bucomaxilo IS NOT NULL
                    GROUP BY profissional
                    ORDER BY COUNT(DISTINCT aih_id) DESC
                `);
                break;

            case 'aprovacoes':
                const aprovacoes = await get(`
                    SELECT 
                        SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) as aprovacao_direta,
                        SUM(CASE WHEN status = 2 THEN 1 ELSE 0 END) as aprovacao_indireta,
                        SUM(CASE WHEN status = 3 THEN 1 ELSE 0 END) as em_discussao,
                        SUM(CASE WHEN status = 4 THEN 1 ELSE 0 END) as finalizada_pos_discussao,
                        COUNT(*) as total
                    FROM aihs
                `);
                dados = [
                    { Tipo: 'Aprovação Direta', Quantidade: aprovacoes.aprovacao_direta, Percentual: ((aprovacoes.aprovacao_direta/aprovacoes.total)*100).toFixed(1) + '%' },
                    { Tipo: 'Aprovação Indireta', Quantidade: aprovacoes.aprovacao_indireta, Percentual: ((aprovacoes.aprovacao_indireta/aprovacoes.total)*100).toFixed(1) + '%' },
                    { Tipo: 'Em Discussão', Quantidade: aprovacoes.em_discussao, Percentual: ((aprovacoes.em_discussao/aprovacoes.total)*100).toFixed(1) + '%' },
                    { Tipo: 'Finalizada Pós-Discussão', Quantidade: aprovacoes.finalizada_pos_discussao, Percentual: ((aprovacoes.finalizada_pos_discussao/aprovacoes.total)*100).toFixed(1) + '%' }
                ];
                break;

            case 'tipos-glosa':
                dados = await all(`
                    SELECT tipo as 'Tipo de Glosa', 
                           COUNT(*) as 'Total Ocorrencias', 
                           SUM(quantidade) as 'Quantidade Total'
                    FROM glosas
                    WHERE ativa = 1
                    GROUP BY tipo
                    ORDER BY COUNT(*) DESC
                `);
                break;

            default:
                console.log(`❌ Tipo de relatório não reconhecido: ${tipo}`);
                return res.status(400).json({ 
                    error: `Tipo de relatório não suportado para exportação: ${tipo}`,
                    tipos_suportados: [
                        'tipos-glosa-periodo', 'aihs-profissional-periodo', 'glosas-profissional-periodo',
                        'valores-glosas-periodo', 'estatisticas-periodo', 'performance-competencias',
                        'logs-exclusao', 'analise-preditiva', 'detalhamento-status', 'ranking-glosas-frequentes',
                        'distribuicao-valores', 'analise-financeira', 'analise-valores-glosas',
                        'cruzamento-profissional-glosas', 'produtividade-auditores', 'comparativo-auditorias',
                        'eficiencia-processamento', 'analise-temporal-cadastros', 'fluxo-movimentacoes',
                        'acessos', 'glosas-profissional', 'aihs-profissional', 'aprovacoes', 'tipos-glosa'
                    ]
                });
        }

        if (!dados || dados.length === 0) {
            console.log(`❌ Nenhum dado encontrado para o relatório: ${tipo}`);
            return res.status(404).json({ error: 'Nenhum dado encontrado para este relatório' });
        }

        console.log(`✅ Dados do relatório ${tipo}: ${dados.length} registros`);

        // Criar Excel real (XLS compatível)
        const worksheet = XLSX.utils.json_to_sheet(dados);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, tipo.charAt(0).toUpperCase() + tipo.slice(1));

        const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xls' });

        res.setHeader('Content-Type', 'application/vnd.ms-excel');
        res.setHeader('Content-Disposition', `attachment; filename=${nomeArquivo}.xls`);
        res.setHeader('Cache-Control', 'no-cache');
        res.send(buffer);

        console.log(`📊 Relatório ${tipo} exportado com sucesso: ${nomeArquivo}.xls`);

    } catch (err) {
        console.error(`❌ Erro ao exportar relatório ${req.params.tipo}:`, err);
        res.status(500).json({ error: `Erro interno ao exportar relatório: ${err.message}` });
    }
});


// Servir SPA
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Iniciar servidor
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor rodando em http://0.0.0.0:${PORT}`);
});