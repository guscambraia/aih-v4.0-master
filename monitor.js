
const { get } = require('./database');

// Estatísticas de performance
const getPerformanceStats = async () => {
    try {
        const stats = await get(`
            SELECT 
                (SELECT COUNT(*) FROM aihs) as total_aihs,
                (SELECT COUNT(*) FROM movimentacoes) as total_movimentacoes,
                (SELECT COUNT(*) FROM glosas WHERE ativa = 1) as total_glosas_ativas,
                (SELECT COUNT(*) FROM usuarios) as total_usuarios
        `);
        
        const dbSize = await get("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()");
        
        return {
            ...stats,
            db_size_mb: Math.round((dbSize.size || 0) / (1024 * 1024) * 100) / 100,
            timestamp: new Date().toISOString()
        };
    } catch (err) {
        console.error('Erro ao obter estatísticas:', err);
        return null;
    }
};

// Log de performance detalhado
const logPerformance = async () => {
    const stats = await getPerformanceStats();
    const memUsage = process.memoryUsage();
    const uptime = process.uptime();
    
    if (stats) {
        console.log(`📊 Performance Stats:`);
        console.log(`   - AIHs: ${stats.total_aihs} | Movimentações: ${stats.total_movimentacoes} | Glosas: ${stats.total_glosas_ativas}`);
        console.log(`   - DB: ${stats.db_size_mb}MB | RAM: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB | Uptime: ${Math.round(uptime / 3600)}h`);
        
        // Alertas de performance
        if (stats.db_size_mb > 1000) {
            console.warn('⚠️  Banco de dados muito grande (>1GB). Considere manutenção.');
        }
        
        if (memUsage.heapUsed > 512 * 1024 * 1024) { // 512MB
            console.warn('⚠️  Alto uso de memória RAM detectado.');
        }
        
        if (stats.total_aihs > 50000) {
            console.log('🚀 Sistema em produção com alto volume detectado.');
        }
    }
};

// Agendar monitoramento mais frequente para alto volume
setInterval(logPerformance, 30 * 60 * 1000); // A cada 30 minutos

// Log inicial após 1 minuto
setTimeout(logPerformance, 60 * 1000);

module.exports = { getPerformanceStats, logPerformance };
