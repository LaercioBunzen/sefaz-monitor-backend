/**
 * sefaz-monitor-backend — server.js
 * Tryideas — Monitor SEFAZ
 *
 * Endpoints:
 *   GET /api/status?uf=PR&doc=nfe     → status do webservice de autorização
 *   GET /api/svc-status?uf=PR         → se a SVC está ativa para o estado
 *   GET /api/all-status?doc=nfe       → status de todos os estados de uma vez
 *   GET /api/health                   → healthcheck
 */

const express  = require('express');
const cors     = require('cors');
const axios    = require('axios');
const https    = require('https');
const xml2js   = require('xml2js');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

/* ─────────────────────────────────────────
   MAPEAMENTO DE ENDPOINTS SOAP DA SEFAZ
   Fonte: https://www.nfe.fazenda.gov.br/portal/webServices.aspx
   Serviço consultado: NFeStatusServico4 (não exige certificado)
───────────────────────────────────────── */
const SOAP_ENDPOINTS = {
  nfe: {
    AM:   'https://nfe.sefaz.am.gov.br/services2/services/NfeStatusServico4',
    BA:   'https://nfe.sefaz.ba.gov.br/webservices/NFeStatusServico4/NFeStatusServico4.asmx',
    GO:   'https://nfe.sefaz.go.gov.br/nfe/services/NfeStatusServico4',
    MG:   'https://nfe.fazenda.mg.gov.br/nfe2/services/NFeStatusServico4',
    MS:   'https://nfe.fazenda.ms.gov.br/ws/NFeStatusServico4',
    MT:   'https://nfews.sefaz.mt.gov.br/nfews/v2/services/NfeStatusServico4',
    PE:   'https://nfe.sefaz.pe.gov.br/nfe-service/services/NFeStatusServico4',
    PR:   'https://nfe.fazenda.pr.gov.br/nfe/services/NFeStatusServico4',
    RS:   'https://nfe.sefaz.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
    SP:   'https://nfe.fazenda.sp.gov.br/ws/nfestatusservico4.asmx',
    SVRS: 'https://nfe.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
    SVAN: 'https://www.sefazvirtual.fazenda.gov.br/NFeStatusServico4/NFeStatusServico4.asmx',
    // SVC
    'SVC-AN': 'https://www.sefazvirtual.fazenda.gov.br/NFeStatusServico4/NFeStatusServico4.asmx',
    'SVC-RS': 'https://nfe.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
  },
  nfce: {
    AM:   'https://nfe.sefaz.am.gov.br/services2/services/NfceStatusServico4',
    GO:   'https://nfe.sefaz.go.gov.br/nfe/services/NfceStatusServico4',
    MG:   'https://nfe.fazenda.mg.gov.br/nfe2/services/NfceStatusServico4',
    MS:   'https://nfe.fazenda.ms.gov.br/ws/NfceStatusServico4',
    MT:   'https://nfews.sefaz.mt.gov.br/nfews/v2/services/NfceStatusServico4',
    PE:   'https://nfe.sefaz.pe.gov.br/nfe-service/services/NfceStatusServico4',
    PR:   'https://nfe.fazenda.pr.gov.br/nfe/services/NfceStatusServico4',
    RS:   'https://nfe.sefaz.rs.gov.br/ws/NfceStatusServico/NfceStatusServico4.asmx',
    SP:   'https://nfe.fazenda.sp.gov.br/ws/nfcestatusservico4.asmx',
    SVRS: 'https://nfe.svrs.rs.gov.br/ws/NfceStatusServico/NfceStatusServico4.asmx',
  },
  cte: {
    AM:   'https://nfe.sefaz.am.gov.br/services2/services/CteStatusServico4',
    MG:   'https://cte.fazenda.mg.gov.br/cte/services/CteStatusServico4',
    MS:   'https://cte.fazenda.ms.gov.br/ws/CteStatusServico4',
    MT:   'https://cte.sefaz.mt.gov.br/cte/services/CteStatusServico4',
    PR:   'https://nfe.fazenda.pr.gov.br/cte/services/CteStatusServico4',
    RS:   'https://cte.sefaz.rs.gov.br/ws/CteStatusServico/CteStatusServico4.asmx',
    SP:   'https://nfe.fazenda.sp.gov.br/cteWEB/services/CteStatusServico4',
    SVRS: 'https://cte.svrs.rs.gov.br/ws/CteStatusServico/CteStatusServico4.asmx',
  },
};

