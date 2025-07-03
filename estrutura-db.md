# Estrutura do Banco de Dados - Sistema AIH

## Tabelas

### 1. usuarios
```sql
CREATE TABLE usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT UNIQUE NOT NULL,
    senha_hash TEXT NOT NULL,
    criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 2. aihs
```sql
CREATE TABLE aihs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    numero_aih TEXT UNIQUE NOT NULL,
    valor_inicial REAL NOT NULL,
    valor_atual REAL NOT NULL,
    status INTEGER NOT NULL DEFAULT 2, -- 1,2,3,4
    competencia TEXT NOT NULL, -- formato: MM/YYYY
    criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
    usuario_cadastro_id INTEGER,
    FOREIGN KEY (usuario_cadastro_id) REFERENCES usuarios(id)
);
```

### 3. atendimentos
```sql
CREATE TABLE atendimentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    aih_id INTEGER NOT NULL,
    numero_atendimento TEXT NOT NULL,
    FOREIGN KEY (aih_id) REFERENCES aihs(id)
);
```

### 4. movimentacoes
```sql
CREATE TABLE movimentacoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    aih_id INTEGER NOT NULL,
    tipo TEXT NOT NULL, -- 'entrada_sus' ou 'saida_hospital'
    data_movimentacao DATETIME DEFAULT CURRENT_TIMESTAMP,
    usuario_id INTEGER NOT NULL,
    valor_conta REAL,
    competencia TEXT,
    prof_medicina TEXT,
    prof_enfermagem TEXT,
    prof_fisioterapia TEXT,
    prof_bucomaxilo TEXT,
    status_aih INTEGER NOT NULL,
    FOREIGN KEY (aih_id) REFERENCES aihs(id),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
);
```

### 5. glosas
```sql
CREATE TABLE glosas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    aih_id INTEGER NOT NULL,
    linha TEXT NOT NULL,
    tipo TEXT NOT NULL,
    profissional TEXT NOT NULL,
    ativa BOOLEAN DEFAULT 1,
    criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (aih_id) REFERENCES aihs(id)
);
```

### 6. profissionais
```sql
CREATE TABLE profissionais (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    especialidade TEXT NOT NULL
);
```

## Status da AIH

1. **Finalizada com aprovação direta** - Aprovada por ambas auditorias
2. **Ativa com aprovação indireta** - Glosa pela auditoria do SUS
3. **Ativa em discussão** - Glosa em discussão entre auditorias
4. **Finalizada após discussão** - Aprovada após resolver glosas

## Índices para Performance

```sql
CREATE INDEX idx_aih_numero ON aihs(numero_aih);
CREATE INDEX idx_aih_status ON aihs(status);
CREATE INDEX idx_movimentacoes_aih ON movimentacoes(aih_id);
CREATE INDEX idx_atendimentos_aih ON atendimentos(aih_id);
CREATE INDEX idx_glosas_aih ON glosas(aih_id);
```