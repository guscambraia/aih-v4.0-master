
const fs = require('fs');
const path = require('path');

console.log('🔧 Preparando aplicação para distribuição...');

// Garantir que o banco de dados existe
const dbDir = path.join(__dirname, '..', 'db');
const dbFile = path.join(dbDir, 'aih.db');

if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
    console.log('✅ Pasta db criada');
}

if (!fs.existsSync(dbFile)) {
    // Executar inicialização do banco
    const { initDB } = require('../database.js');
    initDB();
    console.log('✅ Banco de dados inicializado');
}

// Verificar arquivos essenciais
const essentialFiles = [
    'main.js',
    'server.js',
    'database.js',
    'auth.js',
    'package.json',
    'public/index.html',
    'public/app.js',
    'public/style.css'
];

let allFilesExist = true;
essentialFiles.forEach(file => {
    if (!fs.existsSync(path.join(__dirname, '..', file))) {
        console.error(`❌ Arquivo essencial não encontrado: ${file}`);
        allFilesExist = false;
    }
});

if (allFilesExist) {
    console.log('✅ Todos os arquivos essenciais estão presentes');
    console.log('🚀 Aplicação pronta para distribuição!');
} else {
    console.error('❌ Aplicação não está pronta para distribuição');
    process.exit(1);
}
