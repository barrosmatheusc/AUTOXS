const paginasPreparadas = new WeakSet();
const acoesGeracao = new WeakMap();
const geracoesAtivas = new WeakSet();

async function avisarGeracao(aba, mensagem) {
  if (aba.isClosed()) return;
  await aba.evaluate(texto => {
    let aviso = document.querySelector('#manual-aviso-geracao');
    if (!aviso) {
      aviso = document.createElement('div');
      aviso.id = 'manual-aviso-geracao'; aviso.setAttribute('role', 'status');
      aviso.style.cssText = 'pointer-events:none;position:fixed;bottom:20px;right:20px;z-index:2147483647;background:#1b2b23;color:#eff7f1;border:1px solid #6a8f79;border-radius:12px;padding:16px;max-width:390px;font:14px/1.5 Segoe UI,Arial;box-shadow:0 8px 30px #0006';
      const conteudo = document.createElement('span'); aviso.appendChild(conteudo);
      const fechar = document.createElement('button'); fechar.type='button'; fechar.textContent='×'; fechar.setAttribute('aria-label','Fechar aviso de geração');
      fechar.style.cssText='pointer-events:auto;margin-left:12px;color:inherit;background:transparent;border:0;font-size:20px;cursor:pointer';
      fechar.addEventListener('click',()=>aviso.remove()); aviso.appendChild(fechar); document.body.appendChild(aviso);
    }
    aviso.querySelector('span').textContent = texto;
  }, mensagem).catch(() => {});
}

