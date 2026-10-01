const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { criarGrupoJanelas } = require('./janelas-trabalho');
const { identificarMateriaComGemini } = require('./identificar-materia-gemini');
const { criarCompartilhamento } = require('./compartilhar-materias');

async function criarPainelManual(context, atualizar, enviarAoSite, janelaAdicao = criarGrupoJanelas(context)) {
  const painel = context.pages().find(p => p.url() === 'about:blank') || await context.newPage();
  const url = pathToFileURL(path.join(__dirname, 'painel-manual.html')).href;
  const urlAdicao = pathToFileURL(path.join(__dirname, 'adicionar-painel.html')).href;
  const compartilhamento = criarCompartilhamento(context, criarGrupoJanelas(context));
  let emAndamento = false;
  let adicao = null;
  let abrindoAdicao = null;
  let filaAdicao = Promise.resolve();
  const enfileirarAdicao = tarefa => {
    const resultado = filaAdicao.then(tarefa);
    filaAdicao = resultado.catch(() => {});
    return resultado;
  };
  const espacoValido = numero => Number.isInteger(numero) && numero >= 1 && numero <= 4;

  await painel.exposeBinding('atualizarMaterias', async ({ frame }, paginaEscolhida) => {
    if (frame !== painel.mainFrame() || frame.url() !== url) return {ok:false,mensagem:'Abra o painel local para atualizar.'};
    if (emAndamento) return {ok:false,mensagem:'Uma conferência já está em andamento.'};
    if (paginaEscolhida !== 1 && paginaEscolhida !== 2) return {ok:false,mensagem:'Escolha Página 1 ou Página 2 antes de atualizar.'};
    emAndamento = true;
    try {
      const progresso = async mensagem => {
        if (!painel.isClosed()) await painel.evaluate(texto => window.exibirProgresso(texto), mensagem).catch(() => {});
      };
      const resumo = await atualizar(progresso, paginaEscolhida);
      return {ok:!resumo.interrompido,resumo,mensagem:'A conferência foi interrompida.'};
    } catch (erro) {
      return {ok:false,mensagem:erro.message || 'Não foi possível concluir a conferência.'};
    } finally {
      emAndamento = false;
      if (!painel.isClosed()) await painel.bringToFront().catch(() => {});
    }
  });

  async function abrirAdicao() {
    if (adicao && !adicao.isClosed()) { await adicao.bringToFront(); return; }
    const pagina = await janelaAdicao.newPage();
    const origemValida = frame => frame === pagina.mainFrame() && frame.url() === urlAdicao;
    const analisesEmAndamento = new Set();
    try {
      await pagina.exposeBinding('identificarMateriaComGemini', async ({ frame }, entrada) => {
        if (!origemValida(frame) || !espacoValido(entrada?.espaco)) return {ok:false,mensagem:'Abra um espaço de adição para analisar o texto.'};
        if (analisesEmAndamento.has(entrada.espaco)) return {ok:false,mensagem:'A análise desta matéria já está em andamento.'};
        analisesEmAndamento.add(entrada.espaco);
        try {
          return {ok:true,resultado:await identificarMateriaComGemini(entrada.texto)};
        } catch (erro) {
          return {ok:false,mensagem:erro.message || 'Não foi possível identificar com Gemini.'};
        } finally { analisesEmAndamento.delete(entrada.espaco); }
      });
      await pagina.exposeBinding('listarCategoriasDoSite', async ({ frame }, espaco) => {
        if (!origemValida(frame) || !espacoValido(espaco)) return {ok:false,mensagem:'Abra um espaço de adição para escolher a categoria.'};
        return enfileirarAdicao(async () => {
          if (pagina.isClosed()) return {ok:false,mensagem:'A janela de adição foi fechada.'};
          try {
            if (typeof enviarAoSite?.listarCategorias !== 'function') throw new Error('Reinicie o AutoXS para carregar as categorias.');
            return {ok:true,categorias:await enviarAoSite.listarCategorias(espaco)};
          } catch (erro) { return {ok:false,mensagem:erro.message || 'Não foi possível carregar as categorias.'}; }
          finally { if (!pagina.isClosed()) await pagina.bringToFront().catch(() => {}); }
        });
      });
      await pagina.exposeBinding('enviarMateriaAoSite', async ({ frame }, entrada) => {
        if (!origemValida(frame) || !espacoValido(entrada?.espaco)) return {ok:false,mensagem:'Abra um espaço de adição para preencher a matéria.'};
        // Cada solicitação leva sua própria cópia dos campos e o número do espaço.
        return enfileirarAdicao(async () => {
          if (pagina.isClosed()) return {ok:false,mensagem:'A janela de adição foi fechada.'};
          try {
            if (typeof enviarAoSite !== 'function') throw new Error('Reinicie o AutoXS para conectar ao formulário do site.');
            const progresso = async mensagem => {
              if (!pagina.isClosed()) await pagina.evaluate(({espaco,mensagem}) =>
                window.exibirProgressoEnvio(espaco,mensagem), {espaco:entrada.espaco,mensagem}).catch(() => {});
            };
            const resultado = await enviarAoSite(entrada,progresso);
            return {ok:true,...resultado};
          } catch (erro) { return {ok:false,mensagem:erro.message || 'Não foi possível preencher a matéria.'}; }
        });
      });
      await pagina.exposeBinding('voltarAoPainel', async ({ frame }) => {
        if (origemValida(frame) && !painel.isClosed()) await painel.bringToFront();
      });
      await pagina.goto(urlAdicao);
      adicao = pagina;
      await pagina.bringToFront();
    } catch (erro) {
      await pagina.close().catch(() => {});
      throw erro;
    }
  }

  await painel.exposeBinding('abrirAdicaoMaterias', async ({ frame }) => {
    if (frame !== painel.mainFrame() || frame.url() !== url) return {ok:false,mensagem:'Abra o painel inicial.'};
    try {
      if (!abrindoAdicao) abrindoAdicao = abrirAdicao().finally(() => { abrindoAdicao = null; });
      await abrindoAdicao;
      return {ok:true};
    } catch (erro) { return {ok:false,mensagem:erro.message || 'Não foi possível abrir a janela de adição.'}; }
  });
  await painel.exposeBinding('abrirCompartilhamentoMaterias', async ({ frame }) => {
    if (frame !== painel.mainFrame() || frame.url() !== url) return {ok:false,mensagem:'Abra o painel inicial.'};
    try {
      await compartilhamento.abrir();
      return {ok:true};
    } catch (erro) { return {ok:false,mensagem:erro.message || 'Não foi possível abrir as matérias para compartilhamento.'}; }
  });
  await painel.goto(url);
  await painel.bringToFront();
  return painel;
}

module.exports = { criarPainelManual };
