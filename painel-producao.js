const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { extrairDadosPublicacao, urlEdicao } = require('./url-publicacao-cms');
const { chaveTitulo, encontrarLinkPorTitulo } = require('./compartilhar-materias');

function dataDaUrl(url) {
  const match = /\/\d{4}\/\d{2}\/\d{2}\//.exec(new URL(url).pathname);
  return match ? match[0].slice(1, -1).replace(/\//g, '-') : '';
}

async function recuperarLinksPorCompartilhamento(historico, compartilhamento, alvoId = null,
  { sinal = null, progresso = null, limitePaginas = 10 } = {}) {
  if (!historico.publicadas || (!compartilhamento?.consultarPaginas && !compartilhamento?.consultarCandidatos)) return 0;
  const publicadas = await historico.publicadas();
  const pendentes = publicadas.filter(item => !item.urlOriginal && (!alvoId || item.id === alvoId));
  if (!pendentes.length || sinal?.aborted) return 0;
  const urlsOcupadas = new Set(publicadas.map(item => item.urlOriginal).filter(Boolean));
  const alvoUnico = pendentes.length === 1 &&
    !publicadas.some(outro => outro.id !== pendentes[0].id &&
      chaveTitulo(outro.titulo) === chaveTitulo(pendentes[0].titulo)) ? pendentes[0] : null;
  const pararQuando = alvoUnico ? candidatos => {
    const encontrado = encontrarLinkPorTitulo(alvoUnico.titulo, candidatos);
    if (!encontrado.url || urlsOcupadas.has(encontrado.url)) return false;
    const diaPublico = Date.parse(dataDaUrl(encontrado.url) + 'T12:00:00Z');
    const conclusao = new Date(alvoUnico.concluidoEm).getTime();
    return Number.isFinite(diaPublico) && Number.isFinite(conclusao) &&
      Math.abs(diaPublico - conclusao) <= 36 * 60 * 60 * 1000;
  } : null;
  let busca;
  try {
    busca = compartilhamento.consultarPaginas
      ? await compartilhamento.consultarPaginas({ limitePaginas, sinal, progresso, pararQuando })
      : { candidatos:await compartilhamento.consultarCandidatos(), paginasVisitadas:1, limiteAtingido:false };
  }
  catch (erro) {
    if (sinal?.aborted) return 0;
    for (const item of pendentes) await historico.registrarMotivoLink(item.id,
      'Não foi possível consultar a listagem pública de Links de matérias.', sinal);
    console.warn('[AUTOXS] Busca de links públicos: ' + erro.message);
    return 0;
  }
  if (sinal?.aborted || busca.cancelado) return 0;
  const candidatos = busca.candidatos;
  let recuperadas = 0;
  for (const item of pendentes) {
    if (sinal?.aborted) return recuperadas;
    const chave = chaveTitulo(item.titulo);
    let motivo = '';
    if (publicadas.some(outro => outro.id !== item.id && chaveTitulo(outro.titulo) === chave)) {
      motivo = 'Há títulos iguais no histórico; confira o link manualmente.';
    } else {
      const resultado = encontrarLinkPorTitulo(item.titulo, candidatos);
      motivo = resultado.motivo;
      if (motivo.includes('não encontrado')) {
        motivo = `Título não encontrado nas ${busca.paginasVisitadas} página(s) consultada(s)` +
          (busca.limiteAtingido ? `; limite de ${limitePaginas} páginas atingido.` : '.');
      }
      if (resultado.url && !motivo) {
        const dataPublica = dataDaUrl(resultado.url);
        const dataRegistro = new Date(item.concluidoEm);
        const diaPublico = Date.parse(dataPublica + 'T12:00:00Z');
        if (!Number.isFinite(diaPublico) || Math.abs(diaPublico - dataRegistro.getTime()) > 36 * 60 * 60 * 1000) {
          motivo = 'A data do link não corresponde à publicação registrada.';
        } else if (urlsOcupadas.has(resultado.url)) {
          motivo = 'Esta URL já está associada a outra matéria.';
        } else {
          try {
            if (sinal?.aborted) return recuperadas;
            await historico.definirUrlCompartilhamento(item.id, chave, resultado.url, sinal);
            urlsOcupadas.add(resultado.url);
            recuperadas++;
          } catch (erro) {
            if (sinal?.aborted) return recuperadas;
            motivo = erro.message;
          }
        }
      }
    }
    if (sinal?.aborted) return recuperadas;
    if (motivo) await historico.registrarMotivoLink(item.id, motivo, sinal);
  }
  return recuperadas;
}

async function recuperarLinksPendentes(historico, request) {
  if (!request?.get || !historico.pendentesRecuperaveis) return 0;
  let recuperadas = 0;
  for (const item of await historico.pendentesRecuperaveis()) {
    const urlCms = urlEdicao(item.urlCms);
    if (!urlCms || urlCms !== item.urlCms) continue;
    try {
      const resposta = await request.get(urlCms, { maxRedirects: 0, timeout: 10000 });
      if (resposta.status() !== 200 || urlEdicao(resposta.url()) !== urlCms) continue;
      const contentType = resposta.headers()['content-type'] || '';
      if (!/\b(?:html|json)\b/i.test(contentType)) continue;
      const dados = extrairDadosPublicacao({ urlResposta: resposta.url(),
        contentType, corpo: await resposta.text() });
      if (!dados.urlOriginal) continue;
      await historico.definirUrlRecuperada(item.id, urlCms, dados.urlOriginal);
      recuperadas++;
    } catch (erro) { console.warn('[AUTOXS] Não foi possível recuperar link da matéria ' + item.id + ': ' + erro.message); }
  }
  return recuperadas;
}

function criarBuscadorLinks(historico, compartilhamento, {
  limitePaginas = 10, atrasoPublicacaoMs = 3000, tentativasPublicacao = 3, intervaloTentativaMs = 15000
} = {}) {
  const limite = Number.isInteger(limitePaginas) && limitePaginas > 0 ? Math.min(limitePaginas, 100) : 10;
  const ativas = new Map();
  const ouvintes = new Set();
  function avisar(id, mensagem, estado) {
    const atual = ativas.get(id);
    if (atual) atual.mensagem = mensagem;
    for (const ouvinte of ouvintes) {
      try { ouvinte({ id, mensagem, estado }); } catch { /* A interface não interrompe a procura. */ }
    }
  }
  function aguardar(ms, sinal) {
    if (sinal.aborted) return Promise.resolve(false);
    return new Promise(resolve => {
      const concluir = resultado => { clearTimeout(timer); sinal.removeEventListener('abort', interromper); resolve(resultado); };
      const interromper = () => concluir(false);
      const timer = setTimeout(() => concluir(true), ms);
      sinal.addEventListener('abort', interromper, { once:true });
    });
  }
  function iniciar(id, { atrasoMs = 0, tentativas = 1, intervaloMs = 0 } = {}) {
    if (ativas.has(id)) throw new Error('A procura desta matéria já está em andamento.');
    const controlador = new AbortController();
    const tarefa = { controlador, promessa:null, mensagem:atrasoMs ? `Aguardando ${atrasoMs / 1000} segundos após a publicação…` : 'Procurando na página 1' };
    ativas.set(id, tarefa);
    const promessa = (async () => {
      if (atrasoMs) {
        avisar(id, tarefa.mensagem, 'procurando');
        if (!await aguardar(atrasoMs, controlador.signal)) return { recuperadas:0, cancelado:true };
      }
      for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
        if (controlador.signal.aborted) break;
        const pendente = (await historico.publicadas()).find(item => item.id === id && !item.urlOriginal);
        if (!pendente) break;
        if (tentativas > 1) avisar(id, `Tentativa ${tentativa}/${tentativas}: procurando na página 1`, 'procurando');
        else avisar(id, 'Procurando na página 1', 'procurando');
        const recuperadas = await recuperarLinksPorCompartilhamento(historico, compartilhamento, id, {
          sinal:controlador.signal, limitePaginas:limite,
          progresso:mensagem => avisar(id, mensagem, 'procurando')
        });
        if (recuperadas || controlador.signal.aborted) return { recuperadas, cancelado:controlador.signal.aborted };
        if (tentativa < tentativas) {
          avisar(id, `Link ainda indisponível. Nova tentativa em ${intervaloMs / 1000} segundos…`, 'procurando');
          if (!await aguardar(intervaloMs, controlador.signal)) break;
        }
      }
      return { recuperadas:0, cancelado:controlador.signal.aborted };
    })().finally(() => {
      const cancelado = controlador.signal.aborted;
      ativas.delete(id);
      avisar(id, cancelado ? 'Procura cancelada.' : 'Procura concluída.', cancelado ? 'cancelado' : 'concluido');
    });
    tarefa.promessa = promessa;
    return promessa;
  }
  function procurar(id) { return iniciar(id); }
  function agendarAposPublicacao(id) {
    if (ativas.has(id)) return ativas.get(id).promessa;
    return iniciar(id, { atrasoMs:atrasoPublicacaoMs, tentativas:tentativasPublicacao, intervaloMs:intervaloTentativaMs });
  }
  function cancelar(id) {
    const busca = ativas.get(id);
    if (!busca) return false;
    busca.controlador.abort();
    avisar(id, 'Cancelando procura…', 'cancelando');
    return true;
  }
  function cancelarTodas() { for (const id of ativas.keys()) cancelar(id); }
  async function procurarPendentes() {
    if (!historico.publicadas) return;
    for (const item of await historico.publicadas()) {
      if (item.urlOriginal || ativas.has(item.id)) continue;
      try { await procurar(item.id); }
      catch (erro) { console.warn('[AUTOXS] Procura automática: ' + erro.message); }
    }
  }
  function observar(ouvinte) { ouvintes.add(ouvinte); return () => ouvintes.delete(ouvinte); }
  return { procurar, agendarAposPublicacao, cancelar, cancelarTodas, procurarPendentes, observar,
    ativas:() => [...ativas].map(([id, valor]) => ({ id, mensagem:valor.mensagem })) };
}

