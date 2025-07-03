// Estado da aplicação
let state = {
    token: localStorage.getItem('token'),
    usuario: null,
    aihAtual: null,
    telaAnterior: null,
    glosasPendentes: []
};

// Verificar se há token válido ao carregar a página
document.addEventListener('DOMContentLoaded', async () => {
    if (state.token) {
        try {
            // Tentar validar o token fazendo uma requisição simples
            const userType = localStorage.getItem('userType');

            if (userType === 'admin') {
                // Para admin, ir direto para tela de gestão
                mostrarTela('telaGestaoUsuarios');
                carregarUsuarios();
            } else {
                // Para usuário normal, validar token e ir para dashboard
                await carregarDashboard();
                mostrarTela('telaPrincipal');
            }
        } catch (err) {
            console.log('Token inválido, redirecionando para login');
            state.token = null;
            localStorage.removeItem('token');
            localStorage.removeItem('userType');
            mostrarTela('telaLogin');
        }
    } else {
        mostrarTela('telaLogin');
    }
});

// API Helper
const api = async (endpoint, options = {}) => {
    const config = {
        method: 'GET',
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(state.token && { 'Authorization': `Bearer ${state.token}` }),
            ...options.headers
        }
    };

    try {
        const response = await fetch(`/api${endpoint}`, config);

        // Verificar se a resposta é JSON válida
        let data;
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            data = await response.json();
        } else {
            const text = await response.text();
            console.error('Resposta não é JSON:', text);
            throw new Error('Resposta inválida do servidor');
        }

        if (!response.ok) {
            throw new Error(data.error || `Erro HTTP ${response.status}`);
        }

        return data;
    } catch (err) {
        console.error('Erro API:', {
            endpoint: endpoint,
            method: config.method,
            error: err.message,
            stack: err.stack
        });
        throw err;
    }
};

// Navegação
const mostrarTela = (telaId) => {
    document.querySelectorAll('.tela').forEach(tela => {
        tela.classList.remove('ativa');
    });
    document.getElementById(telaId).classList.add('ativa');
};

const voltarTelaPrincipal = () => {
    mostrarTela('telaPrincipal');
    carregarDashboard();
    
    // Limpar campo da AIH se estiver na tela de informar AIH
    setTimeout(() => {
        const campoNumeroAIH = document.getElementById('numeroBuscarAIH');
        if (campoNumeroAIH) {
            campoNumeroAIH.value = '';
        }
    }, 100);
};

const voltarTelaAnterior = () => {
    try {
        console.log('Voltando para tela anterior:', state.telaAnterior);

        if (state.telaAnterior) {
            const telaDestino = state.telaAnterior;

            // Limpar tela anterior para evitar loops
            state.telaAnterior = null;

            mostrarTela(telaDestino);

            // Se voltando para tela de movimentação, recarregar dados para atualizar glosas
            if (telaDestino === 'telaMovimentacao') {
                console.log('Recarregando dados da movimentação...');
                // Usar setTimeout para garantir que a tela foi renderizada
                setTimeout(() => {
                    carregarDadosMovimentacao();
                    // Reconfigurar event listeners após carregar dados
                    setTimeout(() => {
                        configurarEventListenersMovimentacao();
                    }, 300);
                }, 150);
            }
            // Se voltando para tela de informações AIH, recarregar AIH atualizada
            else if (telaDestino === 'telaInfoAIH' && state.aihAtual) {
                console.log('Recarregando AIH atualizada com glosas...');
                api(`/aih/${state.aihAtual.numero_aih}`)
                    .then(aih => {
                        console.log('AIH recarregada com sucesso, glosas:', aih.glosas);
                        state.aihAtual = aih;
                        mostrarInfoAIH(aih);
                    })
                    .catch(err => {
                        console.error('Erro ao recarregar AIH:', err);
                        // Se der erro, pelo menos mostrar a tela anterior
                        mostrarTela(telaDestino);
                    });
            }
        } else {
            // Se não há tela anterior, voltar ao dashboard
            console.log('Nenhuma tela anterior definida, voltando ao dashboard');
            mostrarTela('telaPrincipal');
            carregarDashboard();
        }
    } catch (error) {
        console.error('Erro ao voltar para tela anterior:', error);
        // Fallback: sempre tentar voltar ao dashboard
        mostrarTela('telaPrincipal');
        carregarDashboard();
    }
};

// Modal
const mostrarModal = (titulo, mensagem) => {
    return new Promise((resolve) => {
        const modalTitulo = document.getElementById('modalTitulo');
        const modalMensagem = document.getElementById('modalMensagem');
        const modal = document.getElementById('modal');
        const btnSim = document.getElementById('modalBtnSim');
        const btnNao = document.getElementById('modalBtnNao');

        if (!modalTitulo || !modalMensagem || !modal || !btnSim || !btnNao) {
            console.error('Elementos do modal não encontrados. Usando confirm nativo.');
            resolve(confirm(`${titulo}\n\n${mensagem}`));
            return;
        }

        modalTitulo.textContent = titulo;
        modalMensagem.textContent = mensagem;
        modal.classList.add('ativo');

        const fecharModal = (resultado) => {
            modal.classList.remove('ativo');
            btnSim.removeEventListener('click', simHandler);
            btnNao.removeEventListener('click', naoHandler);
            resolve(resultado);
        };

        const simHandler = () => fecharModal(true);
        const naoHandler = () => fecharModal(false);

        btnSim.addEventListener('click', simHandler);
        btnNao.addEventListener('click', naoHandler);
    });
};

// Login
document.getElementById('formLogin').addEventListener('submit', async (e) => {
    e.preventDefault();

    const submitButton = e.target.querySelector('button[type="submit"]');
    const originalText = submitButton.textContent;

    try {
        submitButton.textContent = 'Entrando...';
        submitButton.disabled = true;

        const nome = document.getElementById('loginUsuario').value.trim();
        const senha = document.getElementById('loginSenha').value;

        if (!nome || !senha) {
            throw new Error('Por favor, preencha todos os campos');
        }

        const result = await api('/login', {
            method: 'POST',
            body: JSON.stringify({ nome, senha })
        });

        if (result && result.token && result.usuario) {
            state.token = result.token;
            state.usuario = result.usuario;
            state.admin = null; // Limpar admin
            localStorage.setItem('token', result.token);
            localStorage.setItem('userType', 'user');

            // Atualizar interface
            const nomeUsuarioElement = document.getElementById('nomeUsuario');
            if (nomeUsuarioElement) {
                nomeUsuarioElement.textContent = result.usuario.nome;
            }

            console.log('Login realizado com sucesso:', result.usuario.nome);

            // Redirecionar para tela principal
            mostrarTela('telaPrincipal');
            await carregarDashboard();
        } else {
            throw new Error('Resposta inválida do servidor');
        }
    } catch (err) {
        console.error('Erro no login:', err);
        alert('Erro no login: ' + err.message);
    } finally {
        submitButton.textContent = originalText;
        submitButton.disabled = false;
    }
});

// Link para gerenciar usuários
document.getElementById('linkGerenciarUsuarios').addEventListener('click', (e) => {
    e.preventDefault();
    mostrarTela('telaAdminUsuarios');
});

// Voltar para login
document.getElementById('linkVoltarLogin').addEventListener('click', (e) => {
    e.preventDefault();
    mostrarTela('telaLogin');
});

// Login de administrador
document.getElementById('formLoginAdmin').addEventListener('submit', async (e) => {
    e.preventDefault();

    const submitButton = e.target.querySelector('button[type="submit"]');
    const originalText = submitButton.textContent;

    try {
        submitButton.textContent = 'Entrando...';
        submitButton.disabled = true;

        const usuario = document.getElementById('adminUsuario').value.trim();
        const senha = document.getElementById('adminSenha').value;

        if (!usuario || !senha) {
            throw new Error('Por favor, preencha todos os campos');
        }

        const result = await api('/admin/login', {
            method: 'POST',
            body: JSON.stringify({ usuario, senha })
        });

        if (result && result.token && result.admin) {
            state.token = result.token;
            state.admin = result.admin;
            state.usuario = null; // Limpar usuário normal
            localStorage.setItem('token', result.token);
            localStorage.setItem('userType', 'admin');

            console.log('Login de admin realizado com sucesso');

            mostrarTela('telaGestaoUsuarios');
            await carregarUsuarios();
        } else {
            throw new Error('Resposta inválida do servidor');
        }
    } catch (err) {
        console.error('Erro no login de administrador:', err);
        alert('Erro no login de administrador: ' + err.message);
    } finally {
        submitButton.textContent = originalText;
        submitButton.disabled = false;
    }
});

// Voltar para login principal
window.voltarLogin = () => {
    state.token = null;
    state.admin = null;
    state.usuario = null;
    localStorage.removeItem('token');
    localStorage.removeItem('userType');
    mostrarTela('telaLogin');
};

// Carregar lista de usuários
const carregarUsuarios = async () => {
    try {
        const response = await api('/admin/usuarios');
        const container = document.getElementById('listaUsuarios');

        if (response && response.usuarios && Array.isArray(response.usuarios)) {
            container.innerHTML = response.usuarios.map(u => `
                <div class="glosa-item">
                    <div>
                        <strong>${u.nome}</strong> - Matrícula: ${u.matricula}
                        <br>
                        <span style="color: #64748b; font-size: 0.875rem;">
                            Cadastrado em: ${new Date(u.criado_em).toLocaleDateString('pt-BR')}
                        </span>
                    </div>
                    <button onclick="excluirUsuario(${u.id}, '${u.nome}')" class="btn-danger" style="padding: 0.5rem 1rem;">
                        Excluir
                    </button>
                </div>
            `).join('') || '<p>Nenhum usuário cadastrado</p>';
        } else {
            container.innerHTML = '<p>Erro ao carregar usuários</p>';
        }
    } catch (err) {
        console.error('Erro ao carregar usuários:', err);
        const container = document.getElementById('listaUsuarios');
        if (container) {
            container.innerHTML = '<p>Erro ao carregar usuários. Tente novamente.</p>';
        }
    }
};

// Excluir usuário
window.excluirUsuario = async (id, nome) => {
    // Verificar se é admin
    const userType = localStorage.getItem('userType');
    if (userType !== 'admin') {
        alert('Erro: Apenas administradores podem excluir usuários');
        return;
    }

    const confirmar = await mostrarModal(
        'Excluir Usuário',
        `Tem certeza que deseja excluir o usuário "${nome}"? Esta ação não pode ser desfeita.`
    );

    if (!confirmar) return;

    try {
        await api(`/admin/usuarios/${id}`, { method: 'DELETE' });
        alert('Usuário excluído com sucesso!');
        carregarUsuarios();
    } catch (err) {
        console.error('Erro ao excluir usuário:', err);
        alert('Erro ao excluir usuário: ' + err.message);
    }
};

// Adicionar novo usuário
document.getElementById('formNovoUsuario').addEventListener('submit', async (e) => {
    e.preventDefault();

    try {
        const dados = {
            nome: document.getElementById('novoUsuarioNome').value,
            matricula: document.getElementById('novoUsuarioMatricula').value,
            senha: document.getElementById('novoUsuarioSenha').value
        };

        await api('/admin/usuarios', {
            method: 'POST',
            body: JSON.stringify(dados)
        });

        alert('Usuário cadastrado com sucesso!');
        document.getElementById('formNovoUsuario').reset();
        carregarUsuarios();
    } catch (err) {
        alert('Erro ao cadastrar usuário: ' + err.message);
    }
});

// Alterar senha do administrador
document.getElementById('formAlterarSenhaAdmin').addEventListener('submit', async (e) => {
    e.preventDefault();

    const novaSenha = document.getElementById('novaSenhaAdmin').value;
    const confirmarSenha = document.getElementById('confirmarSenhaAdmin').value;

    if (novaSenha !== confirmarSenha) {
        alert('As senhas não coincidem!');
        return;
    }

    if (novaSenha.length < 4) {
        alert('A senha deve ter pelo menos 4 caracteres!');
        return;
    }

    const confirmar = await mostrarModal(
        'Alterar Senha',
        'Tem certeza que deseja alterar a senha do administrador?'
    );

    if (!confirmar) return;

    try {
        await api('/admin/alterar-senha', {
            method: 'POST',
            body: JSON.stringify({ novaSenha })
        });

        alert('Senha do administrador alterada com sucesso!');
        document.getElementById('formAlterarSenhaAdmin').reset();
    } catch (err) {
        alert('Erro ao alterar senha: ' + err.message);
    }
});

// Logout
document.getElementById('btnSair').addEventListener('click', () => {
    state.token = null;
    state.usuario = null;
    state.admin = null;
    localStorage.removeItem('token');
    localStorage.removeItem('userType');
    mostrarTela('telaLogin');
});

// Helpers
const getStatusDescricao = (status) => {
    const descricoes = {
        1: '✅ Finalizada - Aprovação Direta (SUS aprovado)',
        2: '🔄 Ativa - Aprovação Indireta (Aguardando hospital)',
        3: '⚠️ Ativa - Em Discussão (Divergências identificadas)',
        4: '✅ Finalizada - Após Discussão (Resolvida)'
    };
    return descricoes[status] || '❓ Status Desconhecido';
};

// Obter competência atual
const getCompetenciaAtual = () => {
    const hoje = new Date();
    const mes = String(hoje.getMonth() + 1).padStart(2, '0');
    const ano = hoje.getFullYear();
    return `${mes}/${ano}`;
};

// Animar números
const animarNumero = (elementId, valorFinal) => {
    const elemento = document.getElementById(elementId);
    const valorInicial = parseInt(elemento.textContent) || 0;
    const duracao = 1000; // 1 segundo
    const incremento = (valorFinal - valorInicial) / (duracao / 16);
    let valorAtual = valorInicial;

    const timer = setInterval(() => {
        valorAtual += incremento;
        if ((incremento > 0 && valorAtual >= valorFinal) || 
            (incremento < 0 && valorAtual <= valorFinal)) {
            valorAtual = valorFinal;
            clearInterval(timer);
        }
        elemento.textContent = Math.round(valorAtual);
    }, 16);
};

// Dashboard aprimorado com seletor de competência
const carregarDashboard = async (competenciaSelecionada = null) => {
    try {
        // Se não foi passada competência, usar a atual
        const competencia = competenciaSelecionada || getCompetenciaAtual();

        // Buscar dados do dashboard com a competência
        const dados = await api(`/dashboard?competencia=${competencia}`);

        // Criar/atualizar seletor de competência
        let seletorContainer = document.querySelector('.seletor-competencia-container');
        if (!seletorContainer) {
            // Criar container do seletor apenas se não existir
            const dashboardContainer = document.querySelector('.dashboard');
            seletorContainer = document.createElement('div');
            seletorContainer.className = 'seletor-competencia-container';
            dashboardContainer.parentNode.insertBefore(seletorContainer, dashboardContainer);
        }

        // Sempre atualizar o conteúdo do seletor
        seletorContainer.innerHTML = `
            <div class="seletor-competencia">
                <label for="selectCompetencia">Competência:</label>
                <select id="selectCompetencia" onchange="carregarDashboard(this.value)">
                    ${dados.competencias_disponiveis.map(comp => 
                        `<option value="${comp}" ${comp === competencia ? 'selected' : ''}>${comp}</option>`
                    ).join('')}
                </select>
                <span class="competencia-info">📅 Visualizando dados de ${competencia}</span>
            </div>
        `;

        // Atualizar cards do dashboard
        const dashboard = document.querySelector('.dashboard');
        dashboard.innerHTML = `
            <!-- Card 1: Em Processamento na Competência -->
            <div class="stat-card clickable-card" onclick="visualizarAIHsPorCategoria('em_processamento', '${competencia}')" 
                 style="cursor: pointer; transition: all 0.3s ease;"
                 onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 12px rgba(0,0,0,0.15)'"
                 onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 2px 4px rgba(0,0,0,0.1)'">
                <div class="stat-icon">📊</div>
                <h3>Em Processamento</h3>
                <p class="stat-number" id="emProcessamentoCompetencia">${dados.em_processamento_competencia}</p>
                <p class="stat-subtitle">AIHs em análise em ${competencia}</p>
                <p class="stat-detail">📋 Estas AIHs estão na Auditoria SUS em processamento</p>
                <p class="stat-extra">✨ Clique para ver a lista detalhada</p>
            </div>

            <!-- Card 2: Finalizadas na Competência -->
            <div class="stat-card success clickable-card" onclick="visualizarAIHsPorCategoria('finalizadas', '${competencia}')"
                 style="cursor: pointer; transition: all 0.3s ease;"
                 onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 12px rgba(0,0,0,0.15)'"
                 onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 2px 4px rgba(0,0,0,0.1)'">
                <div class="stat-icon">✅</div>
                <h3>Finalizadas</h3>
                <p class="stat-number" id="finalizadasCompetencia">${dados.finalizadas_competencia}</p>
                <p class="stat-subtitle">AIHs concluídas em ${competencia}</p>
                <p class="stat-detail">🤝 Estas AIHs já tiveram sua auditoria concluída com concordância de ambas auditorias</p>
                <p class="stat-extra">✨ Clique para ver a lista detalhada</p>
            </div>

            <!-- Card 3: Com Pendências na Competência -->
            <div class="stat-card warning clickable-card" onclick="visualizarAIHsPorCategoria('com_pendencias', '${competencia}')"
                 style="cursor: pointer; transition: all 0.3s ease;"
                 onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 12px rgba(0,0,0,0.15)'"
                 onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 2px 4px rgba(0,0,0,0.1)'">
                <div class="stat-icon">⚠️</div>
                <h3>Com Pendências</h3>
                <p class="stat-number" id="comPendenciasCompetencia">${dados.com_pendencias_competencia}</p>
                <p class="stat-subtitle">AIHs com glosas em ${competencia}</p>
                <p class="stat-detail">🔄 Estas AIHs estão com alguma pendência passível de recurso e discussão pelas partes envolvidas</p>
                <p class="stat-extra">✨ Clique para ver a lista detalhada</p>
            </div>

            <!-- Card 4: Total Geral em Processamento -->
            <div class="stat-card info clickable-card" onclick="visualizarAIHsPorCategoria('total_processamento', 'geral')"
                 style="cursor: pointer; transition: all 0.3s ease;"
                 onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 12px rgba(0,0,0,0.15)'"
                 onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 2px 4px rgba(0,0,0,0.1)'">
                <div class="stat-icon">🏥</div>
                <h3>Total em Processamento</h3>
                <p class="stat-number" id="totalProcessamentoGeral">${dados.total_em_processamento_geral}</p>
                <p class="stat-subtitle">Desde o início do sistema</p>
                <p class="stat-detail">📊 Total: ${dados.total_entradas_sus} entradas - ${dados.total_saidas_hospital} saídas</p>
                <p class="stat-extra">✨ Clique para ver a lista detalhada</p>
            </div>

            <!-- Card 5: Total Finalizadas (Histórico Geral) -->
            <div class="stat-card success clickable-card" onclick="visualizarAIHsPorCategoria('total_finalizadas', 'geral')" 
                 style="border-left: 4px solid #10b981; cursor: pointer; transition: all 0.3s ease;"
                 onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 12px rgba(0,0,0,0.15)'"
                 onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 2px 4px rgba(0,0,0,0.1)'">
                <div class="stat-icon">🎯</div>
                <h3>Total Finalizadas</h3>
                <p class="stat-number" id="totalFinalizadasGeral">${dados.total_finalizadas_geral}</p>
                <p class="stat-subtitle">Desde o início do sistema</p>
                <p class="stat-detail">✅ AIHs concluídas com auditoria finalizada</p>
                <p class="stat-extra">✨ Clique para ver a lista detalhada</p>
            </div>

            <!-- Card 6: Total Geral Cadastradas -->
            <div class="stat-card clickable-card" onclick="visualizarAIHsPorCategoria('total_cadastradas', 'geral')" 
                 style="border-left: 4px solid #6366f1; cursor: pointer; transition: all 0.3s ease;"
                 onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 12px rgba(0,0,0,0.15)'"
                 onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 2px 4px rgba(0,0,0,0.1)'">
                <div class="stat-icon">📈</div>
                <h3>Total Cadastradas</h3>
                <p class="stat-number" id="totalAIHsGeral">${dados.total_aihs_geral}</p>
                <p class="stat-subtitle">Desde o início do sistema</p>
                <p class="stat-detail">📋 Todas as AIHs registradas no sistema</p>
                <p class="stat-extra">✨ Clique para ver a lista detalhada</p>
            </div>
        `;

        // Adicionar seção de resumo financeiro
        const resumoFinanceiro = document.createElement('div');
        resumoFinanceiro.className = 'resumo-financeiro';
        resumoFinanceiro.innerHTML = `
            <h3>💰 Resumo Financeiro - ${competencia}</h3>
            <div class="resumo-cards">
                <div class="resumo-card">
                    <span class="resumo-label">Valor Inicial Total</span>
                    <span class="resumo-valor">R$ ${dados.valores_competencia.inicial.toFixed(2)}</span>
                </div>
                <div class="resumo-card">
                    <span class="resumo-label">Valor Atual Total</span>
                    <span class="resumo-valor">R$ ${dados.valores_competencia.atual.toFixed(2)}</span>
                </div>
                <div class="resumo-card">
                    <span class="resumo-label">Diferença Total (Glosas)</span>
                    <span class="resumo-valor" style="color: var(--danger)">R$ ${(dados.valores_competencia.inicial - dados.valores_competencia.atual).toFixed(2)}</span>
                </div>
                <div class="resumo-card">
                    <span class="resumo-label">Total de AIHs</span>
                    <span class="resumo-valor">${dados.total_aihs_competencia}</span>
                </div>
            </div>
        `;

        // Adicionar após o dashboard
        const dashboardContainer = document.querySelector('.dashboard');
        const resumoExistente = document.querySelector('.resumo-financeiro');
        if (resumoExistente) {
            resumoExistente.remove();
        }
        dashboardContainer.parentNode.insertBefore(resumoFinanceiro, dashboardContainer.nextSibling);

        // Animar números (opcional)
        animarNumeros();

    } catch (err) {
        console.error('Erro ao carregar dashboard:', {
            competencia: competenciaSelecionada,
            error: err.message,
            stack: err.stack
        });
        
        // Mostrar mensagem de erro no dashboard
        const dashboardElement = document.querySelector('.dashboard');
        if (dashboardElement) {
            dashboardElement.innerHTML = `
                <div class="erro-dashboard">
                    <p>⚠️ Erro ao carregar dados do dashboard</p>
                    <p style="font-size: 0.875rem; color: #64748b;">Erro: ${err.message}</p>
                    <button onclick="carregarDashboard()">Tentar novamente</button>
                </div>
            `;
        }
    }
};

