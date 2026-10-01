const SITE_PUBLICO = 'https://www.tribunadosertao.com.br/';
const DOMINIO_PUBLICO = 'tribunadosertao.com.br';
const { randomUUID } = require('node:crypto');
const { abrirLaboratorioInstagram } = require('./instagram-sertao');
const { abrirLaboratorioSiteAgreste } = require('./site-agreste');
const { abrirLaboratorioFacebook } = require('./facebook-links');

function pertenceAoSitePublico(valor) {
  try { return new URL(valor, SITE_PUBLICO).hostname.replace(/^www\./i, '').toLowerCase() === DOMINIO_PUBLICO; }
  catch { return false; }
}

function limparTexto(valor) {
  return String(valor || '').replace(/\s+/g, ' ').trim();
}

function montarTextoCompartilhamento({ chapeu, titulo, subtitulo, url }) {
  const partes = [];
  if (limparTexto(chapeu)) partes.push(`*${limparTexto(chapeu)}*`);
  if (limparTexto(titulo)) partes.push(`*${limparTexto(titulo)}*`);
  if (limparTexto(subtitulo)) partes.push(`*_${limparTexto(subtitulo)}_*`);
  partes.push(String(url));
  return partes.join('\n\n');
}

function montarTextoFacebook({ chapeu, titulo, subtitulo, url }) {
  const partes = [];
  if (limparTexto(chapeu)) partes.push(`*${limparTexto(chapeu)}*`);
  if (limparTexto(titulo)) partes.push(`*${limparTexto(titulo)}*`);
  if (limparTexto(subtitulo)) partes.push(`*_${limparTexto(subtitulo)}_*`);
  partes.push(url);
  return partes.join('\n\n');
}

function identidadeMateria(url) {
  try {
    const destino = new URL(url, SITE_PUBLICO);
    if (!['http:', 'https:'].includes(destino.protocol) || !pertenceAoSitePublico(destino)) return null;
    const caminho = destino.pathname.replace(/\/+$/, '');
    return `https://www.tribunadosertao.com.br${caminho}`;
  } catch { return null; }
}