function criarPainelProducao(context, historico, compartilhamento = null, buscadorExterno = null) {
  const url = pathToFileURL(path.join(__dirname, 'painel-producao.html')).href;
  const urlIntegrada = url + '?integrado=1';
  const buscador = buscadorExterno || criarBuscadorLinks(historico, compartilhamento);
  let pagina = null;
  let abrindo = null;
  let recuperando = null;
  async function recuperarPendentes() {
    if (recuperando) return recuperando;
    recuperando = buscador.procurarPendentes().finally(() => { recuperando = null; });
    return recuperando;
  }
  async function registrarOperacoes(alvo, origemValida) {
    await alvo.exposeBinding('operacaoProducao', async ({ frame }, entrada) => {
      if (!origemValida(frame) || !entrada || typeof entrada !== 'object') return { ok:false, mensagem:'Abra o painel de produção do AutoXS.' };
      try {
        let resultado;
        switch (entrada.acao) {
          case 'consultar': resultado = await historico.consultar(entrada.data); break;
          case 'materiasPorResponsavel': resultado = await historico.materiasPorResponsavel(entrada.data); break;
          case 'relatorio': resultado = await historico.relatorio(entrada.data); break;
          case 'responsavel': resultado = await historico.responsavel(entrada.id, entrada.responsavelId ?? null); break;
          case 'cadastrar': resultado = await historico.cadastrarResponsavel(entrada.nome); break;
          case 'editar': resultado = await historico.editarResponsavel(entrada.id, entrada.mudanca || {}); break;
          case 'removerResponsavel': resultado = await historico.removerResponsavel(entrada.id); break;
          case 'definirUrl': resultado = await historico.definirUrl(entrada.id, entrada.url); break;
          case 'compartilhavel': resultado = await historico.compartilhavel(entrada.id); break;
          case 'procurarLink': resultado = await buscador.procurar(entrada.id); break;
          case 'cancelarProcura': resultado = buscador.cancelar(entrada.id); break;
          default: throw new Error('Ação desconhecida.');
        }
        return { ok:true, resultado };
      } catch (erro) { return { ok:false, mensagem:erro.message || 'Não foi possível consultar o histórico.' }; }
    });
  }
  async function integrar(alvo) {
    const quadro = () => alvo.frames().find(frame => frame.parentFrame() === alvo.mainFrame() && frame.url() === urlIntegrada);
    await registrarOperacoes(alvo, frame => frame.parentFrame() === alvo.mainFrame() && frame.url() === urlIntegrada);
    let iniciouBusca = false;
    alvo.on('framenavigated', frame => {
      if (frame.parentFrame() !== alvo.mainFrame() || frame.url() !== urlIntegrada) return;
      void (async () => {
        await frame.waitForFunction(() => typeof window.atualizarProgressoProcura === 'function');
        for (const ativa of buscador.ativas()) {
          await frame.evaluate(dados => window.atualizarProgressoProcura?.(dados),
            { ...ativa, estado:'procurando' });
        }
        if (!iniciouBusca) {
          iniciouBusca = true;
          void recuperarPendentes().catch(erro => console.warn('[AUTOXS] Busca de links: ' + erro.message));
        }
      })().catch(erro => console.warn('[AUTOXS] Painel de produção: ' + erro.message));
    });
    const deixarDeObservar = historico.observar?.(() => {
      const frame = quadro();
      if (frame && !alvo.isClosed()) void frame.evaluate(() => window.atualizarProducao?.()).catch(() => {});
    });
    const deixarDeOuvirBusca = buscador.observar(evento => {
      const frame = quadro();
      if (frame && !alvo.isClosed()) void frame.evaluate(dados => window.atualizarProgressoProcura?.(dados), evento).catch(() => {});
    });
    alvo.on('close', () => { deixarDeObservar?.(); deixarDeOuvirBusca(); });
    return urlIntegrada;
  }
  async function abrir(aba = 'estatisticas') {
    if (pagina && !pagina.isClosed()) {
      await pagina.bringToFront();
      await pagina.evaluate(nome => window.mostrarAba(nome), aba);
      void recuperarPendentes().catch(erro => console.warn('[AUTOXS] Busca de links: ' + erro.message));
      return pagina;
    }
    if (abrindo) return abrindo;
    abrindo = (async () => {
      const nova = await context.newPage();
      const origemValida = frame => frame === nova.mainFrame() && frame.url() === url;
      try {
        await registrarOperacoes(nova, origemValida);
        await nova.goto(url);
        pagina = nova;
        const deixarDeObservar = historico.observar?.(() => {
          if (!nova.isClosed()) void nova.evaluate(() => window.atualizarProducao?.()).catch(() => {});
        });
        const deixarDeOuvirBusca = buscador.observar(evento => {
          if (!nova.isClosed()) void nova.evaluate(dados => window.atualizarProgressoProcura?.(dados), evento).catch(() => {});
        });
        nova.on('close', () => { deixarDeObservar?.(); deixarDeOuvirBusca(); });
        await pagina.evaluate(nome => window.mostrarAba(nome), aba);
        for (const ativa of buscador.ativas()) {
          await pagina.evaluate(dados => window.atualizarProgressoProcura?.(dados),
            { ...ativa, estado:'procurando' }).catch(() => {});
        }
        await pagina.bringToFront();
        void recuperarPendentes().catch(erro => console.warn('[AUTOXS] Busca de links: ' + erro.message));
        return pagina;
      } catch (erro) { await nova.close().catch(() => {}); throw erro; }
    })().finally(() => { abrindo = null; });
    return abrindo;
  }
  return { abrir, integrar };
}

module.exports = { criarPainelProducao, recuperarLinksPendentes, recuperarLinksPorCompartilhamento, criarBuscadorLinks };
