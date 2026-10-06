// Esta função não depende de Node: a mesma regra é usada na página e no envio do AutoXS.
function validarRequisitosDaMateria(formulario) {
  const resultado = { valido: false, temChapeu: false, temFoto: false, fotoIdentificavel: false, faltando: [], quantidadeFotos: 0 };
  if (!formulario) {
    resultado.faltando = ['chapeu', 'foto'];
    return resultado;
  }
  const campo = formulario.querySelector('#inp_hat, input[name="hat"], input[name*="chapeu" i], textarea[name*="chapeu" i]');
  resultado.temChapeu = Boolean(campo && String(campo.value || '').trim());

  // Na Adição, a foto é opcional; a proteção do AutoXS exige somente chapéu.
  if (/^\/news\/add\/?$/.test(formulario.ownerDocument.defaultView?.location.pathname || '')) {
    resultado.temFoto = true;
    if (!resultado.temChapeu) resultado.faltando.push('chapeu');
    resultado.valido = resultado.temChapeu;
    return resultado;
  }

  const documento = formulario.ownerDocument;
  const visivel = elemento => elemento.getClientRects().length > 0 &&
    getComputedStyle(elemento).visibility !== 'hidden';
  const fotoValida = imagem => {
    if (!visivel(imagem) || !imagem.complete || imagem.naturalWidth <= 0 || imagem.naturalHeight <= 0) return false;
    const box = imagem.getBoundingClientRect();
    if (box.width < 80 || box.height < 50) return false;
    const src = imagem.currentSrc || imagem.src || '';
    return Boolean(src) && !/(?:placeholder|no[-_]?image|sem[-_]?imagem|default[-_]?image)/i.test(src);
  };

  // O heading delimita a seção editorial. Não depende de scroll nem dos botões +.
  const rotulos = [...documento.querySelectorAll('h1, h2, h3, h4, h5, h6')]
    .filter(elemento => visivel(elemento) &&
      !elemento.closest('.modal, [role="dialog"], dialog, .rx-editor') &&
      /^imagem\s+(?:de\s+)?destaque\s*[:*]?$/i.test(elemento.textContent.replace(/\s+/g, ' ').trim()));
  if (rotulos.length === 1) {
    resultado.fotoIdentificavel = true;
    const rotulo = rotulos[0];
    const nivel = Number(rotulo.tagName.slice(1));
    try {
      const headingsSeguintes = [...documento.querySelectorAll('h1, h2, h3, h4, h5, h6')]
        .filter(elemento => elemento !== rotulo && visivel(elemento) &&
          !elemento.closest('.modal, [role="dialog"], dialog, .rx-editor') &&
          Boolean(rotulo.compareDocumentPosition(elemento) & Node.DOCUMENT_POSITION_FOLLOWING));
      const proximaSecao = headingsSeguintes.find(elemento =>
        /^galeria(?:\s+de\s+fotos|\s+de\s+imagens)?\s*[:*]?$/i.test(elemento.textContent.replace(/\s+/g, ' ').trim()) ||
        Number(elemento.tagName.slice(1)) <= nivel);
      // O ancestral comum dos dois cabeçalhos delimita o trecho da seção; a linha do H5 não contém o card.
      let container = rotulo.parentElement;
      if (proximaSecao) {
        while (container && !container.contains(proximaSecao)) container = container.parentElement;
      } else {
        container = rotulo.closest('form') || documento.body;
      }
      if (container) {
        const walker = documento.createTreeWalker(container, 1);
        walker.currentNode = rotulo;
        let nosPercorridos = 0;
        while (walker.nextNode() && ++nosPercorridos <= 5000) {
          const elemento = walker.currentNode;
          if (elemento === proximaSecao) break;
          if (elemento.tagName !== 'IMG') continue;
          const classeCorreta = elemento.matches('img.rounded-1.me-9.flex-shrink-0');
          const envoltorioCorreto = Boolean(elemento.closest('.d-flex.align-items-center'));
          const excluida = Boolean(elemento.closest('.rx-editor, [contenteditable="true"], .modal, [role="dialog"], dialog'));
          const aceita = classeCorreta && envoltorioCorreto && !excluida && fotoValida(elemento);
          if (!aceita) continue;
          resultado.quantidadeFotos = 1;
          break;
        }
      }
    } catch {}
  } else if (rotulos.length === 0) {
    // Layout anterior do Atualizar matérias (57fe684): imagem entre os dois primeiros +.
    try {
      const botoesMais = [...documento.querySelectorAll('button')]
        .filter(botao => botao.textContent.trim() === '+' && visivel(botao));
      if (botoesMais.length >= 2) {
        const inicio = botoesMais[0].getBoundingClientRect().top;
        const fim = botoesMais[1].getBoundingClientRect().top;
        if (fim > inicio) {
          resultado.fotoIdentificavel = true;
          for (const imagem of documento.querySelectorAll('img')) {
            if (imagem.closest('.rx-editor, [contenteditable="true"], .modal, [role="dialog"], dialog') ||
                !fotoValida(imagem)) continue;
            const box = imagem.getBoundingClientRect();
            if (box.top > inicio && box.top < fim) resultado.quantidadeFotos++;
          }
        }
      }
    } catch {}
  }
  resultado.temFoto = resultado.quantidadeFotos > 0;
  if (!resultado.temChapeu) resultado.faltando.push('chapeu');
  if (!resultado.temFoto) resultado.faltando.push('foto');
  resultado.valido = resultado.faltando.length === 0;
  return resultado;
}
const paginasPreparadas = new WeakSet();
async function instalarProtecaoEnvioCMS(pagina) {
  if (paginasPreparadas.has(pagina)) return;
  const instalar = () => {
    if (location.origin !== 'https://redacao.tribunaweb.com.br' || !/^\/news\/(?:add|edit\/[^/]+)\/?$/.test(location.pathname)) return;
    if (window.__autoxsProtecaoEnvioCMS) return;
    window.__autoxsProtecaoEnvioCMS = true;
    const reconhecer = formulario => formulario instanceof HTMLFormElement &&
      Boolean(formulario.querySelector('#inp_title, input[name="title"]')) &&
      Boolean(formulario.querySelector('#inp_hat, input[name="hat"]')) &&
      location.origin === 'https://redacao.tribunaweb.com.br' &&
      /^\/news\/(?:add|edit\/[^/]+)\/?$/.test(location.pathname);

    function avisar(resultado) {
      const mensagem = !resultado.temChapeu && !resultado.temFoto
        ? '⚠️ CHAPÉU E FOTO FALTANDO'
        : !resultado.temChapeu ? '⚠️ CHAPÉU FALTANDO' : '⚠️ FOTO FALTANDO';
      document.getElementById('autoxs-aviso-materia-incompleta')?.remove();
      const aviso = document.createElement('div');
      aviso.id = 'autoxs-aviso-materia-incompleta';
      aviso.setAttribute('role', 'status');
      aviso.textContent = mensagem;
      Object.assign(aviso.style, {
        position: 'fixed', top: '24px', left: '50%', transform: 'translateX(-50%)',
        zIndex: '2147483647', padding: '18px 28px', borderRadius: '10px',
        background: '#b42318', color: '#fff', font: '700 22px/1.2 Arial, sans-serif',
        boxShadow: '0 10px 30px rgba(0,0,0,.45)', textAlign: 'center', pointerEvents: 'none'
      });
      document.body.appendChild(aviso);
      window.setTimeout(() => aviso.remove(), 2500);
      const formulario = document.querySelector('#inp_hat, input[name="hat"]')?.closest('form');
      if (!formulario) return;
      if (!resultado.temChapeu) {
        const campo = formulario.querySelector('#inp_hat, input[name="hat"]');
        if (campo) {
          const borda = campo.style.outline;
          campo.style.outline = '3px solid #b42318';
          campo.scrollIntoView({ behavior: 'smooth', block: 'center' });
          window.__autoxsAtualizarSugestoesChapeuCMS?.();
          window.setTimeout(() => { if (campo.isConnected) campo.style.outline = borda; }, 2500);
        }
      }
      if (!resultado.temFoto) {
        const mais = [...formulario.querySelectorAll('button')].find(botao => botao.textContent.trim() === '+');
        if (mais) {
          const borda = mais.style.outline;
          mais.style.outline = '3px solid #b42318';
          window.setTimeout(() => { if (mais.isConnected) mais.style.outline = borda; }, 2500);
        }
      }
    }

    function barrarSeIncompleta(evento, formulario) {
      if (!reconhecer(formulario)) return;
      const resultado = validarRequisitosDaMateria(formulario);
      if (resultado.valido) return;
      evento.preventDefault();
      evento.stopImmediatePropagation();
      avisar(resultado);
    }
    // Esses três campos são inputs de uma linha e Enter neles publica no CMS.
    // O editor do corpo e os demais campos não passam por este filtro.
    function impedirEnterAcidental(evento) {
      if (evento.key !== 'Enter') return;
      const campo = evento.target;
      if (!(campo instanceof HTMLInputElement) ||
          !campo.matches('#inp_title, input[name="title"], #inp_hat, input[name="hat"], #inp_author, input[name="author"]') ||
          !reconhecer(campo.form)) return;
      if (/^\/news\/add\/?$/.test(location.pathname) && validarRequisitosDaMateria(campo.form).valido) return;
      evento.preventDefault();
      evento.stopImmediatePropagation();
      if (evento.type === 'keydown' && !evento.repeat) {
        const resultado = validarRequisitosDaMateria(campo.form);
        if (!resultado.valido) avisar(resultado);
      }
    }
    for (const tipo of ['keydown', 'keypress', 'keyup']) {
      window.addEventListener(tipo, impedirEnterAcidental, true);
    }
    // Cobre clique, Enter e requestSubmit sem interferir na edição de texto.
    window.addEventListener('submit', evento => {
      barrarSeIncompleta(evento, evento.target);
    }, true);
    // O CMS pode enviar via JavaScript no clique sem disparar submit.
    window.addEventListener('click', evento => {
      const botao = evento.target.closest?.('button, input[type="submit"]');
      if (!botao || botao.closest('.modal, [role="dialog"], dialog')) return;
      const formulario = botao.closest('form');
      if (!reconhecer(formulario)) return;
      const nome = (botao.textContent || botao.value || '').replace(/[^\p{L}\p{N}\s]/gu, '').trim();
      const envia = botao.matches('[type="submit"]') || /^(?:enviar|salvar|atualizar|publicar)(?:\s+mat[eé]ria)?$/iu.test(nome);
      if (envia) barrarSeIncompleta(evento, formulario);
    }, true);
  };
  const conteudo = `(() => { ${validarRequisitosDaMateria.toString()}; (${instalar.toString()})(); })()`;
  await pagina.addInitScript({ content: conteudo });
  await pagina.evaluate(conteudo);
  paginasPreparadas.add(pagina);
}

module.exports = { validarRequisitosDaMateria, instalarProtecaoEnvioCMS };
