const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { criarGrupoJanelas } = require('./janelas-trabalho');
const { identificarMateriaComGemini } = require('./identificar-materia-gemini');
const { criarCompartilhamento } = require('./compartilhar-materias');
const { criarPainelProducao } = require('./painel-producao');
const { criarGeradorArtesMaterias } = require('./gerador-artes-materias');
const { criarProcessadorVideos } = require('./gerador-videos-processamento');
const { escolherPastaWindows } = require('./gerador-videos-processamento');
const { criarPreferenciasAutoXS } = require('./preferencias-autoxs');
const { version: versaoAutoXS } = require('./package.json');
const { randomUUID } = require('node:crypto');
const { identificarInstalacao } = require('./instalacao-autoxs');
const { salvarExportacao } = require('./dados-transferencia-arquivo');
const { carregarIntegracaoLocal } = require('./integracao-local');

async function criarPainelManual(context, atualizar, enviarAoSite, janelaAdicao = criarGrupoJanelas(context), historico = null, compartilhamentoExterno = null, buscadorLinks = null, geradorMateriasExterno = null, processadorVideosExterno = null, integracaoLocal = carregarIntegracaoLocal()) {
  const painel = context.pages().find(p => p.url() === 'about:blank') || await context.newPage();
  const url = pathToFileURL(path.join(__dirname, 'painel-manual.html')).href;
  const urlAdicao = pathToFileURL(path.join(__dirname, 'adicionar-painel.html')).href;
  const urlGerador = pathToFileURL(path.join(__dirname, 'gerador-artes.html')).href;
  const urlGeradorVideos = pathToFileURL(path.join(__dirname, 'gerador-videos.html')).href;
  const compartilhamento = compartilhamentoExterno || criarCompartilhamento(context, criarGrupoJanelas(context));
  const geradorMaterias = geradorMateriasExterno || criarGeradorArtesMaterias(compartilhamento, context.request);
  const producao = historico ? criarPainelProducao(context, historico, compartilhamento, buscadorLinks) : null;
  const preferencias = criarPreferenciasAutoXS();
  const previasImportacao = new Map();
  let emAndamento = false;
  let adicao = null;
  let abrindoAdicao = null;
  let geradorArtes = null;
  let abrindoGerador = null;
  let geradorVideos = null;
  let processadorVideosAtivo = null;
  let abrindoVideos = null;
  let filaAdicao = Promise.resolve();
  const enfileirarAdicao = tarefa => {
    const resultado = filaAdicao.then(tarefa);
    filaAdicao = resultado.catch(() => {});
    return resultado;
  };
  const espacoValido = numero => Number.isInteger(numero) && numero >= 1 && numero <= 4;

  await painel.exposeBinding('configuracoesAutoXS', async ({ frame }, pedido = {}) => {
    if (frame !== painel.mainFrame() || frame.url() !== url)
      return { ok:false, mensagem:'Abra o painel local do AutoXS.' };
    try {
      if (pedido.acao === 'obter')
        return { ok:true, preferencias:await preferencias.ler(), versao:versaoAutoXS };
      if (pedido.acao === 'escolherPasta')
        return { ok:true, pasta:await escolherPastaWindows() };
      if (pedido.acao !== 'salvar' && pedido.acao !== 'restaurar')
        return { ok:false, mensagem:'Operação de configuração inválida.' };
      const novas = pedido.acao === 'restaurar'
        ? await preferencias.restaurar() : await preferencias.salvar(pedido.preferencias);
      if (processadorVideosAtivo?.definirPastaDestino) {
        try {
          const pasta = await processadorVideosAtivo.definirPastaDestino(novas.pastaVideos);
          if (geradorVideos && !geradorVideos.isClosed())
            await geradorVideos.evaluate(valor => window.atualizarPastaVideos?.(valor), pasta).catch(() => {});
        } catch { /* A preferência salva será usada na próxima abertura do módulo. */ }
      }
      return { ok:true, preferencias:novas };
    } catch (erro) { return { ok:false, mensagem:erro.message || 'Não foi possível salvar as configurações.' }; }
  });

  await painel.exposeBinding('dadosAutoXS', async ({ frame }, pedido = {}) => {
    if (frame !== painel.mainFrame() || frame.url() !== url)
      return { ok:false, mensagem:'Abra a Central de Configurações local.' };
    if (!historico) return { ok:false, mensagem:'O histórico de produção não está disponível.' };
    try {
      if (pedido.acao === 'exportar') {
        const documento = await historico.exportarDadosHoje(await identificarInstalacao());
        return { ok:true, resultado:await salvarExportacao(documento) };
      }
      if (pedido.acao === 'prever') {
        if (typeof pedido.conteudo !== 'string' || pedido.conteudo.length > 5_000_000)
          throw new Error('Escolha um JSON de até 5 MB.');
        const documento = JSON.parse(pedido.conteudo);
        const previa = await historico.preverImportacao(documento, await identificarInstalacao());
        const token = randomUUID();
        previasImportacao.set(token, { documento, previa, criadoEm:Date.now() });
        return { ok:true, token, previa };
      }
      if (pedido.acao === 'confirmar') {
        const entrada = previasImportacao.get(pedido.token);
        if (!entrada || Date.now() - entrada.criadoEm > 10 * 60 * 1000)
          throw new Error('A prévia expirou. Escolha o arquivo novamente.');
        const resultado = await historico.importarDadosHoje(entrada.documento, entrada.previa, await identificarInstalacao());
        previasImportacao.delete(pedido.token);
        return { ok:true, resultado };
      }
      throw new Error('Operação de dados inválida.');
    } catch (erro) { return { ok:false, mensagem:erro.message || 'Não foi possível transferir os dados.' }; }
  });

  let aplicarConfigHermes = null;
  if (integracaoLocal) {
    const { lerConfigLocal:lerConfigHermes, salvarConfigLocal:salvarConfigHermes,
      estado:estadoHermes, filaHermes } = integracaoLocal;
    // Reflete a configuração privada no estado compartilhado sem iniciar processo.
    const ANDAMENTO_HERMES = new Set(['pesquisando', 'coletando', 'analisando']);
    aplicarConfigHermes = config => {
      const anterior = estadoHermes.obter();
      if (!config.ativo) {
        return estadoHermes.publicar({ ativo:false, modo:config.modo, estado:'desligado',
          ...(filaHermes.emAndamento() ? {} : { fase:'ociosa', pendentes:0 }) });
      }
      const emAndamento = ANDAMENTO_HERMES.has(anterior.estado) || filaHermes.emAndamento();
      return estadoHermes.publicar({ ativo:true, modo:config.modo, scoreMinimo:config.scoreMinimoSelecao,
        estado: emAndamento ? anterior.estado : (anterior.analise ? 'concluido' : 'aguardando') });
    };

    await painel.exposeBinding('hermesAutoXS', async ({ frame }, pedido = {}) => {
      if (frame !== painel.mainFrame() || frame.url() !== url)
        return { ok:false, mensagem:'Abra o painel local do AutoXS.' };
      try {
        if (pedido.acao === 'obter') return { ok:true, estado:aplicarConfigHermes(lerConfigHermes()) };
        if (pedido.acao === 'definir') {
          const alteracoes = {};
          if (pedido.ativo !== undefined) alteracoes.ativo = pedido.ativo === true;
          if (pedido.modo === 'observacao' || pedido.modo === 'automatico') alteracoes.modo = pedido.modo;
          if (!Object.keys(alteracoes).length) return { ok:false, mensagem:'Nada a alterar no Hermes.' };
          return { ok:true, estado:aplicarConfigHermes(await salvarConfigHermes(alteracoes)) };
        }
        if (pedido.acao === 'parar') return { ok:true, interrompendo:filaHermes.parar() };
        return { ok:false, mensagem:'Operação do Hermes inválida.' };
      } catch (erro) {
        return { ok:false, mensagem:erro.message || 'Não foi possível atualizar a preferência do Hermes.' };
      }
    });
  }

  await painel.exposeBinding('atualizarMaterias', async ({ frame }, escolha) => {
    const paginaEscolhida = typeof escolha === 'number' ? escolha : escolha?.pagina;
    const modo = typeof escolha === 'number' ? 'visivel' : escolha?.modo;
    if (frame !== painel.mainFrame() || frame.url() !== url) return {ok:false,mensagem:'Abra o painel local para atualizar.'};
    if (emAndamento) return {ok:false,mensagem:'Uma conferência já está em andamento.'};
    if (paginaEscolhida !== 1 && paginaEscolhida !== 2) return {ok:false,mensagem:'Escolha Página 1 ou Página 2 antes de atualizar.'};
    if (modo !== 'discreto' && modo !== 'visivel') return {ok:false,mensagem:'Modo de atualização inválido.'};
    emAndamento = true;
    try {
      const progresso = async mensagem => {
        if (!painel.isClosed()) await painel.evaluate(texto => window.exibirProgresso(texto), mensagem).catch(() => {});
      };
      const resumo = await atualizar(progresso, paginaEscolhida, modo);
      return {ok:!resumo.interrompido,resumo,mensagem:'A conferência foi interrompida.'};
    } catch (erro) {
      return {ok:false,mensagem:erro.message || 'Não foi possível concluir a conferência.'};
    } finally {
      emAndamento = false;
      if (modo === 'visivel' && !painel.isClosed()) await painel.bringToFront().catch(() => {});
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
          } catch (erro) {
            if (historico && entrada?.id && entrada?.campos) {
              await historico.registrar({ operacao:'adicionar', chave:entrada.id,
                titulo:entrada.campos.titulo || '', situacao:'erro' })
                .catch(falha => console.warn('[AUTOXS] Histórico: ' + falha.message));
            }
            return {ok:false,mensagem:erro.message || 'Não foi possível preencher a matéria.'};
          }
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
  await painel.exposeBinding('abrirGeradorArtes', async ({ frame }) => {
    if (frame !== painel.mainFrame() || frame.url() !== url) return {ok:false,mensagem:'Abra o painel inicial.'};
    try {
      if (!abrindoGerador) abrindoGerador = (async () => {
        if (geradorArtes && !geradorArtes.isClosed()) {
          await geradorArtes.bringToFront();
          return;
        }
        const logoSvg = await fs.readFile(path.join(__dirname, 'gerador-artes', 'assets', 'logo-tribuna-sertao.svg'));
        const pagina = await context.newPage();
        try {
          const origemGerador = frame => frame === pagina.mainFrame() && frame.url() === urlGerador;
          await pagina.exposeBinding('listarUltimasArtes', async ({frame}) => {
            if (!origemGerador(frame)) throw new Error('Abra o Gerador de Artes local.');
            return geradorMaterias.listar();
          });
          await pagina.exposeBinding('prepararArteMateria', async ({frame}, endereco) => {
            if (!origemGerador(frame)) throw new Error('Abra o Gerador de Artes local.');
            return geradorMaterias.preparar(endereco);
          });
          await pagina.goto(urlGerador);
          const carregado = await pagina.evaluate(dataUrl => window.configurarLogoGerador(dataUrl),
            `data:image/svg+xml;base64,${logoSvg.toString('base64')}`);
          if (!carregado) throw new Error('Não foi possível carregar o logotipo oficial da Tribuna do Sertão.');
          geradorArtes = pagina;
          await pagina.bringToFront();
        } catch (erro) {
          await pagina.close().catch(() => {});
          throw erro;
        }
      })().finally(() => { abrindoGerador = null; });
      await abrindoGerador;
      return {ok:true};
    } catch (erro) { return {ok:false,mensagem:erro.message || 'Não foi possível abrir o Gerador de Artes.'}; }
  });
  await painel.exposeBinding('abrirGeradorVideos', async ({ frame }) => {
    if (frame !== painel.mainFrame() || frame.url() !== url) return {ok:false,mensagem:'Abra o painel inicial.'};
    try {
      if (!abrindoVideos) abrindoVideos = (async () => {
        if (geradorVideos && !geradorVideos.isClosed()) {
          await geradorVideos.bringToFront();
          return;
        }
        const pagina = await context.newPage();
        try {
          await pagina.goto(urlGeradorVideos);
          const configuracaoVideos = await preferencias.ler();
          const processadorVideos = processadorVideosExterno || criarProcessadorVideos({
            informar: texto => pagina.evaluate(mensagem => window.atualizarProcessamentoVideos?.(mensagem), texto).catch(() => {}),
            pastaInicial:configuracaoVideos.pastaVideos,
            aoSelecionarPasta:async pasta => preferencias.salvar({ ...await preferencias.ler(), pastaVideos:pasta })
          });
          processadorVideosAtivo = processadorVideos;
          await pagina.exposeFunction('operacaoGeradorVideos', async pedido => {
            if (pedido?.acao === 'cancelar') return { cancelado: processadorVideos.cancelar() };
            if (pedido?.acao === 'processar') return processadorVideos.iniciar(pedido.url);
            if (pedido?.acao === 'transcrever') return processadorVideos.tentarTranscricao(pedido.url);
            if (pedido?.acao === 'obterPastaDestino') return {pasta:await processadorVideos.obterPastaDestino()};
            if (pedido?.acao === 'escolherPastaDestino') return processadorVideos.escolherPastaDestino();
            if (pedido?.acao === 'abrirPastaVideo') return processadorVideos.abrirPastaVideo();
            throw new Error('Operação de vídeo inválida.');
          });
          await pagina.evaluate(async () => {
            try {
              const { pasta } = await window.operacaoGeradorVideos({acao:'obterPastaDestino'});
              window.atualizarPastaVideos(pasta);
            } catch (erro) {
              window.atualizarPastaVideos(erro.message || 'Escolha uma pasta de destino.',true);
            }
          });
          pagina.on('close', () => {
            processadorVideos.cancelar();
            if (processadorVideosAtivo === processadorVideos) processadorVideosAtivo = null;
          });
          geradorVideos = pagina;
          await pagina.bringToFront();
        } catch (erro) {
          await pagina.close().catch(() => {});
          throw erro;
        }
      })().finally(() => { abrindoVideos = null; });
      await abrindoVideos;
      return {ok:true};
    } catch (erro) { return {ok:false,mensagem:erro.message || 'Não foi possível abrir Download e Transcrição.'}; }
  });
  if (producao) await producao.integrar(painel);
  await painel.goto(url);
  const botaoVideosDisponivel = await painel.evaluate(() => {
    const botao = document.querySelector('#gerador-videos');
    return Boolean(botao && botao.getClientRects().length && getComputedStyle(botao).visibility !== 'hidden');
  });
  if (!botaoVideosDisponivel) throw new Error('O botão Download e Transcrição não apareceu no painel inicial carregado.');
  await painel.evaluate(temHistorico => {
    const coluna = document.querySelector('.coluna-producao');
    if (temHistorico) coluna.querySelector('iframe').src = 'painel-producao.html?integrado=1';
    else coluna.hidden = true;
  }, Boolean(producao));
  if (integracaoLocal) {
    const instalarPainelLocal = async () => {
      if (painel.isClosed() || painel.url() !== url) return;
      try {
        await painel.addScriptTag({ path:integracaoLocal.caminhoPainel });
        await painel.evaluate(() => { document.querySelector('#hermes').hidden = false; });
        aplicarConfigHermes(integracaoLocal.lerConfigLocal());
      } catch (erro) {
        console.warn(`⚠️ Painel local indisponível: ${erro.message}. O AutoXS continuará normalmente.`);
        await painel.evaluate(() => { document.querySelector('#hermes').hidden = true; }).catch(() => {});
      }
    };
    await instalarPainelLocal();
    painel.on('load', () => { void instalarPainelLocal(); });
    const encerrar = integracaoLocal.estado.assinar(estado => {
      if (painel.isClosed()) return;
      return painel.evaluate(dados => window.atualizarHermes?.(dados), estado).catch(() => {});
    });
    painel.on('close', encerrar);
  }
  await painel.bringToFront();
  return painel;
}

module.exports = { criarPainelManual };