/* UFs que roteiam pelo autorizador virtual para NF-e */
const SVRS_NFE = ['AC','AL','AP','CE','DF','ES','PA','PB','PI','RJ','RN','RO','RR','SC','SE','TO'];
const SVAN_NFE = ['MA'];

/* Mapeamento SVC (contingência) */
const SVC_MAP = {
  AC:'SVC-AN', AL:'SVC-AN', AP:'SVC-AN', CE:'SVC-AN', DF:'SVC-AN',
  ES:'SVC-AN', MG:'SVC-AN', PA:'SVC-AN', PB:'SVC-AN', PI:'SVC-AN',
  RJ:'SVC-AN', RN:'SVC-AN', RO:'SVC-AN', RR:'SVC-AN', RS:'SVC-AN',
  SC:'SVC-AN', SE:'SVC-AN', SP:'SVC-AN', TO:'SVC-AN',
  AM:'SVC-RS', BA:'SVC-RS', GO:'SVC-RS', MA:'SVC-RS', MS:'SVC-RS',
  MT:'SVC-RS', PE:'SVC-RS', PR:'SVC-RS',
};

function resolveAutorizador(uf, doc) {
  if (doc === 'nfe') {
    if (SVRS_NFE.includes(uf)) return 'SVRS';
    if (SVAN_NFE.includes(uf)) return 'SVAN';
  }
  return uf;
}