// Carregar dados para movimentação
const carregarDadosMovimentacao = async () => {
    try {
        console.log('Carregando dados da movimentação...');

        // Carregar profissionais para os selects
        const profissionais = await api('/profissionais');

        if (profissionais && profissionais.profissionais) {
            const especialidades = {
                'Medicina': 'movProfMedicina',
                'Enfermagem': 'movProfEnfermagem', 
                'Fisioterapia': 'movProfFisioterapia',
                'Bucomaxilo': 'movProfBucomaxilo'
            };

            // Limpar e preencher selects de profissionais
            Object.entries(especialidades).forEach(([especialidade, selectId]) => {
                const select = document.getElementById(selectId);
                if (select) {
                    // Verificar se existe primeira opção, senão criar
                    const primeiraOpcao = select.querySelector('option');
                    const opcaoInicial = primeiraOpcao ? primeiraOpcao.outerHTML : `<option value="">Selecione - ${especialidade}</option>`;
                    select.innerHTML = opcaoInicial;

                    // Adicionar profissionais da especialidade
                    profissionais.profissionais
                        .filter(p => p.especialidade === especialidade)
                        .forEach(prof => {
                            const option = document.createElement('option');
                            option.value = prof.nome;
                            option.textContent = prof.nome;
                            select.appendChild(option);
                        });
                }
            });
        }

        // Buscar e pré-selecionar profissionais da última movimentação desta AIH
        if (state.aihAtual && state.aihAtual.id) {
            try {
                const ultimaMovimentacao = await api(`/aih/${state.aihAtual.id}/ultima-movimentacao`);

                if (ultimaMovimentacao && ultimaMovimentacao.movimentacao) {
                    const mov = ultimaMovimentacao.movimentacao;

                    // Pré-selecionar profissionais baseado na última movimentação
                    if (mov.prof_medicina) {
                        const selectMedicina = document.getElementById('movProfMedicina');
                        if (selectMedicina) {
                            selectMedicina.value = mov.prof_medicina;
                        }
                    }

                    if (mov.prof_enfermagem) {
                        const selectEnfermagem = document.getElementById('movProfEnfermagem');
                        if (selectEnfermagem) {
                            selectEnfermagem.value = mov.prof_enfermagem;
                        }
                    }

                    if (mov.prof_fisioterapia) {
                        const selectFisioterapia = document.getElementById('movProfFisioterapia');
                        if (selectFisioterapia) {
                            selectFisioterapia.value = mov.prof_fisioterapia;
                        }
                    }

                    if (mov.prof_bucomaxilo) {
                        const selectBucomaxilo = document.getElementById('movProfBucomaxilo');
                        if (selectBucomaxilo) {
                            selectBucomaxilo.value = mov.prof_bucomaxilo;
                        }
                    }

                    console.log('Profissionais pré-selecionados da última movimentação:', {
                        medicina: mov.prof_medicina,
                        enfermagem: mov.prof_enfermagem,
                        fisioterapia: mov.prof_fisioterapia,
                        bucomaxilo: mov.prof_bucomaxilo
                    });
                }
            } catch (err) {
                console.log('Não foi possível carregar profissionais anteriores:', err.message);
                // Não é um erro crítico, continua sem pré-seleção
            }
        }

        // Carregar glosas atuais se existirem
        if (state.aihAtual && state.aihAtual.id) {
            const glosas = await api(`/aih/${state.aihAtual.id}/glosas`);

            const listaGlosas = document.getElementById('listaGlosas');
            if (listaGlosas && glosas && glosas.glosas) {
                if (glosas.glosas.length > 0) {
                    // Ordenar glosas por data de criação (mais recente primeira)
                    const glosasOrdenadas = glosas.glosas.sort((a, b) => new Date(b.criado_em) - new Date(a.criado_em));

                    // Cabeçalho das colunas + conteúdo das glosas
                    listaGlosas.innerHTML = `
                        <div style="padding: 0.75rem 0; border-bottom: 2px solid #d1d5db; display: grid; grid-template-columns: 80px 100px 120px 1fr 40px; gap: 1rem; align-items: center; background: #f9fafb; margin: -1rem -1rem 1rem -1rem; padding-left: 1rem; padding-right: 1rem;">
                            <div style="font-size: 0.75rem; color: #374151; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">
                                Data
                            </div>
                            <div style="font-size: 0.75rem; color: #374151; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">
                                Linha do Item
                            </div>
                            <div style="font-size: 0.75rem; color: #374151; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">
                                Profissional
                            </div>
                            <div style="font-size: 0.75rem; color: #374151; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">
                                Tipo de Glosa/Pendência
                            </div>
                            <div style="font-size: 0.75rem; color: #374151; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; text-align: center;">
                                Quantidade
                            </div>
                        </div>
                        ${glosasOrdenadas.map((g, index) => `
                            <div style="padding: 0.75rem 0; ${index < glosasOrdenadas.length - 1 ? 'border-bottom: 1px solid #f3f4f6;' : ''} display: grid; grid-template-columns: 80px 100px 120px 1fr 40px; gap: 1rem; align-items: center;">
                                <div style="font-size: 0.875rem; color: #6b7280; font-weight: 500;">
                                    ${new Date(g.criado_em).toLocaleDateString('pt-BR')}
                                </div>
                                <div style="font-weight: 600; color: #92400e;">
                                    ${g.linha}
                                </div>
                                <div style="color: #374151; font-weight: 500;">
                                    ${g.profissional}
                                </div>
                                <div style="color: #7c2d12;">
                                    ${g.tipo}
                                </div>
                                <div style="text-align: center; font-weight: 600; color: #92400e;">
                                    ${g.quantidade || 1}
                                </div>
                            </div>
                        `).join('')}
                    `;
                } else {
                    listaGlosas.innerHTML = `
                        <div style="background: #f0fdf4; border: 2px solid #22c55e; border-radius: 8px; padding: 2rem; text-align: center;">
                            <div style="font-size: 3rem; margin-bottom: 0.5rem;">✅</div>
                            <p style="color: #166534; font-weight: 600; margin: 0; font-size: 1.125rem;">
                                Nenhuma glosa ativa para esta AIH
                            </p>
                            <p style="color: #22c55e; font-size: 0.875rem; margin: 0.5rem 0 0 0; font-style: italic;">
                                Esta AIH está livre de pendências
                            </p>
                        </div>
                    `;
                }
            }
        }

        // Mostrar status atual da AIH
        const statusAtualDiv = document.getElementById('statusAtualAIH');
        if (statusAtualDiv && state.aihAtual) {
            statusAtualDiv.innerHTML = `
                <div style="background: #f0f9ff; border: 1px solid #0284c7; border-radius: 8px; padding: 1rem; margin-bottom: 1rem;">
                    <h4 style="color: #0284c7; margin-bottom: 0.5rem;">📋 Status Atual da AIH</h4>
                    <p style="margin: 0;">
                        <strong>AIH:</strong> ${state.aihAtual.numero_aih} | 
                        <strong>Status:</strong> <span class="status-badge status-${state.aihAtual.status}">${getStatusDescricao(state.aihAtual.status)}</span> | 
                        <strong>Valor Atual:</strong> R$ ${state.aihAtual.valor_atual.toFixed(2)}
                    </p>
                </div>
            `;
        }

        // Mostrar lembrete sobre status
        const lembreteDiv = document.getElementById('lembreteStatus');
        if (lembreteDiv) {
            lembreteDiv.innerHTML = `
                <div style="background: #fffbeb; border: 1px solid #f59e0b; border-radius: 8px; padding: 1rem; margin-bottom: 1rem;">
                    <h5 style="color: #92400e; margin-bottom: 0.5rem;">💡 Lembrete sobre Status</h5>
                    <ul style="margin: 0; padding-left: 1.5rem; color: #92400e;">
                        <li><strong>Status 1:</strong> Finalizada com aprovação direta</li>
                        <li><strong>Status 2:</strong> Ativa com aprovação indireta</li>
                        <li><strong>Status 3:</strong> Ativa em discussão</li>
                        <li><strong>Status 4:</strong> Finalizada após discussão</li>
                    </ul>
                </div>
            `;
        }

        // Configurar event listeners dos botões após carregar todos os dados
        setTimeout(() => {
            configurarEventListenersMovimentacao();
        }, 300);

    } catch (err) {
        console.error('Erro ao carregar dados da movimentação:', err);
        alert('Erro ao carregar dados: ' + err.message);
    }
};

// Função auxiliar para animar os números
const animarNumeros = () => {
    const numeros = document.querySelectorAll('.stat-number');
    numeros.forEach(elemento => {
        const valorFinal = parseInt(elemento.textContent);
        let valorAtual = 0;
        const incremento = valorFinal / 30;

        const timer = setInterval(() => {
            valorAtual += incremento;
            if (valorAtual >= valorFinal) {
                valorAtual = valorFinal;
                clearInterval(timer);
            }
            elemento.textContent = Math.round(valorAtual);
        }, 30);
    });
};

