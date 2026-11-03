const { randomUUID } = require('node:crypto');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SITUACOES = new Set(['aguardandoRevisao', 'concluido', 'naoConfirmado', 'erro']);
const OPERACOES = new Set(['atualizar', 'adicionar', 'linkManual']);

function cmsId(item) {
  if (typeof item.cmsId === 'string' && /^\d{1,15}$/.test(item.cmsId)) return item.cmsId;
  const origem = String(item.urlCms || item.chave || '');
  return origem.match(/\/news\/(?:edit\/(\d+)|(\d+)\/edit)(?:[/?#]|$)/i)?.slice(1).find(Boolean) || null;
}
function referencia(item) { return item.situacao === 'concluido' ? item.concluidoEm : item.criadoEm; }
function identidadePublica(url, validarUrl) {
  const publica = validarUrl(url);
  return publica ? new URL(publica).pathname.replace(/\/$/, '') : null;
}
function chaves(item, validarUrl) {
  const resultado = [];
  const publico = identidadePublica(item.urlOriginal, validarUrl);
  if (publico) resultado.push(`publico:${publico}`);
  const cms = cmsId(item);
  if (cms) resultado.push(`cms:${cms}`);
  if (item.origemInstalacao && item.origemRegistroId)
    resultado.push(`origem:${item.origemInstalacao}:${item.origemRegistroId}`);
  return resultado;
}
function exportarRegistros(estado, instalacao, agora, { dataLocal, urlPublica }) {
  const hoje = dataLocal(agora);
  return { versao:1, instalacao, exportadoEm:new Date(agora).toISOString(), dia:hoje,
    registros:estado.registros.filter(item => {
      const data = Date.parse(referencia(item));
      return Number.isFinite(data) && dataLocal(data) === hoje;
    }).map(item => ({
      origem:{ instalacao:item.origemInstalacao || instalacao,
        registro:item.origemRegistroId || item.id },
      operacao:item.operacao, situacao:item.situacao,
      formaConclusao:item.formaConclusao || null,
      criadoEm:item.criadoEm, concluidoEm:item.concluidoEm || null,
      atualizadoEm:item.origemAtualizadoEm || item.atualizadoEm || item.criadoEm,
      titulo:String(item.titulo || '').slice(0, 500),
      chapeu:String(item.chapeu || '').slice(0, 120),
      subtitulo:String(item.subtitulo || '').slice(0, 1000),
      urlOriginal:['adicionar', 'linkManual'].includes(item.operacao) ? urlPublica(item.urlOriginal) : '',
      cmsId:cmsId(item), ocultoSelecao:item.ocultoSelecao === true
    })) };
}
function validarDocumento(documento) {
  if (!documento || documento.versao !== 1 || !UUID.test(documento.instalacao || '') ||
      !Array.isArray(documento.registros) || documento.registros.length > 5000 ||
      !Number.isFinite(Date.parse(documento.exportadoEm)) || !/^\d{4}-\d{2}-\d{2}$/.test(documento.dia || ''))
    throw new Error('Arquivo de dados inválido ou incompatível. Nenhum registro foi alterado.');
  return documento;
}
function normalizarRegistro(item, { urlPublica }) {
  if (!item || !UUID.test(item.origem?.instalacao || '') || !UUID.test(item.origem?.registro || '') ||
      !OPERACOES.has(item.operacao) || !SITUACOES.has(item.situacao) ||
      !Number.isFinite(Date.parse(item.criadoEm)) ||
      (item.situacao === 'concluido' && !Number.isFinite(Date.parse(item.concluidoEm))) ||
      typeof item.titulo !== 'string' || item.titulo.length > 500 ||
      typeof item.chapeu !== 'string' || item.chapeu.length > 120 ||
      typeof item.subtitulo !== 'string' || item.subtitulo.length > 1000 ||
      (item.cmsId !== null && item.cmsId !== undefined && !/^\d{1,15}$/.test(item.cmsId)) ||
      (item.urlOriginal && urlPublica(item.urlOriginal) !== item.urlOriginal)) return null;
  if (item.operacao === 'linkManual' && (item.situacao !== 'concluido' || !item.urlOriginal)) return null;
  if (item.situacao === 'concluido' && item.operacao !== 'linkManual' &&
      !['manual', 'automatico'].includes(item.formaConclusao)) return null;
  return {
    origemInstalacao:item.origem.instalacao, origemRegistroId:item.origem.registro,
    operacao:item.operacao, situacao:item.situacao,
    formaConclusao:item.formaConclusao || null,
    criadoEm:item.criadoEm, concluidoEm:item.concluidoEm || null,
    atualizadoEm:Number.isFinite(Date.parse(item.atualizadoEm)) ? item.atualizadoEm : item.criadoEm,
    titulo:item.titulo, chapeu:item.chapeu, subtitulo:item.subtitulo,
    urlOriginal:item.urlOriginal || '', cmsId:item.cmsId || null,
    ocultoSelecao:item.ocultoSelecao === true
  };
}
function classificarImportacao(documento, estado, agora, helpers) {
  validarDocumento(documento);
  const hoje = helpers.dataLocal(agora);
  const existentes = new Map();
  const adicionarChaves = item => {
    for (const chave of chaves(item, helpers.urlPublica)) {
      if (!existentes.has(chave)) existentes.set(chave, []);
      existentes.get(chave).push(item);
    }
  };
  estado.registros.forEach(adicionarChaves);
  const resumo = { novos:0, atualizados:0, repetidos:0, expirados:0, invalidos:0, ambiguos:0 };
  const novos = [];
  const atualizacoes = [];
  for (const bruto of documento.registros) {
    const item = normalizarRegistro(bruto, helpers);
    if (!item) { resumo.invalidos++; continue; }
    const instante = Date.parse(referencia(item));
    const dia = helpers.dataLocal(instante);
    if (dia < hoje) { resumo.expirados++; continue; }
    if (dia > hoje || dia !== documento.dia) { resumo.invalidos++; continue; }
    const chavesItem = chaves(item, helpers.urlPublica);
    const pares = new Set(chavesItem.flatMap(chave => existentes.get(chave) || []));
    if (pares.size > 1) { resumo.ambiguos++; continue; }
    if (pares.size === 1) {
      const existente = [...pares][0];
      if (existente.origemInstalacao === item.origemInstalacao &&
          existente.origemRegistroId === item.origemRegistroId &&
          existente.atualizadoEm === existente.origemAtualizadoEm &&
          Date.parse(item.atualizadoEm) > Date.parse(existente.origemAtualizadoEm) &&
          existente.situacao !== 'concluido') {
        atualizacoes.push({ existente, item });
        resumo.atualizados++;
      } else resumo.repetidos++;
      continue;
    }
    if (!chavesItem.some(chave => chave.startsWith('publico:') || chave.startsWith('cms:'))) {
      resumo.ambiguos++; continue;
    }
    const convertido = { ...item, id:randomUUID(),
      chave:`importado:${item.origemInstalacao}:${item.origemRegistroId}`,
      urlCms:'', responsavelId:null, motivoLinkPendente:'', origemAtualizadoEm:item.atualizadoEm };
    novos.push(convertido);
    adicionarChaves(convertido);
    resumo.novos++;
  }
  return { resumo, novos, atualizacoes };
}

module.exports = { exportarRegistros, validarDocumento, classificarImportacao, cmsId };
