function categoriaDaUrlSertao(urlSertao) {
  try {
    const url = new URL(urlSertao);
    const partes = url.pathname.split('/').filter(Boolean);
    const categoria = partes[0];
    if (url.protocol === 'https:' &&
        url.hostname.replace(/^www\./i, '').toLowerCase() === 'tribunadosertao.com.br' &&
        partes.length === 5 &&
        categoria.length <= 60 &&
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(categoria) &&
        /^\d{4}$/.test(partes[1]) &&
        /^\d{2}$/.test(partes[2]) &&
        /^\d{2}$/.test(partes[3]) &&
        /^\d+-[^/]+$/.test(partes[4])) return categoria;
  } catch {}
  // Fallback temporário: não foi possível determinar a categoria pela URL do Sertão.
  return 'cidades';
}

function validarHrefAgreste(valor, categoria) {
  try {
    const url = new URL(valor);
    const partes = url.pathname.split('/').filter(Boolean);
    if (url.protocol !== 'https:' ||
        url.hostname.replace(/^www\./i, '').toLowerCase() !== 'tribunadoagreste.com.br' ||
        partes.length !== 5 || partes[0] !== categoria ||
        !/^\d{4}$/.test(partes[1]) || !/^\d{2}$/.test(partes[2]) ||
        !/^\d{2}$/.test(partes[3]) || !/^\d+-[^/]+$/.test(partes[4])) return null;
    return url.href;
  } catch { return null; }
}

function instalarBotoesSiteAgreste({tentativaId,categoria}) {
  if (location.hostname.replace(/^www\./i, '') !== 'tribunadoagreste.com.br' ||
      ![`/${categoria}`, `/${categoria}/`].includes(location.pathname) ||
      window.__autoxsSiteAgreste?.tentativaId === tentativaId) return 0;

  const titulo = [...document.querySelectorAll('h2,h3,h4,h5,h6')]
    .find(elemento => elemento.textContent.replace(/\s+/g, ' ').trim().toLocaleLowerCase('pt-BR') === 'últimas notícias');
  if (!titulo) return 0;

  function hrefDaMateria(ancora) {
    try {
      const url = new URL(ancora.getAttribute('href'), location.href);
      const partes = url.pathname.split('/').filter(Boolean);
      return url.protocol === 'https:' &&
        url.hostname.replace(/^www\./i, '').toLowerCase() === 'tribunadoagreste.com.br' &&
        partes.length === 5 && partes[0] === categoria &&
        /^\d{4}$/.test(partes[1]) && /^\d{2}$/.test(partes[2]) &&
        /^\d{2}$/.test(partes[3]) && /^\d+-[^/]+$/.test(partes[4]) ? url.href : null;
    } catch { return null; }
  }

  let secao = titulo.parentElement;
  let links = [];
  while (secao) {
    links = [...secao.querySelectorAll('a[href]')]
      .filter(ancora => (titulo.compareDocumentPosition(ancora) & Node.DOCUMENT_POSITION_FOLLOWING) &&
        hrefDaMateria(ancora) && ancora.getClientRects().length);
    if (new Set(links.map(hrefDaMateria)).size >= 2 || secao === document.body) break;
    secao = secao.parentElement;
  }
  if (!links.length) return 0;

  const estado = {tentativaId, ocupado:false, opcoesEnviadas:false};
  window.__autoxsSiteAgreste = estado;
  const estilo = document.createElement('style');
  estilo.textContent = '.autoxs-site-agreste-copiar { display:inline-block !important; margin:5px 8px !important; padding:7px 9px !important; border:2px solid white !important; border-radius:7px !important; background:#08783f !important; color:white !important; font:700 12px Arial,sans-serif !important; cursor:pointer !important; position:relative !important; z-index:5 !important; }';
  document.head.appendChild(estilo);

  let adicionados = 0;
  const vistos = new Set();
  const opcoes = [];
  for (const ancora of links) {
    const href = hrefDaMateria(ancora);
    if (!href || vistos.has(href)) continue;
    vistos.add(href);
    if (vistos.size > 10) break;
    if (!ancora.parentElement) continue;
    const recipiente = ancora.closest('article,li') || ancora.parentElement;
    const imagem = ancora.querySelector('img') || recipiente?.querySelector('img');
    const tituloMateria = (ancora.textContent ||
      recipiente?.querySelector('h1,h2,h3,h4,h5,h6')?.textContent || '')
      .replace(/\s+/g, ' ').trim();
    opcoes.push({
      href,
      miniatura:imagem?.currentSrc || imagem?.src || imagem?.getAttribute('src') || '',
      titulo:tituloMateria
    });
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'autoxs-site-agreste-copiar';
    botao.textContent = 'COPIAR LINK';
    ancora.insertAdjacentElement('afterend', botao);
    adicionados += 1;
    botao.addEventListener('click', async evento => {
      evento.preventDefault();
      evento.stopPropagation();
      if (estado.ocupado) return;
      estado.ocupado = true;
      botao.disabled = true;
      try {
        const hrefAtual = hrefDaMateria(ancora);
        if (hrefAtual !== href || !ancora.isConnected) throw new Error('O link da matéria mudou. Escolha novamente.');
        const resposta = await window.__autoxsSiteAgresteUsarLink({tentativaId,href:hrefAtual});
        if (!resposta?.ok) throw new Error(resposta?.mensagem || 'Não foi possível usar o link.');
        botao.textContent = '✅ Link salvo';
      } catch (erro) {
        botao.textContent = 'COPIAR LINK';
        window.alert(erro.message || 'Não foi possível usar o link.');
      } finally {
        botao.disabled = false;
        estado.ocupado = false;
      }
    });
  }
  if (!estado.opcoesEnviadas && opcoes.length) {
    estado.opcoesEnviadas = true;
    void window.__autoxsSiteAgresteReceberOpcoes({tentativaId,opcoes}).then(resposta => {
      if (!resposta?.ok) estado.opcoesEnviadas = false;
    }).catch(() => { estado.opcoesEnviadas = false; });
  }
  return adicionados;
}