/* ─────────────────────────────────────────
   SOAP: monta o envelope de NFeStatusServico4
───────────────────────────────────────── */
function buildSoapEnvelope(cUF, doc) {
  const service = doc === 'cte' ? 'cteStatusServicoNF' : 'nfeStatusServicoNF';
  const xmlns   = doc === 'cte'
    ? 'http://www.portalfiscal.inf.br/cte'
    : 'http://www.portalfiscal.inf.br/nfe';

  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope
  xmlns:soapenv="http://www.w3.org/2003/05/soap-envelope"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <soapenv:Header/>
  <soapenv:Body>
    <nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4">
      <consStatServ versao="4.00" xmlns="${xmlns}">
        <tpAmb>1</tpAmb>
        <cUF>${cUF}</cUF>
        <xServ>STATUS</xServ>
      </consStatServ>
    </nfeDadosMsg>
  </soapenv:Body>
</soapenv:Envelope>`;
}

/* Código IBGE da UF */
const UF_CODE = {
  AC:12, AL:27, AM:13, AP:16, BA:29, CE:23, DF:53, ES:32,
  GO:52, MA:21, MG:31, MS:50, MT:51, PA:15, PB:25, PE:26,
  PI:22, PR:41, RJ:33, RN:24, RO:11, RR:14, RS:43, SC:42,
  SE:28, SP:35, TO:17,
  SVRS:43, SVAN:91, 'SVC-AN':91, 'SVC-RS':43,
};

/* ─────────────────────────────────────────
   STATUS CODES da SEFAZ
  107 = Serviço em Operação (normal)
  108 = Serviço Paralisado Temporariamente (contingência ativa)
  109 = Serviço Paralisado sem Previsão (fora do ar)
  outros = erro/desconhecido
───────────────────────────────────────── */
function interpretCStat(cStat, xMotivo) {
  const code = parseInt(cStat, 10);
  if (code === 107) return { status: 'normal',      label: 'Em operação',           cStat: code, xMotivo };
  if (code === 108) return { status: 'contingencia', label: 'Paralisado temporário', cStat: code, xMotivo };
  if (code === 109) return { status: 'erro',         label: 'Paralisado',            cStat: code, xMotivo };
  return               { status: 'instavel',      label: xMotivo || 'Instável',   cStat: code, xMotivo };
}

/* ─────────────────────────────────────────
   Consulta SOAP para um autorizador
───────────────────────────────────────── */
async function querySoapStatus(autorizador, doc, timeoutMs = 8000) {
  const endpoints = SOAP_ENDPOINTS[doc] || SOAP_ENDPOINTS.nfe;
  const url = endpoints[autorizador];
  if (!url) return { status: 'desconhecido', label: 'Endpoint não mapeado', cStat: null, xMotivo: null };

  const cUF  = UF_CODE[autorizador] || 91;
  const body = buildSoapEnvelope(cUF, doc);

  const agent = new https.Agent({ rejectUnauthorized: false }); // SEFAZ usa certificados legados

  const start = Date.now();
  try {
    const resp = await axios.post(url, body, {
      headers: {
        'Content-Type': 'application/soap+xml; charset=UTF-8',
        'SOAPAction': '',
      },
      httpsAgent: agent,
      timeout: timeoutMs,
    });

    const latency = Date.now() - start;
    const parsed  = await xml2js.parseStringPromise(resp.data, { explicitArray: false });

    // Navega pelo XML de retorno (estrutura pode variar por UF)
    const body    = parsed?.['soapenv:Envelope']?.['soapenv:Body']
                 || parsed?.['env:Envelope']?.['env:Body']
                 || parsed?.['soap:Envelope']?.['soap:Body']
                 || {};

    // Pega o primeiro valor com chave que contenha "nfeResultMsg"
    const resultKey = Object.keys(body).find(k => k.includes('ResultMsg') || k.includes('resultMsg'));
    const result    = resultKey ? body[resultKey] : body;

    // Extrai retConsStatServ
    const ret = result?.retConsStatServ
             || result?.['nfe:retConsStatServ']
             || result?.['cte:retConsStatServ']
             || Object.values(result || {}).find(v => v?.cStat)
             || {};

    const cStat   = ret?.cStat   || ret?.['_'] || null;
    const xMotivo = ret?.xMotivo || null;

    if (!cStat) {
      return { status: 'instavel', label: 'Sem retorno SOAP', cStat: null, xMotivo: null, latency };
    }

    return { ...interpretCStat(cStat, xMotivo), latency };
  } catch (err) {
    const latency = Date.now() - start;
    if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
      return { status: 'timeout', label: 'Timeout (> 8s)', cStat: null, xMotivo: null, latency };
    }
    return { status: 'erro', label: err.message?.slice(0, 80) || 'Erro de conexão', cStat: null, xMotivo: null, latency };
  }
}

/* ─────────────────────────────────────────
   SVC-AN: scraping do Portal Nacional da NF-e
   A página oficial lista os estados com contingência ativa
───────────────────────────────────────── */
let svcAnCache = { activatedUFs: [], fetchedAt: null };

async function fetchSVCAnStatus() {
  // Cache de 2 minutos
  if (svcAnCache.fetchedAt && Date.now() - svcAnCache.fetchedAt < 120_000) {
    return svcAnCache;
  }
  try {
    const resp = await axios.get('https://www.nfe.fazenda.gov.br/portal/principal.aspx', {
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SEFAZMonitor/1.0)' },
    });
    const html = resp.data;

    // Procura pelo bloco "Contingência Ativada na SVC-AN"
    const match = html.match(/Conting[eê]ncia\s+Ativada.*?SVC[- ]?AN.*?<\/tr>([\s\S]*?)<\/table>/i);
    const activatedUFs = [];

    if (match) {
      const tableContent = match[1];
      // Extrai siglas de UF (2 letras maiúsculas)
      const ufs = tableContent.match(/\b([A-Z]{2})\b/g) || [];
      ufs.forEach(uf => {
        if (SVC_MAP[uf] === 'SVC-AN') activatedUFs.push(uf);
      });
    }

    svcAnCache = { activatedUFs, fetchedAt: Date.now() };
  } catch (e) {
    console.error('Erro ao buscar SVC-AN status:', e.message);
    // Mantém cache anterior se disponível, ou retorna vazio
    if (!svcAnCache.fetchedAt) svcAnCache = { activatedUFs: [], fetchedAt: Date.now() };
  }
  return svcAnCache;
}

/* ─────────────────────────────────────────
   SVC-RS: consulta direta ao webservice da SVC-RS
   e ao endpoint da SEFAZ-RS nfe-svc.aspx
───────────────────────────────────────── */
let svcRsCache = { activatedUFs: [], fetchedAt: null };

async function fetchSVCRsStatus() {
  if (svcRsCache.fetchedAt && Date.now() - svcRsCache.fetchedAt < 120_000) {
    return svcRsCache;
  }
  const activatedUFs = [];

  // Estratégia 1: consulta SOAP ao webservice da SVC-RS para cada UF que usa SVC-RS
  const svcRsUFs = Object.entries(SVC_MAP)
    .filter(([, svc]) => svc === 'SVC-RS')
    .map(([uf]) => uf);

  // Verifica status do SVC-RS consultando o próprio autorizador
  const svcRsResult = await querySoapStatus('SVC-RS', 'nfe', 6000);

  if (svcRsResult.status === 'contingencia') {
    // Se a própria SVC-RS retorna cStat 108, ela está ativada
    svcRsUFs.forEach(uf => activatedUFs.push(uf));
  } else {
    // Estratégia 2: consulta status do servidor de cada UF individualmente
    // Se o servidor da UF retorna 108 (paralisado), a SVC provavelmente está ativa
    await Promise.allSettled(
      svcRsUFs.map(async uf => {
        const autorizador = resolveAutorizador(uf, 'nfe');
        if (autorizador === uf) { // UF tem servidor próprio
          const result = await querySoapStatus(uf, 'nfe', 5000);
          if (result.cStat === 108 || result.status === 'contingencia') {
            activatedUFs.push(uf);
          }
        }
      })
    );
  }

  svcRsCache = { activatedUFs, fetchedAt: Date.now(), svcRsStatus: svcRsResult };
  return svcRsCache;
}

/* ─────────────────────────────────────────
   CACHE de status por UF/doc
───────────────────────────────────────── */
const statusCache = new Map(); // key: "uf-doc", value: { data, fetchedAt }
const CACHE_TTL   = 55_000;   // 55 segundos

async function getStatusCached(uf, doc) {
  const key = `${uf}-${doc}`;
  const cached = statusCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) return cached.data;

  const autorizador = resolveAutorizador(uf, doc);
  const result      = await querySoapStatus(autorizador, doc);

  const data = {
    uf,
    doc,
    autorizador,
    ...result,
    checkedAt: new Date().toISOString(),
  };
  statusCache.set(key, { data, fetchedAt: Date.now() });
  return data;
}

/* ─────────────────────────────────────────
   ROTAS
───────────────────────────────────────── */

/** GET /api/health */
app.get('/api/health', (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

/**
 * GET /api/status?uf=PR&doc=nfe
 * Retorna o status do webservice de autorização para uma UF e tipo de documento.
 *
 * Resposta:
 * {
 *   uf: "PR",
 *   doc: "nfe",
 *   autorizador: "PR",
 *   status: "normal" | "contingencia" | "instavel" | "erro" | "timeout",
 *   label: "Em operação",
 *   cStat: 107,
 *   xMotivo: "Servico em Operacao",
 *   latency: 312,
 *   checkedAt: "2024-01-01T10:00:00.000Z"
 * }
 */
app.get('/api/status', async (req, res) => {
  const uf  = (req.query.uf  || 'PR').toUpperCase();
  const doc = (req.query.doc || 'nfe').toLowerCase();

  if (!['nfe','nfce','cte'].includes(doc)) {
    return res.status(400).json({ error: 'doc deve ser nfe, nfce ou cte' });
  }

  try {
    const data = await getStatusCached(uf, doc);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/svc-status?uf=PR
 * Retorna se a Sefaz Virtual de Contingência está ativa para a UF.
 *
 * Resposta:
 * {
 *   uf: "PR",
 *   svc: "SVC-RS",
 *   active: true | false,
 *   svcServerStatus: "normal" | "instavel" | ...,
 *   checkedAt: "..."
 * }
 */
app.get('/api/svc-status', async (req, res) => {
  const uf = (req.query.uf || 'PR').toUpperCase();
  const svc = SVC_MAP[uf];

  if (!svc) {
    return res.json({
      uf,
      svc: null,
      active: false,
      note: 'Este estado é o próprio autorizador virtual ou não tem SVC mapeado',
      checkedAt: new Date().toISOString(),
    });
  }

  try {
    let active = false;
    let svcServerStatus = 'desconhecido';
    let activatedUFs = [];

    if (svc === 'SVC-AN') {
      const anData = await fetchSVCAnStatus();
      activatedUFs = anData.activatedUFs;
      active = activatedUFs.includes(uf);
      // Também consulta o servidor SVC-AN diretamente
      const anResult = await querySoapStatus('SVC-AN', 'nfe', 6000);
      svcServerStatus = anResult.status;
    } else {
      const rsData = await fetchSVCRsStatus();
      activatedUFs = rsData.activatedUFs;
      active = activatedUFs.includes(uf);
      svcServerStatus = rsData.svcRsStatus?.status || 'desconhecido';
    }

    res.json({
      uf,
      svc,
      active,
      svcServerStatus,
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/all-status?doc=nfe
 * Retorna o status de todos os estados de uma vez.
 * Útil para a tela inicial do monitor.
 */
const ALL_UFS = [
  'AC','AL','AM','AP','BA','CE','DF','ES','GO',
  'MA','MG','MS','MT','PA','PB','PE','PI','PR',
  'RJ','RN','RO','RR','RS','SC','SE','SP','TO',
];

app.get('/api/all-status', async (req, res) => {
  const doc = (req.query.doc || 'nfe').toLowerCase();

  try {
    // Busca em paralelo, limitando a 8 simultâneos para não sobrecarregar
    const results = {};
    const chunks  = [];
    for (let i = 0; i < ALL_UFS.length; i += 8) chunks.push(ALL_UFS.slice(i, i + 8));

    for (const chunk of chunks) {
      await Promise.allSettled(
        chunk.map(async uf => {
          try {
            results[uf] = await getStatusCached(uf, doc);
          } catch {
            results[uf] = { uf, doc, status: 'erro', label: 'Erro', latency: null, checkedAt: new Date().toISOString() };
          }
        })
      );
    }

    res.json({ doc, results, checkedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/all-svc
 * Retorna o status SVC de todos os estados de uma vez.
 */
app.get('/api/all-svc', async (req, res) => {
  try {
    const [anData, rsData] = await Promise.all([fetchSVCAnStatus(), fetchSVCRsStatus()]);

    const result = {};
    ALL_UFS.forEach(uf => {
      const svc = SVC_MAP[uf];
      if (!svc) { result[uf] = { svc: null, active: false }; return; }
      const activated = svc === 'SVC-AN' ? anData.activatedUFs : rsData.activatedUFs;
      result[uf] = { svc, active: activated.includes(uf) };
    });

    res.json({ result, checkedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────
   START
───────────────────────────────────────── */
app.listen(PORT, () => {
  console.log(`\n✅  SEFAZ Monitor Backend — tryideas`);
  console.log(`   Rodando em http://localhost:${PORT}`);
  console.log(`\n   Endpoints disponíveis:`);
  console.log(`   GET /api/health`);
  console.log(`   GET /api/status?uf=PR&doc=nfe`);
  console.log(`   GET /api/svc-status?uf=PR`);
  console.log(`   GET /api/all-status?doc=nfe`);
  console.log(`   GET /api/all-svc\n`);
});
