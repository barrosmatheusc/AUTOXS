const { randomUUID } = require('node:crypto');

async function criarJanela(context) {
  const referencia = context.pages().find(p => !p.isClosed());
  if (!referencia) throw new Error('Abra o painel do AutoXS para iniciar uma janela de trabalho.');
  const sessao = await context.newCDPSession(referencia);
  const marcador = 'about:blank#autoxs-' + randomUUID();
  const paginaPendente = context.waitForEvent('page', {
    predicate: async pagina => {
      try { await pagina.waitForURL(marcador, {timeout:5000}); return true; }
      catch { return false; }
    }, timeout:15000
  });
  paginaPendente.catch(() => {});
  try {
    const { targetInfo } = await sessao.send('Target.getTargetInfo');
    await sessao.send('Target.createTarget', {
      url:marcador, newWindow:true,
      ...(targetInfo.browserContextId ? {browserContextId:targetInfo.browserContextId} : {})
    });
    return await paginaPendente;
  } finally { await sessao.detach().catch(() => {}); }
}

async function abrirAbaNaJanela(context, referencia) {
  const paginaPendente = context.waitForEvent('page', {
    predicate: async pagina => await pagina.opener() === referencia, timeout:15000
  });
  paginaPendente.catch(() => {});
  // Sem dimensões de popup: a nova aba pertence à janela da página de referência.
  const abriu = await referencia.evaluate(() => Boolean(window.open('about:blank', '_blank')));
  if (!abriu) throw new Error('O navegador não permitiu abrir a aba na janela de trabalho.');
  return paginaPendente;
}

function criarGrupoJanelas(context) {
  const paginas = new Set();
  let fila = Promise.resolve();
  const grupo = {
    pages: () => [...paginas].filter(p => !p.isClosed()),
    newPage: () => {
      const tarefa = fila.then(async () => {
        const referencia = grupo.pages()[0];
        const pagina = referencia ? await abrirAbaNaJanela(context, referencia) : await criarJanela(context);
        paginas.add(pagina);
        pagina.once('close', () => paginas.delete(pagina));
        return pagina;
      });
      fila = tarefa.catch(() => {});
      return tarefa;
    }
  };
  return grupo;
}

module.exports = { criarGrupoJanelas };
