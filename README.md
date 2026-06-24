# SEFAZ Monitor Backend — tryideas

Backend Node.js que consulta os webservices SOAP da SEFAZ e detecta se a SVC (Sefaz Virtual de Contingência) está ativa para cada estado.

---

## Como rodar

### 1. Pré-requisitos
- Node.js 18+ instalado
- Acesso à internet (para consultar os webservices da SEFAZ)

### 2. Instalar dependências

```bash
npm install
```

### 3. Iniciar o servidor

```bash
# Produção
npm start

# Desenvolvimento (reinicia automaticamente ao salvar)
npm run dev
```

O servidor sobe em **http://localhost:3000**

---

## Endpoints

### `GET /api/health`
Verifica se o servidor está rodando.

```json
{ "ok": true, "ts": "2024-01-01T10:00:00.000Z" }
```

---

### `GET /api/status?uf=PR&doc=nfe`
Consulta o webservice de StatusServico da SEFAZ para uma UF e documento.

**Parâmetros:**
- `uf` — sigla do estado (AC, AL, AM... PR, RS, SP etc.)
- `doc` — tipo de documento: `nfe`, `nfce` ou `cte`

**Resposta:**
```json
{
  "uf": "PR",
  "doc": "nfe",
  "autorizador": "PR",
  "status": "normal",
  "label": "Em operação",
  "cStat": 107,
  "xMotivo": "Servico em Operacao",
  "latency": 312,
  "checkedAt": "2024-01-01T10:00:00.000Z"
}
```

**Valores de `status`:**
| status | significado |
|---|---|
| `normal` | cStat 107 — Serviço em operação |
| `contingencia` | cStat 108 — Paralisado temporariamente (SVC ativa) |
| `erro` | cStat 109 ou falha de conexão |
| `timeout` | Sem resposta em 8 segundos |
| `instavel` | Retornou mas com cStat inesperado |

---

### `GET /api/svc-status?uf=PR`
Retorna se a Sefaz Virtual de Contingência está ativa para o estado.

**Resposta:**
```json
{
  "uf": "PR",
  "svc": "SVC-RS",
  "active": false,
  "svcServerStatus": "normal",
  "checkedAt": "2024-01-01T10:00:00.000Z"
}
```

**Como funciona:**
- Para estados que usam **SVC-AN**: faz scraping do [Portal Nacional da NF-e](https://www.nfe.fazenda.gov.br/portal/principal.aspx) que publica oficialmente quais estados estão em contingência
- Para estados que usam **SVC-RS**: consulta o SOAP da SVC-RS diretamente + verifica o status individual de cada UF

**Mapeamento SVC:**
- **SVC-AN**: AC, AL, AP, CE, DF, ES, MG, PA, PB, PI, RJ, RN, RO, RR, RS, SC, SE, SP, TO
- **SVC-RS**: AM, BA, GO, MA, MS, MT, PE, PR

---

### `GET /api/all-status?doc=nfe`
Retorna o status de todos os 27 estados de uma vez. Útil para carregar o monitor completo.

---

### `GET /api/all-svc`
Retorna o status SVC de todos os estados de uma vez.

---

## Integração com o HTML do Monitor

No arquivo `monitor-sefaz-tryideas.html`, altere a constante `BACKEND_URL`:

```js
const BACKEND_URL = 'http://localhost:3000'; // em produção: https://seu-dominio.com
```

O HTML passará a consultar o backend nos endpoints acima ao invés de usar a API da WebmaniaBR diretamente.

---

## Cache

O backend mantém cache em memória:
- **Status SOAP** — 55 segundos (evita spam nos webservices da SEFAZ)
- **SVC-AN** (Portal NF-e) — 2 minutos
- **SVC-RS** — 2 minutos

---

## Deploy em produção

Recomendamos rodar com **PM2**:

```bash
npm install -g pm2
pm2 start server.js --name sefaz-monitor
pm2 save
pm2 startup
```

Ou via **Docker**:

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

---

## Observações técnicas

- Os webservices da SEFAZ usam certificados SSL legados — o backend desabilita a verificação `rejectUnauthorized` para aceitar esses certificados (comportamento seguro em ambiente controlado)
- O SOAP de `NFeStatusServico4` **não exige certificado digital** do cliente — apenas retorna o status atual do serviço
- O Portal Nacional da NF-e publica oficialmente os estados com SVC-AN ativa na página principal

---

Desenvolvido por [tryideas](https://tryideas.com.br)
