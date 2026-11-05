const URL_NEWS = 'https://redacao.tribunaweb.com.br/news';
const TITULO_REFERENCIA = 'Quanto foi o jogo Brasil x Japão hoje? Veja resultado dos gols';
const DATA_REFERENCIA = '14/10/2025';
const ORIGEM = new URL(URL_NEWS).origin;
const DATA = /\b\d{2}\/\d{2}\/\d{4}(?:\s*\d{2}:\d{2})?\b/;
const normalizar = texto => String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/×/g, 'x').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const idEdicao = url => /\/news\/(?:edit\/(\d+)|(\d+)\/edit)\/?$/i.exec(new URL(url).pathname)?.slice(1).find(Boolean) || '';

function analisarLinhas(linhas, { referenciaId = '', vistos = new Set() } = {}) {
  let quantidade = 0;
  for (const linha of linhas) {
    const titulo = String(linha.titulo || '').trim();
    if (!titulo) continue;
    const urls = [...new Set((linha.hrefs || []).flatMap(href => {
      try {
        const url = new URL(href, URL_NEWS);
        return url.origin === ORIGEM && idEdicao(url.href) ? [url.href] : [];
      } catch { return []; }
    }))];
    const id = urls.length === 1 ? idEdicao(urls[0]) : '';
    const referenciaPorId = Boolean(referenciaId && id === referenciaId);
    const referenciaPorTexto = normalizar(titulo).includes(normalizar(TITULO_REFERENCIA)) &&
      (!DATA.test(linha.data || '') || String(linha.data).match(DATA)[0].slice(0,10) === DATA_REFERENCIA);
    if (referenciaPorId || referenciaPorTexto)
      return { quantidade, encontrou:true, referenciaId:id || referenciaId, vistos };
    if (urls.length !== 1) throw new Error('A listagem contém matéria sem link de edição único antes da referência; a contagem não foi alterada.');
    if (!vistos.has(urls[0])) { vistos.add(urls[0]); quantidade++; }
  }
  return { quantidade, encontrou:false, referenciaId, vistos };
}

async function lerPagina(pagina) {
  return pagina.evaluate(() => {
    const visivel = elemento => elemento.getClientRects().length > 0 && getComputedStyle(elemento).visibility !== 'hidden';
    const tabelas = [...document.querySelectorAll('table')].filter(visivel)
      .map(tabela => ({ tabela, links:[...tabela.querySelectorAll('a[href]')]
        .filter(a => /\/news\/(?:edit\/\d+|\d+\/edit)/.test(a.getAttribute('href') || '')).length }))
      .sort((a,b) => b.links-a.links);
    const seletores = ['tr','[role="row"]','.list-group-item','.card','.row'];
    let linhas = tabelas[0]?.links ? [...tabelas[0].tabela.querySelectorAll('tr')].filter(item =>
      visivel(item) && item.querySelector('td')) : [];
    if (!linhas.length) for (const seletor of seletores) {
      const candidatas = [...document.querySelectorAll(seletor)].filter(item =>
        visivel(item) && item.querySelector('td,[role="cell"]'));
      if (candidatas.length) { linhas = candidatas; break; }
    }
    return linhas.map(linha => {
      const celulas = [...linha.querySelectorAll('td')];
      const texto = linha.innerText || '';
      const titulo = celulas.length > 7 ? celulas[7].innerText.trim() : texto.replace(/\s+/g,' ').trim();
      const acoes = celulas.length > 1 ? celulas[1] : linha;
      return { titulo, data:texto.match(/\b\d{2}\/\d{2}\/\d{4}(?:\s*\d{2}:\d{2})?\b/)?.[0] || '',
        hrefs:[...acoes.querySelectorAll('a[href]')].map(a => a.getAttribute('href')) };
    }).filter(item => item.titulo);
  });
}

