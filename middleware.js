const rateLimit = {
    window: 15 * 60 * 1000, // 15 minutos
    maxRequests: 2000, // 2000 requests por janela (aumentado)
    requests: new Map(),

    check(ip) {
        const now = Date.now();
        const windowStart = now - this.window;

        if (!this.requests.has(ip)) {
            this.requests.set(ip, []);
        }

        const requests = this.requests.get(ip);

        // Remover requests antigos de forma mais eficiente
        let removeCount = 0;
        for (let i = 0; i < requests.length; i++) {
            if (requests[i] < windowStart) {
                removeCount++;
            } else {
                break;
            }
        }
        if (removeCount > 0) {
            requests.splice(0, removeCount);
        }

        if (requests.length >= this.maxRequests) {
            return false;
        }

        requests.push(now);
        return true;
    },

    clear(ip) {
        this.requests.delete(ip);
    },

    // Limpeza periódica para evitar vazamento de memória
    cleanup() {
        const now = Date.now();
        const windowStart = now - this.window;

        for (const [ip, requests] of this.requests.entries()) {
            const activeRequests = requests.filter(time => time > windowStart);
            if (activeRequests.length === 0) {
                this.requests.delete(ip);
            } else {
                this.requests.set(ip, activeRequests);
            }
        }
    },

    getStats() {
        const now = Date.now();
        const windowStart = now - this.window;
        let totalActive = 0;

        for (const [ip, requests] of this.requests.entries()) {
            const activeRequests = requests.filter(time => time > windowStart);
            totalActive += activeRequests.length;
        }

        return {
            totalActiveRequests: totalActive,
            uniqueIPs: this.requests.size,
            window: this.window / 1000 / 60 // em minutos
        };
    }
};
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutos
const MAX_REQUESTS = 2000; // requests por janela - otimizado para volume de AIHs

// Rate limiting simples
const rateLimitMiddleware = (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];
    const now = Date.now();

    // Exempletar IPs locais e de desenvolvimento
    const exemptIPs = ['127.0.0.1', '::1', 'localhost'];
    const isLocal = exemptIPs.some(exemptIP => ip.includes(exemptIP)) || 
                   ip.startsWith('192.168.') || 
                   ip.startsWith('10.');

    if (isLocal && process.env.NODE_ENV !== 'production') {
        return next();
    }

    if (!rateLimit[ip]) {
        rateLimit[ip] = { count: 1, resetTime: now + RATE_LIMIT_WINDOW };
        return next();
    }

    if (now > rateLimit[ip].resetTime) {
        rateLimit[ip] = { count: 1, resetTime: now + RATE_LIMIT_WINDOW };
        return next();
    }

    if (rateLimit[ip].count >= MAX_REQUESTS) {
        console.log(`Rate limit excedido para IP: ${ip} (${rateLimit[ip].count}/${MAX_REQUESTS})`);
        return res.status(429).json({ 
            error: 'Muitas requisições. Tente novamente em alguns minutos.',
            resetTime: Math.ceil((rateLimit[ip].resetTime - now) / 1000 / 60) // minutos restantes
        });
    }

    rateLimit[ip].count++;
    next();
};

// Logs de segurança
const securityLogs = [];
const MAX_SECURITY_LOGS = 1000;

const logSecurityEvent = (type, details, ip) => {
    const event = {
        timestamp: new Date().toISOString(),
        type,
        details,
        ip,
        id: Date.now() + Math.random()
    };

    securityLogs.push(event);
    if (securityLogs.length > MAX_SECURITY_LOGS) {
        securityLogs.shift();
    }

    console.log(`🔒 Evento de Segurança [${type}]: ${details} - IP: ${ip}`);
};

