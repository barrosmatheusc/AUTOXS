const PERFIS = {
  facebookSertao: 'jornaltribunadosertao',
  facebookAgreste: 'tribunaagreste'
};

function normalizarPermalinkFacebook(url, area) {
  url.hash = '';
  const partes = url.pathname.split('/').filter(Boolean);
  if (area === 'fotos' && ['photo', 'photo.php'].includes(partes[0])) {
    const fbid = url.searchParams.get('fbid');
    url.search = '';
    if (fbid) url.searchParams.set('fbid', fbid);
  } else if (area === 'fotos' && partes[0] === 'permalink.php') {
    const storyFbid = url.searchParams.get('story_fbid');
    const id = url.searchParams.get('id');
    url.search = '';
    if (storyFbid) url.searchParams.set('story_fbid', storyFbid);
    if (id) url.searchParams.set('id', id);
  } else {
    url.search = '';
  }
  url.hostname = 'www.facebook.com';
  return url.href;
}

function validarHrefFacebook(valor, area, conta) {
  try {
    const url = new URL(valor);
    if (url.protocol !== 'https:' ||
        url.hostname.replace(/^www\./i, '').toLowerCase() !== 'facebook.com') return null;
    const partes = url.pathname.split('/').filter(Boolean);
    const numero = valor => /^\d+$/.test(valor || '');
    if (area === 'fotos') {
      const fotoDireta = ['photo', 'photo.php'].includes(partes[0]) && numero(url.searchParams.get('fbid'));
      const fotoDaPagina = partes[0] === conta && ['photos', 'photos_by'].includes(partes[1]) &&
        partes.length >= 3 && numero(partes.at(-1));
      const publicacaoDaPagina = partes[0] === conta && partes[1] === 'posts' &&
        partes.length >= 3 && /^(?:\d+|pfbid[A-Za-z0-9]+)$/.test(partes.at(-1));
      const permalink = partes[0] === 'permalink.php' &&
        /^(?:\d+|pfbid[A-Za-z0-9]+)$/.test(url.searchParams.get('story_fbid') || '');
      if (!fotoDireta && !fotoDaPagina && !publicacaoDaPagina && !permalink) return null;
    } else if (area === 'reels') {
      const reelDireto = partes[0] === 'reel' && partes.length === 2 && numero(partes[1]);
      const reelDaPagina = partes[0] === conta &&
        ['reel', 'reels', 'videos'].includes(partes[1]) &&
        partes.length === 3 && numero(partes[2]);
      if (!reelDireto && !reelDaPagina) return null;
    } else {
      return null;
    }
    return normalizarPermalinkFacebook(url, area);
  } catch { return null; }
}

