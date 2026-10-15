const { confirmarSalvamento } = require('./acompanhar-envio');
const { extrairDadosPublicacao } = require('./url-publicacao-cms');

async function localizarUrlOriginal(resposta) {
  const cabecalhos = resposta.headers();
  const contentType = cabecalhos['content-type'] || '';
  const corpo = /\b(?:json|html)\b/i.test(contentType) ? await resposta.text().catch(() => '') : '';
  return extrairDadosPublicacao({
    urlResposta: resposta.url(), location: cabecalhos.location || '', contentType, corpo
  });
}

async function acompanharPublicacaoAdicao(aba, dados, aoEvento) {
  const inicial = new URL(aba.url());
  const form = aba.locator('#inp_title').locator('xpath=ancestor::form[1]');
  if (!/^\/news\/add\/?$/.test(inicial.pathname) || await form.count() !== 1) {
    throw new Error('Formulário de adição não identificado para acompanhar a publicação.');
  }
  const action = new URL(await form.evaluate(elemento => elemento.action));
  if (action.origin !== inicial.origin) throw new Error('Destino do formulário de adição inesperado.');
  const mensagensIniciais = await aba.locator('.alert-success, .toast-success, [role="status"]').allTextContents();
  const tentativas = new Map();
  let fechado = false;
  function camposEnviados(requisicao) {
    try {
      if (!/application\/x-www-form-urlencoded/i.test(requisicao.headers()?.['content-type'] || '')) return dados.campos;
      const parametros = new URLSearchParams(requisicao.postData() || '');
      const campos = { ...dados.campos };
      for (const [chave, nome] of [['title','titulo'], ['hat','chapeu'], ['subtitle','bigode']]) {
        if (parametros.has(chave)) campos[nome] = parametros.get(chave) || '';
      }
      return campos;
    } catch { return dados.campos; }
  }
  function parar() {
    if (fechado) return;
    fechado = true;
    tentativas.clear();
    aba.off('request', aoRequisitar);
    aba.off('response', aoResponder);
    aba.off('requestfailed', aoFalhar);
    aba.off('close', parar);
  }
  function aoRequisitar(requisicao) {
    if (fechado || aba.isClosed()) return;
    try {
      const destino = new URL(requisicao.url());
      const atual = new URL(aba.url());
      if (requisicao.frame() !== aba.mainFrame() || atual.origin !== inicial.origin ||
          !/^\/news\/add\/?$/.test(atual.pathname) ||
          !['POST', 'PUT', 'PATCH'].includes(requisicao.method()) ||
          destino.origin !== inicial.origin || destino.pathname !== action.pathname) return;
      tentativas.set(requisicao, {
        antes: aba.locator('.alert-success, .toast-success, [role="status"]').allTextContents().catch(() => mensagensIniciais),
        campos: camposEnviados(requisicao)
      });
    } catch { /* Outros recursos não são o envio do formulário. */ }
  }
  function aoFalhar(requisicao) {
    if (!tentativas.delete(requisicao)) return;
    void aoEvento({ tipo:'naoConfirmado', ...dados }).catch(erro => console.warn('[AUTOXS] Histórico: ' + erro.message));
  }
  function aoResponder(resposta) {
    const tentativa = tentativas.get(resposta.request());
    if (!tentativa) return;
    tentativas.delete(resposta.request());
    void concluir(resposta, tentativa).catch(erro => console.warn('[AUTOXS] Histórico: ' + erro.message));
  }
  async function concluir(resposta, tentativa) {
    if (resposta.status() < 200 || resposta.status() >= 400 || !await confirmarSalvamento(aba, await tentativa.antes)) {
      await aoEvento({ tipo:'naoConfirmado', ...dados });
      return;
    }
    if (fechado) return;
    const { urlOriginal, urlCms, ambiguo } = await localizarUrlOriginal(resposta);
    if (ambiguo) console.warn('[AUTOXS] Histórico: resposta de publicação contém mais de uma URL pública; link pendente para revisão.');
    parar();
    await aoEvento({ tipo:'concluido', ...dados, campos:tentativa.campos, urlOriginal, urlCms });
  }
  aba.on('request', aoRequisitar);
  aba.on('response', aoResponder);
  aba.on('requestfailed', aoFalhar);
  aba.on('close', parar);
  return parar;
}

module.exports = { acompanharPublicacaoAdicao, localizarUrlOriginal };
