// Acompanha apenas a aba de adição. Não abre o acervo nem escolhe fotos sozinho.
async function acompanharFotosAdicao(aba, mostrarSugestoes) {
  let ocupado = false;
  await aba.exposeBinding('__autoxsFotosAdicao', async ({ frame }) => {
    if (frame !== aba.mainFrame() || ocupado) return {ok:false};
    const url = new URL(frame.url());
    if (url.origin !== 'https://redacao.tribunaweb.com.br' || !/^\/news\/(?:add\/?|edit\/[^/]+)$/.test(url.pathname)) return {ok:false};
    const dialog = aba.getByRole('dialog', {name:/Imagem de Destaque/i});
    if (!await dialog.isVisible()) return {ok:false};
    ocupado = true;
    try { await mostrarSugestoes(); return {ok:true}; }
    catch { return {ok:false}; }
    finally { ocupado = false; }
  });
  const instalar = () => {
    if (window.__autoxsObservandoFotos) return;
    window.__autoxsObservandoFotos = true;
    let anterior = null;
    let ocupado = false;
    // Detecta abertura e reabertura, inclusive quando o site conserva o modal no DOM.
    window.setInterval(async () => {
      if (ocupado) return;
      const modal = [...document.querySelectorAll('[role="dialog"], dialog, .modal')].find(el => {
        const estilo = getComputedStyle(el);
        return el.getClientRects().length && estilo.visibility !== 'hidden' && estilo.display !== 'none' &&
          /Imagem de Destaque/i.test(el.textContent || '');
      });
      if (!modal) { anterior = null; return; }
      if (modal === anterior) return;
      anterior = modal;
      ocupado = true;
      try {
        const resultado = await window.__autoxsFotosAdicao();
        if (!resultado.ok && modal.isConnected) {
          let aviso = modal.querySelector('#autoxs-erro-sugestoes');
          if (!aviso) {
            aviso = document.createElement('p'); aviso.id = 'autoxs-erro-sugestoes';
            aviso.setAttribute('role','status'); modal.appendChild(aviso);
          }
          aviso.textContent = 'Não foi possível abrir as sugestões. Você pode pesquisar no acervo ou fechar e abrir novamente a seleção de fotos.';
        } else modal.querySelector('#autoxs-erro-sugestoes')?.remove();
      } catch { /* Uma navegação encerra a janela anterior. */ }
      finally { ocupado = false; }
    }, 700);
  };
  await aba.addInitScript(instalar);
  await aba.evaluate(instalar);
}
module.exports = { acompanharFotosAdicao };