async function lerMateriaEmAbaTemporaria(janela, listagem, entrada) {
  let destino;
  try { destino = new URL(entrada?.url, SITE_PUBLICO); }
  catch { return { ok:false, mensagem:'A URL desta matéria não foi identificada.' }; }
  if (!pertenceAoSitePublico(destino)) {
    return { ok:false, mensagem:'O link encontrado não pertence ao site da Tribuna do Sertão.' };
  }

  const consulta = await janela.newPage();
  try {
    // A aba de Últimas continua visível enquanto a matéria é consultada.
    await listagem.bringToFront().catch(() => {});
    await consulta.goto(destino.href, { waitUntil:'domcontentloaded', timeout:30000 });
    await listagem.bringToFront().catch(() => {});

    const pagina = await consulta.evaluate(({ tituloListagem, chapeuListagem }) => {
      const texto = elemento => (elemento?.textContent || elemento?.content || '').replace(/\s+/g, ' ').trim();
      const primeiroTexto = seletores => {
        for (const seletor of seletores) {
          const valor = texto(document.querySelector(seletor));
          if (valor) return valor;
        }
        return '';
      };
      const primeiroEnderecoImagem = seletores => {
        for (const seletor of seletores) {
          const elemento = document.querySelector(seletor);
          const valor = elemento?.content || elemento?.currentSrc || elemento?.src ||
            elemento?.getAttribute?.('data-src') || elemento?.getAttribute?.('href') || '';
          if (!valor) continue;
          try { return new URL(valor, location.href).href; } catch {}
        }
        return '';
      };
      const titulo = String(tituloListagem || '').trim() || primeiroTexto([
        'main article h1', 'article h1', 'main h1',
        'meta[property="og:title"]'
      ]);
      const chapeu = String(chapeuListagem || '').trim() || primeiroTexto([
        'main article [rel="category"]', 'article [rel="category"]',
        'meta[property="article:section"]'
      ]);
      const cabecalhoEditorial = [...document.querySelectorAll('main header.news-header, header.news-header')]
        .find(cabecalho => {
          const h1 = cabecalho.querySelector('h1.news-header__title');
          return h1 && (!titulo || texto(h1) === titulo);
        });
      const h1Editorial = cabecalhoEditorial?.querySelector('h1.news-header__title') || null;
      const elementosDoCabecalho = cabecalhoEditorial ? [...cabecalhoEditorial.children] : [];
      const indiceTitulo = h1Editorial ? elementosDoCabecalho.indexOf(h1Editorial) : -1;
      const indiceInformacoes = elementosDoCabecalho.findIndex(elemento => elemento.matches('.info'));
      const subtituloEstrutural = elementosDoCabecalho.find((elemento, indice) =>
        indice > indiceTitulo &&
        (indiceInformacoes < 0 || indice < indiceInformacoes) &&
        elemento.matches('p.news-header__excerpt') &&
        !elemento.hidden &&
        getComputedStyle(elemento).display !== 'none' &&
        getComputedStyle(elemento).visibility !== 'hidden'
      );
      let subtitulo = texto(subtituloEstrutural) || primeiroTexto([
        'main article [itemprop="description"]', 'article [itemprop="description"]',
        'main article .subtitulo', 'main article .subtitle',
        'main article .post-subtitle', 'main article .entry-subtitle',
        'main article .lead', 'article .subtitulo', 'article .subtitle'
      ]);
      const textoComparavel = valor => String(valor || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ').trim().toLowerCase();
      const subtituloComparavel = textoComparavel(subtitulo);
      const descricaoGenerica = subtituloComparavel.startsWith('noticias de alagoas, do brasil e do mundo') ||
        (subtituloComparavel.includes('noticias de alagoas') &&
          subtituloComparavel.includes('saiba tudo em tempo real'));
      if (subtitulo === titulo || descricaoGenerica) subtitulo = '';
      const imagem = primeiroEnderecoImagem([
        'meta[property="og:image"]',
        'meta[name="twitter:image"]',
        'main figure img',
        'article figure img'
      ]);
      return { titulo, chapeu, subtitulo, imagem };
    }, {
      tituloListagem: limparTexto(entrada?.titulo),
      chapeuListagem: limparTexto(entrada?.chapeu)
    });

    if (!pagina.titulo) {
      return { ok:false, mensagem:'O título não foi encontrado na listagem nem na página da matéria.' };
    }
    const avisos = [];
    if (!pagina.chapeu) avisos.push('Chapéu não encontrado; ele não será incluído.');
    if (!pagina.subtitulo) avisos.push('Subtítulo não encontrado; ele não será incluído.');
    const dados = { ...pagina, url:destino.href };
    return { ok:true, dados, texto:montarTextoCompartilhamento(dados), avisos };
  } catch (erro) {
    return { ok:false, mensagem:erro.message || 'Não foi possível consultar a página da matéria.' };
  } finally {
    await consulta.close().catch(() => {});
    if (!listagem.isClosed()) await listagem.bringToFront().catch(() => {});
  }
}

// Executada dentro da página pública. Não altera nenhum arquivo ou dado do site.
function instalarInterfaceCompartilhamento() {
  if (!document.head || !document.body) {
    if (!window.__autoxsCompartilhamentoAguardando) {
      window.__autoxsCompartilhamentoAguardando = true;
      document.addEventListener('DOMContentLoaded', () => {
        delete window.__autoxsCompartilhamentoAguardando;
        instalarInterfaceCompartilhamento();
      }, { once:true });
    }
    return;
  }
  if (window.__autoxsCompartilhamento?.instalado) {
    window.__autoxsCompartilhamento.garantirBotoesCompartilhar('reinjecao');
    return;
  }

  const estado = { instalado:true, botaoAtual:null, timer:null, ultimaQuantidade:null, resultadoAtual:null, selecaoExterna:null };
  window.__autoxsCompartilhamento = estado;
  const estilo = document.createElement('style');
  estilo.dataset.autoxsCompartilhar = 'estilo';
  estilo.textContent = `
    .autoxs-compartilhar-faixa { display:inline-flex !important; align-items:center !important; margin:4px 7px 4px 0 !important; vertical-align:middle !important; }
    .autoxs-compartilhar-botao { appearance:none !important; border:2px solid #08783f !important; border-radius:7px !important; background:#baf3d3 !important; color:#064e2f !important; cursor:pointer !important; font:700 13px/1.2 "Segoe UI",Arial,sans-serif !important; padding:8px 10px !important; white-space:nowrap !important; box-shadow:0 2px 8px #0003 !important; }
    .autoxs-compartilhar-botao:hover { background:#d9f8e8 !important; }
    .autoxs-compartilhar-botao:disabled { cursor:wait !important; opacity:.75 !important; }
    .autoxs-compartilhar-fundo { position:fixed !important; inset:0 !important; z-index:2147483646 !important; display:grid !important; place-items:center !important; padding:20px !important; background:#06130dcc !important; }
    .autoxs-compartilhar-fundo[hidden] { display:none !important; }
    .autoxs-compartilhar-modal { width:min(620px,100%) !important; max-height:85vh !important; overflow:auto !important; border:1px solid #456958 !important; border-radius:18px !important; background:#14251d !important; color:#f3faf6 !important; box-shadow:0 28px 90px #0009 !important; padding:24px !important; font:14px/1.5 "Segoe UI",Arial,sans-serif !important; }
    .autoxs-compartilhar-modal h2 { margin:0 40px 18px 0 !important; color:#fff !important; font-size:22px !important; }
    .autoxs-compartilhar-modal dl { margin:0 !important; }
    .autoxs-compartilhar-modal dt { margin-top:13px !important; color:#9fd9bb !important; font-weight:700 !important; }
    .autoxs-compartilhar-modal dd { margin:3px 0 0 !important; overflow-wrap:anywhere !important; }
    .autoxs-fontes { display:grid !important; grid-template-columns:repeat(3,minmax(0,1fr)) !important; gap:7px !important; margin-top:18px !important; }
    .autoxs-fonte { border:1px solid #6d8d7c !important; border-radius:8px !important; background:#30483d !important; color:#fff !important; padding:8px 4px !important; font:700 12px "Segoe UI",Arial,sans-serif !important; cursor:pointer !important; }
    .autoxs-fonte[data-pendente="true"] { opacity:.65 !important; }
    .autoxs-fonte[aria-pressed="true"] { background:#9aebc0 !important; border-color:#9aebc0 !important; color:#0b3d26 !important; opacity:1 !important; }
    .autoxs-fonte:disabled { cursor:wait !important; }
    .autoxs-compartilhar-aviso { margin:16px 0 0 !important; padding:10px 12px !important; border-radius:8px !important; background:#473c16 !important; color:#ffe8a3 !important; }
    .autoxs-compartilhar-acoes { display:flex !important; gap:10px !important; margin-top:20px !important; }
    .autoxs-compartilhar-acoes button { border:0 !important; border-radius:9px !important; cursor:pointer !important; padding:11px 15px !important; font-weight:700 !important; }
    .autoxs-compartilhar-acoes button:disabled { opacity:.55 !important; cursor:not-allowed !important; }
    .autoxs-copiar { background:#9aebc0 !important; color:#0b3d26 !important; }
    .autoxs-fechar { background:#30483d !important; color:#fff !important; }
    .autoxs-compartilhar-status { min-height:21px !important; margin:12px 0 0 !important; color:#aee8c9 !important; }
    .autoxs-facebook-opcoes-fundo { position:fixed !important; inset:0 !important; z-index:2147483647 !important; display:grid !important; place-items:center !important; padding:20px !important; background:#06130de8 !important; }
    .autoxs-facebook-opcoes-fundo[hidden] { display:none !important; }
    .autoxs-facebook-opcoes-modal { width:min(980px,100%) !important; max-height:90vh !important; overflow:auto !important; box-sizing:border-box !important; border:2px solid #73dca4 !important; border-radius:18px !important; background:#14251d !important; color:#f3faf6 !important; box-shadow:0 28px 90px #000c !important; padding:22px !important; font:14px/1.45 "Segoe UI",Arial,sans-serif !important; }
    .autoxs-facebook-opcoes-cabecalho { display:flex !important; align-items:flex-start !important; justify-content:space-between !important; gap:16px !important; }
    .autoxs-facebook-opcoes-cabecalho h2 { margin:0 !important; color:#fff !important; font-size:22px !important; }
    .autoxs-facebook-opcoes-x { border:0 !important; border-radius:8px !important; background:#30483d !important; color:#fff !important; cursor:pointer !important; padding:7px 10px !important; font-weight:800 !important; }
    .autoxs-facebook-opcoes-status { margin:8px 0 18px !important; color:#bce9cf !important; }
    .autoxs-facebook-opcoes-grade { display:grid !important; grid-template-columns:repeat(5,minmax(0,1fr)) !important; gap:12px !important; }
    .autoxs-facebook-opcoes-grade[data-secoes="true"] { display:block !important; }
    .autoxs-facebook-opcoes-grade[data-abas="true"] { display:block !important; }
    .autoxs-facebook-abas { display:flex !important; gap:9px !important; margin:0 0 16px !important; }
    .autoxs-facebook-aba { border:1px solid #6d8d7c !important; border-radius:9px !important; background:#30483d !important; color:#fff !important; cursor:pointer !important; padding:9px 18px !important; font-weight:800 !important; }
    .autoxs-facebook-aba[aria-selected="true"] { border-color:#9aebc0 !important; background:#9aebc0 !important; color:#0b3d26 !important; }
    .autoxs-facebook-aba-conteudo { display:grid !important; grid-template-columns:repeat(5,minmax(0,1fr)) !important; gap:12px !important; }
    .autoxs-facebook-aba-mensagem { grid-column:1/-1 !important; margin:0 !important; padding:18px !important; border:1px solid #527362 !important; border-radius:10px !important; background:#091b13 !important; color:#bce9cf !important; text-align:center !important; }
    .autoxs-facebook-opcoes-secao + .autoxs-facebook-opcoes-secao { margin-top:22px !important; }
    .autoxs-facebook-opcoes-secao h3 { margin:0 0 10px !important; color:#9aebc0 !important; font-size:15px !important; letter-spacing:.08em !important; }
    .autoxs-facebook-opcoes-linha { display:grid !important; grid-template-columns:repeat(5,minmax(0,1fr)) !important; gap:12px !important; }
    .autoxs-facebook-opcao { display:flex !important; flex-direction:column !important; gap:9px !important; min-width:0 !important; padding:9px !important; border:1px solid #527362 !important; border-radius:11px !important; background:#091b13 !important; }
    .autoxs-facebook-opcao img { display:block !important; width:100% !important; aspect-ratio:4/3 !important; object-fit:cover !important; border-radius:8px !important; background:#07110c !important; }
    .autoxs-facebook-opcao-sem-imagem { display:grid !important; place-items:center !important; width:100% !important; aspect-ratio:4/3 !important; border-radius:8px !important; background:#263b31 !important; color:#bce9cf !important; font-weight:700 !important; }
    .autoxs-facebook-opcao-titulo { min-height:42px !important; margin:0 !important; color:#f3faf6 !important; font-size:12px !important; line-height:1.35 !important; }
    .autoxs-facebook-opcao button,.autoxs-facebook-opcoes-acoes button { border:0 !important; border-radius:8px !important; cursor:pointer !important; padding:10px 12px !important; font-weight:750 !important; }
    .autoxs-facebook-opcao button { background:#9aebc0 !important; color:#0b3d26 !important; }
    .autoxs-facebook-opcao button:disabled { cursor:wait !important; opacity:.6 !important; }
    .autoxs-facebook-opcoes-acoes { display:flex !important; justify-content:flex-end !important; gap:10px !important; margin-top:18px !important; }
    .autoxs-facebook-opcoes-cancelar { background:#30483d !important; color:#fff !important; }
    .autoxs-facebook-opcoes-fallback { background:#9aebc0 !important; color:#0b3d26 !important; }
  `;
  document.head.appendChild(estilo);

  const normalizar = valor => String(valor || '').replace(/\s+/g, ' ').trim();
  const urlValida = href => {
    try {
      const url = new URL(href, location.href);
      if (url.hostname.replace(/^www\./i, '').toLowerCase() !== 'tribunadosertao.com.br' || !/^https?:$/.test(url.protocol)) return false;
      // Formato real das matérias: /categoria/AAAA/MM/DD/numero-titulo
      return /^\/[^/]+\/\d{4}\/\d{2}\/\d{2}\/\d+-[^/]+\/?$/i.test(url.pathname);
    } catch { return false; }
  };
  const localizarChapeu = recipiente => {
    const categoria = recipiente?.querySelector('[rel="category"], a[href*="/categoria/"], a[href*="/category/"]');
    return normalizar(categoria?.textContent);
  };
  const normalizarChapeu = valor => {
    const chapeu = normalizar(valor).toLocaleUpperCase('pt-BR');
    return chapeu === 'ESPORTE' ? 'ESPORTES' : chapeu;
  };
  const lerDadosDoLink = (ancora, recipiente) => {
    const textoCompleto = normalizar(ancora.textContent);
    const partes = [...ancora.querySelectorAll('*')]
      .filter(elemento => !elemento.children.length)
      .map(elemento => normalizar(elemento.textContent)).filter(Boolean);
    const data = /\b\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}\b/;
    const metadado = partes.find(parte => data.test(parte)) || '';
    let titulo = partes.filter(parte => !data.test(parte)).sort((a, b) => b.length - a.length)[0] || '';
    let restante = textoCompleto.replace(/^\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}\s*(?:\|\s*)?/u, '').trim();
    let chapeu = normalizar(metadado.replace(data, '').replace(/^\s*\|\s*/, ''));
    // Quando metadado e título estão concatenados no mesmo link, o chapéu é
    // a sequência em caixa alta antes da primeira palavra normal do título.
    if (!chapeu || chapeu === restante) {
      const separacao = restante.match(/^([\p{Lu}\p{M}\d][\p{Lu}\p{M}\d\s&/.-]{1,60}?)(?=\s+\p{Lu}[\p{Ll}\p{M}])/u);
      if (separacao) {
        chapeu = separacao[1].trim();
        restante = restante.slice(separacao[0].length).trim();
      }
    } else if (restante.toLocaleUpperCase('pt-BR').startsWith(chapeu.toLocaleUpperCase('pt-BR') + ' ')) {
      restante = restante.slice(chapeu.length).trim();
    }
    if (!titulo || titulo === textoCompleto || data.test(titulo)) titulo = restante;
    // Um título extraído de um descendente ainda pode conter o metadado.
    titulo = titulo.replace(/^\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}\s*(?:\|\s*)?/u, '').trim();
    if (chapeu && titulo.toLocaleUpperCase('pt-BR').startsWith(chapeu.toLocaleUpperCase('pt-BR') + ' ')) {
      titulo = titulo.slice(chapeu.length).trim();
    }
    return {
      titulo:normalizar(titulo || restante),
      chapeu:normalizarChapeu(chapeu || localizarChapeu(recipiente))
    };
  };

  function obterModal() {
    let fundo = document.querySelector('[data-autoxs-compartilhar="modal"]');
    if (fundo) return fundo;
    fundo = document.createElement('div');
    fundo.className = 'autoxs-compartilhar-fundo';
    fundo.dataset.autoxsCompartilhar = 'modal';
    fundo.hidden = true;
    fundo.innerHTML = '<section class="autoxs-compartilhar-modal" role="dialog" aria-modal="true" aria-labelledby="autoxs-compartilhar-titulo"><h2 id="autoxs-compartilhar-titulo">Link pronto para compartilhar</h2><div data-autoxs-conteudo></div><div class="autoxs-compartilhar-acoes"><button class="autoxs-copiar" type="button">Copiar texto</button><button class="autoxs-fechar" type="button">Fechar</button></div><p class="autoxs-compartilhar-status" role="status" aria-live="polite"></p></section>';
    document.body.appendChild(fundo);
    fundo.querySelector('.autoxs-fechar').addEventListener('click', () => { fundo.hidden = true; });
    fundo.addEventListener('click', evento => { if (evento.target === fundo) fundo.hidden = true; });
    return fundo;
  }

  const rotuloFonteExterna = fonte => ({
    siteAgreste:'Site Agreste',
    instagramSertao:'Instagram Sertão',
    instagramAgreste:'Instagram Agreste',
    facebookSertao:'Facebook Sertão',
    facebookAgreste:'Facebook Agreste'
  })[fonte] || 'Fonte externa';

  function obterSeletorExterno() {
    let fundo = document.querySelector('[data-autoxs-facebook-opcoes]');
    if (fundo) return fundo;
    fundo = document.createElement('div');
    fundo.className = 'autoxs-facebook-opcoes-fundo';
    fundo.dataset.autoxsFacebookOpcoes = 'true';
    fundo.hidden = true;
    fundo.innerHTML = '<section class="autoxs-facebook-opcoes-modal" role="dialog" aria-modal="true" aria-labelledby="autoxs-facebook-opcoes-titulo"><div class="autoxs-facebook-opcoes-cabecalho"><h2 id="autoxs-facebook-opcoes-titulo">Facebook</h2><button class="autoxs-facebook-opcoes-x" type="button" aria-label="Fechar">×</button></div><p class="autoxs-facebook-opcoes-status" role="status" aria-live="polite"></p><div class="autoxs-facebook-opcoes-grade"></div><div class="autoxs-facebook-opcoes-acoes"><button class="autoxs-facebook-opcoes-fallback" type="button">ABRIR FACEBOOK</button><button class="autoxs-facebook-opcoes-cancelar" type="button">CANCELAR</button></div></section>';
    document.body.appendChild(fundo);
    const cancelar = async () => {
      const selecao = estado.selecaoExterna;
      fundo.hidden = true;
      estado.selecaoExterna = null;
      if (!selecao?.tentativaId) return;
      try {
        await window.cancelarSelecaoFonte({
          materiaId:selecao.materiaId,
          fonte:selecao.fonte,
          tentativaId:selecao.tentativaId
        });
      } catch {}
    };
    fundo.querySelector('.autoxs-facebook-opcoes-x').addEventListener('click', cancelar);
    fundo.querySelector('.autoxs-facebook-opcoes-cancelar').addEventListener('click', cancelar);
    fundo.querySelector('.autoxs-facebook-opcoes-fallback').addEventListener('click', async () => {
      const selecao = estado.selecaoExterna;
      if (!selecao?.tentativaId) return;
      const status = fundo.querySelector('.autoxs-facebook-opcoes-status');
      try {
        const resposta = await window.abrirFonteFallback({
          materiaId:selecao.materiaId,
          fonte:selecao.fonte,
          tentativaId:selecao.tentativaId
        });
        if (!resposta?.ok) throw new Error(resposta?.mensagem || 'Não foi possível abrir a fonte.');
        fundo.hidden = true;
      } catch (erro) {
        status.textContent = erro.message || 'Não foi possível abrir a fonte.';
      }
    });
    return fundo;
  }

  function mostrarCarregandoFonte({materiaId, fonte}) {
    const fundo = obterSeletorExterno();
    estado.selecaoExterna = {materiaId,fonte,tentativaId:null};
    fundo.hidden = false;
    fundo.querySelector('#autoxs-facebook-opcoes-titulo').textContent = rotuloFonteExterna(fonte);
    fundo.querySelector('.autoxs-facebook-opcoes-status').textContent = fonte === 'siteAgreste' ? 'Carregando matérias...' : 'Carregando publicações...';
    fundo.querySelector('.autoxs-facebook-opcoes-grade').replaceChildren();
    fundo.querySelector('.autoxs-facebook-opcoes-x').hidden = true;
    fundo.querySelector('.autoxs-facebook-opcoes-fallback').hidden = true;
    fundo.querySelector('.autoxs-facebook-opcoes-cancelar').hidden = true;
  }

  function mostrarErroFonte({materiaId, fonte, tentativaId, mensagem}) {
    const fundo = obterSeletorExterno();
    estado.selecaoExterna = {materiaId,fonte,tentativaId};
    fundo.hidden = false;
    fundo.querySelector('#autoxs-facebook-opcoes-titulo').textContent = rotuloFonteExterna(fonte);
    fundo.querySelector('.autoxs-facebook-opcoes-status').textContent = mensagem || 'Não foi possível carregar as opções.';
    fundo.querySelector('.autoxs-facebook-opcoes-grade').replaceChildren();
    fundo.querySelector('.autoxs-facebook-opcoes-x').hidden = false;
    fundo.querySelector('.autoxs-facebook-opcoes-fallback').hidden = !tentativaId;
    fundo.querySelector('.autoxs-facebook-opcoes-fallback').textContent = 'ABRIR FONTE';
    fundo.querySelector('.autoxs-facebook-opcoes-cancelar').hidden = false;
  }

  function mostrarOpcoesFonte({materiaId, fonte, tentativaId, opcoes}) {
    const ehFacebook = fonte.startsWith('facebook');
    if (!Array.isArray(opcoes) || opcoes.length > 10 || (!opcoes.length && !ehFacebook)) {
      mostrarErroFonte({materiaId,fonte,tentativaId,mensagem:'Não foi possível carregar as opções.'});
      return;
    }
    const fundo = obterSeletorExterno();
    fundo.hidden = false;
    fundo.querySelector('#autoxs-facebook-opcoes-titulo').textContent = rotuloFonteExterna(fonte);
    fundo.querySelector('.autoxs-facebook-opcoes-status').textContent = fonte === 'siteAgreste' ? 'Escolha a matéria' : 'Escolha a publicação';
    fundo.querySelector('.autoxs-facebook-opcoes-x').hidden = false;
    fundo.querySelector('.autoxs-facebook-opcoes-fallback').hidden = true;
    fundo.querySelector('.autoxs-facebook-opcoes-cancelar').hidden = false;
    const grade = fundo.querySelector('.autoxs-facebook-opcoes-grade');
    grade.replaceChildren();
    const criarOpcao = ({url,imagem,titulo}, indice, rotulo = '') => {
      const opcao = document.createElement('div');
      opcao.className = 'autoxs-facebook-opcao';
      if (imagem) {
        const miniatura = document.createElement('img');
        miniatura.src = imagem;
        miniatura.alt = rotulo ? `${rotulo} ${indice + 1}` : `Opção ${indice + 1}`;
        opcao.appendChild(miniatura);
      } else {
        const semImagem = document.createElement('div');
        semImagem.className = 'autoxs-facebook-opcao-sem-imagem';
        semImagem.textContent = 'Sem miniatura';
        opcao.appendChild(semImagem);
      }
      if (titulo) {
        const textoTitulo = document.createElement('p');
        textoTitulo.className = 'autoxs-facebook-opcao-titulo';
        textoTitulo.textContent = titulo;
        opcao.appendChild(textoTitulo);
      }
      const usar = document.createElement('button');
      usar.type = 'button';
      usar.textContent = rotulo
        ? `${rotulo} ${indice + 1} · USAR LINK`
        : `${indice + 1} USAR LINK`;
      usar.addEventListener('click', async () => {
        usar.disabled = true;
        try {
          const resposta = await window.usarOpcaoFonte({materiaId,fonte,tentativaId,url});
          if (!resposta?.ok) throw new Error(resposta?.mensagem || 'Não foi possível usar o link.');
          fundo.hidden = true;
          estado.selecaoExterna = null;
        } catch (erro) {
          fundo.querySelector('.autoxs-facebook-opcoes-status').textContent = erro.message || 'Não foi possível usar o link.';
        } finally {
          usar.disabled = false;
        }
      });
      opcao.appendChild(usar);
      return opcao;
    };
    if (ehFacebook) {
      delete grade.dataset.secoes;
      grade.dataset.abas = 'true';
      const selecao = {
        materiaId, fonte, tentativaId,
        abaAtiva:'fotos',
        cache:{
          fotos:opcoes.filter(opcao => opcao.tipo !== 'reels').slice(0,5),
          reels:[]
        },
        reelsCarregados:false,
        reelsCarregando:false,
        erroReels:''
      };
      estado.selecaoExterna = selecao;
      const abas = document.createElement('div');
      abas.className = 'autoxs-facebook-abas';
      const conteudoAbas = document.createElement('div');
      conteudoAbas.className = 'autoxs-facebook-aba-conteudo';
      const botoesAbas = {};

      const renderizarAba = tipo => {
        selecao.abaAtiva = tipo;
        for (const [id,botao] of Object.entries(botoesAbas)) {
          botao.setAttribute('aria-selected', String(id === tipo));
        }
        conteudoAbas.replaceChildren();
        const itens = selecao.cache[tipo];
        if (tipo === 'reels' && selecao.reelsCarregando) {
          const carregando = document.createElement('p');
          carregando.className = 'autoxs-facebook-aba-mensagem';
          carregando.textContent = 'Carregando Reels...';
          conteudoAbas.appendChild(carregando);
          fundo.querySelector('.autoxs-facebook-opcoes-status').textContent = 'REELS · Carregando Reels...';
          return;
        }
        if (!itens.length) {
          const vazio = document.createElement('p');
          vazio.className = 'autoxs-facebook-aba-mensagem';
          vazio.textContent = tipo === 'reels'
            ? (selecao.erroReels || 'Nenhum Reel encontrado.')
            : 'Nenhuma Foto encontrada.';
          conteudoAbas.appendChild(vazio);
          fundo.querySelector('.autoxs-facebook-opcoes-status').textContent = tipo === 'reels' ? 'REELS' : 'FOTOS';
          return;
        }
        const rotulo = tipo === 'reels' ? 'Reel' : 'Foto';
        itens.forEach((opcao,indice) => conteudoAbas.appendChild(criarOpcao(opcao,indice,rotulo)));
        fundo.querySelector('.autoxs-facebook-opcoes-status').textContent = `${tipo === 'reels' ? 'REELS' : 'FOTOS'} · Escolha a publicação`;
      };

      const selecionarReels = async () => {
        renderizarAba('reels');
        if (selecao.reelsCarregados || selecao.reelsCarregando) return;
        selecao.reelsCarregando = true;
        selecao.erroReels = '';
        renderizarAba('reels');
        try {
          const resposta = await window.carregarReelsFacebook({materiaId,fonte,tentativaId});
          if (!resposta?.ok) throw new Error(resposta?.mensagem || 'Não foi possível carregar os Reels.');
          selecao.cache.reels = Array.isArray(resposta.opcoes) ? resposta.opcoes.slice(0,5) : [];
          selecao.reelsCarregados = true;
        } catch (erro) {
          selecao.erroReels = erro.message || 'Não foi possível carregar os Reels.';
        } finally {
          selecao.reelsCarregando = false;
          if (estado.selecaoExterna === selecao && selecao.abaAtiva === 'reels') renderizarAba('reels');
        }
      };

      for (const [tipo,rotulo] of [['fotos','FOTOS'],['reels','REELS']]) {
        const botao = document.createElement('button');
        botao.type = 'button';
        botao.className = 'autoxs-facebook-aba';
        botao.textContent = rotulo;
        botao.setAttribute('role','tab');
        botao.addEventListener('click', () => {
          if (tipo === 'fotos') renderizarAba('fotos');
          else void selecionarReels();
        });
        botoesAbas[tipo] = botao;
        abas.appendChild(botao);
      }
      grade.append(abas,conteudoAbas);
      renderizarAba('fotos');
    } else {
      estado.selecaoExterna = {materiaId,fonte,tentativaId};
      delete grade.dataset.secoes;
      delete grade.dataset.abas;
      opcoes.forEach((opcao,indice) => grade.appendChild(criarOpcao(opcao,indice)));
    }
  }

  function mostrarCarregando() {
    const modal = obterModal();
    modal.hidden = false;
    modal.querySelector('[data-autoxs-conteudo]').textContent = 'Buscando o subtítulo da matéria…';
    modal.querySelector('.autoxs-compartilhar-acoes > .autoxs-copiar').hidden = true;
    modal.querySelector('.autoxs-compartilhar-status').textContent = '';
  }

  function mostrarResultado(resultado, fonteInicial = 'siteSertao') {
    const modal = obterModal();
    modal.hidden = false;
    const conteudo = modal.querySelector('[data-autoxs-conteudo]');
    const copiar = modal.querySelector('.autoxs-compartilhar-acoes > .autoxs-copiar');
    const status = modal.querySelector('.autoxs-compartilhar-status');
    conteudo.replaceChildren();
    status.textContent = '';
    estado.resultadoAtual = resultado?.ok ? resultado : null;
    if (!resultado?.ok) {
      const erro = document.createElement('p');
      erro.className = 'autoxs-compartilhar-aviso';
      erro.textContent = resultado?.mensagem || 'Não foi possível preparar esta matéria.';
      conteudo.appendChild(erro);
      copiar.hidden = true;
      return;
    }
    const lista = document.createElement('dl');
    for (const [rotulo, valor] of [['Chapéu',resultado.dados.chapeu],['Título',resultado.dados.titulo],['Subtítulo',resultado.dados.subtitulo]]) {
      if (!valor) continue;
      const dt = document.createElement('dt'); dt.textContent = rotulo;
      const dd = document.createElement('dd'); dd.textContent = valor;
      lista.append(dt, dd);
    }
    conteudo.appendChild(lista);
    if (resultado.avisos?.length) {
      const aviso = document.createElement('p');
      aviso.className = 'autoxs-compartilhar-aviso';
      aviso.textContent = resultado.avisos.join(' ');
      conteudo.appendChild(aviso);
    }

    const fontes = [
      ['siteSertao', 'Site Sertão'],
      ['siteAgreste', 'Site Agreste'],
      ['instagramSertao', 'Inst. Sertão'],
      ['instagramAgreste', 'Inst. Agreste'],
      ['facebookSertao', 'Face. Sertão'],
      ['facebookAgreste', 'Face. Agreste']
    ];
    const urlDaFonte = fonte => fonte === 'siteSertao'
      ? (resultado.dados.urlSertao || resultado.dados.url)
      : (resultado.dados.links?.[fonte] || '');
    let fonteSelecionada = fontes.some(([id]) => id === fonteInicial) ? fonteInicial : 'siteSertao';
    const seletor = document.createElement('div');
    seletor.className = 'autoxs-fontes';
    const urlRotulo = document.createElement('dt');
    urlRotulo.textContent = 'URL';
    const urlValor = document.createElement('dd');
    const urlLista = document.createElement('dl');
    urlLista.append(urlRotulo, urlValor);
    const atualizarFonte = () => {
      const url = urlDaFonte(fonteSelecionada);
      for (const botao of seletor.querySelectorAll('button')) {
        botao.setAttribute('aria-pressed', String(botao.dataset.fonte === fonteSelecionada));
      }
      urlValor.textContent = url || 'Pendente — link não adicionado';
      copiar.hidden = false;
      copiar.disabled = !url;
      copiar.textContent = 'COPIAR';
      status.textContent = url && fonteSelecionada !== 'siteSertao' ? '✅ Link adicionado' :
        (url ? '' : 'Esta fonte ainda não possui URL.');
    };
    for (const [id, rotulo] of fontes) {
      const botao = document.createElement('button');
      botao.type = 'button';
      botao.className = 'autoxs-fonte';
      botao.dataset.fonte = id;
      botao.dataset.pendente = String(!urlDaFonte(id));
      botao.textContent = rotulo;
      botao.addEventListener('click', async () => {
        fonteSelecionada = id;
        atualizarFonte();
        const fontesExternas = ['siteAgreste','instagramSertao','instagramAgreste','facebookSertao','facebookAgreste'];
        if (urlDaFonte(id) || !fontesExternas.includes(id)) return;
        botao.disabled = true;
        const mensagemCarregando = id === 'siteAgreste' ? 'Carregando matérias...' : 'Carregando publicações...';
        status.textContent = mensagemCarregando;
        mostrarCarregandoFonte({materiaId:resultado.materiaId,fonte:id});
        try {
          const resposta = id === 'siteAgreste'
            ? await window.abrirSiteAgreste({materiaId:resultado.materiaId})
            : (id.startsWith('instagram')
              ? await window.abrirInstagram({materiaId:resultado.materiaId,fonte:id})
              : await window.abrirFacebook({materiaId:resultado.materiaId,fonte:id}));
          if (!resposta?.ok) {
            const mensagem = resposta?.mensagem || 'Não foi possível carregar as opções.';
            status.textContent = mensagem;
            mostrarErroFonte({materiaId:resultado.materiaId,fonte:id,tentativaId:resposta?.tentativaId || null,mensagem});
          } else {
            if (estado.selecaoExterna?.materiaId === resultado.materiaId && estado.selecaoExterna?.fonte === id) {
              estado.selecaoExterna.tentativaId = resposta.tentativaId;
            }
            status.textContent = mensagemCarregando;
          }
        } catch (erro) {
          const mensagem = erro.message || 'Não foi possível carregar as opções.';
          status.textContent = mensagem;
          mostrarErroFonte({materiaId:resultado.materiaId,fonte:id,tentativaId:null,mensagem});
        } finally {
          botao.disabled = false;
        }
      });
      seletor.appendChild(botao);
    }
    conteudo.append(seletor, urlLista);
    atualizarFonte();
    copiar.onclick = async () => {
      try {
        const preparo = await window.prepararTextoFonte({materiaId:resultado.materiaId,fonte:fonteSelecionada});
        if (!preparo?.ok) throw new Error(preparo?.mensagem || 'Esta fonte ainda não possui URL.');
        let copiado = false;
        if (navigator.clipboard?.writeText) {
          try { await navigator.clipboard.writeText(preparo.texto); copiado = true; } catch {}
        }
        if (!copiado) {
          const area = document.createElement('textarea');
          area.value = preparo.texto;
          area.style.position = 'fixed'; area.style.opacity = '0';
          document.body.appendChild(area); area.select();
          copiado = document.execCommand('copy'); area.remove();
        }
        if (!copiado) throw new Error('A área de transferência não autorizou a cópia.');
        copiar.textContent = '✅ Copiado';
        status.textContent = '✅ Copiado';
        if (estado.botaoAtual?.isConnected) {
          estado.botaoAtual.textContent = '✅ Copiado';
          estado.botaoAtual.dataset.copiado = 'true';
        }
      } catch (erro) { status.textContent = erro.message || 'Não foi possível copiar o texto.'; }
    };
  }
  estado.mostrarResultado = mostrarResultado;
  estado.mostrarOpcoesFonte = mostrarOpcoesFonte;
  estado.mostrarErroFonte = mostrarErroFonte;

  async function compartilhar(botao, ancora, recipiente) {
    estado.botaoAtual = botao;
    botao.disabled = true;
    mostrarCarregando();
    try {
      const dadosLink = lerDadosDoLink(ancora, recipiente);
      const resultado = await window.prepararCompartilhamento({
        url:ancora.href,
        titulo:dadosLink.titulo,
        chapeu:dadosLink.chapeu
      });
      mostrarResultado(resultado);
    } catch (erro) {
      mostrarResultado({ ok:false, mensagem:erro.message || 'Não foi possível preparar a matéria.' });
    } finally { botao.disabled = false; }
  }

  const registrarResumo = dados => {
    try {
      const envio = window.registrarCompartilhamento?.(dados);
      if (envio?.catch) envio.catch(() => {});
    } catch {}
  };

  function garantirBotoesCompartilhar(motivo = 'varredura') {
    // O formato do href distingue matérias de menus, publicidade, categorias e links institucionais.
    const candidatos = [...document.querySelectorAll('a[href]')];
    const processadosPorRecipiente = new WeakMap();
    let detectadas = 0;
    let adicionados = 0;
    for (const ancora of candidatos) {
      const titulo = normalizar(ancora.textContent);
      if (titulo.length < 12 || !urlValida(ancora.href) || !ancora.getClientRects().length) continue;
      const chave = new URL(ancora.href, location.href).href;
      const cabecalho = ancora.closest('h1,h2,h3,h4,h5,h6');
      const recipiente = ancora.closest('article, li') || cabecalho?.parentElement || ancora.parentElement;
      if (!recipiente || !recipiente.isConnected) continue;

      let urlsDoRecipiente = processadosPorRecipiente.get(recipiente);
      if (!urlsDoRecipiente) {
        urlsDoRecipiente = new Set();
        processadosPorRecipiente.set(recipiente, urlsDoRecipiente);
      }
      if (urlsDoRecipiente.has(chave)) continue;
      urlsDoRecipiente.add(chave);
      detectadas += 1;

      const existente = [...recipiente.querySelectorAll('[data-autoxs-share="true"]')]
        .some(item => item.dataset.autoxsUrl === chave);
      if (existente) continue;

      const faixa = document.createElement('span');
      faixa.className = 'autoxs-compartilhar-faixa';
      faixa.dataset.autoxsShare = 'true';
      faixa.dataset.autoxsUrl = chave;
      const botao = document.createElement('button');
      botao.type = 'button';
      botao.className = 'autoxs-compartilhar-botao';
      botao.dataset.autoxsShare = 'true';
      botao.dataset.autoxsUrl = chave;
      botao.textContent = '🔗 Compartilhar';
      botao.addEventListener('click', evento => {
        evento.preventDefault();
        evento.stopPropagation();
        void compartilhar(botao, ancora, recipiente);
      });
      faixa.appendChild(botao);
      const referencia = cabecalho || ancora;
      referencia.parentElement.insertBefore(faixa, referencia);
      adicionados += 1;
    }

    const quantidadeMudou = estado.ultimaQuantidade !== null && estado.ultimaQuantidade !== detectadas;
    if (quantidadeMudou || (motivo === 'mutacao' && adicionados > 0)) {
      registrarResumo({ tipo:'nova-listagem' });
    }
    if (adicionados > 0 || quantidadeMudou || estado.ultimaQuantidade === null || motivo === 'reinjecao') {
      registrarResumo({ tipo:'resumo', detectadas, adicionados });
    }
    estado.ultimaQuantidade = detectadas;
    return { detectadas, adicionados };
  }
  estado.garantirBotoesCompartilhar = garantirBotoesCompartilhar;
  garantirBotoesCompartilhar('instalacao');
  const observador = new MutationObserver(() => {
    clearTimeout(estado.timer);
    estado.timer = setTimeout(() => garantirBotoesCompartilhar('mutacao'), 180);
  });
  observador.observe(document.documentElement, { childList:true, subtree:true });
  estado.observador = observador;
}

