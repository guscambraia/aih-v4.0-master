
const { run, get } = require('./database');

// Limpeza de logs antigos (manter apenas 60 dias para melhor performance)
const cleanupOldLogs = async () => {
    try {
        const result = await run(`
            DELETE FROM logs_acesso 
            WHERE data_hora < datetime('now', '-60 days')
        `);
        console.log(`Logs limpos: ${result.changes} registros removidos`);
        
        // Limpar também logs de exclusão muito antigos (manter 180 dias)
        const exclusaoResult = await run(`
            DELETE FROM logs_exclusao 
            WHERE data_exclusao < datetime('now', '-180 days')
        `);
        console.log(`Logs de exclusão limpos: ${exclusaoResult.changes} registros removidos`);
    } catch (err) {
        console.error('Erro na limpeza de logs:', err);
    }
};

// Otimizar banco de dados com manutenção WAL
const optimizeDatabase = async () => {
    try {
        // Checkpoint do WAL para liberar espaço
        await run('PRAGMA wal_checkpoint(TRUNCATE)');
        console.log('WAL checkpoint realizado');
        
        // Atualizar estatísticas primeiro (mais rápido)
        await run('ANALYZE');
        console.log('Estatísticas atualizadas');
        
        // VACUUM incremental (menos impacto)
        await run('PRAGMA incremental_vacuum(1000)'); // Apenas 1000 páginas
        console.log('VACUUM incremental realizado');
        
        // Otimizar índices
        await run('PRAGMA optimize');
        console.log('Índices otimizados');
        
        console.log('Banco otimizado com sucesso');
    } catch (err) {
        console.error('Erro na otimização:', err);
    }
};

// Executar manutenção (deve ser chamado periodicamente)
const runMaintenance = async () => {
    console.log('Iniciando manutenção do banco...');
    await cleanupOldLogs();
    await optimizeDatabase();
    console.log('Manutenção concluída');
};

// Agendar manutenção mais frequente para alto volume
const scheduleMaintenance = () => {
    const THREE_DAYS = 3 * 24 * 60 * 60 * 1000; // A cada 3 dias
    setInterval(runMaintenance, THREE_DAYS);
    
    // Executar na inicialização após 5 minutos
    setTimeout(runMaintenance, 5 * 60 * 1000);
    
    // Manutenção leve diária (apenas WAL checkpoint)
    const lightMaintenance = async () => {
        try {
            await run('PRAGMA wal_checkpoint(PASSIVE)');
            console.log('Manutenção leve: WAL checkpoint realizado');
        } catch (err) {
            console.error('Erro na manutenção leve:', err);
        }
    };
    
    // Manutenção leve a cada 24 horas
    setInterval(lightMaintenance, 24 * 60 * 60 * 1000);
};

module.exports = { cleanupOldLogs, optimizeDatabase, runMaintenance, scheduleMaintenance };
