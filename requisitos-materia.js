// Esta função não depende de Node: a mesma regra é usada na página e no envio do AutoXS.
function validarRequisitosDaMateria(formulario) {
  const resultado = { valido: false, temChapeu: false, temFoto: false, faltando: [], quantidadeFotos: 0 };
  if (!formulario) {
    resultado.faltando = ['chapeu', 'foto'];
    return resultado;
  }
  const campo = formulario.querySelector('#inp_hat, input[name="hat"], input[name*="chapeu" i], textarea[name*="chapeu" i]');
  resultado.temChapeu = Boolean(campo && String(campo.value || '').trim());

  // No CMS, o primeiro + pertence à imagem destaque e o segundo à galeria.
  // Imagens do corpo, fora desse trecho do formulário, não servem como destaque.
  const botoesMais = [...formulario.querySelectorAll('button')]
    .filter(botao => botao.textContent.trim() === '+' && botao.getClientRects().length);
  if (botoesMais.length >= 2) {
    const inicio = botoesMais[0].getBoundingClientRect().top;
    const fim = botoesMais[1].getBoundingClientRect().top;
    if (fim > inicio) {
      for (const imagem of formulario.querySelectorAll('img')) {
        if (!imagem.getClientRects().length || getComputedStyle(imagem).visibility === 'hidden') continue;
        const box = imagem.getBoundingClientRect();
        if (box.top <= inicio || box.top >= fim || box.width < 80 || box.height < 50) continue;
        if (!imagem.complete || !imagem.naturalWidth) continue;
        const src = imagem.currentSrc || imagem.src || '';
        if (/(?:placeholder|no[-_]?image|sem[-_]?imagem|default[-_]?image)/i.test(src)) continue;
        resultado.quantidadeFotos++;
      }
    }
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
