const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { get, run, all } = require('./database');

const JWT_SECRET = process.env.JWT_SECRET || 'chave-secreta-aih-2024';
const BCRYPT_ROUNDS = 10; // Define the number of bcrypt rounds

// Criar hash de senha
const hashSenha = async (senha) => {
    // Validar força da senha
    if (senha.length < 6) {
        throw new Error('Senha deve ter pelo menos 6 caracteres');
    }
    return await bcrypt.hash(senha, BCRYPT_ROUNDS);
};

// Verificar senha
const verificarSenha = async (senha, hash) => {
    return await bcrypt.compare(senha, hash);
};

// Gerar token JWT
const gerarToken = (usuario) => {
    return jwt.sign(
        { id: usuario.id, nome: usuario.nome },
        JWT_SECRET,
        { expiresIn: '24h' }
    );
};

// Verificar token
const verificarToken = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Token não fornecido' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.usuario = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Token inválido' });
    }
};

// Login
const login = async (nome, senha) => {
    const usuario = await get('SELECT * FROM usuarios WHERE nome = ?', [nome]);

    if (!usuario) {
        throw new Error('Usuário não encontrado');
    }

    const senhaValida = await verificarSenha(senha, usuario.senha_hash);

    if (!senhaValida) {
        throw new Error('Senha incorreta');
    }

    return {
        token: gerarToken(usuario),
        usuario: { id: usuario.id, nome: usuario.nome }
    };
};

// Cadastrar usuário (apenas por admin)
const cadastrarUsuario = async (nome, matricula, senha) => {
    const usuarioExiste = await get('SELECT id FROM usuarios WHERE nome = ? OR matricula = ?', [nome, matricula]);

    if (usuarioExiste) {
        throw new Error('Usuário ou matrícula já existe');
    }

    const senhaHash = await hashSenha(senha);
    const result = await run(
        'INSERT INTO usuarios (nome, matricula, senha_hash) VALUES (?, ?, ?)',
        [nome, matricula, senhaHash]
    );

    return { id: result.id, nome, matricula };
};

// Login de administrador
const loginAdmin = async (usuario, senha) => {
    const admin = await get('SELECT * FROM administradores WHERE usuario = ?', [usuario]);

    if (!admin) {
        throw new Error('Administrador não encontrado');
    }

    const senhaValida = await verificarSenha(senha, admin.senha_hash);

    if (!senhaValida) {
        throw new Error('Senha incorreta');
    }

    return {
        token: gerarToken({ id: admin.id, nome: admin.usuario }),
        admin: { id: admin.id, usuario: admin.usuario }
    };
};

// Alterar senha do administrador
const alterarSenhaAdmin = async (novaSenha) => {
    const senhaHash = await hashSenha(novaSenha);
    await run(
        'UPDATE administradores SET senha_hash = ?, ultima_alteracao = CURRENT_TIMESTAMP WHERE usuario = ?',
        [senhaHash, 'admin']
    );
    return true;
};

// Listar todos os usuários
const listarUsuarios = async () => {
    return await all('SELECT id, nome, matricula, criado_em FROM usuarios ORDER BY nome');
};

// Excluir usuário
const excluirUsuario = async (id) => {
    const result = await run('DELETE FROM usuarios WHERE id = ?', [id]);
    if (result.changes === 0) {
        throw new Error('Usuário não encontrado');
    }
    return true;
};

module.exports = {
    verificarToken,
    login,
    cadastrarUsuario,
    loginAdmin,
    alterarSenhaAdmin,
    listarUsuarios,
    excluirUsuario
};