function criarCompartilhamento(context, janela) {
  let listagem = null;
  let abrindo = null;
  let capturaPendente = null;
  const materias = new Map();
  const paginasVinculadas = new WeakSet();
  const navegacoesIniciais = new WeakSet();

  async function vincularPagina(pagina) {
    if (paginasVinculadas.has(pagina)) return;
    const origemValida = frame => {
      try { return frame === pagina.mainFrame() && pertenceAoSitePublico(frame.url()); }
      catch { return false; }
    };
    await pagina.exposeBinding('prepararCompartilhamento', async ({ frame }, entrada) => {
      if (!origemValida(frame)) return { ok:false, mensagem:'Abra a página pública da Tribuna do Sertão.' };
      const resultado = await lerMateriaEmAbaTemporaria(janela, pagina, entrada);
      if (!resultado.ok) return resultado;
      const materiaId = identidadeMateria(resultado.dados.url);
      if (!materiaId) return {ok:false,mensagem:'A identidade da matéria não é válida.'};
      const anterior = materias.get(materiaId);
      const dados = {
        ...resultado.dados,
        urlSertao:resultado.dados.url,
        links:{
          siteAgreste:anterior?.dados.links.siteAgreste || '',
          instagramSertao:anterior?.dados.links.instagramSertao || '',
          instagramAgreste:anterior?.dados.links.instagramAgreste || '',
          facebookSertao:anterior?.dados.links.facebookSertao || '',
          facebookAgreste:anterior?.dados.links.facebookAgreste || ''
        }
      };
      const registro = {...resultado,materiaId,dados};
      materias.set(materiaId, registro);
      return registro;
    });
    await pagina.exposeBinding('abrirSiteAgreste', async ({frame}, entrada) => {
      if (!origemValida(frame)) return {ok:false,mensagem:'Abra a página pública da Tribuna do Sertão.'};
      const materiaId = entrada?.materiaId;
      if (typeof materiaId !== 'string' || !materias.has(materiaId)) return {ok:false,mensagem:'Esta matéria não está preparada.'};
      if (capturaPendente) return {ok:false,mensagem:'Já existe uma seleção de link em andamento.'};
      if (materias.get(materiaId).dados.links.siteAgreste) return {ok:false,mensagem:'Esta matéria já possui um link do Site Agreste.'};
      const tentativa = {
        id:randomUUID(), materiaId, fonte:'siteAgreste', pagina, origemUrl:pagina.url(), aba:null,
        opcoesPermitidas:new Set(), opcoesRecebidas:false, modoAntigo:false,
        timerMiniaturas:null, receberLink:null
      };
      capturaPendente = tentativa;
      tentativa.receberLink = async ({aba,tentativaId,href}) => {
        if (capturaPendente !== tentativa || tentativa.id !== tentativaId ||
            (tentativa.aba && tentativa.aba !== aba)) return {ok:false,mensagem:'Esta seleção não está ativa.'};
        if (!tentativa.aba) tentativa.aba = aba;
        if (pagina.isClosed() || pagina.url() !== tentativa.origemUrl) {
          clearTimeout(tentativa.timerMiniaturas);
          capturaPendente = null;
          return {ok:false,mensagem:'A página original mudou. Reabra a matéria para selecionar o link.'};
        }
        const materia = materias.get(tentativa.materiaId);
        if (!materia || materia.dados.links.siteAgreste) return {ok:false,mensagem:'Esta matéria já possui um link ou não está disponível.'};
        materia.dados.links.siteAgreste = href;
        clearTimeout(tentativa.timerMiniaturas);
        capturaPendente = null;
        await pagina.bringToFront().catch(() => {});
        const atualizado = await pagina.evaluate(registro => {
          const interfaceCompartilhamento = window.__autoxsCompartilhamento;
          if (!interfaceCompartilhamento?.mostrarResultado) return false;
          interfaceCompartilhamento.mostrarResultado(registro, 'siteAgreste');
          return true;
        }, materia).catch(() => false);
        if (!atualizado) return {ok:false,mensagem:'Link salvo, mas o modal não pôde ser atualizado. Reabra a matéria.'};
        setTimeout(() => { if (!aba.isClosed()) void aba.close().catch(() => {}); }, 0);
        return {ok:true,href};
      };
      try {
        const abertura = await abrirLaboratorioSiteAgreste({
          janela,
          tentativaId:tentativa.id,
          urlSertao:materias.get(materiaId).dados.urlSertao,
          aoFechar:aba => {
            clearTimeout(tentativa.timerMiniaturas);
            if (capturaPendente === tentativa && tentativa.aba === aba) capturaPendente = null;
          },
          receberLink:tentativa.receberLink,
          receberOpcoes:async ({aba,tentativaId,opcoes}) => {
            if (capturaPendente !== tentativa || tentativa.id !== tentativaId ||
                (tentativa.aba && tentativa.aba !== aba)) return {ok:false,mensagem:'Esta seleção não está ativa.'};
            if (!tentativa.aba) tentativa.aba = aba;
            if (pagina.isClosed() || pagina.url() !== tentativa.origemUrl) {
              clearTimeout(tentativa.timerMiniaturas);
              capturaPendente = null;
              return {ok:false,mensagem:'A página original mudou. Reabra a matéria para selecionar o link.'};
            }
            tentativa.opcoesPermitidas = new Set(opcoes.map(({url}) => url));
            tentativa.opcoesRecebidas = true;
            clearTimeout(tentativa.timerMiniaturas);
            if (tentativa.modoAntigo) return {ok:true};
            await pagina.bringToFront().catch(() => {});
            const exibido = await pagina.evaluate(dados => {
              const interfaceCompartilhamento = window.__autoxsCompartilhamento;
              if (!interfaceCompartilhamento?.mostrarOpcoesFonte) return false;
              interfaceCompartilhamento.mostrarOpcoesFonte(dados);
              return true;
            }, {materiaId:tentativa.materiaId,fonte:tentativa.fonte,tentativaId:tentativa.id,opcoes}).catch(() => false);
            return exibido ? {ok:true} : {ok:false,mensagem:'As opções foram obtidas, mas a janela não pôde ser exibida.'};
          }
        });
        tentativa.aba = abertura.aba;
        await pagina.bringToFront().catch(() => {});
        if (abertura.ok && !tentativa.opcoesRecebidas) {
          tentativa.timerMiniaturas = setTimeout(async () => {
            if (capturaPendente !== tentativa || tentativa.opcoesRecebidas || tentativa.modoAntigo || pagina.isClosed()) return;
            await pagina.bringToFront().catch(() => {});
            await pagina.evaluate(dados => window.__autoxsCompartilhamento?.mostrarErroFonte?.(dados), {
              materiaId:tentativa.materiaId, fonte:tentativa.fonte, tentativaId:tentativa.id,
              mensagem:'Não foi possível carregar as opções.'
            }).catch(() => {});
          }, 15000);
        }
        return {ok:abertura.ok,mensagem:abertura.mensagem,tentativaId:tentativa.id};
      } catch (erro) {
        clearTimeout(tentativa.timerMiniaturas);
        if (capturaPendente === tentativa) capturaPendente = null;
        return {ok:false,mensagem:erro.message || 'Não foi possível abrir Cidades do Tribuna do Agreste.'};
      }
    });
    await pagina.exposeBinding('abrirInstagram', async ({frame}, entrada) => {
      if (!origemValida(frame)) return {ok:false,mensagem:'Abra a página pública da Tribuna do Sertão.'};
      const materiaId = entrada?.materiaId;
      const fonte = entrada?.fonte;
      if (typeof materiaId !== 'string' || !materias.has(materiaId)) return {ok:false,mensagem:'Esta matéria não está preparada.'};
      if (!['instagramSertao', 'instagramAgreste'].includes(fonte)) return {ok:false,mensagem:'Fonte do Instagram não autorizada.'};
      if (capturaPendente) return {ok:false,mensagem:'Já existe uma seleção do Instagram em andamento.'};
      if (materias.get(materiaId).dados.links[fonte]) return {ok:false,mensagem:'Esta matéria já possui um link nessa fonte.'};
      const tentativa = {
        id:randomUUID(), materiaId, fonte, pagina, origemUrl:pagina.url(), aba:null,
        opcoesPermitidas:new Set(), opcoesRecebidas:false, modoAntigo:false,
        timerMiniaturas:null, receberLink:null
      };
      capturaPendente = tentativa;
      tentativa.receberLink = async ({aba,tentativaId,href}) => {
        if (capturaPendente !== tentativa || tentativa.id !== tentativaId ||
            (tentativa.aba && tentativa.aba !== aba)) return {ok:false,mensagem:'Esta tentativa de captura não está ativa.'};
        if (!tentativa.aba) tentativa.aba = aba;
        if (pagina.isClosed() || pagina.url() !== tentativa.origemUrl) {
          clearTimeout(tentativa.timerMiniaturas);
          capturaPendente = null;
          return {ok:false,mensagem:'A página original mudou. Reabra a matéria para selecionar o link.'};
        }
        const materia = materias.get(tentativa.materiaId);
        if (!materia || materia.dados.links[tentativa.fonte]) return {ok:false,mensagem:'Esta matéria já possui um link ou não está disponível.'};
        materia.dados.links[tentativa.fonte] = href;
        clearTimeout(tentativa.timerMiniaturas);
        capturaPendente = null;
        await pagina.bringToFront().catch(() => {});
        const atualizado = await pagina.evaluate(({registro,fonte}) => {
          const interfaceCompartilhamento = window.__autoxsCompartilhamento;
          if (!interfaceCompartilhamento?.mostrarResultado) return false;
          interfaceCompartilhamento.mostrarResultado(registro, fonte);
          return true;
        }, {registro:materia,fonte:tentativa.fonte}).catch(() => false);
        if (!atualizado) return {ok:false,mensagem:'Link salvo, mas o modal não pôde ser atualizado. Reabra a matéria.'};
        setTimeout(() => { if (!aba.isClosed()) void aba.close().catch(() => {}); }, 0);
        return {ok:true,href};
      };
      try {
        const abertura = await abrirLaboratorioInstagram({
          janela,
          tentativaId:tentativa.id,
          fonte,
          aoFechar:aba => {
            clearTimeout(tentativa.timerMiniaturas);
            if (capturaPendente === tentativa && tentativa.aba === aba) capturaPendente = null;
          },
          receberLink:tentativa.receberLink,
          receberOpcoes:async ({aba,tentativaId,opcoes}) => {
            if (capturaPendente !== tentativa || tentativa.id !== tentativaId ||
                (tentativa.aba && tentativa.aba !== aba)) return {ok:false,mensagem:'Esta tentativa de captura não está ativa.'};
            if (!tentativa.aba) tentativa.aba = aba;
            if (pagina.isClosed() || pagina.url() !== tentativa.origemUrl) {
              clearTimeout(tentativa.timerMiniaturas);
              capturaPendente = null;
              return {ok:false,mensagem:'A página original mudou. Reabra a matéria para selecionar o link.'};
            }
            tentativa.opcoesPermitidas = new Set(opcoes.map(({url}) => url));
            tentativa.opcoesRecebidas = true;
            clearTimeout(tentativa.timerMiniaturas);
            if (tentativa.modoAntigo) return {ok:true};
            await pagina.bringToFront().catch(() => {});
            const exibido = await pagina.evaluate(dados => {
              const interfaceCompartilhamento = window.__autoxsCompartilhamento;
              if (!interfaceCompartilhamento?.mostrarOpcoesFonte) return false;
              interfaceCompartilhamento.mostrarOpcoesFonte(dados);
              return true;
            }, {materiaId:tentativa.materiaId,fonte:tentativa.fonte,tentativaId:tentativa.id,opcoes}).catch(() => false);
            return exibido ? {ok:true} : {ok:false,mensagem:'As opções foram obtidas, mas a janela não pôde ser exibida.'};
          }
        });
        tentativa.aba = abertura.aba;
        await pagina.bringToFront().catch(() => {});
        if (abertura.ok && !tentativa.opcoesRecebidas) {
          tentativa.timerMiniaturas = setTimeout(async () => {
            if (capturaPendente !== tentativa || tentativa.opcoesRecebidas || tentativa.modoAntigo || pagina.isClosed()) return;
            await pagina.bringToFront().catch(() => {});
            await pagina.evaluate(dados => window.__autoxsCompartilhamento?.mostrarErroFonte?.(dados), {
              materiaId:tentativa.materiaId, fonte:tentativa.fonte, tentativaId:tentativa.id,
              mensagem:'Não foi possível carregar as opções.'
            }).catch(() => {});
          }, 15000);
        }
        return {ok:abertura.ok,mensagem:abertura.mensagem,tentativaId:tentativa.id};
      } catch (erro) {
        clearTimeout(tentativa.timerMiniaturas);
        if (capturaPendente === tentativa) capturaPendente = null;
        return {ok:false,mensagem:erro.message || 'Não foi possível abrir o Instagram.'};
      }
    });
    await pagina.exposeBinding('abrirFacebook', async ({frame}, entrada) => {
      if (!origemValida(frame)) return {ok:false,mensagem:'Abra a página pública da Tribuna do Sertão.'};
      const materiaId = entrada?.materiaId;
      const fonte = entrada?.fonte;
      if (typeof materiaId !== 'string' || !materias.has(materiaId)) return {ok:false,mensagem:'Esta matéria não está preparada.'};
      if (!['facebookSertao', 'facebookAgreste'].includes(fonte)) return {ok:false,mensagem:'Fonte do Facebook não autorizada.'};
      if (capturaPendente) return {ok:false,mensagem:'Já existe uma seleção de link em andamento.'};
      if (materias.get(materiaId).dados.links[fonte]) return {ok:false,mensagem:'Esta matéria já possui um link nessa fonte.'};
      const tentativa = {
        id:randomUUID(), materiaId, fonte, pagina, origemUrl:pagina.url(), aba:null,
        opcoesPermitidas:new Set(), opcoesRecebidas:false, modoAntigo:false,
        timerMiniaturas:null, receberLink:null, carregarReels:null
      };
      capturaPendente = tentativa;
      tentativa.receberLink = async ({aba,tentativaId,href}) => {
        if (capturaPendente !== tentativa || tentativa.id !== tentativaId ||
            (tentativa.aba && tentativa.aba !== aba)) return {ok:false,mensagem:'Esta seleção não está ativa.'};
        if (!tentativa.aba) tentativa.aba = aba;
        if (pagina.isClosed() || pagina.url() !== tentativa.origemUrl) {
          clearTimeout(tentativa.timerMiniaturas);
          capturaPendente = null;
          return {ok:false,mensagem:'A página original mudou. Reabra a matéria para selecionar o link.'};
        }
        const materia = materias.get(tentativa.materiaId);
        console.log(`[FACEBOOK] Link escolhido: ${href}`);
        if (!materia || materia.dados.links[tentativa.fonte]) {
          console.log('[FACEBOOK] Link salvo: NÃO');
          return {ok:false,mensagem:'Esta matéria já possui um link ou não está disponível.'};
        }
        materia.dados.links[tentativa.fonte] = href;
        console.log('[FACEBOOK] Link salvo: SIM');
        clearTimeout(tentativa.timerMiniaturas);
        capturaPendente = null;
        const tribunaRecuperada = await pagina.bringToFront().then(() => true).catch(() => false);
        const atualizado = await pagina.evaluate(({registro,fonte}) => {
          const interfaceCompartilhamento = window.__autoxsCompartilhamento;
          if (!interfaceCompartilhamento?.mostrarResultado) return false;
          interfaceCompartilhamento.mostrarResultado(registro, fonte);
          return true;
        }, {registro:materia,fonte:tentativa.fonte}).catch(() => false);
        const paginaAuxiliarFechada = aba.isClosed()
          ? true
          : await aba.close().then(() => true).catch(() => false);
        console.log(`[FACEBOOK] Page auxiliar fechada: ${paginaAuxiliarFechada ? 'SIM' : 'NÃO'}`);
        console.log(`[FACEBOOK] Tribuna recuperada: ${tribunaRecuperada ? 'SIM' : 'NÃO'}`);
        if (!atualizado) return {ok:false,mensagem:'Link salvo, mas o modal não pôde ser atualizado. Reabra a matéria.'};
        return {ok:true,href};
      };
      try {
        const abertura = await abrirLaboratorioFacebook({
          janela,
          tentativaId:tentativa.id,
          fonte,
          aoFechar:aba => {
            clearTimeout(tentativa.timerMiniaturas);
            if (capturaPendente === tentativa && tentativa.aba === aba) capturaPendente = null;
          },
          receberLink:tentativa.receberLink,
          receberOpcoes:async ({aba,tentativaId,opcoes,carregarReels}) => {
            if (capturaPendente !== tentativa || tentativa.id !== tentativaId ||
                (tentativa.aba && tentativa.aba !== aba)) return {ok:false,mensagem:'Esta seleção não está ativa.'};
            if (!tentativa.aba) tentativa.aba = aba;
            if (pagina.isClosed() || pagina.url() !== tentativa.origemUrl) {
              clearTimeout(tentativa.timerMiniaturas);
              capturaPendente = null;
              return {ok:false,mensagem:'A página original mudou. Reabra a matéria para selecionar o link.'};
            }
            tentativa.carregarReels = carregarReels;
            tentativa.opcoesPermitidas = new Set(opcoes.map(({url}) => url));
            tentativa.opcoesRecebidas = true;
            clearTimeout(tentativa.timerMiniaturas);
            if (tentativa.modoAntigo) return {ok:true};
            await pagina.bringToFront().catch(() => {});
            const exibido = await pagina.evaluate(dados => {
              const interfaceCompartilhamento = window.__autoxsCompartilhamento;
              if (!interfaceCompartilhamento?.mostrarOpcoesFonte) return false;
              interfaceCompartilhamento.mostrarOpcoesFonte(dados);
              return true;
            }, {
              materiaId:tentativa.materiaId,
              fonte:tentativa.fonte,
              tentativaId:tentativa.id,
              opcoes
            }).catch(() => false);
            return exibido ? {ok:true} : {ok:false,mensagem:'As miniaturas foram obtidas, mas a janela não pôde ser exibida.'};
          }
        });
        tentativa.aba = abertura.aba;
        await pagina.bringToFront().catch(() => {});
        if (abertura.ok && !tentativa.opcoesRecebidas) {
          tentativa.timerMiniaturas = setTimeout(async () => {
            if (capturaPendente !== tentativa || tentativa.opcoesRecebidas || tentativa.modoAntigo || pagina.isClosed()) return;
            await pagina.bringToFront().catch(() => {});
            await pagina.evaluate(dados => {
              window.__autoxsCompartilhamento?.mostrarErroFonte?.(dados);
            }, {
              materiaId:tentativa.materiaId,
              fonte:tentativa.fonte,
              tentativaId:tentativa.id,
              mensagem:'Não foi possível carregar as publicações.'
            }).catch(() => {});
          }, 15000);
        }
        return {ok:abertura.ok,mensagem:abertura.mensagem,tentativaId:tentativa.id};
      } catch (erro) {
        clearTimeout(tentativa.timerMiniaturas);
        if (capturaPendente === tentativa) capturaPendente = null;
        return {ok:false,mensagem:erro.message || 'Não foi possível abrir o Facebook.'};
      }
    });
    await pagina.exposeBinding('carregarReelsFacebook', async ({frame}, entrada) => {
      if (!origemValida(frame)) return {ok:false,mensagem:'Abra a página pública da Tribuna do Sertão.'};
      const tentativa = capturaPendente;
      if (!tentativa || tentativa.id !== entrada?.tentativaId || tentativa.materiaId !== entrada?.materiaId ||
          tentativa.fonte !== entrada?.fonte || typeof tentativa.carregarReels !== 'function' ||
          !tentativa.aba || tentativa.aba.isClosed()) {
        return {ok:false,mensagem:'A coleta de Reels não está mais disponível.'};
      }
      try {
        const opcoes = await tentativa.carregarReels();
        for (const {url} of opcoes) tentativa.opcoesPermitidas.add(url);
        await pagina.bringToFront().catch(() => {});
        return {ok:true,opcoes};
      } catch (erro) {
        await pagina.bringToFront().catch(() => {});
        return {ok:false,mensagem:erro.message || 'Não foi possível carregar os Reels.'};
      }
    });
    await pagina.exposeBinding('usarOpcaoFonte', async ({frame}, entrada) => {
      if (!origemValida(frame)) return {ok:false,mensagem:'Abra a página pública da Tribuna do Sertão.'};
      const tentativa = capturaPendente;
      if (!tentativa || tentativa.id !== entrada?.tentativaId || tentativa.materiaId !== entrada?.materiaId ||
          tentativa.fonte !== entrada?.fonte || !tentativa.opcoesPermitidas?.has(entrada?.url) ||
          !tentativa.aba || tentativa.aba.isClosed()) {
        return {ok:false,mensagem:'Esta opção não está mais disponível.'};
      }
      return tentativa.receberLink({aba:tentativa.aba,tentativaId:tentativa.id,href:entrada.url});
    });
    await pagina.exposeBinding('abrirFonteFallback', async ({frame}, entrada) => {
      if (!origemValida(frame)) return {ok:false,mensagem:'Abra a página pública da Tribuna do Sertão.'};
      const tentativa = capturaPendente;
      if (!tentativa || tentativa.id !== entrada?.tentativaId || tentativa.materiaId !== entrada?.materiaId ||
          tentativa.fonte !== entrada?.fonte || !tentativa.aba || tentativa.aba.isClosed()) {
        return {ok:false,mensagem:'A página auxiliar desta fonte não está disponível.'};
      }
      tentativa.modoAntigo = true;
      clearTimeout(tentativa.timerMiniaturas);
      await tentativa.aba.bringToFront();
      return {ok:true};
    });
    await pagina.exposeBinding('cancelarSelecaoFonte', async ({frame}, entrada) => {
      if (!origemValida(frame)) return {ok:false,mensagem:'Abra a página pública da Tribuna do Sertão.'};
      const tentativa = capturaPendente;
      if (!tentativa || tentativa.id !== entrada?.tentativaId || tentativa.materiaId !== entrada?.materiaId ||
          tentativa.fonte !== entrada?.fonte) return {ok:true};
      clearTimeout(tentativa.timerMiniaturas);
      capturaPendente = null;
      const ehFacebook = tentativa.fonte?.startsWith('facebook');
      const paginaAuxiliarFechada = !tentativa.aba || tentativa.aba.isClosed()
        ? true
        : await tentativa.aba.close().then(() => true).catch(() => false);
      const tribunaRecuperada = ehFacebook
        ? await pagina.bringToFront().then(() => true).catch(() => false)
        : true;
      if (ehFacebook) {
        console.log(`[FACEBOOK] Page auxiliar fechada: ${paginaAuxiliarFechada ? 'SIM' : 'NÃO'}`);
        console.log(`[FACEBOOK] Tribuna recuperada: ${tribunaRecuperada ? 'SIM' : 'NÃO'}`);
      }
      return {ok:true};
    });
    await pagina.exposeBinding('prepararTextoFonte', async ({frame}, entrada) => {
      if (!origemValida(frame)) return {ok:false,mensagem:'Abra a página pública da Tribuna do Sertão.'};
      const materia = materias.get(entrada?.materiaId);
      const fonte = entrada?.fonte;
      if (!materia || !['siteSertao','siteAgreste','instagramSertao','instagramAgreste','facebookSertao','facebookAgreste'].includes(fonte)) {
        return {ok:false,mensagem:'Matéria ou fonte indisponível.'};
      }
      const url = fonte === 'siteSertao' ? materia.dados.urlSertao : materia.dados.links[fonte];
      if (!url) return {ok:false,mensagem:'Esta fonte ainda não possui URL.'};
      const montarTexto = fonte.startsWith('facebook') ? montarTextoFacebook : montarTextoCompartilhamento;
      return {ok:true,texto:montarTexto({...materia.dados,url})};
    });
    await pagina.exposeBinding('registrarCompartilhamento', async ({ frame }, evento) => {
      if (!origemValida(frame) || !evento || typeof evento !== 'object') return;
      if (evento.tipo === 'nova-listagem') {
        console.log('🔄 Nova listagem detectada');
        return;
      }
      if (evento.tipo !== 'resumo') return;
      const detectadas = Math.max(0, Number(evento.detectadas) || 0);
      const adicionados = Math.max(0, Number(evento.adicionados) || 0);
      console.log(`🔗 Compartilhamento ativo: ${detectadas} matérias detectadas`);
      console.log(adicionados > 0 ? `➕ Botões adicionados: ${adicionados}` : '✅ Botões já estavam ativos');
    });
    await pagina.addInitScript(instalarInterfaceCompartilhamento);
    pagina.on('domcontentloaded', () => {
      if (pagina.isClosed() || !pertenceAoSitePublico(pagina.url())) return;
      if (!navegacoesIniciais.has(pagina)) console.log('🔄 Nova listagem detectada');
      void pagina.evaluate(() => Boolean(window.__autoxsCompartilhamento?.instalado))
        .then(instalada => instalada ? undefined : pagina.evaluate(instalarInterfaceCompartilhamento))
        .catch(() => {});
    });
    paginasVinculadas.add(pagina);
  }

  async function prepararPaginaInicial(pagina) {
    await vincularPagina(pagina);
    navegacoesIniciais.add(pagina);
    try {
      await pagina.goto(SITE_PUBLICO, { waitUntil:'domcontentloaded', timeout:30000 });
      const linkUltimas = pagina.getByRole('link', { name:/^\s*ÚLTIMAS\s*$/i }).filter({ visible:true });
      if (!await linkUltimas.count()) {
        throw new Error('A seção “ÚLTIMAS” não foi encontrada no menu do site público.');
      }
      const href = await linkUltimas.first().getAttribute('href');
      const destino = new URL(href, SITE_PUBLICO);
      if (!pertenceAoSitePublico(destino)) throw new Error('O endereço da seção “ÚLTIMAS” não é válido.');
      await pagina.goto(destino.href, { waitUntil:'domcontentloaded', timeout:30000 });
      await pagina.evaluate(instalarInterfaceCompartilhamento);
    } finally {
      navegacoesIniciais.delete(pagina);
    }
  }

  async function abrir() {
    if (listagem && !listagem.isClosed()) {
      await vincularPagina(listagem);
      const instalada = await listagem.evaluate(() => Boolean(window.__autoxsCompartilhamento?.instalado)).catch(() => false);
      if (!instalada) {
        if (pertenceAoSitePublico(listagem.url())) await listagem.evaluate(instalarInterfaceCompartilhamento);
        else await prepararPaginaInicial(listagem);
      }
      await listagem.bringToFront();
      return;
    }
    listagem = await janela.newPage();
    try {
      await prepararPaginaInicial(listagem);
      await listagem.bringToFront();
    }
    catch (erro) { await listagem.close().catch(() => {}); listagem = null; throw erro; }
  }

  return {
    abrir: async () => {
      if (!abrindo) abrindo = abrir().finally(() => { abrindo = null; });
      return abrindo;
    }
  };
}

module.exports = { criarCompartilhamento, montarTextoCompartilhamento, identidadeMateria };
