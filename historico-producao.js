const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { montarTextoCompartilhamento, chaveTitulo, identidadeMateria } = require('./compartilhar-materias');

const FUSO = 'America/Sao_Paulo';
const URL_PUBLICA = 'tribunadosertao.com.br';
const INICIAIS = ['Vladimir', 'Cinara', 'Land', 'Léo'];
const IDS_REDATORES = new Set(['inicial-1', 'inicial-2', 'inicial-3']);
const situacoes = new Set(['aguardandoRevisao', 'concluido', 'naoConfirmado', 'erro']);
const operacoes = new Set(['adicionar', 'atualizar']);
const RETENCAO_MS = 8 * 24 * 60 * 60 * 1000;

function dataLocal(iso) {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) throw new Error('Data inválida no histórico.');
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' }).format(data);
}

function urlPublica(valor) {
  if (!valor) return '';
  try {
    const url = new URL(String(valor));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port ||
        url.hostname.replace(/^www\./i, '').toLowerCase() !== URL_PUBLICA) return '';
    if (!/^\/[^/]+\/\d{4}\/\d{2}\/\d{2}\/\d+-[^/]+\/?$/i.test(url.pathname)) return '';
    url.hash = '';
    return url.href;
  } catch { return ''; }
}

function estadoInicial() {
  return { versao: 1, responsaveis: INICIAIS.map((nome, indice) => ({ id: `inicial-${indice + 1}`, nome, ativo: true })), registros: [] };
}

function validarEstado(estado) {
  if (estado?.versao !== 1 || !Array.isArray(estado.responsaveis) || !Array.isArray(estado.registros)) {
    throw new Error('O arquivo de histórico não está no formato esperado. Nenhum dado foi sobrescrito.');
  }
  return estado;
}