// Validação avançada de entrada
const validateInput = (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];

    // Detectar possíveis ataques SQL Injection
    const sqlInjectionPatterns = [
        /('|(\')|(\-\-)|(\;)|(\|)|(\*)|(\%)|(\+)|(select|union|insert|delete|update|drop|create|alter|exec|execute))/i,
        /(script|javascript|vbscript|onload|onerror|onclick)/i,
        /(\<|\>|&lt;|&gt;|&#60;|&#62;)/i
    ];

    // Sanitizar strings com validação rigorosa
    const sanitizeString = (str) => {
        if (typeof str !== 'string') return str;

        // Verificar padrões suspeitos
        for (const pattern of sqlInjectionPatterns) {
            if (pattern.test(str)) {
                logSecurityEvent('TENTATIVA_SQL_INJECTION', `Padrão suspeito detectado: ${str.substring(0, 100)}`, ip);
                throw new Error('Entrada inválida detectada');
            }
        }

        // Limitar tamanho
        if (str.length > 10000) {
            logSecurityEvent('ENTRADA_MUITO_GRANDE', `Tamanho: ${str.length} chars`, ip);
            throw new Error('Entrada muito grande');
        }

        return str.trim()
            .replace(/[<>]/g, '') // Remover tags básicas
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ''); // Remover caracteres de controle
    };

    // Sanitizar recursivamente
    const sanitizeObject = (obj, depth = 0) => {
        if (depth > 10) {
            logSecurityEvent('OBJETO_MUITO_PROFUNDO', `Profundidade: ${depth}`, ip);
            throw new Error('Estrutura muito complexa');
        }

        if (typeof obj !== 'object' || obj === null) {
            return typeof obj === 'string' ? sanitizeString(obj) : obj;
        }

        if (Array.isArray(obj)) {
            if (obj.length > 1000) {
                logSecurityEvent('ARRAY_MUITO_GRANDE', `Tamanho: ${obj.length}`, ip);
                throw new Error('Array muito grande');
            }
            return obj.map(item => sanitizeObject(item, depth + 1));
        }

        const sanitized = {};
        let keyCount = 0;

        for (const [key, value] of Object.entries(obj)) {
            keyCount++;
            if (keyCount > 100) {
                logSecurityEvent('MUITAS_PROPRIEDADES', `Propriedades: ${keyCount}`, ip);
                throw new Error('Muitas propriedades no objeto');
            }

            const sanitizedKey = sanitizeString(key);
            sanitized[sanitizedKey] = sanitizeObject(value, depth + 1);
        }
        return sanitized;
    };

    try {
        req.body = sanitizeObject(req.body);
        next();
    } catch (error) {
        console.error('Erro na validação de entrada:', error.message);
        res.status(400).json({ error: 'Dados de entrada inválidos' });
    }
};

// Middleware para detectar comportamento suspeito
const suspiciousActivityTracker = {};

const detectSuspiciousActivity = (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];
    const now = Date.now();
    const minute = Math.floor(now / 60000);

    if (!suspiciousActivityTracker[ip]) {
        suspiciousActivityTracker[ip] = { requests: [], errors: 0, lastReset: minute };
    }

    const tracker = suspiciousActivityTracker[ip];

    // Reset a cada minuto
    if (minute > tracker.lastReset) {
        tracker.requests = [];
        tracker.errors = 0;
        tracker.lastReset = minute;
    }

    tracker.requests.push(now);

    // Remover requisições antigas (últimos 60 segundos)
    tracker.requests = tracker.requests.filter(time => now - time < 60000);

    // Detectar padrões suspeitos
    if (tracker.requests.length > 100) { // Mais de 100 req/min
        logSecurityEvent('MUITAS_REQUISICOES', `${tracker.requests.length} req/min`, ip);
    }

    // Verificar User-Agent suspeito
    const userAgent = req.headers['user-agent'] || '';
    const suspiciousUA = [
        'sqlmap', 'nikto', 'nmap', 'masscan', 'zap', 'burp', 'curl', 'wget'
    ];

    if (suspiciousUA.some(ua => userAgent.toLowerCase().includes(ua))) {
        logSecurityEvent('USER_AGENT_SUSPEITO', userAgent, ip);
    }

    // Monitorar endpoints sensíveis
    const sensitiveEndpoints = ['/api/admin/', '/api/backup', '/api/export'];
    if (sensitiveEndpoints.some(endpoint => req.path.includes(endpoint))) {
        logSecurityEvent('ACESSO_ENDPOINT_SENSIVEL', req.path, ip);
    }

    next();
};

// Obter logs de segurança
const getSecurityLogs = () => {
    return securityLogs.slice(-100); // Últimos 100 eventos
};

// Função para limpar rate limit (útil para desenvolvimento)
const clearRateLimit = (ip = null) => {
    if (ip) {
        delete rateLimit[ip];
        console.log(`Rate limit limpo para IP: ${ip}`);
    } else {
        Object.keys(rateLimit).forEach(key => delete rateLimit[key]);
        console.log('Rate limit limpo para todos os IPs');
    }
};

// Limpeza periódica do rate limit
setInterval(() => {
    const now = Date.now();
    for (const ip in rateLimit) {
        if (now > rateLimit[ip].resetTime) {
            delete rateLimit[ip];
        }
    }
}, RATE_LIMIT_WINDOW);

// Limpeza periódica do rate limit
setInterval(() => {
    const now = Date.now();

    // Limpar IPs suspeitos
    for (const [ip, data] of suspiciousIPs.entries()) {
        // Remover após 1 hora de inatividade
        if (now - data.lastActivity > 60 * 60 * 1000) {
            suspiciousIPs.delete(ip);
        }
    }

    // Limpar rate limit
    rateLimit.cleanup();

}, 10 * 60 * 1000); // Verificar a cada 10 minutos

module.exports = { 
    rateLimitMiddleware, 
    validateInput, 
    clearRateLimit, 
    detectSuspiciousActivity,
    getSecurityLogs,
    logSecurityEvent
};