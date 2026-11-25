const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { criarCapturaMaterias } = require('./captura-materias');
const { criarPreferenciasAutoXS } = require('./preferencias-autoxs');
const { buscarFotoLocal } = require('./foto-local');

const instalacoes = new WeakMap();
const urlPainel = pathToFileURL(path.join(__dirname, 'adicionar-painel.html')).href;

function instalarCaptura(context, pasta) {
  if (!context || typeof context.exposeBinding !== 'function') return Promise.resolve(false);
  if (instalacoes.has(context)) return instalacoes.get(context);
  const captura = criarCapturaMaterias(pasta);
  const preferencias = criarPreferenciasAutoXS();
  async function preparar(id) {
    const rascunho = await captura.prepararEncaminhamento(id);
    const ajustes = await preferencias.ler();
    const campos = { ...rascunho.campos };
    if (campos.tipoRadar === 'clima' && campos.cidade) {
      const padrao = Object.entries(ajustes.fotosClima || {}).find(([cidade]) =>
        cidade.localeCompare(campos.cidade, 'pt-BR', { sensitivity:'base' }) === 0);
      campos.imagem = padrao
        ? `Fotografia padrão de ${padrao[0]} cadastrada no CMS (ID ${padrao[1].id}).`
        : `FOTO PENDENTE — não há fotografia padrão cadastrada para ${campos.cidade}.`;
      return { ...rascunho, campos, fotoPadrao:padrao ? { cidade:padrao[0], ...padrao[1] } : null };
    }
    if (ajustes.buscarFotosAutomaticamente && campos.imagemNome) {
      const busca = await buscarFotoLocal({ pasta:ajustes.pastaFotos, nomeEsperado:campos.imagemNome });
      campos.imagem = busca.estado === 'encontrada'
        ? `Fotografia encontrada: ${busca.escolhida.nome} (${busca.criterio === 'nome-exato' ? 'nome exato' : 'cópia mais recente'}).`
        : (busca.motivo || 'FOTO PENDENTE.');
      return { ...rascunho, campos, fotoCaminho:busca.escolhida?.caminho || null,
        fotoNome:busca.escolhida?.nome || null, fotoBusca:busca };
    }
    return { ...rascunho, campos };
  }
  const instalacao = context.exposeBinding('capturaAutoXS', async (fonte, pedido) => {
    if (fonte.frame !== fonte.page.mainFrame() || fonte.frame.url() !== urlPainel)
      throw new Error('A Central de Captura só pode ser usada no painel Adicionar Matérias.');
    const { acao, id } = pedido || {};
    switch (acao) {
      case 'listar': return captura.listar();
      case 'receber': return captura.receber(pedido.entrada);
      case 'organizar': return captura.organizar();
      case 'analisarLote': return captura.analisarLote(pedido.entrada);
      case 'importarLote': return captura.importarLote(pedido.entrada);
      case 'atualizar': return captura.atualizar(id, pedido.campos);
      case 'juntar': return captura.juntar(pedido.ids);
      case 'separar': return captura.separar(id, pedido.mensagemId);
      case 'associarFoto': return captura.associarFoto(id, pedido.fotoId);
      case 'confirmarGrupo': return captura.confirmarGrupo(id);
      case 'aprovar': return captura.aprovar(id);
      case 'marcarEncaminhado': return captura.marcarEncaminhado(id);
      case 'marcarEstado': return captura.marcarEstado(id, pedido.status, pedido.motivo);
      case 'prepararEncaminhamento': return preparar(id);
      case 'descartar': return captura.descartar(id);
      case 'mover': return captura.mover(id, Number(pedido.direcao), pedido.ordem);
      case 'foto': return captura.obterFoto(id);
      default: throw new Error('Ação de captura desconhecida.');
    }
  }).then(() => true);
  instalacoes.set(context, instalacao);
  instalacao.catch(() => instalacoes.delete(context));
  return instalacao;
}

module.exports = { instalarCaptura };
