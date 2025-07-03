# API Endpoints - Sistema AIH

## Autenticação

### POST /api/login
```json
Request: { "nome": "usuario", "senha": "senha123" }
Response: { "token": "jwt_token", "nome": "usuario" }
```

### POST /api/cadastrar
```json
Request: { "nome": "novo_usuario", "senha": "senha123" }
Response: { "success": true, "message": "Usuário criado" }
```

## AIH

### GET /api/dashboard
```json
Response: {
    "total_cadastradas": 150,
    "em_processamento": 45,
    "por_status": {
        "1": 30,
        "2": 25,
        "3": 20,
        "4": 75
    }
}
```

### GET /api/aih/:numero
```json
Response: {
    "id": 1,
    "numero_aih": "12345",
    "valor_inicial": 1500.00,
    "valor_atual": 1200.00,
    "status": 2,
    "competencia": "12/2024",
    "atendimentos": ["A001", "A002"],
    "movimentacoes": [...],
    "glosas": [...]
}
```

### POST /api/aih
```json
Request: {
    "numero_aih": "12345",
    "valor_inicial": 1500.00,
    "competencia": "12/2024",
    "atendimentos": ["A001", "A002"]
}
Response: { "success": true, "id": 1 }
```

### POST /api/aih/:id/movimentacao
```json
Request: {
    "tipo": "entrada_sus",
    "status_aih": 2,
    "valor_conta": 1200.00,
    "competencia": "12/2024",
    "prof_medicina": "Dr. Silva",
    "prof_enfermagem": "Enf. Maria"
}
```

### GET /api/aih/:id/glosas
```json
Response: {
    "glosas": [
        {
            "id": 1,
            "linha": "Material",
            "tipo": "Quantidade",
            "profissional": "Dr. Silva",
            "ativa": true
        }
    ]
}
```

### POST /api/aih/:id/glosas
```json
Request: {
    "linha": "Material",
    "tipo": "Quantidade",
    "profissional": "Dr. Silva"
}
```

### DELETE /api/glosas/:id
```json
Response: { "success": true }
```

## Pesquisa

### POST /api/pesquisar
```json
Request: {
    "filtros": {
        "status": [2, 3],
        "competencia": "12/2024",
        "data_inicio": "2024-12-01",
        "data_fim": "2024-12-31",
        "profissional": "Dr. Silva"
    }
}
Response: {
    "resultados": [...]
}
```

## Profissionais

### GET /api/profissionais
```json
Response: {
    "profissionais": [
        { "id": 1, "nome": "Dr. Silva", "especialidade": "Medicina" }
    ]
}
```

### POST /api/profissionais
```json
Request: { "nome": "Dr. Costa", "especialidade": "Medicina" }
```

### DELETE /api/profissionais/:id

## Backup

### GET /api/backup
Retorna arquivo SQLite para download

### GET /api/export/:formato
Formatos: csv, json
Retorna dados exportados no formato solicitado