// Mostrar informações da AIH
const mostrarInfoAIH = (aih) => {
    const content = document.getElementById('infoAIHContent');

    // Calcular diferença de valor
    const diferencaValor = aih.valor_inicial - aih.valor_atual;
    const percentualDiferenca = ((diferencaValor / aih.valor_inicial) * 100).toFixed(1);
    const valorGlosas = aih.valor_inicial - aih.valor_atual;

    content.innerHTML = `
        <div class="info-card">
            <h3>📋 AIH ${aih.numero_aih}</h3>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 1rem;">
                <p><strong>Status:</strong> <span class="status-badge status-${aih.status}">${getStatusDescricao(aih.status)}</span></p>
                <p><strong>Competência:</strong> ${aih.competencia}</p>
                <p><strong>Valor Inicial:</strong> R$ ${aih.valor_inicial.toFixed(2)}</p>
                <p><strong>Valor Atual:</strong> R$ ${aih.valor_atual.toFixed(2)}</p>
                <p><strong>Diferença:</strong> <span style="color: ${diferencaValor > 0 ? '#ef4444' : '#10b981'}">
                    R$ ${Math.abs(diferencaValor).toFixed(2)} (${percentualDiferenca}%)
                </span></p>
                <p><strong>Atendimentos:</strong> ${aih.atendimentos.length}</p>
            </div>
            <div style="margin-top: 1rem;">
                <strong>Números de Atendimento:</strong>
                <div style="display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.5rem;">
                    ${aih.atendimentos.map(at => `
                        <span style="background: #e0e7ff; color: #4f46e5; padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 0.875rem;">
                            ${at}
                        </span>
                    `).join('')}
                </div>
            </div>
        </div>

        ${aih.glosas.length > 0 ? `
            <div style="margin-top: 2rem; background: #fef3c7; padding: 1.5rem; border-radius: 12px; border-left: 4px solid #f59e0b;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; gap: 1rem;">
                    <h4 style="color: #92400e; margin: 0;">
                        ⚠️ Glosas Ativas (${aih.glosas.length})
                    </h4>
                    <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center;">
                        <button onclick="gerenciarGlosasFromInfo()" 
                                style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); 
                                       color: white; border: none; padding: 0.75rem 1.5rem; border-radius: 8px; 
                                       cursor: pointer; font-size: 0.875rem; display: flex; align-items: center; gap: 0.5rem;
                                       transition: all 0.2s ease; font-weight: 600; margin-right: 0.5rem;"
                                onmouseover="this.style.transform='translateY(-1px)'; this.style.boxShadow='0 4px 8px rgba(0,0,0,0.2)'"
                                onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='none'">
                            📋 Gerenciar Glosas
                        </button>
                        <button onclick="exportarGlosasAIH('csv')" 
                                style="background: linear-gradient(135deg, #059669 0%, #047857 100%); 
                                       color: white; border: none; padding: 0.5rem 1rem; border-radius: 6px; 
                                       cursor: pointer; font-size: 0.875rem; display: flex; align-items: center; gap: 0.25rem;
                                       transition: all 0.2s ease; min-width: 80px; justify-content: center;"
                                onmouseover="this.style.transform='translateY(-1px)'; this.style.boxShadow='0 4px 8px rgba(0,0,0,0.2)'"
                                onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='none'">
                            📄 CSV
                        </button>
                        <button onclick="exportarGlosasAIH('excel')" 
                                style="background: linear-gradient(135deg, #0d9488 0%, #0f766e 100%); 
                                       color: white; border: none; padding: 0.5rem 1rem; border-radius: 6px; 
                                       cursor: pointer; font-size: 0.875rem; display: flex; align-items: center; gap: 0.25rem;
                                       transition: all 0.2s ease; min-width: 100px; justify-content: center;"
                                onmouseover="this.style.transform='translateY(-1px)'; this.style.boxShadow='0 4px 8px rgba(0,0,0,0.2)'"
                                onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='none'">
                            📊 Excel
                        </button>
                    </div>
                </div>

                <!-- Cabeçalho das colunas -->
                <div style="padding: 0.75rem 0; border-bottom: 2px solid #f59e0b; display: grid; grid-template-columns: 100px 120px 1fr 80px 100px; gap: 1rem; align-items: center; background: #fbbf24; margin: -1.5rem -1.5rem 1rem -1.5rem; padding-left: 1.5rem; padding-right: 1.5rem;">
                    <div style="font-size: 0.75rem; color: #92400e; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">
                        Linha Item
                    </div>
                    <div style="font-size: 0.75rem; color: #92400e; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">
                        Profissional
                    </div>
                    <div style="font-size: 0.75rem; color: #92400e; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">
                        Tipo de Glosa/Pendência
                    </div>
                    <div style="font-size: 0.75rem; color: #92400e; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; text-align: center;">
                        Quantidade
                    </div>
                    <div style="font-size: 0.75rem; color: #92400e; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; text-align: center;">
                        Data
                    </div>
                </div>

                <!-- Dados das glosas -->
                <div style="display: grid; gap: 0.5rem;">
                    ${aih.glosas.map((g, index) => `
                        <div style="background: white; padding: 1rem; border-radius: 8px; display: grid; grid-template-columns: 100px 120px 1fr 80px 100px; gap: 1rem; align-items: center; border: 1px solid #fbbf24;">
                            <div style="font-weight: 600; color: #92400e; font-size: 0.875rem;">
                                ${g.linha}
                            </div>
                            <div style="color: #374151; font-weight: 500; font-size: 0.875rem;">
                                ${g.profissional}
                            </div>
                            <div style="color: #7c2d12; font-size: 0.875rem;">
                                ${g.tipo}
                            </div>
                            <div style="text-align: center; font-weight: 600; color: #92400e;">
                                ${g.quantidade || 1}
                            </div>
                            <div style="text-align: center; font-size: 0.75rem; color: #92400e;">
                                ${new Date(g.criado_em).toLocaleDateString('pt-BR')}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        ` : ''}

        <div style="margin-top: 2rem;">
            <h4 style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1rem; flex-wrap: wrap;">
                <span style="display: flex; align-items: center; gap: 0.5rem;">
                    📊 Histórico de Movimentações
                    <span style="background: #6366f1; color: white; padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 0.75rem;">
                        ${aih.movimentacoes.length}
                    </span>
                </span>
                <div style="display: flex; gap: 0.5rem; margin-left: auto; flex-wrap: wrap;">
                    <button onclick="exportarHistoricoMovimentacoes('csv')" 
                            style="background: linear-gradient(135deg, #059669 0%, #047857 100%); 
                                   color: white; border: none; padding: 0.5rem 1rem; border-radius: 6px; 
                                   cursor: pointer; font-size: 0.875rem; display: flex; align-items: center; gap: 0.25rem;
                                   transition: all 0.2s ease; min-width: 80px; justify-content: center;"
                            onmouseover="this.style.transform='translateY(-1px)'; this.style.boxShadow='0 4px 8px rgba(0,0,0,0.2)'"
                            onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='none'">
                        📄 CSV
                    </button>
                    <button onclick="exportarHistoricoMovimentacoes('xlsx')" 
                            style="background: linear-gradient(135deg, #0d9488 0%, #0f766e 100%); 
                                   color: white; border: none; padding: 0.5rem 1rem; border-radius: 6px; 
                                   cursor: pointer; font-size: 0.875rem; display: flex; align-items: center; gap: 0.25rem;
                                   transition: all 0.2s ease; min-width: 100px; justify-content: center;"
                            onmouseover="this.style.transform='translateY(-1px)'; this.style.boxShadow='0 4px 8px rgba(0,0,0,0.2)'"
                            onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='none'">
                        📊 Excel (XLS)
                    </button>
                </div>
            </h4>
            <table>
                <thead>
                    <tr>
                        <th>Data</th>
                        <th>Tipo</th>
                        <th>Status</th>
                        <th>Valor</th>
                        <th>Profissionais</th>
                    </tr>
                </thead>
                <tbody>
                    ${aih.movimentacoes.map(mov => {
                        const profissionais = [];
                        if (mov.prof_medicina) profissionais.push(`Med: ${mov.prof_medicina}`);
                        if (mov.prof_enfermagem) profissionais.push(`Enf: ${mov.prof_enfermagem}`);
                        if (mov.prof_fisioterapia) profissionais.push(`Fis: ${mov.prof_fisioterapia}`);
                        if (mov.prof_bucomaxilo) profissionais.push(`Buco: ${mov.prof_bucomaxilo}`);

                        return `
                            <tr>
                                <td>${new Date(mov.data_movimentacao).toLocaleDateString('pt-BR')}</td>
                                <td>
                                    <span style="display: flex; align-items: center; gap: 0.5rem;">
                                        ${mov.tipo === 'entrada_sus' ? '📥' : '📤'}
                                        ${mov.tipo === 'entrada_sus' ? 'Entrada SUS' : 'Saída Hospital'}
                                    </span>
                                </td>
                                <td><span class="status-badge status-${mov.status_aih}">${getStatusDescricao(mov.status_aih)}</span></td>
                                <td>R$ ${(mov.valor_conta || 0).toFixed(2)}</td>
                                <td style="font-size: 0.875rem;">${profissionais.join(' | ') || '-'}</td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
    `;

    mostrarTela('telaInfoAIH');
};

// Carregar profissionais para o campo de pesquisa
const carregarProfissionaisPesquisa = async () => {
    try {
        const response = await api('/profissionais');
        const selectProfissional = document.getElementById('pesquisaProfissional');

        if (response && response.profissionais && selectProfissional) {
            // Limpar opções existentes exceto a primeira
            selectProfissional.innerHTML = '<option value="">Todos os profissionais</option>';

            // Adicionar profissionais
            response.profissionais.forEach(prof => {
                const option = document.createElement('option');
                option.value = prof.nome;
                option.textContent = `${prof.nome} (${prof.especialidade})`;
                selectProfissional.appendChild(option);
            });

            console.log('Profissionais carregados na pesquisa:', response.profissionais.length);
        }
    } catch (err) {
        console.error('Erro ao carregar profissionais para pesquisa:', err);
    }
};

// Menu Principal
document.getElementById('btnInformarAIH').addEventListener('click', () => {
    mostrarTela('telaInformarAIH');
    // Limpar campo do número da AIH sempre que acessar a tela
    setTimeout(() => {
        const campoNumeroAIH = document.getElementById('numeroBuscarAIH');
        if (campoNumeroAIH) {
            campoNumeroAIH.value = '';
        }
    }, 100);
});

document.getElementById('btnBuscarAIH').addEventListener('click', () => {
    mostrarTela('telaPesquisa');
    // Carregar profissionais quando abrir a tela de pesquisa
    setTimeout(() => {
        carregarProfissionaisPesquisa();
    }, 100);
});

document.getElementById('btnBackup').addEventListener('click', async () => {
    const modal = document.getElementById('modal');
    
    if (!modal) {
        console.error('Modal não encontrado');
        // Se não existir modal, chamar backup diretamente
        await fazerBackup();
        return;
    }

    const modalContent = modal.querySelector('.modal-content');
    
    if (!modalContent) {
        console.error('Modal content não encontrado');
        // Se não existir modal content, chamar backup diretamente
        await fazerBackup();
        return;
    }
    
    modalContent.innerHTML = `
        <h3>💾 Backup da Base de Dados</h3>
        <p style="margin-bottom: 2rem; color: #64748b;">Faça o backup completo do banco de dados do sistema:</p>

        <div style="display: grid; gap: 1rem; margin-top: 1rem;">
            <button onclick="fazerBackup()" 
                    style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); 
                           color: white; border: none; border-radius: 8px; cursor: pointer;
                           padding: 1.5rem; font-size: 1.1rem; display: flex; align-items: center; gap: 1rem;
                           transition: all 0.2s ease; box-shadow: 0 2px 4px rgba(0,0,0,0.1);"
                    onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 8px rgba(0,0,0,0.2)'"
                    onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 2px 4px rgba(0,0,0,0.1)'">
                <span style="font-size: 2rem;">💾</span>
                <div style="text-align: left;">
                    <strong>Fazer Backup Completo</strong>
                    <br>
                    <span style="font-size: 0.875rem; opacity: 0.9;">Arquivo SQLite (.db) - Contém todos os dados do sistema</span>
                </div>
            </button>

            <button onclick="document.getElementById('modal').classList.remove('ativo')" 
                    style="background: linear-gradient(135deg, #64748b 0%, #475569 100%); 
                           color: white; border: none; border-radius: 8px; cursor: pointer;
                           padding: 1rem; font-size: 1rem; margin-top: 1rem;
                           transition: all 0.2s ease;">
                ❌ Cancelar
            </button>
        </div>

        <div style="margin-top: 2rem; padding: 1rem; background: #f8fafc; border-radius: 8px; border-left: 4px solid #0284c7;">
            <h4 style="color: #0284c7; margin: 0 0 0.5rem 0; font-size: 0.9rem;">ℹ️ Sobre o backup:</h4>
            <ul style="margin: 0; padding-left: 1.5rem; color: #64748b; font-size: 0.85rem;">
                <li><strong>Arquivo SQLite (.db):</strong> Backup completo de todo o sistema</li>
                <li><strong>Contém:</strong> Todas as AIHs, movimentações, glosas, usuários e configurações</li>
                <li><strong>Uso:</strong> Para restaurar o sistema ou migrar para outro servidor</li>
                <li><strong>Segurança:</strong> Mantenha o arquivo em local seguro</li>
            </ul>
        </div>
    `;

    modal.classList.add('ativo');
});

document.getElementById('btnConfiguracoes').addEventListener('click', () => {
    mostrarTela('telaConfiguracoes');
    carregarProfissionais();
    carregarTiposGlosaConfig();
});

// Buscar AIH
document.getElementById('formBuscarAIH').addEventListener('submit', async (e) => {
    e.preventDefault();

    const numero = document.getElementById('numeroBuscarAIH').value;

    try {
        const aih = await api(`/aih/${numero}`);
        state.aihAtual = aih;

        if (aih.status === 1 || aih.status === 4) {
            const continuar = await mostrarModal(
                'AIH Finalizada',
                'Esta AIH está finalizada. É uma reassinatura/reapresentação?'
            );

            if (!continuar) {
                document.getElementById('numeroBuscarAIH').value = '';
                return;
            }
        }

        // Definir tela anterior para poder voltar
        state.telaAnterior = 'telaInformarAIH';
        
        // Limpar campo antes de navegar
        document.getElementById('numeroBuscarAIH').value = '';
        
        mostrarInfoAIH(aih);
    } catch (err) {
        if (err.message.includes('não encontrada')) {
            // Nova AIH
            document.getElementById('cadastroNumeroAIH').value = numero;
            document.getElementById('cadastroNumeroAIH').removeAttribute('readonly');
            state.telaAnterior = 'telaInformarAIH';
            
            // Limpar campo antes de navegar
            document.getElementById('numeroBuscarAIH').value = '';
            
            mostrarTela('telaCadastroAIH');
            // Garantir que sempre tenha pelo menos um campo de atendimento
            setTimeout(garantirCampoAtendimento, 100);
        } else {
            alert('Erro: ' + err.message);
        }
    }
});

// Cadastrar AIH
document.getElementById('btnAddAtendimento').addEventListener('click', () => {
    const container = document.getElementById('atendimentosContainer');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'atendimento-input';
    input.placeholder = 'Número do atendimento';
    container.appendChild(input);
});

// Garantir que sempre tenha pelo menos um campo de atendimento
const garantirCampoAtendimento = () => {
    const container = document.getElementById('atendimentosContainer');
    if (container) {
        const inputs = container.querySelectorAll('.atendimento-input');
        if (inputs.length === 0) {
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'atendimento-input';
            input.placeholder = 'Número do atendimento';
            container.appendChild(input);
        }
    }
};

// Cadastrar AIH
document.getElementById('formCadastroAIH').addEventListener('submit', async (e) => {
    e.preventDefault();

    const numeroAIH = document.getElementById('cadastroNumeroAIH').value.trim();

    // Validação do número da AIH (deve ter 13 dígitos)
    if (numeroAIH.length !== 13) {
        const continuar = await mostrarModal(
            'Atenção - Número da AIH',
            `O número da AIH informado tem ${numeroAIH.length} dígitos, mas o padrão são 13 dígitos. Deseja continuar o cadastro mesmo assim?`
        );

        if (!continuar) {
            return;
        }
    }

    // Coleta CORRIGIDA dos atendimentos
    const atendimentosInputs = document.querySelectorAll('#atendimentosContainer .atendimento-input');
    const atendimentos = [];

    // Usar for...of para garantir que percorra todos os elementos
    for (const input of atendimentosInputs) {
        const valor = input.value ? input.value.trim() : '';
        if (valor && valor.length > 0) {
            atendimentos.push(valor);
            console.log('Atendimento adicionado:', valor);
        }
    }

    console.log('Total de inputs encontrados:', atendimentosInputs.length);
    console.log('Atendimentos coletados:', atendimentos);
    console.log('Quantidade de atendimentos:', atendimentos.length);

    if (atendimentos.length === 0) {
        alert('Informe pelo menos um número de atendimento');
        return;
    }

    try {
        const dados = {
            numero_aih: numeroAIH,
            valor_inicial: parseFloat(document.getElementById('cadastroValor').value),
            competencia: document.getElementById('cadastroCompetencia').value,
            atendimentos: atendimentos
        };

        console.log('Dados que serão enviados:', JSON.stringify(dados, null, 2));

        const result = await api('/aih', {
            method: 'POST',
            body: JSON.stringify(dados)
        });

        alert('AIH cadastrada com sucesso!');

        // Limpar formulário após sucesso
        document.getElementById('formCadastroAIH').reset();

        // Limpar especificamente o campo do número da AIH
        document.getElementById('cadastroNumeroAIH').value = '';
        document.getElementById('cadastroNumeroAIH').removeAttribute('readonly');

        // Limpar container de atendimentos e adicionar um campo limpo
        const container = document.getElementById('atendimentosContainer');
        container.innerHTML = '';
        const novoInput = document.createElement('input');
        novoInput.type = 'text';
        novoInput.className = 'atendimento-input';
        novoInput.placeholder = 'Número do atendimento';
        container.appendChild(novoInput);

        // Voltar para a tela de informar AIH
        mostrarTela('telaInformarAIH');

    } catch (err) {
        console.error('Erro ao cadastrar AIH:', err);
        alert('Erro ao cadastrar AIH: ' + err.message);
    }
});

// Configurar competência padrão no campo
document.addEventListener('DOMContentLoaded', () => {
    const hoje = new Date();
    const mes = String(hoje.getMonth() + 1).padStart(2, '0');
    const ano = hoje.getFullYear();
    const competenciaAtual = `${mes}/${ano}`;

    const campoCadastroCompetencia = document.getElementById('cadastroCompetencia');
    if (campoCadastroCompetencia && !campoCadastroCompetencia.value) {
        campoCadastroCompetencia.value = competenciaAtual;
    }
});

// Funções de backup e exportação melhoradas
window.fazerBackup = async () => {
    try {
        console.log('🔄 Iniciando backup do banco de dados...');
        
        // Verificar se há token válido
        if (!state.token) {
            console.error('❌ Token não encontrado no state:', state);
            alert('❌ Erro: Usuário não autenticado. Faça login novamente.');
            return;
        }

        console.log('✅ Token encontrado, continuando com backup...');

        // Criar modal temporário para loading se não existir
        let modalTemporario = false;
        let modal = document.getElementById('modal');
        
        if (!modal) {
            console.log('📦 Modal não encontrado, criando modal temporário...');
            modal = document.createElement('div');
            modal.id = 'modal-backup-temp';
            modal.className = 'modal ativo';
            modal.style.cssText = `
                position: fixed; top: 0; left: 0; right: 0; bottom: 0; 
                background: rgba(0,0,0,0.7); display: flex; align-items: center; 
                justify-content: center; z-index: 9999;
            `;
            modal.innerHTML = `
                <div style="background: white; padding: 2rem; border-radius: 12px; text-align: center; min-width: 300px;">
                    <h3 style="color: #0369a1; margin-bottom: 1rem;">💾 Fazendo Backup...</h3>
                    <p style="color: #64748b; margin-bottom: 1.5rem;">Aguarde enquanto o backup é criado...</p>
                    <div style="border: 3px solid #f3f3f3; border-top: 3px solid #3498db; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 0 auto;"></div>
                </div>
            `;
            document.body.appendChild(modal);
            modalTemporario = true;
        } else {
            console.log('✅ Modal encontrado, exibindo loading...');
            const modalContent = modal.querySelector('.modal-content');
            if (modalContent) {
                modalContent.innerHTML = `
                    <h3>💾 Fazendo Backup...</h3>
                    <p>Aguarde enquanto o backup do banco de dados é criado...</p>
                    <div style="text-align: center; margin: 2rem 0;">
                        <div style="border: 3px solid #f3f3f3; border-top: 3px solid #3498db; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 0 auto;"></div>
                    </div>
                    <p style="font-size: 0.875rem; color: #64748b; text-align: center;">Isso pode levar alguns segundos...</p>
                `;
            }
            modal.classList.add('ativo');
        }

        // Fazer requisição para backup
        console.log('📡 Fazendo requisição para /api/backup...');
        console.log('🔑 Token sendo usado:', state.token.substring(0, 20) + '...');
        
        const response = await fetch('/api/backup', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${state.token}`
            }
        });

        console.log(`📡 Resposta recebida: Status ${response.status}`);
        console.log(`📡 Headers da resposta:`, {
            contentType: response.headers.get('content-type'),
            contentDisposition: response.headers.get('content-disposition'),
            contentLength: response.headers.get('content-length')
        });

        if (!response.ok) {
            let errorText;
            try {
                errorText = await response.text();
            } catch (e) {
                errorText = `Erro ao ler resposta: ${e.message}`;
            }
            console.error('❌ Erro na resposta do servidor:', {
                status: response.status,
                statusText: response.statusText,
                errorText: errorText
            });
            throw new Error(`Erro HTTP ${response.status}: ${response.statusText} - ${errorText}`);
        }

        // Verificar content-type da resposta
        const contentType = response.headers.get('content-type');
        console.log('📄 Content-Type da resposta:', contentType);

        // Aceitar tanto application/octet-stream quanto outros tipos de arquivo
        if (contentType && contentType.includes('application/json')) {
            const errorData = await response.json();
            console.error('❌ Servidor retornou JSON ao invés de arquivo:', errorData);
            throw new Error(errorData.error || 'Servidor retornou erro ao invés de arquivo de backup');
        }

        // Criar blob e fazer download
        console.log('💾 Criando blob para download...');
        const blob = await response.blob();
        
        if (blob.size === 0) {
            throw new Error('Arquivo de backup está vazio');
        }
        
        console.log(`💾 Blob criado com tamanho: ${blob.size} bytes`);

        // Criar link de download
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        
        // Definir nome do arquivo
        const dataAtual = new Date().toISOString().split('T')[0];
        link.download = `backup-aih-${dataAtual}.db`;
        
        // Configurar link invisível
        link.style.display = 'none';
        link.style.visibility = 'hidden';

        // Adicionar ao DOM temporariamente
        document.body.appendChild(link);
        
        // Forçar clique
        console.log('🖱️ Iniciando download...');
        link.click();
        
        // Limpar recursos
        setTimeout(() => {
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);
            console.log('🧹 Recursos de download limpos');
        }, 100);

        console.log('✅ Download do backup iniciado com sucesso');

        // Fechar modal
        if (modalTemporario) {
            document.body.removeChild(modal);
        } else if (modal) {
            modal.classList.remove('ativo');
        }
        
        // Mostrar mensagem de sucesso
        alert('✅ Backup do banco de dados realizado com sucesso!\n\nO arquivo SQLite foi baixado e contém todos os dados do sistema.');

    } catch (err) {
        console.error('❌ Erro completo ao fazer backup:', {
            message: err.message,
            stack: err.stack,
            token: state.token ? `Presente (${state.token.length} chars)` : 'Ausente',
            url: window.location.href,
            userAgent: navigator.userAgent
        });
        
        // Fechar modal adequadamente
        if (modalTemporario && modal && modal.parentNode) {
            document.body.removeChild(modal);
        } else {
            const modalExistente = document.getElementById('modal');
            if (modalExistente) {
                modalExistente.classList.remove('ativo');
            }
        }
        
        // Mostrar erro detalhado
        alert(`❌ Erro ao fazer backup: ${err.message}\n\nDetalhes técnicos foram registrados no console.`);
    }
};



// Busca rápida por AIH
window.buscarPorAIH = async () => {
    const numeroAIH = document.getElementById('buscaRapidaAIH').value.trim();

    if (!numeroAIH) {
        alert('Por favor, digite o número da AIH');
        return;
    }

    // Mostrar indicador de carregamento
    const botao = document.querySelector('.busca-card button');
    const textoOriginal = botao.textContent;
    botao.textContent = 'Buscando...';
    botao.disabled = true;

    try {
        const aih = await api(`/aih/${numeroAIH}`);
        state.aihAtual = aih;

        // **NOVO**: Limpar campo automaticamente após busca bem-sucedida
        document.getElementById('buscaRapidaAIH').value = '';

        if (aih.status === 1 || aih.status === 4) {
            const continuar = await mostrarModal(
                'AIH Finalizada',
                'Esta AIH está finalizada. É uma reassinatura/reapresentação?'
            );

            if (!continuar) {
                return;
            }
        }

        state.telaAnterior = 'telaPesquisa';
        mostrarInfoAIH(aih);
    } catch (err) {
        if (err.message.includes('não encontrada')) {
            const cadastrar = confirm(`AIH ${numeroAIH} não encontrada. Deseja cadastrá-la?`);
            if (cadastrar) {
                // **NOVO**: Limpar campo antes de navegar para cadastro
                document.getElementById('buscaRapidaAIH').value = '';
                document.getElementById('cadastroNumeroAIH').value = numeroAIH;
                state.telaAnterior = 'telaPesquisa';
                mostrarTela('telaCadastroAIH');
                setTimeout(garantirCampoAtendimento, 100);
            } else {
                document.getElementById('buscaRapidaAIH').value = '';
            }
        } else{
            alert('Erro ao buscar AIH: ' + err.message);
            console.error('Erro detalhado:', err);
        }
    } finally {
        // Restaurar botão
        botao.textContent = textoOriginal;
        botao.disabled = false;
    }
};

// Busca por número de atendimento
window.buscarPorAtendimento = async () => {
    const numeroAtendimento = document.getElementById('buscaRapidaAtendimento').value.trim();

    if (!numeroAtendimento) {
        alert('Por favor, digite o número do atendimento');
        return;
    }

    // Mostrar indicador de carregamento
    const botoes = document.querySelectorAll('.busca-card button');
    const botaoAtendimento = botoes[1]; // Segundo botão
    const textoOriginal = botaoAtendimento.textContent;
    botaoAtendimento.textContent = 'Buscando...';
    botaoAtendimento.disabled = true;

    try {
        const response = await api('/pesquisar', {
            method: 'POST',
            body: JSON.stringify({
                filtros: {
                    numero_atendimento: numeroAtendimento
                }
            })
        });

        console.log('Resposta da busca por atendimento:', response);

        if (response.resultados && response.resultados.length > 0) {
            exibirResultadosPesquisa(response.resultados);
            // **REMOVIDO**: Campo será limpo automaticamente pela função exibirResultadosPesquisa
        } else {
            alert('Nenhuma AIH encontrada com este número de atendimento');
            // **NOVO**: Limpar campo mesmo quando não encontrar resultados
            document.getElementById('buscaRapidaAtendimento').value = '';
            // Limpar container de resultados
            const container = document.getElementById('resultadosPesquisa');
            if (container) {
                container.innerHTML = '<p style="text-align: center; color: #64748b; padding: 2rem;">Nenhum resultado encontrado</p>';
            }
        }
    } catch (err) {
        alert('Erro ao buscar por atendimento: ' + err.message);
        console.error('Erro detalhado:', err);
        // **NOVO**: Limpar campo em caso de erro
        document.getElementById('buscaRapidaAtendimento').value = '';
        // Limpar container de resultados em caso de erro
        const container = document.getElementById('resultadosPesquisa');
        if (container) {
            container.innerHTML = '<p style="text-align: center; color: #ef4444; padding: 2rem;">Erro na pesquisa. Tente novamente.</p>';
        }
    } finally {
        // Restaurar botão
        botaoAtendimento.textContent = textoOriginal;
        botaoAtendimento.disabled = false;
    }
};

// Sistema de paginação e ordenação para resultados
let sistemaResultados = {
    dados: [],
    dadosOrdenados: [],
    paginaAtual: 1,
    itensPorPagina: 10,
    colunaOrdenacao: null,
    direcaoOrdenacao: 'asc', // 'asc' ou 'desc'
    titulo: 'Resultados da Pesquisa',
    descricao: ''
};

// Função para exibir resultados da pesquisa com paginação e ordenação
const exibirResultadosPesquisa = (resultados, titulo = 'Resultados da Pesquisa', descricao = '') => {
    const container = document.getElementById('resultadosPesquisa');

    if (!container) {
        console.error('Container de resultados não encontrado');
        return;
    }

    // **NOVO**: Limpar automaticamente os campos de busca sempre que resultados são exibidos
    limparCamposBuscaRapida();

    if (!resultados || resultados.length === 0) {
        container.innerHTML = `
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 2rem; text-align: center; margin-top: 2rem;">
                <h3 style="color: #64748b; margin-bottom: 1rem;">📭 Nenhum resultado encontrado</h3>
                <p style="color: #64748b;">Tente ajustar os critérios de busca ou verifique se os dados estão corretos.</p>
            </div>
        `;
        return;
    }

    // Armazenar resultados globalmente para exportação e controle
    window.ultimosResultadosPesquisa = resultados;
    sistemaResultados.dados = resultados;
    sistemaResultados.dadosOrdenados = [...resultados];
    sistemaResultados.titulo = titulo;
    sistemaResultados.descricao = descricao;
    sistemaResultados.paginaAtual = 1;

    renderizarTabela();
};

// Função para renderizar a tabela com paginação
const renderizarTabela = () => {
    const container = document.getElementById('resultadosPesquisa');
    const totalItens = sistemaResultados.dadosOrdenados.length;
    const totalPaginas = Math.ceil(totalItens / sistemaResultados.itensPorPagina);
    const inicio = (sistemaResultados.paginaAtual - 1) * sistemaResultados.itensPorPagina;
    const fim = inicio + sistemaResultados.itensPorPagina;
    const itensPagina = sistemaResultados.dadosOrdenados.slice(inicio, fim);

    container.innerHTML = `
        <div style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 1.5rem; margin-top: 2rem;">
            <!-- Cabeçalho com título e controles -->
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 1rem;">
                <div>
                    <h3 style="color: #0369a1; margin: 0 0 0.5rem 0;">${sistemaResultados.titulo}</h3>
                    ${sistemaResultados.descricao ? `<p style="color: #0369a1; margin: 0; font-size: 0.9rem; font-style: italic;">${sistemaResultados.descricao}</p>` : ''}
                    <p style="color: #0284c7; margin: 0.5rem 0 0 0; font-weight: 600;">
                        Total: ${totalItens} AIH${totalItens !== 1 ? 's' : ''} | 
                        Página ${sistemaResultados.paginaAtual} de ${totalPaginas} | 
                        Exibindo ${itensPagina.length} itens
                    </p>
                </div>
                <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: flex-start;">
                    <button onclick="voltarTelaPrincipal()" style="padding: 0.5rem 1rem; background: #6366f1; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 0.875rem;">
                        ← Dashboard
                    </button>
                    <button onclick="exportarResultadosPesquisa('csv')" class="btn-success" style="padding: 0.5rem 1rem; font-size: 0.875rem;">
                        📄 CSV
                    </button>
                    <button onclick="exportarResultadosPesquisa('excel')" class="btn-success" style="padding: 0.5rem 1rem; font-size: 0.875rem;">
                        📊 Excel
                    </button>
                    <button onclick="limparResultados()" class="btn-secondary" style="padding: 0.5rem 1rem; font-size: 0.875rem;">
                        🗑️ Limpar
                    </button>
                </div>
            </div>

            <!-- Controles de paginação superiores -->
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; gap: 1rem;">
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                    <label style="font-weight: 500; color: #374151;">Itens por página:</label>
                    <select onchange="alterarItensPorPagina(this.value)" style="padding: 0.25rem 0.5rem; border: 1px solid #d1d5db; border-radius: 4px; background: white;">
                        <option value="5" ${sistemaResultados.itensPorPagina === 5 ? 'selected' : ''}>5</option>
                        <option value="10" ${sistemaResultados.itensPorPagina === 10 ? 'selected' : ''}>10</option>
                        <option value="25" ${sistemaResultados.itensPorPagina === 25 ? 'selected' : ''}>25</option>
                        <option value="50" ${sistemaResultados.itensPorPagina === 50 ? 'selected' : ''}>50</option>
                        <option value="100" ${sistemaResultados.itensPorPagina === 100 ? 'selected' : ''}>100</option>
                        <option value="${totalItens}">Todos (${totalItens})</option>
                    </select>
                </div>
                
                ${gerarControlesPaginacao()}
            </div>

            <!-- Tabela de resultados -->
            <div style="overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse; background: white; border-radius: 6px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                    <thead>
                        <tr style="background: #f1f5f9;">
                            <th onclick="ordenarPorColuna('numero_aih')" style="padding: 1rem; text-align: left; font-weight: 600; color: #334155; border-bottom: 1px solid #e2e8f0; cursor: pointer; user-select: none; transition: background-color 0.2s;" onmouseover="this.style.backgroundColor='#e2e8f0'" onmouseout="this.style.backgroundColor='#f1f5f9'">
                                AIH ${getIndicadorOrdenacao('numero_aih')}
                            </th>
                            <th onclick="ordenarPorColuna('status')" style="padding: 1rem; text-align: left; font-weight: 600; color: #334155; border-bottom: 1px solid #e2e8f0; cursor: pointer; user-select: none; transition: background-color 0.2s;" onmouseover="this.style.backgroundColor='#e2e8f0'" onmouseout="this.style.backgroundColor='#f1f5f9'">
                                Status ${getIndicadorOrdenacao('status')}
                            </th>
                            <th onclick="ordenarPorColuna('competencia')" style="padding: 1rem; text-align: left; font-weight: 600; color: #334155; border-bottom: 1px solid #e2e8f0; cursor: pointer; user-select: none; transition: background-color 0.2s;" onmouseover="this.style.backgroundColor='#e2e8f0'" onmouseout="this.style.backgroundColor='#f1f5f9'">
                                Competência ${getIndicadorOrdenacao('competencia')}
                            </th>
                            <th onclick="ordenarPorColuna('valor_inicial')" style="padding: 1rem; text-align: left; font-weight: 600; color: #334155; border-bottom: 1px solid #e2e8f0; cursor: pointer; user-select: none; transition: background-color 0.2s;" onmouseover="this.style.backgroundColor='#e2e8f0'" onmouseout="this.style.backgroundColor='#f1f5f9'">
                                Valor Inicial ${getIndicadorOrdenacao('valor_inicial')}
                            </th>
                            <th onclick="ordenarPorColuna('valor_atual')" style="padding: 1rem; text-align: left; font-weight: 600; color: #334155; border-bottom: 1px solid #e2e8f0; cursor: pointer; user-select: none; transition: background-color 0.2s;" onmouseover="this.style.backgroundColor='#e2e8f0'" onmouseout="this.style.backgroundColor='#f1f5f9'">
                                Valor Atual ${getIndicadorOrdenacao('valor_atual')}
                            </th>
                            <th onclick="ordenarPorColuna('total_glosas')" style="padding: 1rem; text-align: left; font-weight: 600; color: #334155; border-bottom: 1px solid #e2e8f0; cursor: pointer; user-select: none; transition: background-color 0.2s;" onmouseover="this.style.backgroundColor='#e2e8f0'" onmouseout="this.style.backgroundColor='#f1f5f9'">
                                Glosas ${getIndicadorOrdenacao('total_glosas')}
                            </th>
                            <th onclick="ordenarPorColuna('criado_em')" style="padding: 1rem; text-align: left; font-weight: 600; color: #334155; border-bottom: 1px solid #e2e8f0; cursor: pointer; user-select: none; transition: background-color 0.2s;" onmouseover="this.style.backgroundColor='#e2e8f0'" onmouseout="this.style.backgroundColor='#f1f5f9'">
                                Data ${getIndicadorOrdenacao('criado_em')}
                            </th>
                            <th style="padding: 1rem; text-align: left; font-weight: 600; color: #334155; border-bottom: 1px solid #e2e8f0;">
                                Ações
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        ${itensPagina.map((aih, index) => `
                            <tr style="border-bottom: 1px solid #f1f5f9; transition: background-color 0.2s;" onmouseover="this.style.backgroundColor='#f8fafc'" onmouseout="this.style.backgroundColor='white'">
                                <td style="padding: 1rem; font-weight: 500; color: #1e293b;">${aih.numero_aih || 'N/A'}</td>
                                <td style="padding: 1rem;"><span class="status-badge status-${aih.status}">${getStatusDescricao(aih.status)}</span></td>
                                <td style="padding: 1rem; color: #64748b;">${aih.competencia || 'N/A'}</td>
                                <td style="padding: 1rem; color: #059669; font-weight: 500;">R$ ${(aih.valor_inicial || 0).toFixed(2)}</td>
                                <td style="padding: 1rem; color: ${(aih.valor_atual < aih.valor_inicial) ? '#dc2626' : '#059669'}; font-weight: 500;">R$ ${(aih.valor_atual || 0).toFixed(2)}</td>
                                <td style="padding: 1rem; text-align: center;">
                                    <span style="background: ${(aih.total_glosas > 0) ? '#fef3c7' : '#f0fdf4'}; color: ${(aih.total_glosas > 0) ? '#92400e' : '#166534'}; padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 0.875rem; font-weight: 500;">
                                        ${aih.total_glosas || 0}
                                    </span>
                                </td>
                                <td style="padding: 1rem; color: #64748b; font-size: 0.875rem;">${new Date(aih.criado_em).toLocaleDateString('pt-BR')}</td>
                                <td style="padding: 1rem;">
                                    <button onclick="visualizarAIH('${aih.numero_aih}')" 
                                            style="background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); 
                                                   color: white; border: none; padding: 0.5rem 1rem; border-radius: 6px; 
                                                   cursor: pointer; font-weight: 500; transition: all 0.2s;">
                                        👁️ Ver Detalhes
                                    </button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>

            <!-- Controles de paginação inferiores -->
            ${totalPaginas > 1 ? `
                <div style="display: flex; justify-content: center; margin-top: 1rem;">
                    ${gerarControlesPaginacao()}
                </div>
            ` : ''}

            <!-- Informações adicionais -->
            <div style="margin-top: 1rem; padding: 1rem; background: #f8fafc; border-radius: 6px; font-size: 0.875rem; color: #64748b;">
                💡 <strong>Dicas:</strong> Clique nos cabeçalhos das colunas para ordenar • Use os controles de paginação para navegar • Ajuste quantos itens ver por página
            </div>
        </div>
    `;
};

// Função para gerar controles de paginação
const gerarControlesPaginacao = () => {
    const totalItens = sistemaResultados.dadosOrdenados.length;
    const totalPaginas = Math.ceil(totalItens / sistemaResultados.itensPorPagina);
    
    if (totalPaginas <= 1) return '';

    let controles = `
        <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
            <button onclick="irParaPagina(1)" ${sistemaResultados.paginaAtual === 1 ? 'disabled' : ''} 
                    style="padding: 0.5rem 0.75rem; border: 1px solid #d1d5db; background: ${sistemaResultados.paginaAtual === 1 ? '#f9fafb' : 'white'}; color: ${sistemaResultados.paginaAtual === 1 ? '#9ca3af' : '#374151'}; border-radius: 4px; cursor: ${sistemaResultados.paginaAtual === 1 ? 'not-allowed' : 'pointer'};">
                ⏮️ Primeira
            </button>
            
            <button onclick="irParaPagina(${sistemaResultados.paginaAtual - 1})" ${sistemaResultados.paginaAtual === 1 ? 'disabled' : ''} 
                    style="padding: 0.5rem 0.75rem; border: 1px solid #d1d5db; background: ${sistemaResultados.paginaAtual === 1 ? '#f9fafb' : 'white'}; color: ${sistemaResultados.paginaAtual === 1 ? '#9ca3af' : '#374151'}; border-radius: 4px; cursor: ${sistemaResultados.paginaAtual === 1 ? 'not-allowed' : 'pointer'};">
                ⏪ Anterior
            </button>
    `;

    // Páginas numeradas (mostrar no máximo 7 páginas)
    let inicioRange = Math.max(1, sistemaResultados.paginaAtual - 3);
    let fimRange = Math.min(totalPaginas, sistemaResultados.paginaAtual + 3);

    if (fimRange - inicioRange < 6) {
        if (inicioRange === 1) {
            fimRange = Math.min(totalPaginas, inicioRange + 6);
        } else {
            inicioRange = Math.max(1, fimRange - 6);
        }
    }

    for (let i = inicioRange; i <= fimRange; i++) {
        controles += `
            <button onclick="irParaPagina(${i})" 
                    style="padding: 0.5rem 0.75rem; border: 1px solid ${i === sistemaResultados.paginaAtual ? '#3b82f6' : '#d1d5db'}; 
                           background: ${i === sistemaResultados.paginaAtual ? '#3b82f6' : 'white'}; 
                           color: ${i === sistemaResultados.paginaAtual ? 'white' : '#374151'}; 
                           border-radius: 4px; cursor: pointer; font-weight: ${i === sistemaResultados.paginaAtual ? '600' : '400'};">
                ${i}
            </button>
        `;
    }

    controles += `
            <button onclick="irParaPagina(${sistemaResultados.paginaAtual + 1})" ${sistemaResultados.paginaAtual === totalPaginas ? 'disabled' : ''} 
                    style="padding: 0.5rem 0.75rem; border: 1px solid #d1d5db; background: ${sistemaResultados.paginaAtual === totalPaginas ? '#f9fafb' : 'white'}; color: ${sistemaResultados.paginaAtual === totalPaginas ? '#9ca3af' : '#374151'}; border-radius: 4px; cursor: ${sistemaResultados.paginaAtual === totalPaginas ? 'not-allowed' : 'pointer'};">
                Próxima ⏩
            </button>
            
            <button onclick="irParaPagina(${totalPaginas})" ${sistemaResultados.paginaAtual === totalPaginas ? 'disabled' : ''} 
                    style="padding: 0.5rem 0.75rem; border: 1px solid #d1d5db; background: ${sistemaResultados.paginaAtual === totalPaginas ? '#f9fafb' : 'white'}; color: ${sistemaResultados.paginaAtual === totalPaginas ? '#9ca3af' : '#374151'}; border-radius: 4px; cursor: ${sistemaResultados.paginaAtual === totalPaginas ? 'not-allowed' : 'pointer'};">
                Última ⏭️
            </button>
        </div>
    `;

    return controles;
};

// Função para obter indicador de ordenação
const getIndicadorOrdenacao = (coluna) => {
    if (sistemaResultados.colunaOrdenacao !== coluna) {
        return '↕️';
    }
    return sistemaResultados.direcaoOrdenacao === 'asc' ? '🔼' : '🔽';
};

// Funções de controle
window.alterarItensPorPagina = (novoValor) => {
    sistemaResultados.itensPorPagina = parseInt(novoValor);
    sistemaResultados.paginaAtual = 1;
    renderizarTabela();
};

window.irParaPagina = (pagina) => {
    const totalPaginas = Math.ceil(sistemaResultados.dadosOrdenados.length / sistemaResultados.itensPorPagina);
    if (pagina >= 1 && pagina <= totalPaginas) {
        sistemaResultados.paginaAtual = pagina;
        renderizarTabela();
    }
};

window.ordenarPorColuna = (coluna) => {
    // Se clicou na mesma coluna, inverte a direção
    if (sistemaResultados.colunaOrdenacao === coluna) {
        sistemaResultados.direcaoOrdenacao = sistemaResultados.direcaoOrdenacao === 'asc' ? 'desc' : 'asc';
    } else {
        sistemaResultados.colunaOrdenacao = coluna;
        sistemaResultados.direcaoOrdenacao = 'asc';
    }

    // Ordenar os dados
    sistemaResultados.dadosOrdenados.sort((a, b) => {
        let valorA = a[coluna];
        let valorB = b[coluna];

        // Tratamento especial para diferentes tipos de dados
        switch (coluna) {
            case 'valor_inicial':
            case 'valor_atual':
            case 'total_glosas':
                valorA = parseFloat(valorA) || 0;
                valorB = parseFloat(valorB) || 0;
                break;
            
            case 'criado_em':
                valorA = new Date(valorA).getTime();
                valorB = new Date(valorB).getTime();
                break;
            
            case 'numero_aih':
                // Ordenar como string mas considerando números
                valorA = valorA ? valorA.toString() : '';
                valorB = valorB ? valorB.toString() : '';
                break;
            
            case 'competencia':
                // Ordenar competência por data (MM/AAAA)
                if (valorA && valorB) {
                    const [mesA, anoA] = valorA.split('/');
                    const [mesB, anoB] = valorB.split('/');
                    valorA = parseInt(anoA) * 100 + parseInt(mesA);
                    valorB = parseInt(anoB) * 100 + parseInt(mesB);
                } else {
                    valorA = valorA || '';
                    valorB = valorB || '';
                }
                break;
            
            default:
                valorA = valorA ? valorA.toString().toLowerCase() : '';
                valorB = valorB ? valorB.toString().toLowerCase() : '';
        }

        let resultado;
        if (valorA < valorB) resultado = -1;
        else if (valorA > valorB) resultado = 1;
        else resultado = 0;

        return sistemaResultados.direcaoOrdenacao === 'desc' ? -resultado : resultado;
    });

    // Voltar para primeira página após ordenar
    sistemaResultados.paginaAtual = 1;
    renderizarTabela();
};

// Função para visualizar AIH dos resultados
window.visualizarAIH = async (numeroAIH) => {
    try {
        const aih = await api(`/aih/${numeroAIH}`);
        state.aihAtual = aih;
        state.telaAnterior = 'telaPesquisa';
        mostrarInfoAIH(aih);
    } catch (err) {
        alert('Erro ao carregar AIH: ' + err.message);
    }
};

// Função para visualizar AIHs por categoria do dashboard
window.visualizarAIHsPorCategoria = async (categoria, periodo) => {
    try {
        console.log(`Carregando AIHs da categoria: ${categoria}, período: ${periodo}`);
        
        // Mostrar indicador de carregamento
        const loadingModal = document.createElement('div');
        loadingModal.style.cssText = `
            position: fixed; top: 0; left: 0; right: 0; bottom: 0; 
            background: rgba(0,0,0,0.7); display: flex; align-items: center; 
            justify-content: center; z-index: 9999;
        `;
        loadingModal.innerHTML = `
            <div style="background: white; padding: 2rem; border-radius: 8px; text-align: center;">
                <div style="border: 3px solid #f3f3f3; border-top: 3px solid #3498db; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 0 auto 1rem;"></div>
                <p>Carregando AIHs...</p>
            </div>
        `;
        document.body.appendChild(loadingModal);

        // Construir filtros baseados na categoria
        let filtros = {};
        
        switch(categoria) {
            case 'em_processamento':
                // AIHs em processamento = entradas SUS - saídas hospital na competência
                filtros = { em_processamento_competencia: periodo };
                break;
            case 'finalizadas':
                filtros = { status: [1, 4] };
                if (periodo !== 'geral') {
                    filtros.competencia = periodo;
                }
                break;
            case 'com_pendencias':
                filtros = { status: [2, 3] };
                if (periodo !== 'geral') {
                    filtros.competencia = periodo;
                }
                break;
            case 'total_processamento':
                filtros = { em_processamento_geral: true };
                break;
            case 'total_finalizadas':
                filtros = { status: [1, 4] };
                break;
            case 'total_cadastradas':
                filtros = {}; // Todas as AIHs
                break;
        }

        // Fazer requisição para buscar AIHs
        const response = await api('/pesquisar', {
            method: 'POST',
            body: JSON.stringify({ filtros })
        });

        // Remover loading
        document.body.removeChild(loadingModal);

        // Definir título baseado na categoria
        let titulo = '';
        let descricao = '';
        
        switch(categoria) {
            case 'em_processamento':
                titulo = `📊 AIHs Em Processamento - ${periodo}`;
                descricao = 'AIHs que estão atualmente na Auditoria SUS em processamento';
                break;
            case 'finalizadas':
                titulo = `✅ AIHs Finalizadas${periodo !== 'geral' ? ` - ${periodo}` : ' (Histórico Geral)'}`;
                descricao = 'AIHs que já tiveram sua auditoria concluída com concordância de ambas auditorias';
                break;
            case 'com_pendencias':
                titulo = `⚠️ AIHs Com Pendências${periodo !== 'geral' ? ` - ${periodo}` : ' (Histórico Geral)'}`;
                descricao = 'AIHs que estão com alguma pendência passível de recurso e discussão pelas partes envolvidas';
                break;
            case 'total_processamento':
                titulo = '🏥 Total de AIHs Em Processamento (Geral)';
                descricao = 'Todas as AIHs que estão em processamento desde o início do sistema';
                break;
            case 'total_finalizadas':
                titulo = '🎯 Total de AIHs Finalizadas (Geral)';
                descricao = 'Todas as AIHs finalizadas desde o início do sistema';
                break;
            case 'total_cadastradas':
                titulo = '📈 Total de AIHs Cadastradas (Geral)';
                descricao = 'Todas as AIHs registradas no sistema desde o início';
                break;
        }

        // Ir para tela de pesquisa e exibir resultados
        mostrarTela('telaPesquisa');
        
        // **NOVO**: Carregar profissionais sempre que acessar a tela de pesquisa através do dashboard
        setTimeout(() => {
            carregarProfissionaisPesquisa();
        }, 100);
        
        // Aguardar um pouco para garantir que a tela foi carregada
        setTimeout(() => {
            if (!response.resultados || response.resultados.length === 0) {
                const container = document.getElementById('resultadosPesquisa');
                if (container) {
                    container.innerHTML = `
                        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 2rem; text-align: center; margin-top: 2rem;">
                            <h3 style="color: #64748b; margin-bottom: 1rem;">${titulo}</h3>
                            <p style="color: #64748b; margin-bottom: 1rem;">${descricao}</p>
                            <p style="color: #64748b;">📭 Nenhuma AIH encontrada nesta categoria.</p>
                            <button onclick="voltarTelaPrincipal()" style="margin-top: 1rem; padding: 0.5rem 1rem; background: #6366f1; color: white; border: none; border-radius: 6px; cursor: pointer;">
                                ← Voltar ao Dashboard
                            </button>
                        </div>
                    `;
                }
                return;
            }

            // Usar o novo sistema de paginação e ordenação
            exibirResultadosPesquisa(response.resultados, titulo, descricao);
        }, 200);

    } catch (err) {
        console.error('Erro ao carregar AIHs por categoria:', err);
        
        // Remover loading se existir
        const loadingModal = document.querySelector('[style*="position: fixed"]');
        if (loadingModal) {
            document.body.removeChild(loadingModal);
        }
        
        alert('Erro ao carregar AIHs: ' + err.message);
    }
};

// Navegação para relatórios
document.getElementById('btnRelatorios').addEventListener('click', () => {
    console.log('Navegando para tela de relatórios...');
    mostrarTela('telaRelatorios');
    
    // Aguardar um pouco para garantir que a tela foi carregada
    setTimeout(() => {
        carregarRelatorios();
    }, 100);
});

// Navegação para alterar BD
document.getElementById('btnAlterarBD').addEventListener('click', () => {
    console.log('Navegando para tela de alteração da BD...');
    mostrarTela('telaAlterarBD');
    
    // Aguardar um pouco para garantir que a tela foi carregada
    setTimeout(() => {
        configurarAlteracaoBD();
        // Carregar logs automaticamente após um pequeno delay
        setTimeout(() => {
            carregarLogsExclusao();
        }, 500);
    }, 100);
});

// Carregar opções de relatórios
const carregarRelatorios = () => {
    console.log('🔄 Carregando opções de relatórios...');
    const container = document.getElementById('opcoesRelatorios');
    
    if (!container) {
        console.error('❌ Container opcoesRelatorios não encontrado!');
        return;
    }

    // Preencher competência atual automaticamente
    const competenciaAtual = getCompetenciaAtual();

    container.innerHTML = `
        <!-- Filtros Unificados -->
        <div style="background: #f0f9ff; border: 1px solid #0284c7; border-radius: 12px; padding: 2rem; margin-bottom: 2rem;">
            <h3 style="color: #0369a1; margin: 0 0 1.5rem 0; display: flex; align-items: center; gap: 0.5rem;">
                <span>🔍</span> Filtros para Relatórios
            </h3>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; align-items: end;">
                <div>
                    <label style="display: block; font-weight: 600; color: #374151; margin-bottom: 0.5rem;">Competência (MM/AAAA):</label>
                    <input type="text" id="relatorioCompetencia" placeholder="07/2025" value="${competenciaAtual}"
                           style="width: 100%; padding: 0.75rem; border: 1px solid #d1d5db; border-radius: 6px; font-size: 0.875rem;">
                </div>
                <div>
                    <label style="display: block; font-weight: 600; color: #374151; margin-bottom: 0.5rem;">Data Início:</label>
                    <input type="date" id="relatorioDataInicio"
                           style="width: 100%; padding: 0.75rem; border: 1px solid #d1d5db; border-radius: 6px; font-size: 0.875rem;">
                </div>
                <div>
                    <label style="display: block; font-weight: 600; color: #374151; margin-bottom: 0.5rem;">Data Fim:</label>
                    <input type="date" id="relatorioDataFim"
                           style="width: 100%; padding: 0.75rem; border: 1px solid #d1d5db; border-radius: 6px; font-size: 0.875rem;">
                </div>
                <div>
                    <button onclick="limparFiltrosRelatorio()" 
                            style="background: #64748b; color: white; border: none; padding: 0.75rem 1.5rem; border-radius: 6px; cursor: pointer; font-weight: 600; width: 100%;">
                        🗑️ Limpar Filtros
                    </button>
                </div>
            </div>
            <div style="margin-top: 1rem; padding: 1rem; background: #fffbeb; border: 1px solid #f59e0b; border-radius: 6px; font-size: 0.875rem;">
                <strong style="color: #92400e;">💡 Dica:</strong> 
                <span style="color: #92400e;">Informe uma COMPETÊNCIA (MM/AAAA) OU um PERÍODO (data início + data fim) para gerar relatórios com filtros. Alguns relatórios funcionam sem filtros.</span>
            </div>
        </div>

        <!-- Relatórios Básicos -->
        <div style="margin-bottom: 3rem;">
            <h3 style="color: #374151; margin-bottom: 1.5rem; display: flex; align-items: center; gap: 0.5rem;">
                <span>📊</span> Relatórios Básicos
                <span style="background: #10b981; color: white; padding: 0.25rem 0.75rem; border-radius: 12px; font-size: 0.75rem; font-weight: 600;">Sem filtros obrigatórios</span>
            </h3>
            <div class="relatorios-grid">
                <div class="relatorio-card" onclick="gerarRelatorioPeriodo('acessos')">
                    <div class="relatorio-icon">👥</div>
                    <h4>Relatório de Acessos</h4>
                    <p>Usuários e frequência de acessos ao sistema</p>
                </div>

                <div class="relatorio-card" onclick="gerarRelatorioPeriodo('aprovacoes')">
                    <div class="relatorio-icon">✅</div>
                    <h4>Relatório de Aprovações</h4>
                    <p>Distribuição por status de aprovação das AIHs</p>
                </div>

                <div class="relatorio-card" onclick="gerarRelatorioPeriodo('glosas-profissional')">
                    <div class="relatorio-icon">⚠️</div>
                    <h4>Glosas por Profissional</h4>
                    <p>Glosas identificadas por cada auditor</p>
                </div>

                <div class="relatorio-card" onclick="gerarRelatorioPeriodo('tipos-glosa')">
                    <div class="relatorio-icon">📋</div>
                    <h4>Tipos de Glosa</h4>
                    <p>Ranking dos tipos de glosa mais frequentes</p>
                </div>

                <div class="relatorio-card" onclick="gerarRelatorioPeriodo('fluxo-movimentacoes')">
                    <div class="relatorio-icon">🔄</div>
                    <h4>Fluxo de Movimentações</h4>
                    <p>Entradas SUS vs Saídas Hospital</p>
                </div>
            </div>
        </div>

        <!-- Relatórios Avançados -->
        <div style="margin-bottom: 3rem;">
            <h3 style="color: #374151; margin-bottom: 1.5rem; display: flex; align-items: center; gap: 0.5rem;">
                <span>🔬</span> Relatórios Avançados
                <span style="background: #f59e0b; color: white; padding: 0.25rem 0.75rem; border-radius: 12px; font-size: 0.75rem; font-weight: 600;">Requer período</span>
            </h3>
            <div class="relatorios-grid">
                <div class="relatorio-card" onclick="gerarRelatorioPeriodo('produtividade-auditores')">
                    <div class="relatorio-icon">📈</div>
                    <h4>Produtividade dos Auditores</h4>
                    <p>Análise detalhada de performance dos profissionais</p>
                </div>

                <div class="relatorio-card" onclick="gerarRelatorioPeriodo('aihs-profissional-periodo')">
                    <div class="relatorio-icon">👨‍⚕️</div>
                    <h4>AIHs por Profissional (Período)</h4>
                    <p>Produtividade por auditor no período específico</p>
                </div>

                <div class="relatorio-card" onclick="gerarRelatorioPeriodo('glosas-profissional-periodo')">
                    <div class="relatorio-icon">⚠️</div>
                    <h4>Glosas por Profissional (Período)</h4>
                    <p>Glosas identificadas por auditor no período</p>
                </div>

                <div class="relatorio-card" onclick="gerarRelatorioPeriodo('cruzamento-profissional-glosas')">
                    <div class="relatorio-icon">🔀</div>
                    <h4>Cruzamento Profissional x Glosas</h4>
                    <p>Relação entre auditores e tipos de glosa</p>
                </div>

                <div class="relatorio-card" onclick="gerarRelatorioPeriodo('analise-valores-glosas')">
                    <div class="relatorio-icon">💸</div>
                    <h4>Análise de Valores de Glosas</h4>
                    <p>Resumo financeiro das glosas no período</p>
                </div>

                <div class="relatorio-card" onclick="gerarRelatorioPeriodo('valores-glosas-periodo')">
                    <div class="relatorio-icon">💰</div>
                    <h4>Valores de Glosas (Período)</h4>
                    <p>Análise financeira detalhada das glosas</p>
                </div>

                <div class="relatorio-card" onclick="gerarRelatorioPeriodo('analise-financeira')">
                    <div class="relatorio-icon">📊</div>
                    <h4>Análise Financeira</h4>
                    <p>Relatório financeiro abrangente do período</p>
                </div>

                <div class="relatorio-card" onclick="gerarRelatorioPeriodo('estatisticas-periodo')">
                    <div class="relatorio-icon">📈</div>
                    <h4>Estatísticas Gerais do Período</h4>
                    <p>Visão geral das estatísticas do período</p>
                </div>

                <div class="relatorio-card" onclick="gerarRelatorioPeriodo('eficiencia-processamento')">
                    <div class="relatorio-icon">⚡</div>
                    <h4>Eficiência de Processamento</h4>
                    <p>Análise de eficiência e tempo de processamento</p>
                </div>

                <div class="relatorio-card" onclick="gerarRelatorioPeriodo('detalhamento-status')">
                    <div class="relatorio-icon">📋</div>
                    <h4>Detalhamento por Status</h4>
                    <p>Análise detalhada por status das AIHs</p>
                </div>

                <div class="relatorio-card" onclick="gerarRelatorioPeriodo('tipos-glosa-periodo')">
                    <div class="relatorio-icon">📊</div>
                    <h4>Tipos de Glosa (Período)</h4>
                    <p>Ranking de tipos de glosa no período específico</p>
                </div>

                <div class="relatorio-card" onclick="gerarRelatorioPeriodo('ranking-glosas-frequentes')">
                    <div class="relatorio-icon">🏆</div>
                    <h4>Ranking de Glosas Frequentes</h4>
                    <p>Glosas mais frequentes e seu impacto</p>
                </div>

                <div class="relatorio-card" onclick="gerarRelatorioPeriodo('analise-temporal-cadastros')">
                    <div class="relatorio-icon">⏰</div>
                    <h4>Análise Temporal de Cadastros</h4>
                    <p>Evolução temporal dos cadastros de AIHs</p>
                </div>

                <div class="relatorio-card" onclick="gerarRelatorioPeriodo('analise-preditiva')">
                    <div class="relatorio-icon">🔮</div>
                    <h4>Análise Preditiva</h4>
                    <p>Tendências e previsões baseadas nos dados</p>
                </div>
            </div>
        </div>
    `;
};

// Gerar relatório
window.gerarRelatorio = async (tipo) => {
    try {
        // Mostrar indicador de carregamento
        const loadingModal = document.createElement('div');
        loadingModal.style.cssText = `
            position: fixed; top: 0; left: 0; right: 0; bottom: 0; 
            background: rgba(0,0,0,0.7); display: flex; align-items: center; 
            justify-content: center; z-index: 9999;
        `;
        loadingModal.innerHTML = `
            <div style="background: white; padding: 2rem; border-radius: 8px; text-align: center;">
                <div style="border: 3px solid #f3f3f3; border-top: 3px solid #3498db; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 0 auto 1rem;"></div>
                <p>Gerando relatório...</p>
            </div>
        `;
        document.body.appendChild(loadingModal);

        // Coletar filtros se existirem
        const filtros = coletarFiltrosRelatorio();

        const response = await api(`/relatorios/${tipo}`, {
            method: 'POST',
            body: JSON.stringify(filtros)
        });

        // Remover loading
        document.body.removeChild(loadingModal);

        // Exibir relatório em interface dedicada
        exibirRelatorioMelhorado(tipo, response.resultado, filtros);
    } catch (err) {
        // Remover loading se existir
        const loadingModal = document.querySelector('[style*="position: fixed"]');
        if (loadingModal) {
            document.body.removeChild(loadingModal);
        }
        alert('Erro ao gerar relatório: ' + err.message);
    }
};

// Exibir relatório melhorado
const exibirRelatorioMelhorado = (tipo, dados, filtros = {}) => {
    const container = document.getElementById('resultadoRelatorio');
    const titulo = getTituloRelatorio(tipo);
    
    // Formatar período dos filtros
    let periodoInfo = '';
    if (filtros.competencia) {
        periodoInfo = `Competência: ${filtros.competencia}`;
    } else if (filtros.data_inicio && filtros.data_fim) {
        periodoInfo = `Período: ${filtros.data_inicio} até ${filtros.data_fim}`;
    } else if (filtros.data_inicio) {
        periodoInfo = `A partir de: ${filtros.data_inicio}`;
    } else if (filtros.data_fim) {
        periodoInfo = `Até: ${filtros.data_fim}`;
    } else {
        periodoInfo = 'Todos os dados disponíveis';
    }

    let html = `
        <div class="relatorio-container" style="background: white; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); margin-top: 2rem;">
            <!-- Cabeçalho do Relatório -->
            <div class="relatorio-header" style="background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); color: white; padding: 2rem; border-radius: 12px 12px 0 0;">
                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
                    <div>
                        <h2 style="margin: 0 0 0.5rem 0; font-size: 1.5rem;">📊 ${titulo}</h2>
                        <p style="margin: 0; opacity: 0.9; font-size: 0.9rem;">${periodoInfo}</p>
                        <p style="margin: 0.5rem 0 0 0; opacity: 0.8; font-size: 0.8rem;">Gerado em: ${new Date().toLocaleString('pt-BR')}</p>
                    </div>
                    <div style="display: flex; gap: 1rem; flex-wrap: wrap;">
                        <button onclick="exportarRelatorio('${tipo}', ${JSON.stringify(filtros).replace(/"/g, '&quot;')})" 
                                class="btn-export-relatorio"
                                style="background: rgba(255,255,255,0.2); backdrop-filter: blur(10px); color: white; border: 2px solid rgba(255,255,255,0.3); padding: 0.75rem 1.5rem; border-radius: 8px; cursor: pointer; font-weight: 600; transition: all 0.3s ease;"
                                onmouseover="this.style.background='rgba(255,255,255,0.3)'"
                                onmouseout="this.style.background='rgba(255,255,255,0.2)'">
                            📊 Exportar Excel
                        </button>
                        <button onclick="voltarListaRelatorios()" 
                                style="background: rgba(255,255,255,0.2); backdrop-filter: blur(10px); color: white; border: 2px solid rgba(255,255,255,0.3); padding: 0.75rem 1.5rem; border-radius: 8px; cursor: pointer; font-weight: 600; transition: all 0.3s ease;"
                                onmouseover="this.style.background='rgba(255,255,255,0.3)'"
                                onmouseout="this.style.background='rgba(255,255,255,0.2)'">
                            ← Voltar aos Relatórios
                        </button>
                    </div>
                </div>
            </div>

            <!-- Conteúdo do Relatório -->
            <div class="relatorio-content" style="padding: 2rem;">
    `;

    // Processar diferentes tipos de dados
    if (Array.isArray(dados) && dados.length > 0) {
        // Relatório tabular
        html += gerarTabelaRelatorio(dados, tipo);
    } else if (dados && typeof dados === 'object' && !Array.isArray(dados)) {
        // Relatório com estrutura complexa
        html += gerarRelatorioComplexo(dados, tipo);
    } else if (Array.isArray(dados) && dados.length === 0) {
        html += `
            <div style="text-align: center; padding: 3rem; color: #64748b;">
                <div style="font-size: 3rem; margin-bottom: 1rem;">📭</div>
                <h3>Nenhum dado encontrado</h3>
                <p>Não há dados disponíveis para os filtros selecionados.</p>
            </div>
        `;
    } else {
        // Dados simples
        html += `
            <div style="background: #f8fafc; border-radius: 8px; padding: 2rem;">
                <pre style="margin: 0; white-space: pre-wrap; font-family: 'Courier New', monospace;">${JSON.stringify(dados, null, 2)}</pre>
            </div>
        `;
    }

    html += `
            </div>
        </div>
    `;

    container.innerHTML = html;
    
    // Scroll suave para o relatório
    container.scrollIntoView({ behavior: 'smooth' });
};

// Gerar tabela para relatórios
const gerarTabelaRelatorio = (dados, tipo) => {
    const cabecalhos = Object.keys(dados[0]);
    
    return `
        <div style="margin-bottom: 1.5rem;">
            <div style="display: flex; justify-content: between; align-items: center; margin-bottom: 1rem;">
                <h3 style="color: #374151; margin: 0;">📋 Resultados (${dados.length} registro${dados.length !== 1 ? 's' : ''})</h3>
            </div>
            
            <div style="overflow-x: auto; border-radius: 8px; border: 1px solid #e5e7eb;">
                <table style="width: 100%; border-collapse: collapse; background: white;">
                    <thead style="background: #f9fafb;">
                        <tr>
                            ${cabecalhos.map(header => `
                                <th style="padding: 1rem; text-align: left; font-weight: 600; color: #374151; border-bottom: 2px solid #e5e7eb; white-space: nowrap;">
                                    ${formatarCabecalho(header)}
                                </th>
                            `).join('')}
                        </tr>
                    </thead>
                    <tbody>
                        ${dados.map((item, index) => `
                            <tr style="border-bottom: 1px solid #f3f4f6; transition: background-color 0.2s;" onmouseover="this.style.backgroundColor='#f8fafc'" onmouseout="this.style.backgroundColor='white'">
                                ${cabecalhos.map(header => `
                                    <td style="padding: 1rem; color: #374151; border-bottom: 1px solid #f3f4f6;">
                                        ${formatarValorTabela(item[header], header)}
                                    </td>
                                `).join('')}
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;
};

// Gerar relatório complexo (com subseções)
const gerarRelatorioComplexo = (dados, tipo) => {
    let html = '';
    
    if (tipo === 'fluxo-movimentacoes' && dados.resumo && dados.fluxo_mensal) {
        // Relatório de fluxo de movimentações
        const resumo = dados.resumo;
        html += `
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1rem; margin-bottom: 2rem;">
                <div style="background: #e0f2fe; border: 1px solid #0284c7; border-radius: 8px; padding: 1.5rem; text-align: center;">
                    <h4 style="color: #0369a1; margin: 0 0 0.5rem 0;">📥 Entradas SUS</h4>
                    <p style="font-size: 2rem; font-weight: bold; color: #0369a1; margin: 0;">${resumo.total_entradas_sus || 0} AIHs</p>
                    <p style="font-size: 0.875rem; color: #0284c7; margin: 0.5rem 0 0 0;">AIHs que entraram na auditoria</p>
                </div>
                <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 1.5rem; text-align: center;">
                    <h4 style="color: #92400e; margin: 0 0 0.5rem 0;">📤 Saídas Hospital</h4>
                    <p style="font-size: 2rem; font-weight: bold; color: #92400e; margin: 0;">${resumo.total_saidas_hospital || 0} AIHs</p>
                    <p style="font-size: 0.875rem; color: #f59e0b; margin: 0.5rem 0 0 0;">AIHs enviadas para o hospital</p>
                </div>
                <div style="background: ${(resumo.diferenca_fluxo || 0) >= 0 ? '#f0fdf4' : '#fef2f2'}; border: 1px solid ${(resumo.diferenca_fluxo || 0) >= 0 ? '#22c55e' : '#ef4444'}; border-radius: 8px; padding: 1.5rem; text-align: center;">
                    <h4 style="color: ${(resumo.diferenca_fluxo || 0) >= 0 ? '#166534' : '#dc2626'}; margin: 0 0 0.5rem 0;">⚖️ Saldo</h4>
                    <p style="font-size: 2rem; font-weight: bold; color: ${(resumo.diferenca_fluxo || 0) >= 0 ? '#166534' : '#dc2626'}; margin: 0;">
                        ${(resumo.diferenca_fluxo || 0) >= 0 ? '+' : ''}${resumo.diferenca_fluxo || 0} AIHs
                    </p>
                    <p style="font-size: 0.875rem; color: ${(resumo.diferenca_fluxo || 0) >= 0 ? '#22c55e' : '#ef4444'}; margin: 0.5rem 0 0 0;">
                        ${(resumo.diferenca_fluxo || 0) >= 0 ? 'Entradas > Saídas' : 'Saídas > Entradas'}
                    </p>
                </div>
                <div style="background: #f0f9ff; border: 1px solid #3b82f6; border-radius: 8px; padding: 1.5rem; text-align: center;">
                    <h4 style="color: #1d4ed8; margin: 0 0 0.5rem 0;">🔄 Em Processamento</h4>
                    <p style="font-size: 2rem; font-weight: bold; color: #1d4ed8; margin: 0;">${resumo.aihs_em_processamento || 0} AIHs</p>
                    <p style="font-size: 0.875rem; color: #3b82f6; margin: 0.5rem 0 0 0;">Atualmente na auditoria SUS</p>
                </div>
            </div>
        `;
        
        if (dados.fluxo_mensal && dados.fluxo_mensal.length > 0) {
            html += `<h3 style="color: #374151; margin: 2rem 0 1rem 0;">📊 Fluxo Mensal Detalhado</h3>`;
            html += gerarTabelaRelatorio(dados.fluxo_mensal, 'fluxo_mensal');
        }
    } else if (tipo === 'analise-valores-glosas' && dados.resumo_financeiro) {
        // Relatório de análise de valores - apenas 3 cards principais
        html += `
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1.5rem; margin-bottom: 2rem;">
                <div style="background: #e0f2fe; border: 1px solid #0284c7; border-radius: 12px; padding: 2rem; text-align: center; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <div style="font-size: 2.5rem; margin-bottom: 0.75rem;">🏥</div>
                    <h4 style="color: #0369a1; margin: 0 0 0.75rem 0; font-size: 1.1rem;">AIHs com Glosas</h4>
                    <p style="font-size: 2.5rem; font-weight: bold; color: #0369a1; margin: 0; line-height: 1;">${dados.resumo_financeiro.aihs_com_glosas || 0}</p>
                    <p style="font-size: 0.875rem; color: #0284c7; margin: 0.5rem 0 0 0; font-style: italic;">Quantidade de AIHs que possuem pelo menos uma glosa ativa</p>
                </div>
                
                <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 12px; padding: 2rem; text-align: center; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <div style="font-size: 2.5rem; margin-bottom: 0.75rem;">⚠️</div>
                    <h4 style="color: #92400e; margin: 0 0 0.75rem 0; font-size: 1.1rem;">Total de Glosas</h4>
                    <p style="font-size: 2.5rem; font-weight: bold; color: #92400e; margin: 0; line-height: 1;">${dados.resumo_financeiro.total_glosas || 0}</p>
                    <p style="font-size: 0.875rem; color: #f59e0b; margin: 0.5rem 0 0 0; font-style: italic;">Número total de glosas registradas no período</p>
                </div>
                
                <div style="background: #fef2f2; border: 1px solid #ef4444; border-radius: 12px; padding: 2rem; text-align: center; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <div style="font-size: 2.5rem; margin-bottom: 0.75rem;">💸</div>
                    <h4 style="color: #dc2626; margin: 0 0 0.75rem 0; font-size: 1.1rem;">Valor Total das Glosas</h4>
                    <p style="font-size: 2rem; font-weight: bold; color: #dc2626; margin: 0; line-height: 1;">R$ ${(dados.resumo_financeiro.valor_total_glosas || 0).toFixed(2)}</p>
                    <p style="font-size: 0.875rem; color: #ef4444; margin: 0.5rem 0 0 0; font-style: italic;">Diferença entre valor inicial e atual (perda financeira)</p>
                </div>
            </div>
        `;
    } else if (tipo === 'analise-financeira' && dados.resumo_geral && dados.distribuicao_por_faixa) {
        // Análise financeira completa
        const resumo = dados.resumo_geral;
        html += `
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1rem; margin-bottom: 2rem;">
                <div style="background: #f0fdf4; border: 1px solid #22c55e; border-radius: 8px; padding: 1.5rem;">
                    <h4 style="color: #166534; margin: 0 0 1rem 0;">💰 Valores Iniciais</h4>
                    <p style="margin: 0.5rem 0;"><strong>Total:</strong> R$ ${(resumo.valor_inicial_geral || 0).toFixed(2)}</p>
                    <p style="margin: 0.5rem 0;"><strong>Média:</strong> R$ ${(resumo.valor_inicial_medio || 0).toFixed(2)}</p>
                    <p style="margin: 0.5rem 0;"><strong>Menor:</strong> R$ ${(resumo.menor_valor_inicial || 0).toFixed(2)}</p>
                    <p style="margin: 0.5rem 0;"><strong>Maior:</strong> R$ ${(resumo.maior_valor_inicial || 0).toFixed(2)}</p>
                </div>
                <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 1.5rem;">
                    <h4 style="color: #92400e; margin: 0 0 1rem 0;">📉 Valores Atuais</h4>
                    <p style="margin: 0.5rem 0;"><strong>Total:</strong> R$ ${(resumo.valor_atual_geral || 0).toFixed(2)}</p>
                    <p style="margin: 0.5rem 0;"><strong>Média:</strong> R$ ${(resumo.valor_atual_medio || 0).toFixed(2)}</p>
                    <p style="margin: 0.5rem 0;"><strong>Menor:</strong> R$ ${(resumo.menor_valor_atual || 0).toFixed(2)}</p>
                    <p style="margin: 0.5rem 0;"><strong>Maior:</strong> R$ ${(resumo.maior_valor_atual || 0).toFixed(2)}</p>
                </div>
                <div style="background: #fef2f2; border: 1px solid #ef4444; border-radius: 8px; padding: 1.5rem;">
                    <h4 style="color: #dc2626; margin: 0 0 1rem 0;">📊 Perdas (Glosas)</h4>
                    <p style="margin: 0.5rem 0;"><strong>Total:</strong> R$ ${(resumo.perdas_glosas || 0).toFixed(2)}</p>
                    <p style="margin: 0.5rem 0;"><strong>Média por AIH:</strong> R$ ${(resumo.perda_media_por_aih || 0).toFixed(2)}</p>
                    <p style="margin: 0.5rem 0;"><strong>Total de AIHs:</strong> ${resumo.total_aihs || 0}</p>
                </div>
            </div>
        `;
        
        if (dados.distribuicao_por_faixa && dados.distribuicao_por_faixa.length > 0) {
            html += `<h3 style="color: #374151; margin: 2rem 0 1rem 0;">📊 Distribuição por Faixa de Valor</h3>`;
            html += gerarTabelaRelatorio(dados.distribuicao_por_faixa, 'distribuicao_faixas');
        }
    } else {
        // Outros tipos de relatórios complexos
        Object.keys(dados).forEach(chave => {
            const valor = dados[chave];
            if (Array.isArray(valor) && valor.length > 0) {
                html += `<h3 style="color: #374151; margin: 2rem 0 1rem 0;">${formatarCabecalho(chave)}</h3>`;
                html += gerarTabelaRelatorio(valor, chave);
            } else if (typeof valor === 'object' && valor !== null) {
                html += `
                    <div style="background: #f8fafc; border-radius: 8px; padding: 1.5rem; margin: 1rem 0;">
                        <h4 style="color: #374151; margin: 0 0 1rem 0;">${formatarCabecalho(chave)}</h4>
                        <pre style="margin: 0; white-space: pre-wrap; font-family: 'Courier New', monospace; color: #4b5563;">${JSON.stringify(valor, null, 2)}</pre>
                    </div>
                `;
            } else {
                html += `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 1rem; margin: 0.25rem 0; background: #f8fafc; border-radius: 6px; border-left: 4px solid #6366f1;">
                        <span style="font-weight: 600; color: #374151;">${formatarCabecalho(chave)}:</span>
                        <span style="color: #6366f1; font-weight: 600;">${formatarValorTabela(valor, chave)}</span>
                    </div>
                `;
            }
        });
    }
    
    return html;
};

// Formatار cabeçalho da tabela
const formatarCabecalho = (header) => {
    return header
        .replace(/_/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
};

// Formatear valor da tabela
const formatarValorTabela = (valor, header) => {
    if (valor === null || valor === undefined) return '-';
    
    // Campos de quantidade unitária (não devem ter R$ nem texto adicional)
    if (header.includes('AIHs') || header.includes('Qtd') || header.includes('Quantidade') || 
        header.includes('Saldo Mensal') || header.includes('Movimentações') || header.includes('movimentacoes') ||
        header.includes('Total Movimentacoes') || header.includes('Total AIHs') || 
        header.includes('Auditadas') || header.includes('auditadas') ||
        header.includes('Ocorrencias') || header.includes('total_ocorrencias')) {
        // Excluir "Total Glosas" da lista de campos de quantidade para que seja tratado como valor monetário
        if (typeof valor === 'number') {
            return valor.toString();
        }
        return valor;
    }
    
    // Campos de valor monetário
    if (header.includes('valor') || header.includes('impacto') || header.includes('media') ||
        header.includes('Total Glosas') || header.includes('total_glosas')) {
        if (typeof valor === 'number') {
            return `R$ ${valor.toFixed(2)}`;
        }
    }
    
    // Campos de data
    if (header.includes('data') || header.includes('Data')) {
        if (typeof valor === 'string' && valor.includes('-')) {
            try {
                return new Date(valor).toLocaleDateString('pt-BR');
            } catch (e) {
                return valor;
            }
        }
    }
    
    // Campos de porcentagem
    if (header.includes('percentual') || header.includes('Percentual')) {
        if (typeof valor === 'number') {
            return `${valor.toFixed(1)}%`;
        }
    }
    
    return valor.toString();
};

// Voltar para lista de relatórios
window.voltarListaRelatorios = () => {
    const container = document.getElementById('resultadoRelatorio');
    container.innerHTML = '';
    container.scrollIntoView({ behavior: 'smooth' });
};

// Obter título do relatório
const getTituloRelatorio = (tipo) => {
    const titulos = {
        'acessos': 'Relatório de Acessos',
        'aprovacoes': 'Relatório de Aprovações',
        'glosas-profissional': 'Glosas por Profissional',
        'aihs-profissional': 'AIHs por Profissional',
        'tipos-glosa': 'Tipos de Glosa',
        'fluxo-movimentacoes': 'Fluxo de Movimentações - Entradas SUS vs Saídas Hospital',
        'estatisticas-periodo': 'Estatísticas Gerais por Período',
        'valores-glosas-periodo': 'Análise Financeira de Glosas',
        'tipos-glosa-periodo': 'Tipos de Glosa por Período',
        'aihs-profissional-periodo': 'Produtividade por Profissional'
    };
    return titulos[tipo] || 'Relatório';
};

// Coletar filtros de relatórios
const coletarFiltrosRelatorio = () => {
    const filtros = {};
    
    const dataInicio = document.getElementById('relatorioDataInicio')?.value;
    if (dataInicio) filtros.data_inicio = dataInicio;
    
    const dataFim = document.getElementById('relatorioDataFim')?.value;
    if (dataFim) filtros.data_fim = dataFim;
    
    const competencia = document.getElementById('relatorioCompetencia')?.value;
    if (competencia) filtros.competencia = competencia;
    
    return filtros;
};

// Exportar relatório
window.exportarRelatorio = async (tipo, filtros = {}) => {
    try {
        // Mostrar indicador de carregamento
        const botaoExport = event.target;
        const textoOriginal = botaoExport.textContent;
        botaoExport.textContent = '⏳ Exportando...';
        botaoExport.disabled = true;

        const response = await fetch(`/api/relatorios/${tipo}/export`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${state.token}`
            },
            body: JSON.stringify(filtros)
        });

        if (!response.ok) {
            throw new Error('Erro ao exportar relatório');
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `relatorio-${tipo}-${new Date().toISOString().split('T')[0]}.xls`;
        link.click();
        URL.revokeObjectURL(url);

        alert('Relatório exportado com sucesso!');
    } catch (err) {
        alert('Erro ao exportar relatório: ' + err.message);
    } finally {
        // Restaurar botão
        if (event.target) {
            event.target.textContent = textoOriginal;
            event.target.disabled = false;
        }
    }
};



// Gerar relatório com período
window.gerarRelatorioPeriodo = async (tipo) => {
    try {
        // Mostrar indicador de carregamento
        const loadingModal = document.createElement('div');
        loadingModal.style.cssText = `
            position: fixed; top: 0; left: 0; right: 0; bottom: 0; 
            background: rgba(0,0,0,0.7); display: flex; align-items: center; 
            justify-content: center; z-index: 9999;
        `;
        loadingModal.innerHTML = `
            <div style="background: white; padding: 2rem; border-radius: 8px; text-align: center;">
                <div style="border: 3px solid #f3f3f3; border-top: 3px solid #3498db; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 0 auto 1rem;"></div>
                <p>Gerando relatório ${getTituloRelatorio(tipo)}...</p>
            </div>
        `;
        document.body.appendChild(loadingModal);

        // Coletar filtros dos campos unificados
        const dataInicio = document.getElementById('relatorioDataInicio')?.value || '';
        const dataFim = document.getElementById('relatorioDataFim')?.value || '';
        const competencia = document.getElementById('relatorioCompetencia')?.value || '';

        // Validação: para alguns relatórios, é obrigatório ter período ou competência
        const relatoriosComFiltroObrigatorio = [
            'tipos-glosa-periodo', 'aihs-profissional-periodo', 'glosas-profissional-periodo',
            'valores-glosas-periodo', 'estatisticas-periodo', 'produtividade-auditores',
            'analise-valores-glosas', 'performance-competencias', 'ranking-glosas-frequentes',
            'analise-temporal-cadastros', 'comparativo-auditorias', 'detalhamento-status',
            'analise-financeira', 'eficiencia-processamento', 'cruzamento-profissional-glosas',
            'analise-preditiva'
        ];

        if (relatoriosComFiltroObrigatorio.includes(tipo) && !competencia && (!dataInicio || !dataFim)) {
            // Remover loading
            document.body.removeChild(loadingModal);
            
            alert(`⚠️ Este relatório requer filtros obrigatórios!\n\nInforme uma COMPETÊNCIA (MM/AAAA) OU um PERÍODO completo (data início + data fim) para gerar o relatório.\n\nExemplo:\n• Competência: 07/2025\n• Período: 01/01/2025 até 31/12/2025`);
            return;
        }

        const filtros = {
            data_inicio: dataInicio,
            data_fim: dataFim,
            competencia: competencia
        };

        console.log(`Gerando relatório ${tipo} com filtros:`, filtros);

        const response = await api(`/relatorios/${tipo}`, {
            method: 'POST',
            body: JSON.stringify(filtros)
        });

        // Remover loading
        document.body.removeChild(loadingModal);

        // Exibir relatório usando a função melhorada
        exibirRelatorioMelhorado(tipo, response.resultado, filtros);

    } catch (err) {
        // Remover loading se existir
        const loadingModal = document.querySelector('[style*="position: fixed"]');
        if (loadingModal) {
            document.body.removeChild(loadingModal);
        }
        
        console.error('Erro ao gerar relatório:', err);
        alert('Erro ao gerar relatório: ' + err.message);
    }
};

// Exibir relatório com período
const exibirRelatorioPeriodo = (tipo, dados, filtros) => {
    const container = document.getElementById('resultadoRelatorioPeriodo');
    let html = `
        <h4>📊 ${getTituloRelatorio(tipo)}</h4>
        <p><strong>Período:</strong> ${filtros.dataInicio || 'Início'} até ${filtros.dataFim || 'Fim'} 
           ${filtros.competencia ? `| Competência: ${filtros.competencia}` : ''}</p>
        <div style="margin-bottom: 1rem;">
            <button onclick="exportarRelatorioPeriodo('${tipo}', ${JSON.stringify(filtros).replace(/"/g, '&quot;')})" class="btn-success">
                📊 Exportar Excel
            </button>
        </div>
    `;

    if (Array.isArray(dados)) {
        html += `
            <table>
                <thead>
                    <tr>
                        ${Object.keys(dados[0] || {}).map(key => `<th>${key}</th>`).join('')}
                    </tr>
                </thead>
                <tbody>
                    ${dados.map(item => `
                        <tr>
                            ${Object.values(item).map(value => `<td>${value}</td>`).join('')}
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    } else {
        html += `<pre>${JSON.stringify(dados, null, 2)}</pre>`;
    }

    container.innerHTML = html;
};

// Exportar relatório com período
window.exportarRelatorioPeriodo = (tipo, filtros) => {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = `/api/relatorios/${tipo}/export`;
    form.style.display = 'none';

    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = 'data';
    input.value = JSON.stringify(filtros);

    form.appendChild(input);
    document.body.appendChild(form);
    form.submit();
    document.body.removeChild(form);
};

// Função para carregar glosas
const carregarGlosas = async () => {
    if (!state.aihAtual) return;

    try {
        const [glosas, tipos, profissionais] = await Promise.all([
            api(`/aih/${state.aihAtual.id}/glosas`),
            api('/tipos-glosa'),
            api('/profissionais')
        ]);

        // Atualizar glosas atuais
        const container = document.getElementById('glosasAtuais');
        if (container && glosas.glosas) {
            container.innerHTML = `
                <h4>📋 Glosas Atuais</h4>
                ${glosas.glosas.length > 0 ? glosas.glosas.map(g => `
                    <div class="glosa-item">
                        <div>
                            <strong>${g.linha}</strong> - ${g.tipo}
                            <br>
                            <span style="color: #64748b;">Por: ${g.profissional}</span>
                        </div>
                        <button onclick="removerGlosa(${g.id})" class="btn-danger">Remover</button>
                    </div>
                `).join('') : '<p>Nenhuma glosa ativa</p>'}
            `;
        }

        // Preencher select de tipos de glosa
        const tipoSelect = document.getElementById('glosaTipo');
        if (tipoSelect && tipos.tipos) {
            tipoSelect.innerHTML = '<option value="">Selecione o tipo de pendência/glosa</option>';
            tipos.tipos.forEach(tipo => {
                const option = document.createElement('option');
                option.value = tipo.descricao;
                option.textContent = tipo.descricao;
                tipoSelect.appendChild(option);
            });
        }

        // Preencher select de profissionais
        const profSelect = document.getElementById('glosaProfissional');
        if (profSelect && profissionais.profissionais) {
            profSelect.innerHTML = '<option value="">Selecione o profissional</option>';
            profissionais.profissionais.forEach(prof => {
                const option = document.createElement('option');
                option.value = prof.nome;
                option.textContent = `${prof.nome} (${prof.especialidade})`;
                profSelect.appendChild(option);
            });
        }

    } catch (err) {
        console.error('Erro ao carregar glosas:', err);
    }
};

// Event listener para formulário de pesquisa avançada
document.addEventListener('DOMContentLoaded', () => {
    const formPesquisa = document.getElementById('formPesquisa');
    if (formPesquisa) {
        formPesquisa.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            // Coletar filtros
            const filtros = {};
            
            const numeroAIH = document.getElementById('pesquisaNumeroAIH').value.trim();
            if (numeroAIH) filtros.numero_aih = numeroAIH;
            
            const numeroAtendimento = document.getElementById('pesquisaNumeroAtendimento').value.trim();
            if (numeroAtendimento) filtros.numero_atendimento = numeroAtendimento;
            
            const dataInicio = document.getElementById('pesquisaDataInicio').value;
            if (dataInicio) filtros.data_inicio = dataInicio;
            
            const dataFim = document.getElementById('pesquisaDataFim').value;
            if (dataFim) filtros.data_fim = dataFim;
            
            const competencia = document.getElementById('pesquisaCompetencia').value.trim();
            if (competencia) filtros.competencia = competencia;
            
            const valorMin = document.getElementById('pesquisaValorMin').value;
            if (valorMin) filtros.valor_min = parseFloat(valorMin);
            
            const valorMax = document.getElementById('pesquisaValorMax').value;
            if (valorMax) filtros.valor_max = parseFloat(valorMax);
            
            const profissional = document.getElementById('pesquisaProfissional').value;
            if (profissional) filtros.profissional = profissional;
            
            // Status selecionados
            const statusSelecionados = Array.from(document.querySelectorAll('input[name="status"]:checked'))
                .map(cb => parseInt(cb.value));
            if (statusSelecionados.length > 0) filtros.status = statusSelecionados;
            
            try {
                const response = await api('/pesquisar', {
                    method: 'POST',
                    body: JSON.stringify({ filtros })
                });
                
                if (response.resultados && response.resultados.length > 0) {
                    exibirResultadosPesquisa(response.resultados, 'Resultados da Pesquisa Avançada');
                } else {
                    const container = document.getElementById('resultadosPesquisa');
                    if (container) {
                        container.innerHTML = '<p style="text-align: center; color: #64748b; padding: 2rem;">Nenhum resultado encontrado com os filtros aplicados</p>';
                    }
                    // **NOVO**: Limpar campos de busca rápida mesmo quando não há resultados
                    limparCamposBuscaRapida();
                }
            } catch (err) {
                alert('Erro ao realizar pesquisa: ' + err.message);
                console.error('Erro na pesquisa avançada:', err);
            }
        });
    }
});

// Função para limpar filtros (corrigindo erro do console)
window.limparFiltros = () => {
    // Limpar campos da pesquisa avançada
    const campos = [
        'pesquisaNumeroAIH', 'pesquisaNumeroAtendimento', 'pesquisaDataInicio', 
        'pesquisaDataFim', 'pesquisaCompetencia', 'pesquisaValorMin', 
        'pesquisaValorMax', 'pesquisaProfissional'
    ];

    campos.forEach(campoId => {
        const campo = document.getElementById(campoId);
        if (campo) campo.value = '';
    });

    // Desmarcar todos os checkboxes de status
    document.querySelectorAll('input[name="status"]').forEach(cb => cb.checked = false);

    // Limpar resultados
    const container = document.getElementById('resultadosPesquisa');
    if (container) {
        container.innerHTML = '';
    }

    // **NOVO**: Limpar também campos de busca rápida
    limparCamposBuscaRapida();

    alert('Filtros limpos com sucesso!');
};

// Função para limpar filtros de relatórios
window.limparFiltrosRelatorio = () => {
    const campos = ['relatorioDataInicio', 'relatorioDataFim', 'relatorioCompetencia'];
    campos.forEach(campoId => {
        const campo = document.getElementById(campoId);
        if (campo) campo.value = '';
    });
    alert('Filtros de relatórios limpos!');
};

// Função para limpar campos de busca rápida
const limparCamposBuscaRapida = () => {
    const campoAIH = document.getElementById('buscaRapidaAIH');
    const campoAtendimento = document.getElementById('buscaRapidaAtendimento');
    
    if (campoAIH) {
        campoAIH.value = '';
    }
    if (campoAtendimento) {
        campoAtendimento.value = '';
    }
    
    console.log('Campos de busca rápida limpos automaticamente');
};

// Função para limpar resultados
window.limparResultados = () => {
    const container = document.getElementById('resultadosPesquisa');
    if (container) {
        container.innerHTML = '';
    }

    // Limpar resultados armazenados
    window.ultimosResultadosPesquisa = null;

    // Também limpar os campos de busca rápida
    limparCamposBuscaRapida();
};

// Variáveis globais para controle de exclusão
let dadosExclusao = {
    tipo: null, // 'movimentacao' ou 'aih'
    dados: null,
    justificativa: null
};

// Função para carregar logs de exclusão
window.carregarLogsExclusao = async () => {
    const container = document.getElementById('containerLogsExclusao');
    const botao = document.querySelector('button[onclick="carregarLogsExclusao()"]');
    
    // Mostrar indicador de carregamento
    const textoOriginal = botao.textContent;
    botao.textContent = '🔄 Carregando...';
    botao.disabled = true;
    
    container.innerHTML = `
        <div style="text-align: center; padding: 2rem;">
            <div style="border: 3px solid #f3f3f3; border-top: 3px solid #6366f1; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 0 auto 1rem;"></div>
            <p style="color: #64748b; margin: 0;">Carregando logs de exclusão...</p>
        </div>
    `;

    try {
        const response = await api('/relatorios/logs-exclusao', {
            method: 'POST',
            body: JSON.stringify({})
        });

        const logs = response.resultado || [];

        if (logs.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 2rem; color: #64748b;">
                    <div style="font-size: 3rem; margin-bottom: 1rem;">📭</div>
                    <h4 style="margin: 0 0 0.5rem 0;">Nenhum log de exclusão encontrado</h4>
                    <p style="margin: 0;">Não há registros de exclusões no sistema.</p>
                </div>
            `;
        } else {
            // Ordenar logs por data (mais recente primeira)
            logs.sort((a, b) => new Date(b.data_exclusao) - new Date(a.data_exclusao));

            container.innerHTML = `
                <!-- Cabeçalho da tabela -->
                <div style="background: #e0e7ff; padding: 1rem; border-radius: 8px 8px 0 0; display: grid; grid-template-columns: 100px 120px 120px 150px 1fr 100px; gap: 1rem; align-items: center; font-weight: 600; color: #3730a3; font-size: 0.875rem;">
                    <div>ID</div>
                    <div>Tipo</div>
                    <div>Usuário</div>
                    <div>Data/Hora</div>
                    <div>Justificativa</div>
                    <div>AIH</div>
                </div>

                <!-- Linhas dos logs -->
                <div style="max-height: 500px; overflow-y: auto; border: 1px solid #c7d2fe; border-top: none;">
                    ${logs.map((log, index) => {
                        const dataFormatada = new Date(log.data_exclusao).toLocaleString('pt-BR');
                        const tipoIcon = log.tipo_exclusao === 'movimentacao' ? '📝' : '🗂️';
                        const tipoTexto = log.tipo_exclusao === 'movimentacao' ? 'Movimentação' : 'AIH Completa';
                        const corFundo = index % 2 === 0 ? '#ffffff' : '#f8fafc';
                        
                        return `
                            <div style="background: ${corFundo}; padding: 1rem; display: grid; grid-template-columns: 100px 120px 120px 150px 1fr 100px; gap: 1rem; align-items: center; border-bottom: 1px solid #e2e8f0; font-size: 0.875rem;">
                                <div style="font-weight: 600; color: #374151;">#${log.id}</div>
                                <div style="display: flex; align-items: center; gap: 0.5rem; color: ${log.tipo_exclusao === 'aih_completa' ? '#dc2626' : '#f59e0b'}; font-weight: 500;">
                                    ${tipoIcon} ${tipoTexto}
                                </div>
                                <div style="color: #6366f1; font-weight: 500;">${log.usuario_nome || 'Sistema'}</div>
                                <div style="color: #64748b; font-size: 0.8rem;">${dataFormatada}</div>
                                <div style="color: #374151; line-height: 1.4; max-width: 300px; word-wrap: break-word;">${log.justificativa}</div>
                                <div style="color: #059669; font-weight: 500; font-family: monospace;">${log.numero_aih_afetado || 'N/A'}</div>
                            </div>
                        `;
                    }).join('')}
                </div>

                <!-- Rodapé com informações adicionais -->
                <div style="background: #f8fafc; padding: 1rem; border-radius: 0 0 8px 8px; border: 1px solid #c7d2fe; border-top: none; font-size: 0.8rem; color: #64748b;">
                    💡 <strong>Informações:</strong> 
                    Os logs são mantidos permanentemente para auditoria. 
                    Movimentações: exclusão de uma movimentação específica | 
                    AIH Completa: exclusão de toda a AIH e dados relacionados.
                </div>
            `;
        }

    } catch (err) {
        console.error('Erro ao carregar logs de exclusão:', err);
        container.innerHTML = `
            <div style="text-align: center; padding: 2rem; color: #dc2626;">
                <div style="font-size: 3rem; margin-bottom: 1rem;">❌</div>
                <h4 style="margin: 0 0 0.5rem 0;">Erro ao carregar logs</h4>
                <p style="margin: 0 0 1rem 0;">${err.message}</p>
                <button onclick="carregarLogsExclusao()" 
                        style="background: #6366f1; color: white; border: none; padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer;">
                    🔄 Tentar Novamente
                </button>
            </div>
        `;
    } finally {
        // Restaurar botão
        botao.textContent = textoOriginal;
        botao.disabled = false;
    }
};

// Configurar funcionalidades de alteração da BD
const configurarAlteracaoBD = () => {
    // Limpar todos os campos ao acessar a tela
    const camposParaLimpar = [
        'aihMovimentacao', 'justificativaMovimentacao',
        'aihCompleta', 'justificativaAIH'
    ];
    
    camposParaLimpar.forEach(campoId => {
        const campo = document.getElementById(campoId);
        if (campo) {
            campo.value = '';
        }
    });

    // Limpar containers de informações
    const containerMovimentacoes = document.getElementById('listaMovimentacoes');
    if (containerMovimentacoes) {
        containerMovimentacoes.innerHTML = '<p style="color: #64748b; text-align: center; margin: 0;">Informe o número da AIH para carregar as movimentações</p>';
    }

    const containerInfoAIH = document.getElementById('infoAIHDeletar');
    if (containerInfoAIH) {
        containerInfoAIH.innerHTML = '<p style="color: #64748b; text-align: center; margin: 0;">Informe o número da AIH para carregar as informações</p>';
    }

    // Limpar dados globais de exclusão
    dadosExclusao = { tipo: null, dados: null, justificativa: null };

    // Event listener para buscar movimentações
    document.getElementById('aihMovimentacao').addEventListener('input', async (e) => {
        const numeroAIH = e.target.value.trim();
        if (numeroAIH.length >= 3) {
            await carregarMovimentacoesAIH(numeroAIH);
        } else {
            document.getElementById('listaMovimentacoes').innerHTML = '<p style="color: #64748b; text-align: center; margin: 0;">Informe o número da AIH para carregar as movimentações</p>';
        }
    });

    // Event listener para buscar informações da AIH
    document.getElementById('aihCompleta').addEventListener('input', async (e) => {
        const numeroAIH = e.target.value.trim();
        if (numeroAIH.length >= 3) {
            await carregarInformacoesAIH(numeroAIH);
        } else {
            document.getElementById('infoAIHDeletar').innerHTML = '<p style="color: #64748b; text-align: center; margin: 0;">Informe o número da AIH para carregar as informações</p>';
        }
    });

    // Event listeners para os formulários
    document.getElementById('formDeletarMovimentacao').addEventListener('submit', processarDeletarMovimentacao);
    document.getElementById('formDeletarAIH').addEventListener('submit', processarDeletarAIH);

    console.log('✅ Funcionalidades de alteração da BD configuradas e campos limpos');
};

// Carregar movimentações de uma AIH
const carregarMovimentacoesAIH = async (numeroAIH) => {
    try {
        const aih = await api(`/aih/${numeroAIH}`);
        const container = document.getElementById('listaMovimentacoes');

        if (aih.movimentacoes && aih.movimentacoes.length > 0) {
            container.innerHTML = `
                <div style="margin-bottom: 1rem;">
                    <strong style="color: #059669;">AIH ${aih.numero_aih} encontrada - ${aih.movimentacoes.length} movimentação(ões)</strong>
                </div>
                ${aih.movimentacoes.map((mov, index) => `
                    <div style="border: 1px solid #d1d5db; border-radius: 6px; padding: 1rem; margin-bottom: 0.5rem; background: white;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <strong>${mov.tipo === 'entrada_sus' ? '📥 Entrada SUS' : '📤 Saída Hospital'}</strong>
                                <br>
                                <span style="color: #64748b;">Data: ${new Date(mov.data_movimentacao).toLocaleString('pt-BR')}</span>
                                <br>
                                <span style="color: #64748b;">Valor: R$ ${(mov.valor_conta || 0).toFixed(2)}</span>
                            </div>
                            <button type="button" onclick="selecionarMovimentacao(${mov.id}, '${aih.numero_aih}', '${mov.tipo}', '${mov.data_movimentacao}')" 
                                    style="background: #dc2626; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer;">
                                Selecionar
                            </button>
                        </div>
                    </div>
                `).join('')}
            `;
        } else {
            container.innerHTML = '<p style="color: #f59e0b; text-align: center; margin: 0;">AIH encontrada, mas sem movimentações registradas</p>';
        }
    } catch (err) {
        const container = document.getElementById('listaMovimentacoes');
        if (err.message.includes('não encontrada')) {
            container.innerHTML = '<p style="color: #dc2626; text-align: center; margin: 0;">AIH não encontrada</p>';
        } else {
            container.innerHTML = '<p style="color: #dc2626; text-align: center; margin: 0;">Erro ao carregar movimentações</p>';
        }
    }
};

// Carregar informações de uma AIH
const carregarInformacoesAIH = async (numeroAIH) => {
    try {
        const aih = await api(`/aih/${numeroAIH}`);
        const container = document.getElementById('infoAIHDeletar');

        container.innerHTML = `
            <div style="color: #059669; margin-bottom: 1rem;">
                <strong>✅ AIH ${aih.numero_aih} encontrada</strong>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; font-size: 0.9rem;">
                <div><strong>Status:</strong> ${getStatusDescricao(aih.status)}</div>
                <div><strong>Competência:</strong> ${aih.competencia}</div>
                <div><strong>Valor Inicial:</strong> R$ ${aih.valor_inicial.toFixed(2)}</div>
                <div><strong>Valor Atual:</strong> R$ ${aih.valor_atual.toFixed(2)}</div>
                <div><strong>Movimentações:</strong> ${aih.movimentacoes.length}</div>
                <div><strong>Glosas Ativas:</strong> ${aih.glosas.length}</div>
                <div><strong>Atendimentos:</strong> ${aih.atendimentos.length}</div>
                <div><strong>Criada em:</strong> ${new Date(aih.criado_em).toLocaleDateString('pt-BR')}</div>
            </div>
            <div style="margin-top: 1rem; padding: 1rem; background: #fef2f2; border: 1px solid #dc2626; border-radius: 4px;">
                <strong style="color: #dc2626;">⚠️ ATENÇÃO:</strong>
                <span style="color: #dc2626;">Esta exclusão removerá PERMANENTEMENTE todos os dados relacionados: ${aih.movimentacoes.length} movimentação(ões), ${aih.glosas.length} glosa(s), ${aih.atendimentos.length} atendimento(s).</span>
            </div>
        `;
    } catch (err) {
        const container = document.getElementById('infoAIHDeletar');
        if (err.message.includes('não encontrada')) {
            container.innerHTML = '<p style="color: #dc2626; text-align: center; margin: 0;">AIH não encontrada</p>';
        } else {
            container.innerHTML = '<p style="color: #dc2626; text-align: center; margin: 0;">Erro ao carregar informações da AIH</p>';
        }
    }
};

// Selecionar movimentação para exclusão
window.selecionarMovimentacao = (movId, numeroAIH, tipo, data) => {
    dadosExclusao = {
        tipo: 'movimentacao',
        dados: { id: movId, numero_aih: numeroAIH, tipo, data },
        justificativa: null
    };

    // Destacar movimentação selecionada
    document.querySelectorAll('#listaMovimentacoes > div > div').forEach(div => {
        div.style.border = '1px solid #d1d5db';
        div.style.background = 'white';
    });

    event.target.closest('div').style.border = '2px solid #dc2626';
    event.target.closest('div').style.background = '#fef2f2';
    event.target.textContent = 'Selecionada ✓';
    event.target.style.background = '#059669';
};

// Processar exclusão de movimentação
const processarDeletarMovimentacao = async (e) => {
    e.preventDefault();

    if (!dadosExclusao.dados || dadosExclusao.tipo !== 'movimentacao') {
        alert('Por favor, selecione uma movimentação para deletar');
        return;
    }

    const justificativa = document.getElementById('justificativaMovimentacao').value.trim();
    if (justificativa.length < 10) {
        alert('A justificativa deve ter pelo menos 10 caracteres');
        return;
    }

    dadosExclusao.justificativa = justificativa;

    // Mostrar modal de confirmação
    const modal = document.getElementById('modalConfirmacaoExclusao');
    const detalhes = document.getElementById('detalhesExclusao');

    detalhes.innerHTML = `
        <h4 style="color: #dc2626; margin: 0 0 1rem 0;">Deletar Movimentação</h4>
        <p><strong>AIH:</strong> ${dadosExclusao.dados.numero_aih}</p>
        <p><strong>Tipo:</strong> ${dadosExclusao.dados.tipo === 'entrada_sus' ? 'Entrada SUS' : 'Saída Hospital'}</p>
        <p><strong>Data:</strong> ${new Date(dadosExclusao.dados.data).toLocaleString('pt-BR')}</p>
        <p><strong>Justificativa:</strong> ${justificativa}</p>
    `;

    document.getElementById('senhaConfirmacao').value = '';
    modal.classList.add('ativo');
};

// Processar exclusão de AIH
const processarDeletarAIH = async (e) => {
    e.preventDefault();

    const numeroAIH = document.getElementById('aihCompleta').value.trim();
    const justificativa = document.getElementById('justificativaAIH').value.trim();

    if (!numeroAIH) {
        alert('Por favor, informe o número da AIH');
        return;
    }

    if (justificativa.length < 10) {
        alert('A justificativa deve ter pelo menos 10 caracteres');
        return;
    }

    try {
        const aih = await api(`/aih/${numeroAIH}`);
        dadosExclusao = {
            tipo: 'aih',
            dados: { numero_aih: numeroAIH, ...aih },
            justificativa: justificativa
        };

        // Mostrar modal de confirmação
        const modal = document.getElementById('modalConfirmacaoExclusao');
        const detalhes = document.getElementById('detalhesExclusao');

        detalhes.innerHTML = `
            <h4 style="color: #dc2626; margin: 0 0 1rem 0;">Deletar AIH Completa</h4>
            <p><strong>AIH:</strong> ${aih.numero_aih}</p>
            <p><strong>Competência:</strong> ${aih.competencia}</p>
            <p><strong>Valor:</strong> R$ ${aih.valor_atual.toFixed(2)}</p>
            <p><strong>Movimentações:</strong> ${aih.movimentacoes.length}</p>
            <p><strong>Glosas:</strong> ${aih.glosas.length}</p>
            <p><strong>Justificativa:</strong> ${justificativa}</p>
            <div style="background: #7f1d1d; color: white; padding: 0.5rem; border-radius: 4px; margin-top: 1rem;">
                <strong>⚠️ TODOS os dados relacionados serão PERMANENTEMENTE removidos!</strong>
            </div>
        `;

        document.getElementById('senhaConfirmacao').value = '';
        modal.classList.add('ativo');

    } catch (err) {
        alert('Erro ao buscar AIH: ' + err.message);
    }
};

// Cancelar exclusão
window.cancelarExclusao = () => {
    document.getElementById('modalConfirmacaoExclusao').classList.remove('ativo');
    dadosExclusao = { tipo: null, dados: null, justificativa: null };
};

// Confirmar exclusão
window.confirmarExclusao = async () => {
    const senha = document.getElementById('senhaConfirmacao').value;

    if (!senha) {
        alert('Por favor, digite sua senha para confirmar');
        return;
    }

    if (!dadosExclusao.dados || !dadosExclusao.justificativa) {
        alert('Dados de exclusão incompletos');
        return;
    }

    try {
        // Validar senha do usuário
        await api('/validar-senha', {
            method: 'POST',
            body: JSON.stringify({ senha })
        });

        // Executar exclusão
        if (dadosExclusao.tipo === 'movimentacao') {
            await api(`/admin/deletar-movimentacao`, {
                method: 'DELETE',
                body: JSON.stringify({
                    movimentacao_id: dadosExclusao.dados.id,
                    justificativa: dadosExclusao.justificativa
                })
            });

            alert('✅ Movimentação deletada com sucesso!');

            // Limpar formulário de movimentação
            document.getElementById('formDeletarMovimentacao').reset();
            document.getElementById('listaMovimentacoes').innerHTML = '<p style="color: #64748b; text-align: center; margin: 0;">Informe o número da AIH para carregar as movimentações</p>';

        } else if (dadosExclusao.tipo === 'aih') {
            await api(`/admin/deletar-aih`, {
                method: 'DELETE',
                body: JSON.stringify({
                    numero_aih: dadosExclusao.dados.numero_aih,
                    justificativa: dadosExclusao.justificativa
                })
            });

            alert('✅ AIH deletada com sucesso!');

            // Limpar formulário de AIH
            document.getElementById('formDeletarAIH').reset();
            document.getElementById('infoAIHDeletar').innerHTML = '<p style="color: #64748b; text-align: center; margin: 0;">Informe o número da AIH para carregar as informações</p>';
        }

        // Fechar modal e limpar dados
        document.getElementById('modalConfirmacaoExclusao').classList.remove('ativo');
        dadosExclusao = { tipo: null, dados: null, justificativa: null };

        // Limpar campos específicos adicionais (garantir limpeza completa)
        const camposParaLimpar = [
            'aihMovimentacao', 'justificativaMovimentacao',
            'aihCompleta', 'justificativaAIH'
        ];
        
        camposParaLimpar.forEach(campoId => {
            const campo = document.getElementById(campoId);
            if (campo) {
                campo.value = '';
            }
        });

        // Carregar logs de exclusão automaticamente após exclusão bem-sucedida
        console.log('🔄 Carregando logs de exclusão automaticamente após exclusão...');
        setTimeout(() => {
            carregarLogsExclusao();
        }, 500); // Pequeno delay para garantir que a exclusão foi processada

    } catch (err) {
        alert('❌ Erro na exclusão: ' + err.message);
    }
};

// Funções de backup e exportação melhoradas
window.fazerBackup = async () => {
    try {
        console.log('🔄 Iniciando backup do banco de dados...');
        
        // Verificar se há token válido
        if (!state.token) {
            console.error('❌ Token não encontrado no state:', state);
            alert('❌ Erro: Usuário não autenticado. Faça login novamente.');
            return;
        }

        console.log('✅ Token encontrado, continuando com backup...');

        // Criar modal de loading customizado
        const loadingModal = document.createElement('div');
        loadingModal.id = 'backup-loading-modal';
        loadingModal.style.cssText = `
            position: fixed; top: 0; left: 0; right: 0; bottom: 0; 
            background: rgba(0,0,0,0.7); display: flex; align-items: center; 
            justify-content: center; z-index: 9999;
        `;
        loadingModal.innerHTML = `
            <div style="background: white; padding: 2rem; border-radius: 12px; text-align: center; min-width: 300px; box-shadow: 0 8px 32px rgba(0,0,0,0.3);">
                <h3 style="color: #0369a1; margin-bottom: 1rem; font-size: 1.25rem;">💾 Fazendo Backup...</h3>
                <p style="color: #64748b; margin-bottom: 1.5rem;">Aguarde enquanto o backup é criado...</p>
                <div style="border: 3px solid #f3f3f3; border-top: 3px solid #3498db; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 0 auto;"></div>
                <p style="font-size: 0.8rem; color: #94a3b8; margin-top: 1rem;">Isso pode levar alguns segundos...</p>
            </div>
        `;
        
        // Adicionar ao DOM
        document.body.appendChild(loadingModal);

        // Fazer requisição para backup
        console.log('📡 Fazendo requisição para /api/backup...');
        
        const response = await fetch('/api/backup', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${state.token}`
            }
        });

        console.log(`📡 Resposta recebida: Status ${response.status}`);

        if (!response.ok) {
            let errorText;
            try {
                errorText = await response.text();
            } catch (e) {
                errorText = `Erro ao ler resposta: ${e.message}`;
            }
            console.error('❌ Erro na resposta do servidor:', {
                status: response.status,
                statusText: response.statusText,
                errorText: errorText
            });
            throw new Error(`Erro HTTP ${response.status}: ${response.statusText} - ${errorText}`);
        }

        // Verificar content-type da resposta
        const contentType = response.headers.get('content-type');
        console.log('📄 Content-Type da resposta:', contentType);

        // Aceitar tanto application/octet-stream quanto outros tipos de arquivo
        if (contentType && contentType.includes('application/json')) {
            const errorData = await response.json();
            console.error('❌ Servidor retornou JSON ao invés de arquivo:', errorData);
            throw new Error(errorData.error || 'Servidor retornou erro ao invés de arquivo de backup');
        }

        // Criar blob e fazer download
        console.log('💾 Criando blob para download...');
        const blob = await response.blob();
        
        if (blob.size === 0) {
            throw new Error('Arquivo de backup está vazio');
        }
        
        console.log(`💾 Blob criado com tamanho: ${blob.size} bytes`);

        // Criar link de download
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        
        // Definir nome do arquivo
        const dataAtual = new Date().toISOString().split('T')[0];
        link.download = `backup-aih-${dataAtual}.db`;
        
        // Configurar link invisível
        link.style.display = 'none';
        link.style.visibility = 'hidden';

        // Adicionar ao DOM temporariamente
        document.body.appendChild(link);
        
        // Forçar clique
        console.log('🖱️ Iniciando download...');
        link.click();
        
        // Limpar recursos
        setTimeout(() => {
            if (document.body.contains(link)) {
                document.body.removeChild(link);
            }
            window.URL.revokeObjectURL(url);
            console.log('🧹 Recursos de download limpos');
        }, 100);

        console.log('✅ Download do backup iniciado com sucesso');

        // Fechar modal de loading
        if (document.body.contains(loadingModal)) {
            document.body.removeChild(loadingModal);
        }
        
        // Mostrar mensagem de sucesso
        alert('✅ Backup do banco de dados realizado com sucesso!\n\nO arquivo SQLite foi baixado e contém todos os dados do sistema.');

    } catch (err) {
        console.error('❌ Erro completo ao fazer backup:', {
            message: err.message,
            stack: err.stack,
            token: state.token ? `Presente (${state.token.length} chars)` : 'Ausente',
            url: window.location.href,
            userAgent: navigator.userAgent
        });
        
        // Remover modal de loading se existir
        const loadingModal = document.getElementById('backup-loading-modal');
        if (loadingModal && document.body.contains(loadingModal)) {
            document.body.removeChild(loadingModal);
        }
        
        // Mostrar erro detalhado
        alert(`❌ Erro ao fazer backup: ${err.message}\n\nDetalhes técnicos foram registrados no console.`);
    }
};

// Função para exportar resultados da pesquisa
window.exportarResultadosPesquisa = async (formato) => {
    if (!window.ultimosResultadosPesquisa || window.ultimosResultadosPesquisa.length === 0) {
        alert('Nenhum resultado disponível para exportação');
        return;
    }

    try {
        // Criar dados formatados para exportação
        const dadosExportacao = window.ultimosResultadosPesquisa.map(aih => ({
            'Número AIH': aih.numero_aih || '',
            'Status': getStatusDescricao(aih.status),
            'Competência': aih.competencia || '',
            'Valor Inicial': `R$ ${(aih.valor_inicial || 0).toFixed(2)}`,
            'Valor Atual': `R$ ${(aih.valor_atual || 0).toFixed(2)}`,
            'Diferença': `R$ ${((aih.valor_inicial || 0) - (aih.valor_atual || 0)).toFixed(2)}`,
            'Total Glosas': aih.total_glosas || 0,
            'Cadastrado em': new Date(aih.criado_em).toLocaleDateString('pt-BR')
        }));

        const dataAtual = new Date().toISOString().split('T')[0];

        if (formato === 'csv') {
            // Gerar CSV
            const cabecalhos = Object.keys(dadosExportacao[0]);
            const linhasCsv = [
                cabecalhos.join(','),
                ...dadosExportacao.map(linha => 
                    cabecalhos.map(cabecalho => `"${linha[cabecalho]}"`).join(',')
                )
            ];

            const csvContent = '\ufeff' + linhasCsv.join('\n'); // BOM para UTF-8
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });

            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `resultados-pesquisa-${dataAtual}.csv`;
            link.click();

            URL.revokeObjectURL(link.href);

        } else if (formato === 'excel') {
            // Para Excel, vamos usar a API do servidor
            const response = await fetch('/api/export/excel', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${state.token}`
                },
                body: JSON.stringify({
                    dados: dadosExportacao,
                    titulo: 'Resultados da Pesquisa',
                    tipo: 'resultados-pesquisa'
                })
            });

            if (response.ok) {
                const blob = await response.blob();
                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = `resultados-pesquisa-${dataAtual}.xls`;
                link.click();
                URL.revokeObjectURL(link.href);
            } else {
                throw new Error('Erro ao gerar arquivo Excel');
            }
        }

        alert(`Exportação ${formato.toUpperCase()} realizada com sucesso!`);

    } catch (err) {
        console.error('Erro na exportação:', err);
        alert('Erro ao exportar resultados: ' + err.message);
    }
};

// Função para ir para gerenciar glosas a partir da tela de informações
window.gerenciarGlosasFromInfo = () => {
    if (!state.aihAtual) {
        alert('Nenhuma AIH selecionada');
        return;
    }
    
    // Definir tela anterior como a tela de informações da AIH
    state.telaAnterior = 'telaInfoAIH';
    
    // Ir para tela de pendências
    mostrarTela('telaPendencias');
    carregarGlosas();
};

// Função para exportar glosas da AIH atual
window.exportarGlosasAIH = async (formato) => {
    if (!state.aihAtual) {
        alert('Nenhuma AIH selecionada');
        return;
    }

    try {
        // Buscar glosas atuais
        const response = await api(`/aih/${state.aihAtual.id}/glosas`);
        const glosas = response.glosas || [];

        if (glosas.length === 0) {
            alert('Esta AIH não possui glosas ativas para exportar');
            return;
        }

        // Preparar dados para exportação
        const dadosExportacao = glosas.map((glosa, index) => ({
            'Sequência': index + 1,
            'AIH': state.aihAtual.numero_aih,
            'Linha da Glosa': glosa.linha,
            'Tipo de Glosa': glosa.tipo,
            'Profissional Responsável': glosa.profissional,
            'Quantidade': glosa.quantidade || 1,
            'Data de Criação': new Date(glosa.criado_em).toLocaleString('pt-BR'),
            'Status': glosa.ativa ? 'Ativa' : 'Inativa'
        }));

        const dataAtual = new Date().toISOString().split('T')[0];
        const nomeArquivo = `glosas-AIH-${state.aihAtual.numero_aih}-${dataAtual}`;

        if (formato === 'csv') {
            // Gerar CSV
            const cabecalhos = Object.keys(dadosExportacao[0]);
            const linhasCsv = [
                cabecalhos.join(','),
                ...dadosExportacao.map(linha => 
                    cabecalhos.map(cabecalho => `"${linha[cabecalho]}"`).join(',')
                )
            ];

            const csvContent = '\ufeff' + linhasCsv.join('\n'); // BOM para UTF-8
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });

            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `${nomeArquivo}.csv`;
            link.click();

            URL.revokeObjectURL(link.href);

        } else if (formato === 'excel') {
            // Para Excel, usar a API do servidor
            const responseExcel = await fetch('/api/export/excel', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${state.token}`
                },
                body: JSON.stringify({
                    dados: dadosExportacao,
                    titulo: `Glosas da AIH ${state.aihAtual.numero_aih}`,
                    tipo: 'glosas-aih'
                })
            });

            if (responseExcel.ok) {
                const blob = await responseExcel.blob();
                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = `${nomeArquivo}.xls`;
                link.click();
                URL.revokeObjectURL(link.href);
            } else {
                throw new Error('Erro ao gerar arquivo Excel');
            }
        }

        alert(`Glosas da AIH ${state.aihAtual.numero_aih} exportadas com sucesso em formato ${formato.toUpperCase()}!`);

    } catch (err) {
        console.error('Erro ao exportar glosas:', err);
        alert('Erro ao exportar glosas: ' + err.message);
    }
};

// Função para limpar filtros
const limparFiltros = () => {
    // Limpar filtros da pesquisa avançada
    document.getElementById('pesquisaNumeroAIH').value = '';
    document.getElementById('pesquisaNumeroAtendimento').value = '';
    document.getElementById('pesquisaCompetencia').value = '';
    document.getElementById('pesquisaDataInicio').value = '';
    document.getElementById('pesquisaDataFim').value = '';
    document.getElementById('pesquisaValorMin').value = '';
    document.getElementById('pesquisaValorMax').value = '';
    document.getElementById('pesquisaProfissional').value = '';

    // Desmarcar todos os checkboxes de status
    document.querySelectorAll('input[name="status"]').forEach(cb => cb.checked = false);

    // Limpar resultados se existirem
    const resultados = document.getElementById('resultadosPesquisa');
    if (resultados) {
        resultados.innerHTML = '';
    }

    console.log('Filtros limpos');
};

// Pesquisa avançada
document.getElementById('formPesquisa').addEventListener('submit', async (e) => {
    e.preventDefault();

    const filtros = {
        status: Array.from(document.querySelectorAll('input[name="status"]:checked')).map(cb => parseInt(cb.value)),
        competencia: document.getElementById('pesquisaCompetencia').value,
        data_inicio: document.getElementById('pesquisaDataInicio').value,
        data_fim: document.getElementById('pesquisaDataFim').value,
        valor_min: document.getElementById('pesquisaValorMin').value,
        valor_max: document.getElementById('pesquisaValorMax').value,
        numero_aih: document.getElementById('pesquisaNumeroAIH').value,
        numero_atendimento: document.getElementById('pesquisaNumeroAtendimento').value,
        profissional: document.getElementById('pesquisaProfissional').value
    };

    // Remover filtros vazios
    Object.keys(filtros).forEach(key => {
        if (!filtros[key] || (Array.isArray(filtros[key]) && filtros[key].length === 0)) {
            delete filtros[key];
        }
    });

    try {
        const response = await api('/pesquisar', {
            method: 'POST',
            body: JSON.stringify({ filtros })
        });

        exibirResultadosPesquisa(response.resultados);
    } catch (err) {
        alert('Erro na pesquisa: ' + err.message);
    }
});

// Exportar histórico de movimentações
window.exportarHistoricoMovimentacoes = async (formato) => {
    if (!state.aihAtual) {
        alert('Nenhuma AIH selecionada');
        return;
    }

    try {
        console.log(`Iniciando exportação do histórico da AIH ${state.aihAtual.numero_aih} em formato ${formato}`);

        // Mostrar indicador de carregamento
        const botoes = document.querySelectorAll('button[onclick*="exportarHistoricoMovimentacoes"]');
        botoes.forEach(btn => {
            btn.disabled = true;
            const textoOriginal = btn.textContent;
            btn.setAttribute('data-texto-original', textoOriginal);
            btn.textContent = '⏳ Exportando...';
        });

        const response = await fetch(`/api/aih/${state.aihAtual.id}/movimentacoes/export/${formato}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${state.token}`
            }
        });

        console.log(`Resposta da API: Status ${response.status}`);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Erro na resposta:', errorText);
            throw new Error(`Erro HTTP ${response.status}: ${response.statusText}`);
        }

        // Criar blob com o conteúdo da resposta
        const blob = await response.blob();
        console.log(`Blob criado com tamanho: ${blob.size} bytes`);

        // Determinar o nome do arquivo
        const dataAtual = new Date().toISOString().split('T')[0];
        let fileName;
        if (formato === 'csv') {
            fileName = `historico-movimentacoes-AIH-${state.aihAtual.numero_aih}-${dataAtual}.csv`;
        } else if (formato === 'xlsx') {
            fileName = `historico-movimentacoes-AIH-${state.aihAtual.numero_aih}-${dataAtual}.xls`;
        } else {
            throw new Error('Formato não suportado');
        }

        // Criar link de download
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        link.style.display = 'none';

        // Adicionar ao DOM temporariamente e clicar
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // Limpar URL do blob
        window.URL.revokeObjectURL(url);

        console.log(`Exportação concluída: ${fileName}`);
        alert(`Histórico exportado com sucesso em formato ${formato.toUpperCase()}!\nArquivo: ${fileName}`);

    } catch (err) {
        console.error('Erro ao exportar histórico:', err);
        alert(`Erro ao exportar histórico: ${err.message || 'Erro desconhecido'}`);
    } finally {
        // Restaurar botões
        setTimeout(() => {
            const botoes = document.querySelectorAll('button[onclick*="exportarHistoricoMovimentacoes"]');
            botoes.forEach(btn => {
                btn.disabled = false;
                const textoOriginal = btn.getAttribute('data-texto-original');
                if (textoOriginal) {
                    btn.textContent = textoOriginal;
                    btn.removeAttribute('data-texto-original');
                } else {
                    // Fallback caso não tenha o atributo
                    if (btn.textContent.includes('CSV') || btn.textContent.includes('Exportando')) {
                        btn.textContent = '📄 CSV';
                    } else {
                        btn.textContent = '📊 Excel (XLS)';
                    }
                }
            });
        }, 500);
    }
};

// Adicionar funcionalidades de configuração
const carregarProfissionais = async () => {
    try {
        const response = await api('/profissionais');
        const container = document.getElementById('listaProfissionais');

        if (response && response.profissionais) {
            container.innerHTML = response.profissionais.map(prof => `
                <div class="glosa-item">
                    <div>
                        <strong>${prof.nome}</strong> - ${prof.especialidade}
                    </div>
                    <button onclick="excluirProfissional(${prof.id})" class="btn-danger">Excluir</button>
                </div>
            `).join('') || '<p>Nenhum profissional cadastrado</p>';
        }
    } catch (err) {
        console.error('Erro ao carregar profissionais:', err);
    }
};

const carregarTiposGlosaConfig = async () => {
    try {
        const response = await api('/tipos-glosa');
        const container = document.getElementById('listaTiposGlosa');

        if (response && response.tipos) {
            container.innerHTML = response.tipos.map(tipo => `
                <div class="glosa-item">
                    <div>${tipo.descricao}</div>
                    <button onclick="excluirTipoGlosa(${tipo.id})" class="btn-danger">Excluir</button>
                </div>
            `).join('') || '<p>Nenhum tipo de glosa cadastrado</p>';
        }
    } catch (err) {
        console.error('Erro ao carregar tipos de glosa:', err);
    }
};

// Event listener para Nova Movimentação
document.getElementById('btnNovaMovimentacao').addEventListener('click', async () => {
    if (!state.aihAtual) {
        alert('Nenhuma AIH selecionada');
        return;
    }

    try {
        // Buscar próxima movimentação possível
        const proximaMovimentacao = await api(`/aih/${state.aihAtual.id}/proxima-movimentacao`);

        // NÃO definir tela anterior aqui - deixar que os botões funcionem independentemente
        // state.telaAnterior = 'telaInfoAIH';

        // Ir para tela de movimentação
        mostrarTela('telaMovimentacao');

        // Carregar dados da movimentação
        await carregarDadosMovimentacao();

        // Garantir que os event listeners estão configurados
        setTimeout(() => {
            configurarEventListenersMovimentacao();
        }, 600);

        // Configurar campos com base na próxima movimentação
        if (proximaMovimentacao) {
            const tipoSelect = document.getElementById('movTipo');
            const explicacaoDiv = document.getElementById('explicacaoMovimentacao');

            if (tipoSelect) {
                tipoSelect.value = proximaMovimentacao.proximo_tipo;
                tipoSelect.disabled = true; // Bloquear alteração
            }

            if (explicacaoDiv) {
                explicacaoDiv.innerHTML = `
                    <div style="background: #e0f2fe; border: 1px solid #0284c7; border-radius: 8px; padding: 1rem; margin-bottom: 1rem;">
                        <h4 style="color: #0284c7; margin-bottom: 0.5rem;">
                            ℹ️ ${proximaMovimentacao.descricao}
                        </h4>
                        <p style="color: #0369a1; margin: 0;">
                            ${proximaMovimentacao.explicacao}
                        </p>
                    </div>
                `;
            }
        }

        // Preencher competência padrão
        const competenciaField = document.getElementById('movCompetencia');
        if (competenciaField && !competenciaField.value) {
            competenciaField.value = getCompetenciaAtual();
        }

        // Preencher valor atual da AIH
        const valorField = document.getElementById('movValor');
        if (valorField && state.aihAtual.valor_atual) {
            valorField.value = state.aihAtual.valor_atual;
        }

    } catch (err) {
        console.error('Erro ao iniciar nova movimentação:', err);
        alert('Erro ao iniciar nova movimentação: ' + err.message);
    }
});

// Event listeners para configurações
document.getElementById('formNovoProfissional').addEventListener('submit', async (e) => {
    e.preventDefault();

    try {
        const dados = {
            nome: document.getElementById('profNome').value,
            especialidade: document.getElementById('profEspecialidade').value
        };

        await api('/profissionais', {
            method: 'POST',
            body: JSON.stringify(dados)
        });

        alert('Profissional adicionado com sucesso!');
        document.getElementById('formNovoProfissional').reset();
        carregarProfissionais();
    } catch (err) {
        alert('Erro ao adicionar profissional: ' + err.message);
    }
});

document.getElementById('formNovoTipoGlosa').addEventListener('submit', async (e) => {
    e.preventDefault();

    try {
        const dados = {
            descricao: document.getElementById('tipoGlosaDescricao').value
        };

        await api('/tipos-glosa', {
            method: 'POST',
            body: JSON.stringify(dados)
        });

        alert('Tipo de glosa adicionado com sucesso!');
        document.getElementById('formNovoTipoGlosa').reset();
        carregarTiposGlosaConfig();
    } catch (err) {
        alert('Erro ao adicionar tipo de glosa: ' + err.message);
    }
});

window.excluirProfissional = async (id) => {
    const confirmar = confirm('Tem certeza que deseja excluir este profissional?');
    if (!confirmar) return;

    try {
        await api(`/profissionais/${id}`, { method: 'DELETE' });
        alert('Profissional excluído com sucesso!');
        carregarProfissionais();
    } catch (err) {
        alert('Erro ao excluir profissional: ' + err.message);
    }
};

window.excluirTipoGlosa = async (id) => {
    const confirmar = confirm('Tem certeza que deseja excluir este tipo de glosa?');
    if (!confirmar) return;

    try {
        await api(`/tipos-glosa/${id}`, { method: 'DELETE' });
        alert('Tipo de glosa excluído com sucesso!');
        carregarTiposGlosaConfig();
    } catch (err) {
        alert('Erro ao excluir tipo de glosa: ' + err.message);
    }
};

// Event listeners para movimentação

// Função global para gerenciar glosas na movimentação
window.gerenciarGlosasMovimentacao = () => {
    state.telaAnterior = 'telaMovimentacao';
    mostrarTela('telaPendencias');
    carregarGlosas();
};

// Função global para cancelar movimentação
window.cancelarMovimentacao = () => {
    voltarTelaAnterior();
};

// Event listeners para os botões na tela de movimentação
const configurarEventListenersMovimentacao = () => {
    // Event listeners configurados silenciosamente para melhor performance

    // Aguardar um pouco para garantir que os elementos estejam no DOM
    setTimeout(() => {
        const btnCancelar = document.getElementById('btnCancelarMovimentacao');
        const btnGerenciarGlosas = document.getElementById('btnGerenciarGlosas');

        if (btnCancelar) {
            // Limpar todos os event listeners existentes
            btnCancelar.onclick = null;
            btnCancelar.replaceWith(btnCancelar.cloneNode(true));

            // Referenciar o novo elemento
            const novoBtnCancelar = document.getElementById('btnCancelarMovimentacao');

            // Configurar event listener principal
            novoBtnCancelar.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('Botão cancelar clicado - voltando para tela anterior');

                // Voltar para tela de informações da AIH
                if (state.aihAtual) {
                    try {
                        // Recarregar AIH atualizada antes de mostrar
                        const aihAtualizada = await api(`/aih/${state.aihAtual.numero_aih}`);
                        state.aihAtual = aihAtualizada;
                        mostrarInfoAIH(aihAtualizada);
                        console.log('AIH recarregada ao cancelar movimentação');
                    } catch (err) {
                        console.error('Erro ao recarregar AIH:', err);
                        // Se der erro, mostrar a AIH atual mesmo
                        mostrarInfoAIH(state.aihAtual);
                    }
                } else {
                    voltarTelaPrincipal();
                }
            });

            console.log('Event listener do botão cancelar configurado');
        } else {
            console.warn('Botão cancelar não encontrado');
        }

        if (btnGerenciarGlosas) {
            // Limpar todos os event listeners existentes
            btnGerenciarGlosas.onclick = null;
            btnGerenciarGlosas.replaceWith(btnGerenciarGlosas.cloneNode(true));

            // Referenciar o novo elemento
            const novoBtnGerenciarGlosas = document.getElementById('btnGerenciarGlosas');

            // Configurar event listener principal
            novoBtnGerenciarGlosas.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('Botão gerenciar glosas clicado');

                // Definir tela anterior antes de navegar
                state.telaAnterior = 'telaMovimentacao';
                mostrarTela('telaPendencias');
                carregarGlosas();
            });

            console.log('Event listener do botão gerenciar glosas configurado');
        } else {
            console.warn('Botão gerenciar glosas não encontrado');
        }
    }, 100);
};

// Chamar configuração quando a página carregar
document.addEventListener('DOMContentLoaded', configurarEventListenersMovimentacao);

// Função para validar profissionais obrigatórios
const validarProfissionaisObrigatorios = () => {
    const profEnfermagem = document.getElementById('movProfEnfermagem').value.trim();
    const profMedicina = document.getElementById('movProfMedicina').value.trim();
    const profBucomaxilo = document.getElementById('movProfBucomaxilo').value.trim();

    const erros = [];

    // Validação 1: Enfermagem é SEMPRE obrigatória
    if (!profEnfermagem) {
        erros.push('• Profissional de Enfermagem é obrigatório');
    }

    // Validação 2: Pelo menos um entre Medicina ou Bucomaxilo deve ser selecionado
    if (!profMedicina && !profBucomaxilo) {
        erros.push('• É necessário selecionar pelo menos um profissional de Medicina OU Cirurgião Bucomaxilo');
    }

    return erros;
};

// Formulário de movimentação
document.getElementById('formMovimentacao')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!state.aihAtual) {
        alert('Nenhuma AIH selecionada');
        return;
    }

    // Validar profissionais obrigatórios
    const errosValidacao = validarProfissionaisObrigatorios();
    if (errosValidacao.length > 0) {
        const mensagemErro = `❌ Profissionais Auditores Obrigatórios não preenchidos:\n\n${errosValidacao.join('\n')}\n\n📋 Regra: Enfermagem é SEMPRE obrigatório + pelo menos um entre Medicina ou Cirurgião Bucomaxilo.\n\n🔬 Fisioterapia é opcional.`;
        alert(mensagemErro);
        return;
    }

    try {
        const dados = {
            tipo: document.getElementById('movTipo').value,
            status_aih: parseInt(document.getElementById('movStatus').value),
            valor_conta: parseFloat(document.getElementById('movValor').value),
            competencia: document.getElementById('movCompetencia').value,
            prof_medicina: document.getElementById('movProfMedicina').value || null,
            prof_enfermagem: document.getElementById('movProfEnfermagem').value || null,
            prof_fisioterapia: document.getElementById('movProfFisioterapia').value || null,
            prof_bucomaxilo: document.getElementById('movProfBucomaxilo').value || null,
            observacoes: document.getElementById('movObservacoes').value || null
        };

        await api(`/aih/${state.aihAtual.id}/movimentacao`, {
            method: 'POST',
            body: JSON.stringify(dados)
        });

        alert('Movimentação salva com sucesso!');

        // Recarregar AIH atualizada
        const aihAtualizada = await api(`/aih/${state.aihAtual.numero_aih}`);
        state.aihAtual = aihAtualizada;

        // Voltar para informações da AIH
        mostrarInfoAIH(aihAtualizada);

    } catch (err) {
        console.error('Erro ao salvar movimentação:', err);
        alert('Erro ao salvar movimentação: ' + err.message);
    }
});

// Formulário para adicionar nova glosa
document.getElementById('formNovaGlosa')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!state.aihAtual || !state.aihAtual.id) {
        alert('Nenhuma AIH selecionada');
        return;
    }

    try {
        const dados = {
            linha: document.getElementById('glosaLinha').value,
            tipo: document.getElementById('glosaTipo').value,
            profissional: document.getElementById('glosaProfissional').value,
            quantidade: parseInt(document.getElementById('glosaQuantidade').value) || 1
        };

        await api(`/aih/${state.aihAtual.id}/glosas`, {
            method: 'POST',
            body: JSON.stringify(dados)
        });

        alert('Glosa adicionada com sucesso!');
        document.getElementById('formNovaGlosa').reset();
        carregarGlosas();
    } catch (err) {
        alert('Erro ao adicionar glosa: ' + err.message);
    }
});

// Remover glosa
window.removerGlosa = async (id) => {
    const confirmar = await mostrarModal(
        'Remover Glosa',
        'Tem certeza que deseja remover esta glosa/pendência?'
    );

    if (!confirmar) return;

    try {
        await api(`/glosas/${id}`, { method: 'DELETE' });
        alert('Glosa removida com sucesso!');
        carregarGlosas();
    } catch (err) {
        alert('Erro ao remover glosa: ' + err.message);
    }
};

// Salvar glosas e voltar
document.getElementById('btnSalvarGlosas')?.addEventListener('click', async () => {
    console.log('Salvando glosas e voltando...');

    // Se veio da tela de movimentação, voltar para lá
    if (state.telaAnterior === 'telaMovimentacao') {
        console.log('Voltando para tela de movimentação...');
        mostrarTela('telaMovimentacao');

        // Recarregar dados da movimentação para mostrar glosas atualizadas
        setTimeout(() => {
            carregarDadosMovimentacao();
            setTimeout(() => {
                configurarEventListenersMovimentacao();
            }, 300);
        }, 150);
    } else if (state.telaAnterior === 'telaInfoAIH' && state.aihAtual) {
        // Se voltando para tela de informações, recarregar AIH com glosas atualizadas
        console.log('Voltando para tela de informações da AIH e recarregando glosas...');
        try {
            const aihAtualizada = await api(`/aih/${state.aihAtual.numero_aih}`);
            state.aihAtual = aihAtualizada;
            mostrarInfoAIH(aihAtualizada);
            console.log('Glosas atualizadas na tela de informações');
        } catch (err) {
            console.error('Erro ao recarregar AIH:', err);
            // Se der erro, usar função padrão
            voltarTelaAnterior();
        }
    } else {
        // Caso contrário, usar função padrão
        voltarTelaAnterior();
    }
});