function instalarMonitorFacebook({tentativaId,conta}) {
  if (window.top !== window || window.__autoxsFacebookMonitor?.tentativaId === tentativaId) return;
  const estado = {
    tentativaId,conta,rota:'',aplicado:false,timer:null,
    modalLoginFechado:false,
    ultimoModalLogin:{detectado:false,botaoSeguro:false,fechado:false}
  };
  window.__autoxsFacebookMonitor = estado;

  function fecharModalLogin() {
    if (estado.modalLoginFechado) return {...estado.ultimoModalLogin};
    const resumo = {detectado:false,botaoSeguro:false,fechado:false};
    const modais = document.querySelectorAll('[role="dialog"], [aria-modal="true"]');
    for (const modal of modais) {
      if (modal.dataset.autoxsFecharLoginTentado === tentativaId) continue;
      const textoModal = (modal.textContent || '').slice(0,1000);
      const login = modal.querySelector('input[name="email"], input[name="pass"]') ||
        /(?:entre|entrar|login|log in|cadastre-se).{0,45}facebook|facebook.{0,45}(?:entre|entrar|login|log in)/i
          .test(textoModal);
      if (!login) continue;
      resumo.detectado = true;
      // CAPTCHA, desafio e confirmação de identidade nunca recebem interação.
      if (/(?:captcha|confirme que (?:é|voce e) humano|security check|verifica[cç][aã]o de seguran[cç]a|confirme sua identidade|checkpoint|challenge)/i.test(textoModal) ||
          modal.querySelector('iframe[src*="captcha"],iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="turnstile"]')) {
        continue;
      }
      const controles = modal.querySelectorAll('button, [role="button"]');
      for (const controle of controles) {
        const nome = controle.getAttribute('aria-label') ||
          controle.getAttribute('title') ||
          controle.textContent?.trim();
        if (!/^(?:fechar|close|fechar janela|close dialog|×|✕|x)$/i.test(nome || '')) continue;
        const retangulo = controle.getBoundingClientRect();
        const estilo = getComputedStyle(controle);
        if (!retangulo.width || !retangulo.height ||
            estilo.visibility === 'hidden' || estilo.display === 'none') continue;
        resumo.botaoSeguro = true;
        modal.dataset.autoxsFecharLoginTentado = tentativaId;
        controle.click();
        resumo.fechado = true;
        estado.modalLoginFechado = true;
        estado.ultimoModalLogin = resumo;
        return {...resumo};
      }
    }
    estado.ultimoModalLogin = {
      detectado:estado.ultimoModalLogin.detectado || resumo.detectado,
      botaoSeguro:estado.ultimoModalLogin.botaoSeguro || resumo.botaoSeguro,
      fechado:estado.ultimoModalLogin.fechado || resumo.fechado
    };
    return {...estado.ultimoModalLogin};
  }
  estado.fecharModalLogin = fecharModalLogin;

  function areaAtual() {
    if (location.hostname.replace(/^www\./i, '').toLowerCase() !== 'facebook.com') return null;
    const partes = location.pathname.toLowerCase().split('/').filter(Boolean);
    if (partes[0] !== conta) return null;
    if (['photos', 'photos_by'].includes(partes[1]) || location.search.includes('sk=photos')) return 'fotos';
    if (['reels', 'videos'].includes(partes[1]) || location.search.includes('sk=videos')) return 'reels';
    const aba = [...document.querySelectorAll('[role="tab"][aria-selected="true"], a[aria-current="page"]')]
      .find(elemento => /^(fotos|reels)$/i.test((elemento.textContent || '').trim()));
    return aba?.textContent.trim().toLowerCase() === 'fotos' ? 'fotos' :
      (aba ? 'reels' : null);
  }

  function hrefDaPublicacao(ancora, area) {
    try {
      const url = new URL(ancora.getAttribute('href'), location.href);
      if (url.protocol !== 'https:' ||
          url.hostname.replace(/^www\./i, '').toLowerCase() !== 'facebook.com') return null;
      const partes = url.pathname.split('/').filter(Boolean);
      const numero = valor => /^\d+$/.test(valor || '');
      if (area === 'fotos') {
        const fotoDireta = ['photo', 'photo.php'].includes(partes[0]) && numero(url.searchParams.get('fbid'));
        const fotoDaPagina = partes[0] === conta && ['photos', 'photos_by'].includes(partes[1]) &&
          partes.length >= 3 && numero(partes.at(-1));
        const publicacaoDaPagina = partes[0] === conta && partes[1] === 'posts' &&
          partes.length >= 3 && /^(?:\d+|pfbid[A-Za-z0-9]+)$/.test(partes.at(-1));
        const permalink = partes[0] === 'permalink.php' &&
          /^(?:\d+|pfbid[A-Za-z0-9]+)$/.test(url.searchParams.get('story_fbid') || '');
        if (!fotoDireta && !fotoDaPagina && !publicacaoDaPagina && !permalink) return null;
      } else if (area === 'reels') {
        if (!((partes[0] === 'reel' && partes.length === 2 && numero(partes[1])) ||
          (partes[0] === conta && ['reel', 'reels', 'videos'].includes(partes[1]) &&
            partes.length === 3 && numero(partes[2])))) return null;
      } else return null;
      url.hash = '';
      if (area === 'fotos' && ['photo', 'photo.php'].includes(partes[0])) {
        const fbid = url.searchParams.get('fbid');
        url.search = '';
        if (fbid) url.searchParams.set('fbid', fbid);
      } else if (area === 'fotos' && partes[0] === 'permalink.php') {
        const storyFbid = url.searchParams.get('story_fbid');
        const id = url.searchParams.get('id');
        url.search = '';
        if (storyFbid) url.searchParams.set('story_fbid', storyFbid);
        if (id) url.searchParams.set('id', id);
      } else {
        url.search = '';
      }
      url.hostname = 'www.facebook.com';
      return url.href;
    } catch { return null; }
  }

  function coletarDados(area) {
    const vazio = {principal:null,candidatos:[],primeiraFileira:null,permalinksValidos:0,opcoes:[]};
    if (!document.head || !document.body) return vazio;
    const principal = document.querySelector('[role="main"], main');
    if (!principal) return vazio;
    const titulo = [...principal.querySelectorAll('h1,h2,h3,[role="heading"]')]
      .filter(elemento => (elemento.textContent || '').trim().toLowerCase() === (area === 'fotos' ? 'fotos' : 'reels'))
      .at(-1);
    if (area === 'fotos' && !titulo) return vazio;
    const limiteSuperior = titulo?.getBoundingClientRect().bottom ?? -Infinity;
    const candidatos = [...principal.querySelectorAll('a[href]')]
      .map(ancora => {
        let card = ancora.parentElement;
        if (area === 'fotos') {
          while (card && card !== principal &&
            (card.getBoundingClientRect().width < 80 || card.getBoundingClientRect().height < 80)) {
            card = card.parentElement;
          }
        } else {
          // No layout de Reels, o permalink costuma ser um link pequeno dentro
          // de um card maior. Sobe somente até o primeiro ancestral visual.
          let atual = ancora;
          while (atual && atual !== principal) {
            const retanguloAtual = atual.getBoundingClientRect();
            const temMidia = atual.querySelector('img,video,[style*="background-image"]') ||
              getComputedStyle(atual).backgroundImage !== 'none';
            if (temMidia && retanguloAtual.width >= 80 && retanguloAtual.height >= 80) {
              card = atual;
              break;
            }
            atual = atual.parentElement;
          }
        }
        return {
          ancora,
          card,
          href:hrefDaPublicacao(ancora, area),
          retangulo:card && card !== principal
            ? card.getBoundingClientRect() : ancora.getBoundingClientRect()
        };
      })
      .filter(({href,retangulo}) => href &&
        (area === 'reels'
          ? retangulo.width > 0 && retangulo.height > 0
          : retangulo.width >= 80 && retangulo.height >= 80) &&
        retangulo.top >= limiteSuperior - 8)
      .sort((a,b) => a.retangulo.top - b.retangulo.top || a.retangulo.left - b.retangulo.left);
    if (!candidatos.length) return {...vazio,principal};
    const vistos = new Set();
    const candidatosUnicos = candidatos
      .filter(({href}) => {
        if (vistos.has(href)) return false;
        vistos.add(href);
        return true;
      });
    const opcoes = candidatosUnicos
      .map(item => {
        const imagens = area === 'reels' && item.card
          ? [...item.card.querySelectorAll('img')]
            .filter(imagem => {
              const retangulo = imagem.getBoundingClientRect();
              return retangulo.width > 0 && retangulo.height > 0;
            })
            .sort((a,b) => {
              const caixaA = a.getBoundingClientRect();
              const caixaB = b.getBoundingClientRect();
              return caixaB.width * caixaB.height - caixaA.width * caixaA.height;
            })
          : [];
        const imagem = area === 'reels'
          ? (imagens[0] || item.ancora.querySelector('img'))
          : (item.ancora.querySelector('img') || item.card?.querySelector('img'));
        const video = item.ancora.querySelector('video') || item.card?.querySelector('video');
        const comFundo = item.ancora.querySelector('[style*="background-image"]') ||
          item.card?.querySelector('[style*="background-image"]') || item.ancora;
        const fundo = getComputedStyle(comFundo).backgroundImage || '';
        const miniaturaFundo = fundo.match(/^url\(["']?(.*?)["']?\)$/i)?.[1] || '';
        const miniatura = imagem?.currentSrc || imagem?.src || imagem?.getAttribute('src') ||
          video?.poster || miniaturaFundo;
        return {href:item.href,miniatura:miniatura || ''};
      })
      .filter(item => area === 'reels' || item.miniatura)
      .slice(0,5);
    return {
      principal,
      candidatos,
      primeiraFileira:candidatos[0].retangulo.top,
      permalinksValidos:candidatosUnicos.length,
      opcoes
    };
  }

  estado.coletarOpcoes = area => {
    const dados = coletarDados(area);
    return {
      area,
      encontradas:dados.candidatos.length,
      permalinksValidos:dados.permalinksValidos,
      opcoes:dados.opcoes.map(({href,miniatura}) => ({href,miniatura}))
    };
  };

  function colocarBotoes(area) {
    const {principal,candidatos,primeiraFileira} = coletarDados(area);
    if (!principal || !candidatos.length) return 0;
    const vistos = new Set();
    if (!document.querySelector('style[data-autoxs-facebook-estilo]')) {
      const estilo = document.createElement('style');
      estilo.dataset.autoxsFacebookEstilo = 'true';
      estilo.textContent = '.autoxs-facebook-copiar { position:absolute !important; top:8px !important; right:8px !important; z-index:2147483640 !important; border:2px solid white !important; border-radius:7px !important; background:#08783f !important; color:white !important; padding:7px 9px !important; font:700 12px Arial,sans-serif !important; cursor:pointer !important; } .autoxs-facebook-barra-fotos { display:grid !important; gap:8px !important; width:100% !important; box-sizing:border-box !important; margin:8px 0 10px !important; padding:10px !important; border:2px solid #7ee2a8 !important; border-radius:9px !important; background:#071b12f2 !important; position:relative !important; z-index:2147483639 !important; } .autoxs-facebook-barra-fotos button { min-width:0 !important; border:2px solid white !important; border-radius:7px !important; background:#08783f !important; color:white !important; padding:9px 6px !important; font:700 12px Arial,sans-serif !important; cursor:pointer !important; }';
      document.head.appendChild(estilo);
    }
    let adicionados = 0;

    if (area === 'fotos') {
      const itensPrimeiraFileira = candidatos
        .filter(({retangulo}) => Math.abs(retangulo.top - primeiraFileira) <= 18)
        .sort((a,b) => a.retangulo.left - b.retangulo.left)
        .slice(0,5);
      const cards = itensPrimeiraFileira.map(({card}) => card).filter(Boolean);
      let grade = cards[0]?.parentElement;
      while (grade && grade !== principal && !cards.every(card => grade.contains(card))) grade = grade.parentElement;
      if (!grade || grade === principal) grade = cards[0]?.parentElement;
      const destinoBarra = grade?.parentElement;
      if (!grade || !destinoBarra) return 0;

      const barra = document.createElement('div');
      barra.className = 'autoxs-facebook-barra-fotos';
      barra.dataset.autoxsFacebookCopiar = tentativaId;
      barra.setAttribute('aria-label', 'Links das fotos da primeira fileira');
      barra.style.gridTemplateColumns = `repeat(${itensPrimeiraFileira.length}, minmax(0, 1fr))`;
      itensPrimeiraFileira.forEach(({ancora,href,card}, indice) => {
        if (vistos.has(href) || !ancora.parentElement || !card) return;
        vistos.add(href);
        const botao = document.createElement('button');
        botao.type = 'button';
        botao.dataset.autoxsFacebookCopiar = tentativaId;
        botao.textContent = `${indice + 1} COPIAR`;
        barra.appendChild(botao);
        adicionados += 1;
        botao.addEventListener('click', async evento => {
          evento.preventDefault();
          evento.stopPropagation();
          botao.disabled = true;
          try {
            const hrefAtual = hrefDaPublicacao(ancora, area);
            if (hrefAtual !== href || !card.contains(ancora) || areaAtual() !== area) throw new Error('O card mudou. Escolha novamente a publicação.');
            const resposta = await window.__autoxsFacebookUsarLink({tentativaId,area,href:hrefAtual});
            if (!resposta?.ok) throw new Error(resposta?.mensagem || 'Não foi possível usar o link.');
            botao.textContent = `${indice + 1} ✅ SALVO`;
            clearInterval(estado.timer);
          } catch (erro) {
            botao.textContent = `${indice + 1} COPIAR`;
            window.alert(erro.message || 'Não foi possível usar o link.');
          } finally { botao.disabled = false; }
        });
      });
      destinoBarra.insertBefore(barra, grade);
      return adicionados;
    }

    for (const {ancora,href,retangulo} of candidatos) {
      if (Math.abs(retangulo.top - primeiraFileira) > 18 || adicionados >= 5) break;
      if (vistos.has(href) || !ancora.parentElement) continue;
      vistos.add(href);
      const card = ancora.parentElement;
      if (!card || card === principal || card.querySelector(':scope > [data-autoxs-facebook-copiar]')) continue;
      const botao = document.createElement('button');
      botao.type = 'button';
      botao.className = 'autoxs-facebook-copiar';
      botao.dataset.autoxsFacebookCopiar = tentativaId;
      botao.textContent = 'COPIAR LINK';
      card.style.position = 'relative';
      card.appendChild(botao);
      adicionados += 1;
      botao.addEventListener('click', async evento => {
        evento.preventDefault();
        evento.stopPropagation();
        botao.disabled = true;
        try {
          const hrefAtual = hrefDaPublicacao(ancora, area);
          if (hrefAtual !== href || !card.contains(ancora) || areaAtual() !== area) throw new Error('O card mudou. Escolha novamente a publicação.');
          const resposta = await window.__autoxsFacebookUsarLink({tentativaId,area,href:hrefAtual});
          if (!resposta?.ok) throw new Error(resposta?.mensagem || 'Não foi possível usar o link.');
          botao.textContent = '✅ Link salvo';
          clearInterval(estado.timer);
        } catch (erro) {
          botao.textContent = 'COPIAR LINK';
          window.alert(erro.message || 'Não foi possível usar o link.');
        } finally { botao.disabled = false; }
      });
    }
    return adicionados;
  }

  // Apenas detecta a troca manual entre Fotos e Reels; não acompanha rolagem.
  estado.timer = setInterval(() => {
    fecharModalLogin();
    const area = areaAtual();
    const rota = area ? location.pathname + location.search + ':' + area : '';
    if (rota !== estado.rota) {
      document.querySelectorAll('[data-autoxs-facebook-copiar]').forEach(botao => botao.remove());
      estado.rota = rota;
      estado.aplicado = false;
    }
    if (area && !estado.aplicado) {
      estado.aplicado = colocarBotoes(area) > 0;
    }
  }, 900);
}

async function abrirLaboratorioFacebook({janela,tentativaId,fonte,receberLink,receberOpcoes,aoFechar}) {
  const conta = PERFIS[fonte];
  if (!conta) throw new Error('Fonte do Facebook não autorizada.');
  const rotulo = fonte === 'facebookSertao' ? 'FACEBOOK SERTÃO' : 'FACEBOOK AGRESTE';
  const enderecos = {
    fotos:`https://www.facebook.com/${conta}/photos_by`,
    reels:`https://www.facebook.com/${conta}/reels/`
  };
  const aba = await janela.newPage();
  aba.once('close', () => aoFechar(aba));
  await aba.exposeBinding('__autoxsFacebookUsarLink', async ({frame}, entrada) => {
    if (frame !== aba.mainFrame() || aba.isClosed()) return {ok:false,mensagem:'A aba de origem não é válida.'};
    const atual = new URL(frame.url());
    if (atual.hostname.replace(/^www\./i, '').toLowerCase() !== 'facebook.com' ||
        atual.pathname.split('/').filter(Boolean)[0]?.toLowerCase() !== conta) {
      return {ok:false,mensagem:'Volte à página oficial do Facebook.'};
    }
    if (entrada?.tentativaId !== tentativaId) return {ok:false,mensagem:'Esta seleção já não está ativa.'};
    const href = validarHrefFacebook(entrada?.href, entrada?.area, conta);
    if (!href) return {ok:false,mensagem:'Este link não é uma publicação válida de Fotos ou Reels.'};
    return receberLink({aba,tentativaId,href});
  });
  await aba.addInitScript(instalarMonitorFacebook, {tentativaId,conta});

  async function coletarArea(area) {
    const nomeArea = area === 'fotos' ? 'Fotos' : 'Reels';
    const concordancia = area === 'fotos' ? 'encontradas' : 'encontrados';
    const concordanciaValidas = area === 'fotos' ? 'válidas' : 'válidos';
    const fonteLog = fonte === 'facebookSertao' ? 'Sertão' : 'Agreste';
    console.log(`[FACEBOOK] Fonte: ${fonteLog}`);
    console.log(`[FACEBOOK] Seção: ${nomeArea}`);
    try {
      await aba.goto(enderecos[area], {waitUntil:'domcontentloaded',timeout:30000});
      console.log('[FACEBOOK] Página aberta: SIM');
    } catch (erro) {
      console.log('[FACEBOOK] Página aberta: NÃO');
      throw erro;
    }
    await aba.evaluate(instalarMonitorFacebook, {tentativaId,conta});

    let resultado = {encontradas:0,permalinksValidos:0,opcoes:[]};
    let modalLogin = {detectado:false,botaoSeguro:false,fechado:false};
    const limite = Date.now() + 8000;
    do {
      const estadoModal = await aba.evaluate(() =>
        window.__autoxsFacebookMonitor?.fecharModalLogin?.() ||
        {detectado:false,botaoSeguro:false,fechado:false});
      modalLogin = {
        detectado:modalLogin.detectado || estadoModal.detectado,
        botaoSeguro:modalLogin.botaoSeguro || estadoModal.botaoSeguro,
        fechado:modalLogin.fechado || estadoModal.fechado
      };
      resultado = await aba.evaluate(areaAtual =>
        window.__autoxsFacebookMonitor?.coletarOpcoes?.(areaAtual) ||
        {encontradas:0,permalinksValidos:0,opcoes:[]}, area);
      if (resultado.opcoes.length >= 5) break;
      await aba.waitForTimeout(500);
    } while (Date.now() < limite);

    const validas = [];
    const vistas = new Set();
    let miniaturasEncontradas = 0;
    for (const opcao of resultado.opcoes.slice(0,5)) {
      const href = validarHrefFacebook(opcao?.href, area, conta);
      if (!href || vistas.has(href)) continue;
      let miniatura = '';
      if (opcao?.miniatura) {
        try {
          const urlMiniatura = new URL(opcao.miniatura);
          if (urlMiniatura.protocol === 'https:') miniatura = urlMiniatura.href;
        } catch {}
      }
      if (area === 'fotos' && !miniatura) continue;
      if (miniatura) miniaturasEncontradas += 1;
      vistas.add(href);
      validas.push({url:href,imagem:miniatura,titulo:'',tipo:area});
    }
    const interfaceLoginPresente = modalLogin.detectado || Boolean(await aba.locator('input[name="email"], input[name="pass"]').filter({visible:true}).count());
    const conteudoPublicoPresente = resultado.permalinksValidos > 0 || validas.length > 0;
    const verificacaoReal = await aba.evaluate(() => {
      const texto = (document.body?.innerText || '').slice(0,5000);
      return /(?:confirme que (?:é|voce e) humano|security check|verifica[cç][aã]o de seguran[cç]a|confirme sua identidade|checkpoint|challenge)/i.test(texto) ||
        Boolean(document.querySelector('iframe[src*="captcha"],iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="turnstile"]'));
    }).catch(() => false);
    const rotaDeVerificacao = /\/checkpoint\/|\/challenge\//i.test(aba.url());
    const bloqueioReal = !conteudoPublicoPresente && (verificacaoReal || rotaDeVerificacao);
    console.log(`[FACEBOOK] Modal comum de login detectado: ${interfaceLoginPresente ? 'SIM' : 'NÃO'}`);
    console.log(`[FACEBOOK] Botão seguro de fechar encontrado: ${modalLogin.botaoSeguro ? 'SIM' : 'NÃO'}`);
    console.log(`[FACEBOOK] Modal fechado: ${modalLogin.fechado ? 'SIM' : 'NÃO'}`);
    console.log(`[FACEBOOK] Conteúdo público encontrado: ${conteudoPublicoPresente ? 'SIM' : 'NÃO'}`);
    console.log(`[FACEBOOK] Publicações válidas: ${validas.length}`);
    console.log(`[FACEBOOK] Verificação/CAPTCHA real detectada: ${bloqueioReal ? 'SIM' : 'NÃO'}`);
    if (bloqueioReal) throw new Error('Facebook requer verificação manual.');
    if (!conteudoPublicoPresente) throw new Error('Nenhuma publicação encontrada.');
    console.log(`[${rotulo}] ${nomeArea} ${concordancia}: ${resultado.encontradas}`);
    console.log(`[${rotulo}] ${nomeArea} ${concordanciaValidas}: ${validas.length}`);
    return {
      opcoes:validas,
      encontradas:resultado.encontradas,
      permalinksValidos:resultado.permalinksValidos,
      miniaturasEncontradas
    };
  }

  let reelsEmCache = null;
  let coletaReels = null;
  async function carregarReels() {
    if (reelsEmCache) return reelsEmCache;
    if (!coletaReels) {
      coletaReels = (async () => {
        console.log('[FACEBOOK] Aba REELS selecionada');
        console.log('[FACEBOOK] Iniciando coleta de Reels');
        console.log(`[FACEBOOK] Perfil: ${fonte === 'facebookSertao' ? 'Sertão' : 'Agreste'}`);
        console.log(`[FACEBOOK] URL acessada: ${enderecos.reels}`);
        try {
          const resultado = await coletarArea('reels');
          console.log(`[FACEBOOK] Links candidatos encontrados: ${resultado.encontradas}`);
          console.log(`[FACEBOOK] Permalinks de Reel válidos: ${resultado.permalinksValidos}`);
          console.log(`[FACEBOOK] Miniaturas encontradas: ${resultado.miniaturasEncontradas}`);
          console.log(`[FACEBOOK] Reels exibidos: ${resultado.opcoes.length}`);
          reelsEmCache = resultado.opcoes;
          return reelsEmCache;
        } catch (erro) {
          console.log(`[FACEBOOK] ERRO REELS: ${erro.message || erro}`);
          throw erro;
        }
      })().finally(() => { coletaReels = null; });
    }
    return coletaReels;
  }

  try {
    const fotos = await coletarArea('fotos');
    console.log(`[${rotulo}] Total exibido: ${fotos.opcoes.length}`);
    const resposta = await receberOpcoes({aba,tentativaId,opcoes:fotos.opcoes,carregarReels});
    if (!resposta?.ok) return {ok:false,aba,mensagem:resposta?.mensagem || 'Não foi possível exibir as Fotos do Facebook.'};
    return {ok:true,aba,carregarReels};
  } catch (erro) {
    await aba.close().catch(() => {});
    throw erro;
  }
}

module.exports = {abrirLaboratorioFacebook};