function criarHistoricoProducao(arquivo = path.join(__dirname, 'historico-autoxs.json'), relogio = () => new Date()) {
  let fila = Promise.resolve();
  const ouvintes = new Set();
  async function lerArquivo() {
    try { return validarEstado(JSON.parse(await fs.readFile(arquivo, 'utf8'))); }
    catch (erro) { if (erro.code === 'ENOENT') return estadoInicial(); throw erro; }
  }
  function dentroDoPrazo(item) {
    const referencia = item.situacao === 'concluido' ? item.concluidoEm : item.criadoEm;
    const instante = typeof referencia === 'string' ? Date.parse(referencia) : NaN;
    return Number.isFinite(instante) && instante >= relogio().getTime() - RETENCAO_MS;
  }
  function filtrarExpirados(estado) {
    const quantidade = estado.registros.length;
    // Sem data confiável, o registro não aparece nos painéis, mas também não
    // é apagado automaticamente como se sua idade fosse conhecida.
    estado.registros = estado.registros.filter(item => {
      const referencia = item.situacao === 'concluido' ? item.concluidoEm : item.criadoEm;
      const instante = typeof referencia === 'string' ? Date.parse(referencia) : NaN;
      return !Number.isFinite(instante) || instante >= relogio().getTime() - RETENCAO_MS;
    });
    return quantidade - estado.registros.length;
  }
  async function ler() {
    const estado = await lerArquivo();
    estado.registros = estado.registros.filter(dentroDoPrazo);
    return estado;
  }
  async function gravar(estado, sinal = null) {
    await fs.mkdir(path.dirname(arquivo), { recursive: true });
    const temporario = `${arquivo}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporario, JSON.stringify(estado, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
      if (sinal?.aborted) throw new Error('Procura cancelada.');
      for (let tentativa = 0; ; tentativa++) {
        try { await fs.rename(temporario, arquivo); break; }
        catch (erro) {
          if (!['EPERM', 'EBUSY'].includes(erro.code) || tentativa >= 7) throw erro;
          await new Promise(resolve => setTimeout(resolve, 25 * (tentativa + 1)));
        }
      }
    } finally { await fs.rm(temporario, { force: true }); }
  }
  function avisar() {
    for (const ouvinte of ouvintes) {
      try { ouvinte(); } catch { /* O painel não interrompe a gravação do histórico. */ }
    }
  }
  function limparExpirados() {
    const resultado = fila.then(async () => {
      const estado = await lerArquivo();
      const removidos = filtrarExpirados(estado);
      if (removidos) {
        await gravar(estado);
        avisar();
      }
      return removidos;
    });
    fila = resultado.catch(() => {});
    return resultado;
  }
  function alterar(mutacao, sinal = null) {
    const resultado = fila.then(async () => {
      if (sinal?.aborted) throw new Error('Procura cancelada.');
      const estado = await lerArquivo();
      filtrarExpirados(estado);
      if (sinal?.aborted) throw new Error('Procura cancelada.');
      const retorno = mutacao(estado);
      await gravar(estado, sinal);
      avisar();
      return retorno;
    });
    fila = resultado.catch(() => {});
    return resultado;
  }
  function agora() { return relogio().toISOString(); }
  async function registrar(entrada) {
    if (!operacoes.has(entrada?.operacao) || !situacoes.has(entrada?.situacao) ||
        typeof entrada.chave !== 'string' || !entrada.chave.trim()) throw new Error('Registro de produção inválido.');
    return alterar(estado => {
      const chave = `${entrada.operacao}:${entrada.chave.trim()}`;
      let registro = estado.registros.find(item => item.chave === chave);
      const instante = agora();
      if (!registro) {
        registro = { id: randomUUID(), chave, operacao: entrada.operacao, titulo: '', chapeu: '', subtitulo: '', urlOriginal: '',
          urlCms: '', criadoEm: instante, concluidoEm: null, atualizadoEm: instante, situacao: 'aguardandoRevisao',
          formaConclusao: null, responsavelId: null, motivoLinkPendente:'' };
        estado.registros.push(registro);
      }
      for (const campo of ['titulo', 'chapeu', 'subtitulo', 'urlCms']) {
        if (typeof entrada[campo] === 'string' && entrada[campo].trim()) registro[campo] = entrada[campo].trim();
      }
      if (entrada.urlOriginal) {
        const url = urlPublica(entrada.urlOriginal);
        if (!url) throw new Error('O link original não é uma matéria válida do Tribuna do Sertão.');
        registro.urlOriginal = url;
        registro.motivoLinkPendente = '';
      }
      // Uma nova conferência não rebaixa uma publicação já confirmada.
      if (registro.situacao !== 'concluido') {
        registro.situacao = entrada.situacao;
        if (entrada.situacao === 'concluido') {
          if (!['manual', 'automatico'].includes(entrada.formaConclusao)) throw new Error('Forma de conclusão não confirmada.');
          registro.formaConclusao = entrada.formaConclusao;
          registro.concluidoEm = instante;
        }
      }
      registro.atualizadoEm = instante;
      return structuredClone(registro);
    });
  }
  async function adicionarLinkManual(entrada) {
    const url = urlPublica(entrada?.url);
    const identidade = url && identidadeMateria(url);
    const titulo = String(entrada?.titulo || '').replace(/\s+/g, ' ').trim();
    const chapeu = String(entrada?.chapeu || '').replace(/\s+/g, ' ').trim();
    const subtitulo = String(entrada?.subtitulo || '').replace(/\s+/g, ' ').trim();
    if (!identidade) throw new Error('Informe a URL pública de uma matéria do Tribuna do Sertão.');
    if (!titulo || titulo.length > 500) throw new Error('Confira o título da matéria (até 500 caracteres).');
    if (chapeu.length > 120 || subtitulo.length > 1000) throw new Error('Chapéu ou subtítulo excede o limite permitido.');
    return alterar(estado => {
      const existente = estado.registros.find(item => item.urlOriginal && identidadeMateria(item.urlOriginal) === identidade);
      if (existente) {
        if (existente.operacao !== 'linkManual' || !existente.ocultoSelecao) {
          throw new Error('Esta URL já está na Seleção de Links.');
        }
        // Reinclusão explícita recupera o mesmo registro, sem duplicar a URL ou inventar uma publicação.
        const instante = agora();
        Object.assign(existente, { titulo, chapeu, subtitulo, ocultoSelecao:false,
          concluidoEm:instante, atualizadoEm:instante });
        return structuredClone(existente);
      }
      const instante = agora();
      const registro = { id:randomUUID(), chave:`linkManual:${identidade}`, operacao:'linkManual',
        origem:'manual', titulo, chapeu, subtitulo, urlOriginal:identidade, urlCms:'',
        criadoEm:instante, concluidoEm:instante, atualizadoEm:instante, situacao:'concluido',
        formaConclusao:null, responsavelId:null, motivoLinkPendente:'' };
      estado.registros.push(registro);
      return structuredClone(registro);
    });
  }
  async function responsavel(id, responsavelId) {
    return alterar(estado => {
      const registro = estado.registros.find(item => item.id === id &&
        ['adicionar', 'linkManual'].includes(item.operacao) && item.situacao === 'concluido');
      if (!registro) throw new Error('Matéria publicada não encontrada.');
      if (responsavelId !== null && !estado.responsaveis.some(item => item.id === responsavelId && item.ativo && !item.removido)) {
        throw new Error('Responsável indisponível.');
      }
      registro.responsavelId = registro.responsavelId === responsavelId ? null : responsavelId;
      registro.atualizadoEm = agora();
      return structuredClone(registro);
    });
  }
  async function removerDaSelecao(id) {
    return alterar(estado => {
      const registro = estado.registros.find(item => item.id === id &&
        ['adicionar', 'linkManual'].includes(item.operacao) && item.situacao === 'concluido' && !item.ocultoSelecao);
      if (!registro) throw new Error('Matéria não encontrada na Seleção de Links.');
      registro.ocultoSelecao = true;
      registro.atualizadoEm = agora();
      return structuredClone(registro);
    });
  }
  async function cadastrarResponsavel(nome) {
    const limpo = String(nome || '').replace(/\s+/g, ' ').trim();
    if (!limpo || limpo.length > 60) throw new Error('Digite um nome de até 60 caracteres.');
    return alterar(estado => {
      if (estado.responsaveis.some(item => !item.removido && item.nome.toLocaleLowerCase('pt-BR') === limpo.toLocaleLowerCase('pt-BR'))) {
        throw new Error('Esse responsável já está cadastrado.');
      }
      const novo = { id: randomUUID(), nome: limpo, ativo: true };
      estado.responsaveis.push(novo);
      return structuredClone(novo);
    });
  }
  async function editarResponsavel(id, mudanca) {
    return alterar(estado => {
      const item = estado.responsaveis.find(responsavel => responsavel.id === id);
      if (!item) throw new Error('Responsável não encontrado.');
      if (item.removido) throw new Error('Responsável removido não pode ser alterado. Cadastre o nome novamente.');
      if (mudanca.nome !== undefined) {
        const nome = String(mudanca.nome || '').replace(/\s+/g, ' ').trim();
        if (!nome || nome.length > 60) throw new Error('Digite um nome de até 60 caracteres.');
        if (estado.responsaveis.some(outro => outro.id !== id && !outro.removido && outro.nome.toLocaleLowerCase('pt-BR') === nome.toLocaleLowerCase('pt-BR'))) throw new Error('Esse nome já está cadastrado.');
        item.nome = nome;
      }
      if (typeof mudanca.ativo === 'boolean') item.ativo = mudanca.ativo;
      return structuredClone(item);
    });
  }
  async function removerResponsavel(id) {
    return alterar(estado => {
      const item = estado.responsaveis.find(responsavel => responsavel.id === id);
      if (!item) throw new Error('Responsável não encontrado.');
      // O cadastro fica como referência das atribuições ainda dentro dos 8 dias.
      item.ativo = false;
      item.removido = true;
      return structuredClone(item);
    });
  }
  async function definirUrl(id, valor) {
    const url = urlPublica(valor);
    if (!url) throw new Error('Informe a URL original da matéria no Tribuna do Sertão.');
    return alterar(estado => {
      const registro = estado.registros.find(item => item.id === id && item.operacao === 'adicionar' && item.situacao === 'concluido');
      if (!registro) throw new Error('Matéria publicada não encontrada.');
      registro.urlOriginal = url;
      registro.motivoLinkPendente = '';
      registro.atualizadoEm = agora();
      return structuredClone(registro);
    });
  }
  async function pendentesRecuperaveis() {
    const estado = await ler();
    return estado.registros.filter(item => item.operacao === 'adicionar' && item.situacao === 'concluido' &&
      !item.urlOriginal && typeof item.urlCms === 'string' && item.urlCms);
  }
  async function publicadas() {
    const estado = await ler();
    return estado.registros.filter(item => item.operacao === 'adicionar' && item.situacao === 'concluido')
      .map(item => structuredClone(item));
  }
  async function definirUrlCompartilhamento(id, tituloChave, valor, sinal = null) {
    const url = urlPublica(valor);
    if (!url || !tituloChave) throw new Error('Link ou título inválido para associação automática.');
    return alterar(estado => {
      const publicados = estado.registros.filter(item => item.operacao === 'adicionar' && item.situacao === 'concluido');
      const registro = publicados.find(item => item.id === id);
      if (!registro || chaveTitulo(registro.titulo) !== tituloChave) throw new Error('O título do registro mudou durante a associação.');
      if (publicados.some(item => item.id !== id && chaveTitulo(item.titulo) === tituloChave)) {
        throw new Error('Há títulos iguais no histórico; associação automática cancelada.');
      }
      if (publicados.some(item => item.id !== id && item.urlOriginal === url)) {
        throw new Error('A URL pública já pertence a outra matéria do histórico.');
      }
      if (!registro.urlOriginal) {
        registro.urlOriginal = url;
        registro.motivoLinkPendente = '';
        registro.atualizadoEm = agora();
      }
      return structuredClone(registro);
    }, sinal);
  }
  async function registrarMotivoLink(id, motivo, sinal = null) {
    const texto = String(motivo || '').slice(0, 180);
    return alterar(estado => {
      const registro = estado.registros.find(item => item.id === id && item.operacao === 'adicionar' &&
        item.situacao === 'concluido' && !item.urlOriginal);
      if (!registro) return null;
      registro.motivoLinkPendente = texto;
      registro.atualizadoEm = agora();
      return structuredClone(registro);
    }, sinal);
  }
  async function definirUrlRecuperada(id, urlCms, valor) {
    const url = urlPublica(valor);
    if (!url) throw new Error('URL pública inválida na recuperação.');
    return alterar(estado => {
      const registro = estado.registros.find(item => item.id === id && item.operacao === 'adicionar' &&
        item.situacao === 'concluido' && item.urlCms === urlCms);
      if (!registro) throw new Error('Registro ou identificador do CMS não corresponde à recuperação.');
      if (!registro.urlOriginal) {
        registro.urlOriginal = url;
        registro.motivoLinkPendente = '';
        registro.atualizadoEm = agora();
      }
      return structuredClone(registro);
    });
  }
  function observar(ouvinte) {
    ouvintes.add(ouvinte);
    return () => ouvintes.delete(ouvinte);
  }
  async function consultar(data = dataLocal(agora())) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || dataLocal(`${data}T12:00:00-03:00`) !== data) throw new Error('Escolha uma data válida.');
    const estado = await ler();
    const registros = estado.registros.filter(item => dataLocal(item.concluidoEm || item.criadoEm) === data);
    const concluidos = registros.filter(item => item.situacao === 'concluido');
    const compartilh = concluidos.filter(item => ['adicionar', 'linkManual'].includes(item.operacao) && !item.ocultoSelecao);
    const producao = registros.filter(item => item.operacao !== 'linkManual');
    const concluidosProducao = producao.filter(item => item.situacao === 'concluido');
    return { data, responsaveis: estado.responsaveis,
      redatores: estado.responsaveis.filter(item => IDS_REDATORES.has(item.id) && item.ativo && !item.removido), registros,
      compartilh: compartilh.sort((a, b) => b.concluidoEm.localeCompare(a.concluidoEm)),
      estatisticas: {
        concluidas: concluidosProducao.length,
        atualizacoesAutomaticas: concluidosProducao.filter(item => item.operacao === 'atualizar' && item.formaConclusao === 'automatico').length,
        finalizadasManualmente: concluidosProducao.filter(item => item.formaConclusao === 'manual').length,
        adicionadas: concluidosProducao.filter(item => item.operacao === 'adicionar').length,
        aguardandoRevisao: producao.filter(item => item.situacao === 'aguardandoRevisao').length,
        erros: producao.filter(item => ['erro', 'naoConfirmado'].includes(item.situacao)).length
      } };
  }
  async function materiasPorResponsavel(data = dataLocal(agora())) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || dataLocal(`${data}T12:00:00-03:00`) !== data) throw new Error('Escolha uma data válida.');
    const estado = await ler(); // Mesma retenção de oito dias usada pelos outros painéis.
    const unicos = new Map();
    const publicados = estado.registros
      .filter(item => ['adicionar', 'linkManual'].includes(item.operacao) && item.situacao === 'concluido')
      .sort((a, b) => String(b.atualizadoEm || b.concluidoEm).localeCompare(String(a.atualizadoEm || a.concluidoEm)));
    for (const item of publicados) {
      const url = urlPublica(item.urlOriginal);
      const chave = url ? `url:${new URL(url).pathname.replace(/\/$/, '')}` : `id:${item.id}`;
      if (!unicos.has(chave)) unicos.set(chave, item);
    }
    function contar(itens) {
      const quantidades = new Map();
      for (const item of itens) {
        if (item.responsavelId && estado.responsaveis.some(pessoa => pessoa.id === item.responsavelId)) {
          quantidades.set(item.responsavelId, (quantidades.get(item.responsavelId) || 0) + 1);
        }
      }
      return { total: [...quantidades.values()].reduce((soma, quantidade) => soma + quantidade, 0),
        grupos: estado.responsaveis.filter(pessoa => !pessoa.removido || quantidades.has(pessoa.id))
          .map(pessoa => ({ id:pessoa.id, nome:pessoa.nome, quantidade:quantidades.get(pessoa.id) || 0 })) };
    }
    const atribuídos = [...unicos.values()];
    return { data, dia:contar(atribuídos.filter(item => dataLocal(item.concluidoEm) === data)),
      periodo:contar(atribuídos) };
  }
  async function relatorio(data) {
    const consulta = await consultar(data);
    const nomesPrioritarios = ['Vladimir', 'Cinara', 'Land', 'Radar', 'Email'];
    const nomeChave = nome => String(nome || '').trim().toLocaleLowerCase('pt-BR');
    const gruposPorNome = new Map();
    for (const nome of nomesPrioritarios) gruposPorNome.set(nomeChave(nome), { responsavel:{ nome }, urls:[] });
    const idsAtribuidos = new Set(consulta.compartilh.map(item => item.responsavelId).filter(Boolean));
    for (const responsavel of consulta.responsaveis) {
      const chave = nomeChave(responsavel.nome);
      if (idsAtribuidos.has(responsavel.id) && !gruposPorNome.has(chave)) {
        gruposPorNome.set(chave, { responsavel, urls:[] });
      } else if (gruposPorNome.has(chave)) {
        const grupo = gruposPorNome.get(chave);
        if (!grupo.responsavel.id || (responsavel.ativo && !responsavel.removido)) grupo.responsavel = responsavel;
      }
    }
    const grupos = [...gruposPorNome.values()];
    const semResponsavel = [], semUrl = [], duplicados = [];
    const vistas = new Set();
    for (const item of consulta.compartilh) {
      if (!item.responsavelId) { semResponsavel.push(item); continue; }
      if (!item.urlOriginal) { semUrl.push(item); continue; }
      if (vistas.has(item.urlOriginal)) { duplicados.push(item); continue; }
      const responsavel = consulta.responsaveis.find(pessoa => pessoa.id === item.responsavelId);
      const grupo = responsavel && gruposPorNome.get(nomeChave(responsavel.nome));
      if (!grupo) { semResponsavel.push(item); continue; }
      vistas.add(item.urlOriginal);
      grupo.urls.push(item.urlOriginal);
    }
    const texto = grupos.map(({ responsavel, urls }) => `LINKS ${responsavel.nome.toLocaleUpperCase('pt-BR')}\n\n${urls.join('\n\n')}`)
      .join('\n\n');
    return { data: consulta.data, texto, grupos, semResponsavel, semUrl, duplicados };
  }
  async function compartilhavel(id) {
    const estado = await ler();
    const item = estado.registros.find(registro => registro.id === id &&
      ['adicionar', 'linkManual'].includes(registro.operacao) && registro.situacao === 'concluido');
    if (!item || !item.urlOriginal) throw new Error('Link original ainda não disponível para esta matéria.');
    return montarTextoCompartilhamento({ chapeu: item.chapeu, titulo: item.titulo, subtitulo: item.subtitulo, url: item.urlOriginal });
  }
  return { registrar, adicionarLinkManual, responsavel, removerDaSelecao, cadastrarResponsavel, editarResponsavel, removerResponsavel, definirUrl, pendentesRecuperaveis,
    definirUrlRecuperada, publicadas, definirUrlCompartilhamento, registrarMotivoLink,
    observar, consultar, materiasPorResponsavel, relatorio, compartilhavel, limparExpirados };
}

module.exports = { criarHistoricoProducao, urlPublica, dataLocal, RETENCAO_MS };
