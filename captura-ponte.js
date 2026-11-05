const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { criarCapturaMaterias } = require('./captura-materias');

const instalacoes = new WeakMap();
const urlPainel = pathToFileURL(path.join(__dirname, 'adicionar-painel.html')).href;

function instalarCaptura(context, pasta) {
  if (!context || typeof context.exposeBinding !== 'function') return Promise.resolve(false);
  if (instalacoes.has(context)) return instalacoes.get(context);
  const captura = criarCapturaMaterias(pasta);
  const instalacao = context.exposeBinding('capturaAutoXS', async (fonte, pedido) => {
    if (fonte.frame !== fonte.page.mainFrame() || fonte.frame.url() !== urlPainel)
      throw new Error('A Central de Captura só pode ser usada no painel Adicionar Matérias.');
    const { acao, id } = pedido || {};
    switch (acao) {
      case 'listar': return captura.listar();
      case 'receber': return captura.receber(pedido.entrada);
      case 'organizar': return captura.organizar();
      case 'atualizar': return captura.atualizar(id, pedido.campos);
      case 'juntar': return captura.juntar(pedido.ids);
      case 'separar': return captura.separar(id, pedido.mensagemId);
      case 'associarFoto': return captura.associarFoto(id, pedido.fotoId);
      case 'confirmarGrupo': return captura.confirmarGrupo(id);
      case 'aprovar': return captura.aprovar(id);
      case 'marcarEncaminhado': return captura.marcarEncaminhado(id);
      case 'descartar': return captura.descartar(id);
      case 'foto': return captura.obterFoto(id);
      default: throw new Error('Ação de captura desconhecida.');
    }
  }).then(() => true);
  instalacoes.set(context, instalacao);
  instalacao.catch(() => instalacoes.delete(context));
  return instalacao;
}

module.exports = { instalarCaptura };
