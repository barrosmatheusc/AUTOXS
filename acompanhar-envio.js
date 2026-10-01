const SELETOR_SUCESSO = '.alert-success, .toast-success, [role="status"]';

async function confirmarSalvamento(aba, mensagensAntes) {
  try {
    await aba.waitForFunction(({ antes }) => {
      const visivel = el => Boolean(el.getClientRects().length);
      const erros = [...document.querySelectorAll('.alert-danger, .invalid-feedback, .toast-error')];
      if (erros.some(el => visivel(el) && el.textContent.trim())) return false;
      if (/^\/news\/?$/.test(location.pathname)) return true;
      return [...document.querySelectorAll('.alert-success, .toast-success, [role="status"]')]
        .some(el => visivel(el) && !antes.includes(el.textContent) &&
          /(?:sucesso|enviad[ao]|salv[ao]|atualizad[ao])/i.test(el.textContent));
    }, { antes: mensagensAntes }, { timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

// Instalado somente nas abas de atualização que ficaram para revisão manual.
// Não clica nem envia: acompanha a requisição do formulário da própria matéria.
async function acompanharEnvioManual(aba, formulario, aoConfirmar) {
  const inicial = new URL(aba.url());
  if (!/^\/news\/edit\//.test(inicial.pathname) || await formulario.count() !== 1) return null;
  const action = new URL(await formulario.evaluate(form => form.action));
  if (action.origin !== inicial.origin) return null;
  const mensagensIniciais = await aba.locator(SELETOR_SUCESSO).allTextContents();
  const pendentes = new Map();
  let sequencia = 0, encerrado = false;

  function parar() {
    encerrado = true;
    pendentes.clear();
    aba.off('request', aoRequisitar);
    aba.off('response', aoResponder);
    aba.off('requestfailed', aoFalhar);
    aba.off('close', parar);
  }
  function aoRequisitar(requisicao) {
    if (encerrado || aba.isClosed()) return;
    try {
      const destino = new URL(requisicao.url());
      const atual = new URL(aba.url());
      if (requisicao.frame() !== aba.mainFrame() ||
          atual.origin !== inicial.origin || atual.pathname !== inicial.pathname ||
          !['POST', 'PUT', 'PATCH'].includes(requisicao.method()) ||
          destino.origin !== inicial.origin ||
          ![action.pathname, inicial.pathname].includes(destino.pathname)) return;
      pendentes.set(requisicao, {
        numero: ++sequencia,
        antes: aba.locator(SELETOR_SUCESSO).allTextContents().catch(() => mensagensIniciais)
      });
    } catch {
      // Requisições sem frame ou de outros recursos não são envios da matéria.
    }
  }
  function aoFalhar(requisicao) {
    pendentes.delete(requisicao);
  }
  function aoResponder(resposta) {
    const tentativa = pendentes.get(resposta.request());
    if (!tentativa) return;
    pendentes.delete(resposta.request());
    void concluir(resposta, tentativa).catch(() => {
      // Uma falha de acompanhamento nunca fecha uma aba sem confirmação.
      console.log('Não foi possível concluir o fechamento automático. Confira a aba da matéria.');
    });
  }
  async function concluir(resposta, tentativa) {
    if (resposta.status() < 200 || resposta.status() >= 400) return;
    const antes = await tentativa.antes;
    if (!await confirmarSalvamento(aba, antes)) return;
    if (encerrado || aba.isClosed() || tentativa.numero !== sequencia) return;
    const atual = new URL(aba.url());
    if (atual.origin !== inicial.origin ||
        ![inicial.pathname, action.pathname, '/news', '/news/'].includes(atual.pathname)) return;
    parar();
    await aoConfirmar();
    try {
      await aba.close();
      console.log('Matéria enviada manualmente. Aba fechada.');
    } catch {
      console.log('Matéria enviada manualmente. Não foi possível fechar a aba.');
    }
  }
  aba.on('request', aoRequisitar);
  aba.on('response', aoResponder);
  aba.on('requestfailed', aoFalhar);
  aba.on('close', parar);
  return parar;
}

module.exports = { confirmarSalvamento, acompanharEnvioManual };
