const { substituirTituloNaLegenda, definirLegendaCreditosPadrao } = require('./imagem-rj');
const preparadas = new WeakSet();

async function instalarBotaoLegenda(aba) {
  if (preparadas.has(aba)) {
    await aba.evaluate(() => window.__autoxsAtualizarBotaoLegenda?.());
    return;
  }
  await aba.exposeBinding('__autoxsTituloNaLegenda', async ({ frame }, acao = 'titulo') => {
    if (frame !== aba.mainFrame()) return { ok: false, mensagem: 'Abra a edição da matéria.' };
    const url = new URL(frame.url());
    if (url.origin !== 'https://redacao.tribunaweb.com.br' || !/^\/news\/(?:add\/?|edit\/[^/]+)$/.test(url.pathname)) return { ok: false, mensagem: 'Abra a edição da matéria.' };
    if (!['titulo', 'padrao'].includes(acao)) return { ok: false, mensagem: 'Escolha uma das ações da legenda.' };
    try {
      if (acao === 'padrao') {
        await definirLegendaCreditosPadrao(aba);
        return { ok: true, mensagem: 'Título aplicado na legenda. Legenda e créditos definidos como padrão da imagem.' };
      }
      await substituirTituloNaLegenda(aba);
      return { ok: true, mensagem: 'Título aplicado na legenda. A opção de padrão ficou desmarcada.' };
    } catch (erro) {
      return { ok: false, mensagem: erro.message || 'Não foi possível alterar a legenda. Confira a foto.' };
    }
  });
  const instalar = () => {
    if (window.__autoxsBotaoLegendaInstalado) {
      window.__autoxsAtualizarBotaoLegenda?.();
      return;
    }
    window.__autoxsBotaoLegendaInstalado = true;
    let ocupado = false;
    const visivel = el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
    function atualizar() {
      if (ocupado) return;
      const antigo = document.getElementById('autoxs-acao-legenda');
      if (location.origin !== 'https://redacao.tribunaweb.com.br' || !/^\/news\/(?:add\/?|edit\/[^/]+)$/.test(location.pathname)) { antigo?.remove(); return; }
      // Usa o texto do cabeçalho como referência. O botão fica fora do fluxo
      // do formulário para não deslocar o + nem aumentar a largura do rótulo.
      const formulario = document.querySelector('#inp_title, input[name="title"]')?.closest('form');
      if (!formulario) { antigo?.remove(); return; }
      const textos = document.createTreeWalker(formulario, NodeFilter.SHOW_TEXT);
      let rotulo = null;
      while (textos.nextNode()) {
        const texto = textos.currentNode, pai = texto.parentElement;
        if (!pai || !visivel(pai) || pai.closest('.modal, [role="dialog"], dialog, button, a, #autoxs-acao-legenda')) continue;
        if (/^imagem\s+(?:de\s+)?destaque\s*[:*]?$/i.test(texto.textContent.trim())) { rotulo = texto; break; }
      }
      if (!rotulo) { antigo?.remove(); return; }
      const faixa = document.createRange(); faixa.selectNodeContents(rotulo);
      const box = faixa.getBoundingClientRect();
      if (!box.width || !box.height) { antigo?.remove(); return; }
      const posicionar = grupo => {
        grupo.style.left = (box.right + window.scrollX + 8) + 'px';
        grupo.style.top = (box.top + window.scrollY - 4) + 'px';
        grupo.style.maxWidth = Math.max(80, document.documentElement.clientWidth - box.right - 20) + 'px';
      };
      if (antigo) { posicionar(antigo); return; }
      antigo?.remove();
      const grupo = document.createElement('span'); grupo.id = 'autoxs-acao-legenda';
      grupo.style.cssText = 'position:absolute;z-index:1000;display:inline-flex;align-items:center;gap:6px';
      const botao = document.createElement('button'); botao.type = 'button';
      botao.dataset.autoxsLegenda = 'true'; botao.textContent = 'Substituir título na legenda';
      botao.style.cssText = 'cursor:pointer;border:1px solid #607e6b;border-radius:6px;padding:5px 8px;background:#a2edc5;color:#10281b;font:600 12px Segoe UI;max-width:100%';
      const padrao = document.createElement('button'); padrao.type = 'button';
      padrao.dataset.autoxsLegenda = 'true'; padrao.textContent = 'Subs. Título/Tornar Padrão legendas';
      padrao.title = 'Substituir a legenda pelo título da matéria e tornar legenda e créditos padrão da imagem';
      padrao.style.cssText = 'cursor:pointer;border:1px solid #b7791f;border-radius:6px;padding:5px 8px;background:#ffe0a3;color:#4a2a00;font:600 12px Segoe UI;max-width:100%';
      const aviso = document.createElement('span'); aviso.setAttribute('role', 'note');
      aviso.style.cssText = 'position:absolute;top:100%;left:0;margin-top:4px;width:280px;max-width:70vw;padding:8px;border-radius:6px;background:#183b29;color:#fff;font:12px/1.4 Segoe UI;overflow-wrap:anywhere;pointer-events:none';
      aviso.hidden = true;
      const executarAcao = async (evento, acao) => {
        evento.preventDefault(); evento.stopPropagation();
        if (ocupado) return;
        ocupado = true; botao.disabled = true; padrao.disabled = true; aviso.hidden = false;
        aviso.textContent = acao === 'padrao' ? 'Aplicando o título na legenda e definindo legenda e créditos como padrão…' : 'Alterando a legenda…';
        try {
          const resultado = await window.__autoxsTituloNaLegenda(acao);
          aviso.textContent = resultado.mensagem;
        } catch { aviso.textContent = 'Não foi possível concluir. Confira a legenda na janela do site.'; }
        finally { ocupado = false; botao.disabled = false; padrao.disabled = false; }
      };
      botao.addEventListener('click', evento => executarAcao(evento, 'titulo'));
      padrao.addEventListener('click', evento => executarAcao(evento, 'padrao'));
      grupo.append(botao, padrao, aviso); document.body.appendChild(grupo); posicionar(grupo);
    }
    window.__autoxsAtualizarBotaoLegenda = atualizar;
    window.setInterval(atualizar, 800);
    atualizar();
  };
  await aba.addInitScript(instalar);
  await aba.evaluate(instalar);
  preparadas.add(aba);
}

module.exports = { instalarBotaoLegenda };
