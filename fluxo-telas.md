# Fluxo de Telas - Sistema AIH

## 1. TELA LOGIN
**Campos:**
- Usuário (input texto)
- Senha (input password)
- Botão Login
- Link "Cadastrar novo usuário"

**Ações:**
- Login bem-sucedido → TELA PRINCIPAL
- Cadastro → Modal de cadastro

## 2. TELA PRINCIPAL
**Seções:**
- Dashboard com estatísticas
  - Total de AIH cadastradas
  - AIH em processamento
  - Distribuição por status (gráfico simples)

**Botões principais:**
- Informar AIH
- Buscar AIH
- Backup/Exportar
- Configurações
- Relatórios

## 3. TELA INFORMAR AIH
**Campo:**
- Número da AIH (input)
- Botão Buscar

**Fluxo:**
- AIH não existe → TELA CADASTRO AIH
- AIH existe (status 1 ou 4) → Alerta reassinatura
  - Sim → TELA INFORMAÇÕES AIH
  - Não → Cancela operação
- AIH existe (status 2 ou 3) → TELA INFORMAÇÕES AIH

## 4. TELA CADASTRO AIH
**Campos obrigatórios:**
- Número AIH
- Números de atendimento (múltiplos)
- Competência (MM/YYYY)
- Valor inicial
- Botão Cadastrar

**Ação:**
- Cadastro bem-sucedido → TELA INFORMAÇÕES AIH

## 5. TELA INFORMAÇÕES AIH
**Exibe:**
- Dados da AIH (número, atendimentos, valores, status)
- Histórico de movimentações (tabela)
- Botão "Nova Movimentação"

**Ação:**
- Nova Movimentação → TELA MOVIMENTAÇÃO

## 6. TELA MOVIMENTAÇÃO
**Campos:**
- Status atual (select 1-4)
- Data (preenchida automaticamente)
- Tipo (entrada SUS/saída hospital)
- Competência
- Profissionais (4 campos)
- Valor atual da conta

**Seção Glosas:**
- Lista de glosas/pendências
- Botão "Gerenciar Glosas"

**Ações:**
- Gerenciar Glosas → TELA PENDÊNCIAS
- Salvar → Volta para TELA INFORMAÇÕES AIH

## 7. TELA PENDÊNCIAS
**Funcionalidades:**
- Lista de glosas atuais
- Adicionar nova glosa:
  - Linha da glosa
  - Tipo da glosa
  - Profissional responsável
- Remover glosas existentes
- Botão Salvar

## 8. TELA PESQUISA
**Filtros:**
- Status (múltipla escolha)
- Período (data início/fim)
- Competência
- Profissional auditor
- Valor (mínimo/máximo)

**Resultados:**
- Tabela com AIHs encontradas
- Botões: Exportar CSV, Exportar JSON

## 9. TELA CONFIGURAÇÕES
**Seções:**
- Gerenciar Profissionais
  - Adicionar/remover profissionais
- Gerenciar Usuários
  - Lista de usuários
  - Resetar senhas
- Backup do Sistema
  - Download banco de dados

## Navegação

```
LOGIN
  └─> PRINCIPAL
        ├─> INFORMAR AIH
        │     ├─> CADASTRO AIH
        │     └─> INFORMAÇÕES AIH
        │           └─> MOVIMENTAÇÃO
        │                 └─> PENDÊNCIAS
        ├─> PESQUISA
        └─> CONFIGURAÇÕES
```

## Validações Importantes

1. **Número AIH**: Único no sistema
2. **Movimentação**: Primeira sempre é "entrada SUS"
3. **Status finalizado**: Alerta antes de nova movimentação
4. **Glosas pendentes**: Aviso antes de finalizar movimentação