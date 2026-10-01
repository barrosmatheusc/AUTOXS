const CONTAS = {
  instagramSertao: 'tribunadosertaooficial',
  instagramAgreste: 'tribunadoagreste'
};

function validarHrefInstagram(valor, conta) {
  try {
    const url = new URL(valor);
    const partes = url.pathname.split('/').filter(Boolean);
    if (url.origin !== 'https://www.instagram.com' ||
        partes.length !== 3 || partes[0] !== conta ||
        !['p', 'reel'].includes(partes[1]) ||
        !/^[A-Za-z0-9_-]+$/.test(partes[2])) return null;
    return url.href;
  } catch { return null; }
}

function instalarBotoesInstagram({ tentativaId, conta }) {
  if (location.origin !== 'https://www.instagram.com' ||
      location.pathname !== `/${conta}/` ||
      window.__autoxsInstagram?.tentativaId === tentativaId) return;

  const estado = { tentativaId, ocupado:false, opcoesEnviadas:false };
  window.__autoxsInstagram = estado;
  const estilo = document.createElement('style');
  estilo.dataset.autoxsInstagramSertao = tentativaId;
  estilo.textContent = `
    .autoxs-instagram-copiar { position:absolute; right:8px; bottom:8px; z-index:5; border:2px solid #fff; border-radius:8px; background:#08783f; color:#fff; padding:8px 10px; font:700 12px Arial,sans-serif; cursor:pointer; box-shadow:0 2px 8px #0008; }
    .autoxs-instagram-copiar:disabled { opacity:.7; cursor:wait; }
  `;
  document.head.appendChild(estilo);

  function hrefDoCard(ancora) {
    try {
      const url = new URL(ancora.getAttribute('href'), location.href);
      if (url.origin !== 'https://www.instagram.com') return null;
      const partes = url.pathname.split('/').filter(Boolean);
      return url.origin === 'https://www.instagram.com' &&
        partes.length === 3 && partes[0] === conta &&
        ['p', 'reel'].includes(partes[1]) &&
        /^[A-Za-z0-9_-]+$/.test(partes[2]) ? url.href : null;
    } catch { return null; }
  }

  // Uma única varredura: no máximo as 10 publicações recentes já disponíveis na grade.
  const cards = [...document.querySelectorAll('main a[href]')]
    .map(ancora => ({ ancora, href:hrefDoCard(ancora), miniatura:ancora.querySelector('img'), card:ancora.parentElement }))
    .filter(({ancora,href,miniatura,card}) => href && miniatura && card &&
      ancora.getClientRects().length && miniatura.getClientRects().length)
    .sort((a,b) => a.ancora.getBoundingClientRect().top - b.ancora.getBoundingClientRect().top);
  const vistos = new Set();
  const opcoes = [];
  for (const {ancora,href,miniatura,card} of cards) {
    if (vistos.has(href)) continue;
    vistos.add(href);
    if (vistos.size > 10) break;
    opcoes.push({
      href,
      miniatura:miniatura.currentSrc || miniatura.src || miniatura.getAttribute('src') || ''
    });
    if (card.querySelector(':scope > [data-autoxs-instagram-copiar]')) continue;

    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'autoxs-instagram-copiar';
    botao.dataset.autoxsInstagramCopiar = tentativaId;
    botao.textContent = 'COPIAR LINK';
    card.style.position = 'relative';
    card.appendChild(botao);
    botao.addEventListener('click', async evento => {
      evento.preventDefault();
      evento.stopPropagation();
      if (estado.ocupado) return;
      estado.ocupado = true;
      botao.disabled = true;
      try {
        const hrefAtual = hrefDoCard(ancora);
        if (!hrefAtual || hrefAtual !== href || !card.contains(ancora)) throw new Error('O card mudou. Escolha novamente a publicação.');
        const resposta = await window.__autoxsInstagramUsarLink({ tentativaId, href:hrefAtual });
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
  if (!estado.opcoesEnviadas && opcoes.length && opcoes.every(({miniatura}) => miniatura)) {
    estado.opcoesEnviadas = true;
    void window.__autoxsInstagramReceberOpcoes({tentativaId,opcoes}).then(resposta => {
      if (!resposta?.ok) estado.opcoesEnviadas = false;
    }).catch(() => { estado.opcoesEnviadas = false; });
  }
}

async function abrirLaboratorioInstagram({ janela, tentativaId, fonte, receberLink, receberOpcoes, aoFechar }) {
  const conta = CONTAS[fonte];
  if (!conta) throw new Error('Fonte do Instagram não autorizada.');
  const perfil = `https://www.instagram.com/${conta}/`;
  const aba = await janela.newPage();
  aba.once('close', () => aoFechar(aba));
  await aba.exposeBinding('__autoxsInstagramUsarLink', async ({ frame }, entrada) => {
    if (frame !== aba.mainFrame() || frame.url() !== aba.url() || aba.isClosed()) return {ok:false,mensagem:'A aba de origem não é válida.'};
    if (frame.url() !== perfil) return {ok:false,mensagem:'Volte ao perfil oficial do Instagram.'};
    if (entrada?.tentativaId !== tentativaId) return {ok:false,mensagem:'Esta seleção já não está ativa.'};
    const href = validarHrefInstagram(entrada?.href, conta);
    if (!href) return {ok:false,mensagem:'Este card não pertence ao perfil autorizado.'};
    return receberLink({aba,tentativaId,href});
  });
  await aba.exposeBinding('__autoxsInstagramReceberOpcoes', async ({frame}, entrada) => {
    if (frame !== aba.mainFrame() || frame.url() !== aba.url() || aba.isClosed()) return {ok:false,mensagem:'A aba de origem não é válida.'};
    if (frame.url() !== perfil) return {ok:false,mensagem:'Volte ao perfil oficial do Instagram.'};
    if (entrada?.tentativaId !== tentativaId || !Array.isArray(entrada?.opcoes) ||
        !entrada.opcoes.length || entrada.opcoes.length > 10) {
      return {ok:false,mensagem:'As opções do Instagram não são válidas.'};
    }
    const opcoes = [];
    for (const opcao of entrada.opcoes) {
      const href = validarHrefInstagram(opcao?.href, conta);
      let miniatura;
      try {
        const urlMiniatura = new URL(opcao?.miniatura);
        if (urlMiniatura.protocol !== 'https:') throw new Error();
        miniatura = urlMiniatura.href;
      } catch { return {ok:false,mensagem:'Uma miniatura do Instagram não é válida.'}; }
      if (!href) return {ok:false,mensagem:'Um link do Instagram não é válido.'};
      opcoes.push({url:href,imagem:miniatura,titulo:''});
    }
    return receberOpcoes({aba,tentativaId,opcoes});
  });
  try {
    await aba.goto(perfil, {waitUntil:'domcontentloaded',timeout:30000});
    if (await aba.locator('input[name="username"], input[name="password"]').count() || /\/accounts\/login\//.test(aba.url())) {
      return {ok:false,aba,requerAcaoManual:true,mensagem:'Entre manualmente no Instagram e depois volte ao perfil.'};
    }
    if (/\/challenge\/|\/checkpoint\//.test(aba.url())) {
      return {ok:false,aba,requerAcaoManual:true,mensagem:'Resolva manualmente a verificação de segurança do Instagram.'};
    }
    if (new URL(aba.url()).pathname !== `/${conta}/`) throw new Error('O Instagram não abriu o perfil autorizado.');
    await aba.waitForFunction(conta => [...document.querySelectorAll('main a[href]')].some(ancora => {
      try {
        const partes = new URL(ancora.getAttribute('href'), location.href).pathname.split('/').filter(Boolean);
        return partes.length === 3 && partes[0] === conta &&
          ['p', 'reel'].includes(partes[1]) && /^[A-Za-z0-9_-]+$/.test(partes[2]) &&
          Boolean(ancora.querySelector('img'));
      } catch { return false; }
    }), conta, {timeout:15000});
    await aba.evaluate(instalarBotoesInstagram, {tentativaId,conta});
    return {ok:true,aba};
  } catch (erro) {
    await aba.close().catch(() => {});
    throw erro;
  }
}

module.exports = { abrirLaboratorioInstagram, validarHrefInstagram };