async function fecharAnunciosVisiveis(aba) {
  const seletores = [
    '[role="dialog"] button', '[aria-modal="true"] button',
    '[class*="popup" i] button', '[class*="modal" i] button',
    '[class*="overlay" i] button', '[class*="advert" i] button',
    '[class*="anuncio" i] button'
  ].join(',');
  const controles = aba.locator(seletores);
  for (let rodada = 0; rodada < 2; rodada++) {
    let fechado = false;
    const quantidade = Math.min(await controles.count(), 30);
    for (let indice = 0; indice < quantidade; indice++) {
      const controle = controles.nth(indice);
      if (!await controle.isVisible().catch(() => false)) continue;
      const nomes = [
        await controle.getAttribute('aria-label').catch(() => ''),
        await controle.getAttribute('title').catch(() => ''),
        await controle.innerText().catch(() => '')
      ].filter(Boolean).map(valor => valor.replace(/\s+/g, ' ').trim());
      if (!nomes.some(nome => /^(?:fechar|close|×|✕|x)(?:\s+(?:anúncio|anuncio|publicidade|popup|pop-up))?$/i.test(nome))) continue;
      if (await controle.click({timeout:1500}).then(() => true).catch(() => false)) {
        fechado = true;
        break;
      }
    }
    if (!fechado) break;
  }
}

async function abrirLaboratorioSiteAgreste({janela,tentativaId,urlSertao,receberLink,receberOpcoes,aoFechar}) {
  const categoria = categoriaDaUrlSertao(urlSertao);
  const paginaCategoria = `https://www.tribunadoagreste.com.br/${categoria}`;
  const aba = await janela.newPage();
  aba.once('close', () => aoFechar(aba));
  await aba.exposeBinding('__autoxsSiteAgresteUsarLink', async ({frame}, entrada) => {
    if (frame !== aba.mainFrame() || aba.isClosed() ||
        new URL(frame.url()).hostname.replace(/^www\./i, '') !== 'tribunadoagreste.com.br' ||
        ![`/${categoria}`, `/${categoria}/`].includes(new URL(frame.url()).pathname)) {
      return {ok:false,mensagem:'Volte à categoria aberta do Tribuna do Agreste.'};
    }
    if (entrada?.tentativaId !== tentativaId) return {ok:false,mensagem:'Esta seleção já não está ativa.'};
    const href = validarHrefAgreste(entrada?.href, categoria);
    if (!href) return {ok:false,mensagem:'O link não é uma matéria da categoria aberta do Tribuna do Agreste.'};
    return receberLink({aba,tentativaId,href});
  });
  await aba.exposeBinding('__autoxsSiteAgresteReceberOpcoes', async ({frame}, entrada) => {
    if (frame !== aba.mainFrame() || aba.isClosed() ||
        new URL(frame.url()).hostname.replace(/^www\./i, '') !== 'tribunadoagreste.com.br' ||
        ![`/${categoria}`, `/${categoria}/`].includes(new URL(frame.url()).pathname)) {
      return {ok:false,mensagem:'Volte à categoria aberta do Tribuna do Agreste.'};
    }
    if (entrada?.tentativaId !== tentativaId || !Array.isArray(entrada?.opcoes) ||
        !entrada.opcoes.length || entrada.opcoes.length > 10) {
      return {ok:false,mensagem:'As opções do Site Agreste não são válidas.'};
    }
    const opcoes = [];
    for (const opcao of entrada.opcoes) {
      const href = validarHrefAgreste(opcao?.href, categoria);
      if (!href) return {ok:false,mensagem:'Uma matéria do Site Agreste não é válida.'};
      let imagem = '';
      if (opcao?.miniatura) {
        try {
          const urlImagem = new URL(opcao.miniatura, frame.url());
          if (!['http:','https:'].includes(urlImagem.protocol)) throw new Error();
          imagem = urlImagem.href;
        } catch { imagem = ''; }
      }
      const titulo = String(opcao?.titulo || '').replace(/\s+/g, ' ').trim().slice(0, 300);
      opcoes.push({url:href,imagem,titulo});
    }
    return receberOpcoes({aba,tentativaId,opcoes});
  });
  try {
    await aba.goto(paginaCategoria, {waitUntil:'domcontentloaded',timeout:30000});
    await fecharAnunciosVisiveis(aba);
    await aba.getByRole('heading', {name:/^Últimas Notícias$/i}).first().waitFor({state:'visible',timeout:15000});
    const adicionados = await aba.evaluate(instalarBotoesSiteAgreste, {tentativaId,categoria});
    if (!adicionados) return {ok:false,aba,mensagem:'Não encontrei links de matérias em “Últimas Notícias”. Feche anúncios visíveis e tente novamente.'};
    return {ok:true,aba};
  } catch (erro) {
    await aba.close().catch(() => {});
    throw erro;
  }
}

module.exports = {abrirLaboratorioSiteAgreste};
