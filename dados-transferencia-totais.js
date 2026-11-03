const { createHash, randomUUID } = require('node:crypto');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CAMPOS = ['concluidas', 'atualizacoesAutomaticas', 'finalizadasManualmente',
  'adicionadas', 'aguardandoRevisao', 'erros'];
const SITUACOES = new Set(['aguardandoRevisao', 'concluido', 'naoConfirmado', 'erro']);
const OPERACOES = new Set(['atualizar', 'adicionar', 'linkManual']);

function totaisVazios() { return Object.fromEntries(CAMPOS.map(campo => [campo, 0])); }
function somar(totais, outros) {
  for (const campo of CAMPOS) totais[campo] += outros[campo];
  return totais;
}
function contar(registros) {
  const totais = totaisVazios();
  for (const item of registros) {
    if (item.operacao === 'linkManual') continue;
    if (item.situacao === 'concluido') {
      totais.concluidas++;
      if (item.operacao === 'atualizar' && item.formaConclusao === 'automatico')
        totais.atualizacoesAutomaticas++;
      if (item.formaConclusao === 'manual') totais.finalizadasManualmente++;
      if (item.operacao === 'adicionar') totais.adicionadas++;
    } else if (item.situacao === 'aguardandoRevisao') totais.aguardandoRevisao++;
    else if (item.situacao === 'erro' || item.situacao === 'naoConfirmado') totais.erros++;
  }
  return totais;
}
function totaisValidos(valor) {
  return valor && CAMPOS.every(campo => Number.isSafeInteger(valor[campo]) &&
    valor[campo] >= 0 && valor[campo] <= 1_000_000) &&
    valor.atualizacoesAutomaticas <= valor.concluidas &&
    valor.finalizadasManualmente <= valor.concluidas && valor.adicionadas <= valor.concluidas;
}
function referencia(item) { return item.situacao === 'concluido' ? item.concluidoEm : item.criadoEm; }
function doDia(item, dia, dataLocal) {
  const instante = Date.parse(referencia(item));
  return Number.isFinite(instante) && dataLocal(instante) === dia;
}
function copiasTransferidas(estado, dia, dataLocal) {
  const grupos = new Map();
  for (const item of estado.registros) {
    if (!UUID.test(item.origemInstalacao || '') || !doDia(item, dia, dataLocal)) continue;
    if (!grupos.has(item.origemInstalacao)) grupos.set(item.origemInstalacao, []);
    grupos.get(item.origemInstalacao).push(item);
  }
  return grupos;
}
function lerTotaisImportados(estado, dia, dataLocal) {
  const resultado = new Map();
  const salvos = estado.totaisImportados?.[dia] || {};
  for (const [origem, item] of Object.entries(salvos)) {
    if (UUID.test(origem) && totaisValidos(item?.totais)) resultado.set(origem, item);
  }
  for (const [origem, registros] of copiasTransferidas(estado, dia, dataLocal)) {
    if (!resultado.has(origem)) resultado.set(origem, {
      totais:contar(registros), geradoEm:'1970-01-01T00:00:00.000Z', legado:true
    });
  }
  return resultado;
}
function exportarTotais(estado, instalacao, agora, { dataLocal, urlPublica }) {
  if (!UUID.test(instalacao)) throw new Error('Identificador local inválido.');
  const dia = dataLocal(agora);
  const locais = estado.registros.filter(item => !item.origemInstalacao && doDia(item, dia, dataLocal));
  const instantaneo = lerTotaisImportados(estado, dia, dataLocal);
  instantaneo.delete(instalacao);
  const estatisticas = [{ origem:instalacao, dia, totais:contar(locais),
    geradoEm:new Date(agora).toISOString() },
  ...[...instantaneo].map(([origem, valor]) => ({ origem, dia, totais:valor.totais,
    geradoEm:valor.geradoEm }))];
  const links = estado.registros.filter(item =>
    ['adicionar', 'linkManual'].includes(item.operacao) && item.situacao === 'concluido' &&
    doDia(item, dia, dataLocal) && urlPublica(item.urlOriginal)).map(item => ({
    origem:item.origemInstalacao || instalacao,
    id:item.origemRegistroId || item.id,
    url:urlPublica(item.urlOriginal),
    titulo:String(item.titulo || '').slice(0, 500),
    chapeu:String(item.chapeu || '').slice(0, 120),
    subtitulo:String(item.subtitulo || '').slice(0, 1000),
    concluidoEm:item.concluidoEm,
    ocultoSelecao:item.ocultoSelecao === true
  }));
  return { versao:2, instalacao, exportadoEm:new Date(agora).toISOString(), dia,
    estatisticas, links };
}
function normalizarLink(item, dia, helpers) {
  if (!item || !UUID.test(item.origem || '') || !UUID.test(item.id || '') ||
      typeof item.titulo !== 'string' || item.titulo.length > 500 ||
      typeof item.chapeu !== 'string' || item.chapeu.length > 120 ||
      typeof item.subtitulo !== 'string' || item.subtitulo.length > 1000 ||
      !Number.isFinite(Date.parse(item.concluidoEm)) ||
      helpers.dataLocal(item.concluidoEm) !== dia ||
      !item.url || helpers.urlPublica(item.url) !== item.url) return null;
  return { ...item, ocultoSelecao:item.ocultoSelecao === true };
}
function converterLegado(documento, helpers) {
  const grupos = new Map(), links = [], invalidos = { quantidade:0 };
  for (const bruto of documento.registros) {
    const origem = bruto?.origem?.instalacao, id = bruto?.origem?.registro;
    if (!UUID.test(origem || '') || !UUID.test(id || '') ||
        !OPERACOES.has(bruto.operacao) || !SITUACOES.has(bruto.situacao) ||
        !Number.isFinite(Date.parse(bruto.criadoEm)) ||
        (bruto.situacao === 'concluido' && !Number.isFinite(Date.parse(bruto.concluidoEm)))) {
      invalidos.quantidade++; continue;
    }
    if (!doDia(bruto, documento.dia, helpers.dataLocal)) continue;
    if (!grupos.has(origem)) grupos.set(origem, new Map());
    const grupo = grupos.get(origem);
    const anterior = grupo.get(id);
    if (!anterior || Date.parse(bruto.atualizadoEm) > Date.parse(anterior.atualizadoEm)) grupo.set(id, bruto);
  }
  const estatisticas = [...grupos].map(([origem, itens]) => ({
    origem, dia:documento.dia, totais:contar([...itens.values()]), geradoEm:documento.exportadoEm
  }));
  for (const [origem, itens] of grupos) for (const [id, bruto] of itens) {
    if (!['adicionar', 'linkManual'].includes(bruto.operacao) ||
        bruto.situacao !== 'concluido' || !bruto.urlOriginal) continue;
    links.push({ origem, id, url:bruto.urlOriginal,
      titulo:bruto.titulo, chapeu:bruto.chapeu, subtitulo:bruto.subtitulo,
      concluidoEm:bruto.concluidoEm, ocultoSelecao:bruto.ocultoSelecao });
  }
  return { estatisticas, links, invalidos:invalidos.quantidade };
}
function normalizarDocumento(documento, helpers) {
  if (!documento || ![1, 2].includes(documento.versao) ||
      !UUID.test(documento.instalacao || '') ||
      !Number.isFinite(Date.parse(documento.exportadoEm)) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(documento.dia || ''))
    throw new Error('Arquivo de dados inválido ou incompatível. Nenhum dado foi alterado.');
  if (documento.versao === 1) {
    if (!Array.isArray(documento.registros) || documento.registros.length > 5000)
      throw new Error('Arquivo antigo inválido. Nenhum dado foi alterado.');
    return converterLegado(documento, helpers);
  }
  if (!Array.isArray(documento.estatisticas) || documento.estatisticas.length > 200 ||
      !Array.isArray(documento.links) || documento.links.length > 5000)
    throw new Error('Arquivo de dados inválido. Nenhum dado foi alterado.');
  return { estatisticas:documento.estatisticas, links:documento.links, invalidos:0 };
}
function classificarTotais(documento, estado, instalacao, agora, helpers) {
  if (!UUID.test(instalacao)) throw new Error('Identificador local inválido.');
  const entrada = normalizarDocumento(documento, helpers);
  const hoje = helpers.dataLocal(agora);
  const resumo = { novosTotais:0, atualizadosTotais:0, novosLinks:0,
    repetidos:0, expirados:0, invalidos:entrada.invalidos, ambiguos:0, linksRepetidos:0 };
  const estatisticas = [], links = [];
  const existentes = lerTotaisImportados(estado, hoje, helpers.dataLocal);
  const vistas = new Map();
  // A prévia precisa mostrar o que o arquivo trouxe, o que já estava
  // contabilizado e o acréscimo real no painel, não só quantas origens mudaram.
  const recebidos = totaisVazios(), jaContabilizados = totaisVazios();
  const porOrigem = new Map();
  const arquivo = { instalacao:documento.instalacao, dia:documento.dia,
    exportadoEm:documento.exportadoEm, propria:documento.instalacao === instalacao };
  for (const bruto of entrada.estatisticas) {
    if (!bruto || !UUID.test(bruto.origem || '') ||
        !/^\d{4}-\d{2}-\d{2}$/.test(bruto.dia || '') ||
        !totaisValidos(bruto.totais) || !Number.isFinite(Date.parse(bruto.geradoEm))) {
      resumo.invalidos++; continue;
    }
    if (bruto.dia < hoje) { resumo.expirados++; continue; }
    if (bruto.dia !== hoje || bruto.dia !== documento.dia) { resumo.invalidos++; continue; }
    if (!porOrigem.has(bruto.origem)) {
      porOrigem.set(bruto.origem, bruto.totais);
      somar(recebidos, bruto.totais);
      const contabilizado = existentes.get(bruto.origem);
      if (contabilizado) somar(jaContabilizados, contabilizado.totais);
    }
    if (bruto.origem === instalacao) { resumo.repetidos++; continue; }
    if (vistas.has(bruto.origem)) {
      resumo.ambiguos++;
      const indice = estatisticas.findIndex(item => item.origem === bruto.origem);
      if (indice >= 0) {
        estatisticas.splice(indice, 1);
        if (existentes.has(bruto.origem)) resumo.atualizadosTotais--;
        else resumo.novosTotais--;
      }
      continue;
    }
    vistas.set(bruto.origem, true);
    const anterior = existentes.get(bruto.origem);
    if (!anterior && CAMPOS.every(campo => bruto.totais[campo] === 0)) {
      resumo.repetidos++;
      continue;
    }
    if (anterior && Date.parse(bruto.geradoEm) <= Date.parse(anterior.geradoEm)) {
      if (bruto.geradoEm === anterior.geradoEm &&
          JSON.stringify(bruto.totais) !== JSON.stringify(anterior.totais)) resumo.ambiguos++;
      else resumo.repetidos++;
      continue;
    }
    estatisticas.push(bruto);
    if (anterior) resumo.atualizadosTotais++; else resumo.novosTotais++;
  }
  const porId = new Set(estado.registros.filter(item => item.origemInstalacao)
    .map(item => `${item.origemInstalacao}:${item.origemRegistroId}`));
  const porUrl = new Set(estado.registros.map(item => helpers.urlPublica(item.urlOriginal)).filter(Boolean));
  for (const bruto of entrada.links) {
    const item = normalizarLink(bruto, documento.dia, helpers);
    if (!item) { resumo.invalidos++; continue; }
    if (documento.dia < hoje) { resumo.expirados++; continue; }
    if (documento.dia !== hoje) { resumo.invalidos++; continue; }
    const chave = `${item.origem}:${item.id}`;
    if (item.origem === instalacao || porId.has(chave) || porUrl.has(item.url)) {
      resumo.repetidos++; resumo.linksRepetidos++; continue;
    }
    porId.add(chave); porUrl.add(item.url);
    links.push(item); resumo.novosLinks++;
  }
  // O acréscimo é a diferença entre o total aceito e o que já estava gravado
  // para a mesma origem, para o painel nunca contar a mesma matéria duas vezes.
  const acrescimo = totaisVazios();
  for (const item of estatisticas) {
    const anterior = existentes.get(item.origem);
    for (const campo of CAMPOS) acrescimo[campo] += item.totais[campo] - (anterior?.totais[campo] || 0);
  }
  const assinatura = createHash('sha256').update(JSON.stringify({ estatisticas, links, resumo })).digest('hex');
  return { resumo, estatisticas, links, assinatura, arquivo, recebidos, jaContabilizados, acrescimo };
}
function aplicarTotais(estado, plano) {
  if (!estado.totaisImportados) estado.totaisImportados = {};
  for (const item of plano.estatisticas) {
    if (!estado.totaisImportados[item.dia]) estado.totaisImportados[item.dia] = {};
    estado.totaisImportados[item.dia][item.origem] = {
      totais:structuredClone(item.totais), geradoEm:item.geradoEm
    };
  }
  for (const item of plano.links) estado.registros.push({
    id:randomUUID(), chave:`importado:${item.origem}:${item.id}`,
    origemInstalacao:item.origem, origemRegistroId:item.id,
    operacao:'linkManual', situacao:'concluido', formaConclusao:null,
    titulo:item.titulo, chapeu:item.chapeu, subtitulo:item.subtitulo,
    urlOriginal:item.url, urlCms:'', criadoEm:item.concluidoEm,
    concluidoEm:item.concluidoEm, atualizadoEm:item.concluidoEm,
    responsavelId:null, ocultoSelecao:item.ocultoSelecao, motivoLinkPendente:''
  });
}
module.exports = { CAMPOS, totaisVazios, somar, contar, lerTotaisImportados,
  exportarTotais, classificarTotais, aplicarTotais };
