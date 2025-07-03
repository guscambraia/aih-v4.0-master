
const fs = require('fs');
const path = require('path');

// Criar pasta assets se não existir
const assetsDir = path.join(__dirname, '..', 'assets');
if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
}

// Criar um ícone SVG simples (você pode substituir por ícones reais)
const iconSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="256" height="256" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
  <rect width="256" height="256" fill="#0369a1" rx="32"/>
  <text x="128" y="140" font-family="Arial, sans-serif" font-size="80" font-weight="bold" fill="white" text-anchor="middle">AIH</text>
  <rect x="40" y="180" width="176" height="8" fill="white" rx="4"/>
  <rect x="40" y="200" width="120" height="8" fill="#bae6fd" rx="4"/>
  <circle cx="200" cy="80" r="20" fill="#10b981"/>
  <text x="200" y="88" font-family="Arial, sans-serif" font-size="16" font-weight="bold" fill="white" text-anchor="middle">✓</text>
</svg>`;

fs.writeFileSync(path.join(assetsDir, 'icon.svg'), iconSvg);

console.log('✅ Ícone SVG criado em assets/icon.svg');
console.log('📝 Para produção, adicione ícones nos formatos:');
console.log('   - icon.ico (Windows)');
console.log('   - icon.icns (macOS)'); 
console.log('   - icon.png (Linux)');