async function aguardarListagem(pagina) {
  await pagina.waitForFunction(() => {
    const ocupado = [...document.querySelectorAll('.dataTables_processing,.dt-processing,table[aria-busy="true"]')]
      .some(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
    return !ocupado && [...document.querySelectorAll('tr,[role="row"]')]
      .some(el => el.getClientRects().length && el.querySelector('td,[role="cell"]'));
  }, undefined, { timeout:15000 });
}

async function filtrarPendentes(pagina) {
  const filtro = pagina.locator('#filterExtra');
  await filtro.waitFor({state:'visible',timeout:15000}).catch(() => {});
  if (await filtro.count() !== 1) throw new Error('Filtro de matérias pendentes não encontrado no CMS.');
  const opcoes = await filtro.locator('option').evaluateAll(lista => lista.map(item =>
    ({ valor:item.value, texto:item.textContent.trim() })));
  const opcao = opcoes.find(item => normalizar(item.texto) === 'com integracao sem edicao');
  if (!opcao) throw new Error('Opção “Com integração (sem edição)” não encontrada.');
  await filtro.selectOption(opcao.valor);
  let botao = pagina.getByRole('button',{name:/Filtrar/i}).filter({visible:true});
  if (!await botao.count()) botao = pagina.locator('button:has-text("Filtrar"),input[type="submit"][value*="Filtrar"]').filter({visible:true});
  if (await botao.count() !== 1) throw new Error('Botão Filtrar não identificado de forma única.');
  await botao.click();
  await pagina.waitForLoadState('networkidle',{timeout:15000}).catch(() => {});
  await aguardarListagem(pagina);
}

async function selecionarCem(pagina) {
  const candidatas = await pagina.locator('select').evaluateAll(lista => lista.map((el, indice) => ({ el, indice }))
    .filter(({el}) => el.getClientRects().length && !el.closest('dialog') &&
      [...el.options].some(op => op.value === '100' || op.textContent.trim() === '100'))
    .map(({el,indice}) => ({ indice, id:el.id, nome:el.name,
      valor:[...el.options].find(op => op.value === '100' || op.textContent.trim() === '100').value })));
  const preferidas = candidatas.filter(item => /(?:length|quantidade|pagina|page)/i.test(item.id+' '+item.nome));
  const lista = preferidas.length ? preferidas : candidatas;
  if (!lista.length) return false;
  if (lista.length !== 1) throw new Error('Controle de 100 matérias por página ambíguo.');
  const controle = pagina.locator('select').nth(lista[0].indice);
  if (await controle.inputValue() !== lista[0].valor) {
    await controle.selectOption(lista[0].valor);
    await pagina.waitForLoadState('networkidle',{timeout:15000}).catch(() => {});
    await aguardarListagem(pagina);
  }
  return true;
}

async function proximaPagina(pagina, assinatura) {
  const navegacao = pagina.locator('.pagination,.dataTables_paginate,.dt-paging,nav[aria-label*="pagina" i],nav[aria-label*="página" i]').filter({visible:true});
  const controle = navegacao.locator('a,button,[role="button"]').filter({hasText:/^(?:Pr[oó]xim[ao]|Next|›|»|>)$/i})
    .or(navegacao.locator('[rel="next"],[aria-label*="próxima" i],[aria-label*="next" i]')).filter({visible:true});
  const disponiveis = await controle.count();
  if (disponiveis !== 1) return false;
  if (await controle.first().evaluate(el => el.matches(':disabled') || Boolean(el.closest('.disabled,[aria-disabled="true"]')))) return false;
  await controle.first().click();
  await pagina.waitForFunction(anterior => {
    const ocupado = [...document.querySelectorAll('.dataTables_processing,.dt-processing,table[aria-busy="true"]')]
      .some(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
    const links = [...document.querySelectorAll('a[href]')].filter(el => el.getClientRects().length)
      .map(el => el.getAttribute('href')).filter(href => /\/news\/(?:edit\/\d+|\d+\/edit)/.test(href));
    return !ocupado && [...new Set(links)].sort().join('|') !== anterior;
  }, assinatura, {timeout:15000});
  return true;
}

function criarContadorPendentesCms(context, { agora = () => new Date() } = {}) {
  let estado = { quantidade:null, atualizadoEm:null, desatualizado:true, motivo:'Aguardando consulta ao CMS.' };
  let emAndamento = null, referenciaId = '';
  async function executar() {
    let pagina;
    try {
      // O painel também é aberto em contextos de teste ou sem login. Neles,
      // não cria uma segunda guia about:blank para uma consulta impossível.
      const paginaCmsAberta = context.pages().some(aberta => {
        try { const url = new URL(aberta.url()); return url.origin === ORIGEM && /^\/news(?:\/|$)/.test(url.pathname); }
        catch { return false; }
      });
      if (!(await context.cookies(URL_NEWS)).length && !paginaCmsAberta)
        throw new Error('Sessão do CMS indisponível. Faça login manualmente no navegador do AutoXS.');
      pagina = await context.newPage();
      await pagina.goto(URL_NEWS,{waitUntil:'domcontentloaded',timeout:20000});
      if (new URL(pagina.url()).origin !== ORIGEM || /\/login\b/.test(new URL(pagina.url()).pathname))
        throw new Error('Sessão do CMS indisponível. Faça login manualmente no navegador do AutoXS.');
      await filtrarPendentes(pagina);
      await selecionarCem(pagina);
      let quantidade = 0;
      const vistos = new Set(), assinaturas = new Set();
      for (let paginaNumero = 1; paginaNumero <= 50; paginaNumero++) {
        const linhas = await lerPagina(pagina);
        if (!linhas.length) throw new Error('Listagem vazia ou incompleta; não foi possível confirmar a contagem.');
        const assinatura = linhas.map(item => item.hrefs.join('|')).join(';');
        if (assinaturas.has(assinatura)) throw new Error('A paginação repetiu matérias; a contagem não foi alterada.');
        assinaturas.add(assinatura);
        const resultado = analisarLinhas(linhas,{referenciaId,vistos});
        quantidade += resultado.quantidade;
        if (resultado.encontrou) {
          referenciaId = resultado.referenciaId;
          return { quantidade, atualizadoEm:agora().toISOString(), desatualizado:false, motivo:'' };
        }
        const assinaturaLinks = [...new Set(linhas.flatMap(item => item.hrefs)
          .filter(href => /\/news\/(?:edit\/\d+|\d+\/edit)/.test(href)))].sort().join('|');
        if (!await proximaPagina(pagina, assinaturaLinks)) break;
      }
      throw new Error('Matéria de referência Brasil x Japão não encontrada na listagem filtrada.');
    } catch (erro) {
      return { ...estado, desatualizado:true, motivo:erro.message || 'Falha na consulta ao CMS.' };
    } finally { await pagina?.close().catch(() => {}); }
  }
  function consultar() {
    if (emAndamento) return emAndamento;
    emAndamento = executar().then(novo => { estado = novo; return { ...estado }; })
      .finally(() => { emAndamento = null; });
    return emAndamento;
  }
  return { consultar, estado:() => ({ ...estado }) };
}

module.exports = { criarContadorPendentesCms, analisarLinhas, selecionarCem, URL_NEWS };
