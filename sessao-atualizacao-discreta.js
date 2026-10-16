function criarSessaoAtualizacaoDiscreta(chromium, caminhoPerfil) {
  let contexto = null;
  let iniciando = null;
  let listagem = null;

  async function obterContexto() {
    if (contexto) return contexto;
    if (!iniciando) iniciando = (async () => {
      const novo = await chromium.launchPersistentContext(caminhoPerfil, {
        channel:'chrome', headless:false, viewport:null
      });
      contexto = novo;
      novo.on('close', () => {
        if (contexto === novo) { contexto = null; listagem = null; }
      });
      return novo;
    })().finally(() => { iniciando = null; });
    return iniciando;
  }

  async function obterListagem() {
    const atual = await obterContexto();
    if (listagem && !listagem.isClosed()) return listagem;
    listagem = atual.pages().find(pagina => !pagina.isClosed() && pagina.url() === 'about:blank') ||
      await atual.newPage();
    return listagem;
  }

  async function encerrar() {
    await iniciando?.catch(() => {});
    const atual = contexto;
    contexto = null;
    listagem = null;
    await atual?.close().catch(() => {});
  }

  return { obterContexto, obterListagem, encerrar };
}

module.exports = { criarSessaoAtualizacaoDiscreta };