async function mostrarAjudaFotos(aba, dialog, titulo, opcoes = {}) {
  if (opcoes.gerarImagem) acoesGeracao.set(aba, opcoes.gerarImagem);
  if (!paginasPreparadas.has(aba)) {
    await aba.exposeBinding('__manualPesquisarFoto', async ({ frame }, entrada) => {
      if (frame !== aba.mainFrame()) return { ok: false };
      const apenasPreencher = entrada?.apenasPreencher === true;
      const valor = apenasPreencher ? entrada.termo : entrada;
      if (typeof valor !== 'string' || valor.trim().length > 120) return { ok: false };
      const termo = valor.trim();
      if (!termo && !apenasPreencher) return { ok: false };
      try {
        const modal = aba.getByRole('dialog', { name: /Imagem de Destaque/i });
        if (!await modal.isVisible()) return { ok: false };
        const campo = modal.getByRole('searchbox', { name: 'Pesquisar:' });
        await campo.fill(termo);
        if (!apenasPreencher) await campo.press('Enter');
        return { ok: true, termo };
      } catch { return { ok: false }; }
    });
    await aba.exposeBinding('__manualGerarFoto', async ({ frame }) => {
      if (frame !== aba.mainFrame() || geracoesAtivas.has(aba)) return { ok: false };
      const acao = acoesGeracao.get(aba);
      const modal = aba.getByRole('dialog', { name: /Imagem de Destaque/i });
      if (!acao || !await modal.isVisible()) return { ok: false };
      geracoesAtivas.add(aba);
      try {
        await avisarGeracao(aba, 'Preparando o Nano Banana…');
        const gerada = await acao(mensagem => avisarGeracao(aba, String(mensagem).trim()));
        await avisarGeracao(aba, gerada ? 'Foto gerada. Confira a matéria antes de enviar.' : 'Geração não realizada. Confira se a matéria já tem foto.');
        return { ok: Boolean(gerada) };
      } catch {
        await avisarGeracao(aba, 'Não foi possível concluir a geração. Confira a janela de imagem; a matéria não foi enviada.');
        return { ok: false };
      } finally { geracoesAtivas.delete(aba); }
    });
    paginasPreparadas.add(aba);
  }
  const atual = await dialog.getByRole('searchbox', { name: 'Pesquisar:' }).inputValue();
  await dialog.evaluate((modal, dados) => {
    // Dentro do modal para funcionar também em dialogs nativos e manter o foco.
    let host = modal.querySelector('#manual-ajuda-fotos');
    if (host) { host.atualizar(dados); return; }
    host = document.createElement('div');
    host.id = 'manual-ajuda-fotos';
    host.style.cssText = 'position:fixed;z-index:2147483646;top:94px;right:22px;width:min(350px,calc(100vw - 24px));font-size:14px;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      :host { color-scheme: dark; font-family: "Segoe UI", Arial, sans-serif; color: #eff7f1; }
      * { box-sizing: border-box; }
      .card { background: #1b2b23; border: 1px solid #6a8f79; border-radius: 16px; box-shadow: 0 14px 42px #0007; overflow: hidden; }
      header { padding: 13px 14px; display: flex; align-items: center; gap: 8px; background: #294134; }
      .mover { flex: 1; font-size: 14px; font-weight: 600; cursor: grab; touch-action: none; user-select: none; outline-offset: 4px; }
      .mover:active { cursor: grabbing; }
      .mover small { display: block; margin-top: 3px; font-size: 11px; font-weight: 400; color: #b5cbbb; }
      button, input { font: inherit; }
      button { cursor: pointer; }
      .recolher { background: transparent; border: 1px solid #65816f; color: #f1f8f3; border-radius: 7px; width: 28px; height: 28px; font-size: 19px; }
      .conteudo { padding: 16px; max-height: calc(100vh - 170px); overflow: auto; }
      .conteudo[hidden] { display: none; }
      [hidden] { display: none !important; }
      .palavras { margin: 0 0 18px; line-height: 2; overflow-wrap: anywhere; }
      .palavra { display: inline; padding: 2px 3px; border: 1px solid transparent; border-radius: 5px; background: transparent; color: #eff7f1; overflow-wrap: anywhere; }
      .palavra:hover { border-color: #a2edc5; background: #38583f; }
      .palavra[aria-pressed="true"] { background: #a2edc5; color: #142c1e; border-color: #a2edc5; }
      .instrucao { color: #b9cfc0; font-size: 12px; line-height: 1.5; margin: 0 0 14px; }
      .limpar-palavras { margin: 0 0 14px; padding: 6px 10px; border: 1px solid #65816f; border-radius: 7px; background: transparent; color: #def3e5; font-size: 12px; }
      .rotulo { color: #a6bfae; margin: 0 0 7px; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; }
      form { display: flex; gap: 7px; margin: 0; }
      input { min-width: 0; flex: 1; width: 100%; border: 1px solid #64816f; border-radius: 8px; padding: 10px; background: #13231a; color: white; font-size: 13px; }
      .buscar { border: 0; border-radius: 8px; background: #a2edc5; color: #132a1d; padding: 0 13px; font-weight: 600; font-size: 13px; }
      .alternativa { border-top: 1px solid #486050; margin-top: 16px; padding-top: 14px; }
      .alternativa p { color: #b9cfc0; font-size: 12px; line-height: 1.5; margin: 0 0 10px; }
      .gerar-ia { display: block; width: 100%; padding: 10px; border: 1px solid #91c8a6; border-radius: 8px; background: #335942; color: #edfff3; font-weight: 600; }
      .gerar-ia:hover:not(:disabled) { background: #416f52; }
      button:focus-visible, input:focus-visible { outline: 2px solid #d0ffe2; outline-offset: 2px; }
      button:disabled { opacity: .55; cursor: wait; }
      #status { margin: 11px 0 0; color: #bad0c2; font-size: 12px; line-height: 1.4; }
    </style>
    <section class="card" aria-label="Sugestões de busca">
      <header><div class="mover" tabindex="0" role="button" aria-label="Mover janela de sugestões; use as setas do teclado">Sugestões de busca<small>Arraste para mover</small></div><button class="recolher" type="button" aria-label="Minimizar sugestões" aria-expanded="true">−</button></header>
      <div class="conteudo">
      <p class="instrucao">Clique nas palavras para montar a busca na ordem que quiser. Clique novamente para retirar. Depois, use Buscar.</p><p class="rotulo">Título da matéria</p><div class="palavras" id="titulo" role="group" aria-label="Palavras do título"></div><p class="rotulo">Subtítulo (bigode)</p><div class="palavras" id="subtitulo" role="group" aria-label="Palavras do subtítulo"></div><button class="limpar-palavras" type="button">Limpar seleção</button>
      <form><input type="text" aria-label="Outro termo para buscar fotos" placeholder="Digite outro termo" maxlength="120"><button class="buscar" type="submit">Buscar</button></form>
      <p id="status" role="status">Selecione palavras do título ou do subtítulo e clique em Buscar.</p>
      <div class="alternativa"><p>Nenhuma foto serviu? Crie uma imagem com Nano Banana e confira antes de enviar.</p><button class="gerar-ia" type="button">Gerar IA</button></div></div>
    </section>`;
    modal.appendChild(host);
    const entrada = root.querySelector('input');
    const status = root.querySelector('#status');
    const mover = root.querySelector('.mover');
    let ocupado = false;
    let baseBusca = '';
    let versaoBusca = 0;
    let sincronizacao = Promise.resolve();
    const palavrasSelecionadas = new Map();
    const atualizarControles = () => {
      root.querySelectorAll('.palavra, .limpar-palavras, .buscar, .gerar-ia, input').forEach(b => { b.disabled = ocupado; });
      root.querySelector('.gerar-ia').disabled = ocupado || !host.podeGerar;
    };
    const marcarPalavras = () => root.querySelectorAll('.palavra').forEach(b => {
      b.setAttribute('aria-pressed', String(palavrasSelecionadas.has(b.dataset.chave)));
    });
    const sincronizarCampo = termo => {
      const versao = ++versaoBusca;
      // Serializa as alterações; cliques rápidos não podem restaurar uma busca antiga.
      sincronizacao = sincronizacao.catch(() => {}).then(async () => {
        if (versao !== versaoBusca) return;
        try {
          const resultado = await window.__manualPesquisarFoto({termo, apenasPreencher:true});
          if (!resultado.ok) throw new Error();
        } catch {
          if (versao === versaoBusca) status.textContent = 'A busca está montada aqui. Clique em Buscar para tentar pesquisar no acervo.';
        }
      });
    };
    const montarBusca = () => {
      const termo = [baseBusca.trim(), ...palavrasSelecionadas.values()].filter(Boolean).join(' ');
      if (termo.length > entrada.maxLength) {
        status.textContent = 'A busca pode ter até 120 caracteres. Retire uma palavra para acrescentar outra.';
        return false;
      }
      entrada.value = termo; marcarPalavras();
      status.textContent = termo ? 'Busca montada. Clique em Buscar para pesquisar.' : 'Selecione palavras do título ou do subtítulo.';
      sincronizarCampo(termo);
      return true;
    };
    const desenharPalavras = (seletor, texto, prefixo) => {
      const recipiente = root.querySelector(seletor);
      recipiente.replaceChildren();
      if (!texto) { recipiente.textContent = prefixo === 'titulo' ? 'Título não disponível' : 'Sem subtítulo'; return; }
      let fim = 0, indice = 0;
      // Mantém pontuação visível e preserva palavras como OAB-SP e nomes com apóstrofo.
      for (const parte of texto.matchAll(/[\p{L}\p{N}]+(?:[-'’.,][\p{L}\p{N}]+)*/gu)) {
        recipiente.appendChild(document.createTextNode(texto.slice(fim, parte.index)));
        const palavra = parte[0], chave = prefixo + '-' + indice++;
        const botao = document.createElement('button');
        botao.type = 'button'; botao.className = 'palavra'; botao.textContent = palavra;
        botao.dataset.chave = chave; botao.setAttribute('aria-pressed', 'false');
        botao.addEventListener('click', () => {
          if (ocupado) return;
          if (palavrasSelecionadas.has(chave)) { palavrasSelecionadas.delete(chave); montarBusca(); }
          else {
            palavrasSelecionadas.set(chave, palavra);
            if (!montarBusca()) palavrasSelecionadas.delete(chave);
          }
        });
        recipiente.appendChild(botao); fim = parte.index + palavra.length;
      }
      recipiente.appendChild(document.createTextNode(texto.slice(fim)));
    };
    root.querySelector('.limpar-palavras').addEventListener('click', () => {
      if (ocupado) return;
      palavrasSelecionadas.clear(); baseBusca = ''; montarBusca();
    });
    entrada.addEventListener('input', () => {
      palavrasSelecionadas.clear(); baseBusca = entrada.value; marcarPalavras();
      sincronizarCampo(entrada.value);
    });
    const buscar = async termo => {
      if (ocupado || !termo.trim()) return;
      ocupado = true;
      entrada.value = termo.trim();
      status.textContent = 'Pesquisando…';
      atualizarControles();
      try {
        ++versaoBusca;
        await sincronizacao;
        const resultado = await window.__manualPesquisarFoto(entrada.value);
        if (!resultado.ok) throw new Error();
        status.textContent = `Busca: ${resultado.termo}. Escolha a foto no acervo.`;
      } catch { status.textContent = 'Não foi possível pesquisar. Tente no campo do acervo.'; }
      finally { ocupado = false; atualizarControles(); }
    };
    root.querySelector('.gerar-ia').addEventListener('click', async () => {
      if (ocupado) return;
      ocupado = true;
      const botao = root.querySelector('.gerar-ia');
      botao.textContent = 'Gerando imagem…';
      atualizarControles();
      status.textContent = 'Fechando o acervo e abrindo o Nano Banana…';
      try {
        ++versaoBusca;
        await sincronizacao;
        const resultado = await window.__manualGerarFoto();
        status.textContent = resultado.ok ? 'Foto gerada. Confira a matéria antes de enviar.' : 'Confira a janela de geração. A matéria não foi enviada.';
      } catch { status.textContent = 'Não foi possível gerar a imagem. Confira a janela do site.'; }
      finally {
        ocupado = false; botao.textContent = 'Gerar IA';
        atualizarControles();
      }
    });
    root.querySelector('form').addEventListener('submit', e => { e.preventDefault(); e.stopPropagation(); void buscar(entrada.value); });
    root.querySelector('.recolher').addEventListener('click', e => {
      const conteudo = root.querySelector('.conteudo');
      conteudo.hidden = !conteudo.hidden;
      e.currentTarget.textContent = conteudo.hidden ? '+' : '−';
      e.currentTarget.setAttribute('aria-expanded', String(!conteudo.hidden));
      e.currentTarget.setAttribute('aria-label', conteudo.hidden ? 'Expandir sugestões' : 'Minimizar sugestões');
    });
    const posicionar = (x, y) => {
      const box = host.getBoundingClientRect();
      host.style.right = 'auto';
      host.style.left = `${Math.max(8, Math.min(x, innerWidth - box.width - 8))}px`;
      host.style.top = `${Math.max(8, Math.min(y, innerHeight - Math.min(box.height, 90) - 8))}px`;
    };
    let arraste;
    mover.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const box = host.getBoundingClientRect();
      arraste = { x: e.clientX - box.left, y: e.clientY - box.top };
      mover.setPointerCapture(e.pointerId); e.preventDefault();
    });
    mover.addEventListener('pointermove', e => { if (arraste) posicionar(e.clientX - arraste.x, e.clientY - arraste.y); });
    mover.addEventListener('pointerup', () => { arraste = null; });
    mover.addEventListener('pointercancel', () => { arraste = null; });
    mover.addEventListener('keydown', e => {
      const deslocamentos = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] };
      if (!deslocamentos[e.key]) return;
      e.preventDefault(); e.stopPropagation();
      const box = host.getBoundingClientRect(); const [dx, dy] = deslocamentos[e.key];
      posicionar(box.left + dx, box.top + dy);
    });
    host.atualizar = dados => {
      host.podeGerar = dados.podeGerar;
      ++versaoBusca;
      palavrasSelecionadas.clear(); baseBusca = '';
      desenharPalavras('#titulo', dados.titulo, 'titulo');
      desenharPalavras('#subtitulo', dados.subtitulo, 'subtitulo');
      entrada.value = dados.atual;
      status.textContent = 'Selecione palavras do título ou do subtítulo e clique em Buscar.';
      atualizarControles();
    };
    host.atualizar(dados);
  }, { titulo: String(titulo || ''), subtitulo: String(opcoes.subtitulo || ''), atual, podeGerar: acoesGeracao.has(aba) });
}

module.exports = { mostrarAjudaFotos };
