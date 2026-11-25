const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { identificarMateria } = require('./identificar-materia');

const PASTA_PADRAO = path.join(__dirname, 'work', 'captura-materias');
const CAMPOS = ['titulo', 'chapeu', 'bigode', 'redacao', 'autor', 'categoria', 'imagemNome',
  'legendaImagem', 'creditoImagem', 'tags', 'portais', 'tipoRadar', 'cidade'];
const MAX_TEXTO = 120000;
const MAX_FOTO = 12 * 1024 * 1024;
const TIPOS = { jpeg:'image/jpeg', png:'image/png', webp:'image/webp', gif:'image/gif' };
const hash = valor => createHash('sha256').update(valor).digest('hex');
const novoEstado = () => ({ versao:1, mensagens:[], rascunhos:[] });

function tipoImagem(bytes) {
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'jpeg';
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
  if (bytes.subarray(0, 4).toString() === 'GIF8') return 'gif';
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}
function validarEstado(estado) {
  if (estado?.versao !== 1 || !Array.isArray(estado.mensagens) || !Array.isArray(estado.rascunhos) ||
      estado.mensagens.some(item => !item || typeof item.id !== 'string' || typeof item.texto !== 'string' ||
        !Array.isArray(item.fotos)) || estado.rascunhos.some(item => !item || typeof item.id !== 'string' ||
        !Array.isArray(item.mensagemIds) || !item.campos || typeof item.campos !== 'object'))
    throw new Error('Arquivo da Central de Captura inválido. O conteúdo foi preservado para recuperação.');
  return estado;
}
function separarMensagens(texto, agora) {
  const original = String(texto || '').replace(/\r\n?/g, '\n');
  if (!original.trim()) return [];
  const recebidoEm = new Date(agora).toISOString();
  // Radar de Notícias: os delimitadores explícitos são soberanos e impedem
  // que metadados ou parágrafos de matérias vizinhas sejam misturados.
  const inicioEditorial = /^\s*(?:#{1,6}\s*)?(?:IN[IÍ]CIO\s+(?:DA|DE)\s+)?MAT[EÉ]RIA\s+(\d+)\s*$/i;
  const fimEditorial = /^\s*(?:#{1,6}\s*)?FIM\s+(?:DA|DE)\s+MAT[EÉ]RIA\s+(\d+)\s*$/i;
  const linhasOriginais = original.split('\n');
  const blocosEditoriais = [];
  let bloco = null;
  for (const linha of linhasOriginais) {
    const inicio = linha.match(inicioEditorial);
    const fim = linha.match(fimEditorial);
    if (inicio) {
      if (bloco) throw new Error(`A matéria ${bloco.numero} não possui marcador de fim antes da próxima matéria.`);
      bloco = { numero:inicio[1], linhas:[] }; continue;
    }
    if (fim) {
      if (!bloco || bloco.numero !== fim[1]) throw new Error(`Marcadores de início e fim da matéria ${fim[1]} não correspondem.`);
      blocosEditoriais.push(bloco.linhas.join('\n').trim()); bloco = null; continue;
    }
    if (bloco) bloco.linhas.push(linha);
  }
  if (bloco) throw new Error(`A matéria ${bloco.numero} não possui marcador de fim.`);
  if (blocosEditoriais.length) return blocosEditoriais.filter(Boolean).map(parte => ({ textoOriginal:parte, texto:parte,
    remetente:'', horarioInformado:'', recebidoEm }));
  // Radar Clima: cada notícia termina com a referência de sua própria foto.
  const marcadoresFoto = linhasOriginais.filter(linha => /^\s*(?:imagem\s+anexa|imagem\s+de\s+destaque\s+sugerida)\s*:/i.test(linha)).length;
  if (marcadoresFoto > 1) {
    const partes=[]; let atual=[];
    for (const linha of linhasOriginais) {
      atual.push(linha);
      if (/^\s*(?:imagem\s+anexa|imagem\s+de\s+destaque\s+sugerida)\s*:/i.test(linha)) {
        const parte=atual.join('\n').trim(); if (parte) partes.push(parte); atual=[];
      }
    }
    if (atual.join('').trim()) partes[partes.length - 1] += '\n' + atual.join('\n');
    return partes.map(parte => ({ textoOriginal:parte, texto:parte, remetente:'', horarioInformado:'', recebidoEm }));
  }
  const linhas = original.split('\n');
  const blocos = [];
  let atual = null;
  const cabecalho = /^\s*\[(\d{1,2}:\d{2}),\s*(\d{1,2}\/\d{1,2}\/\d{2,4})\]\s+([^:\n]{1,100}):\s*(.*)$/;
  for (const linha of linhas) {
    const encontrado = linha.match(cabecalho);
    if (encontrado) {
      if (atual) blocos.push(atual);
      atual = { textoOriginal:linha, texto:encontrado[4], remetente:encontrado[3],
        horarioInformado:`${encontrado[2]} ${encontrado[1]}` };
    } else if (atual) { atual.textoOriginal += '\n' + linha; atual.texto += '\n' + linha; }
    else {
      if (!blocos.length) blocos.push({ textoOriginal:'', texto:'', remetente:'', horarioInformado:'' });
      blocos[0].textoOriginal += (blocos[0].textoOriginal ? '\n' : '') + linha;
      blocos[0].texto += (blocos[0].texto ? '\n' : '') + linha;
    }
  }
  if (atual) blocos.push(atual);
  const separados = blocos.flatMap(item => {
    if (item.horarioInformado) return [item];
    // Em textos sem cabeçalho, um segundo Título explícito após o corpo
    // sinaliza uma nova notícia. Parágrafos comuns nunca iniciam a divisão.
    const linhas = item.textoOriginal.split('\n');
    const grupos = []; let atual = [], temTitulo = false, temCorpo = false;
    for (const linha of linhas) {
      const titulo = /^\s*(?:\*\*)?t[ií]tulo\s*:/i.test(linha);
      const corpo = /^\s*(?:\*\*)?(?:reda[çc][aã]o|corpo|texto)\s*:/i.test(linha);
      if (titulo && temTitulo && temCorpo && atual.length) {
        grupos.push(atual.join('\n')); atual = []; temTitulo = false; temCorpo = false;
      }
      atual.push(linha); temTitulo ||= titulo; temCorpo ||= corpo;
    }
    if (atual.length) grupos.push(atual.join('\n'));
    return grupos.map(parte => ({ ...item, textoOriginal:parte, texto:parte }));
  });
  return separados.filter(item => item.texto.trim()).map(item => ({ ...item,
    recebidoEm }));
}
function identificar(texto, agora) {
  try { return identificarMateria(texto, new Date(agora)).campos; }
  catch { return Object.fromEntries(CAMPOS.map(campo => [campo, ''])); }
}
function camposDe(mensagens, agora) {
  const texto = mensagens.map(item => item.texto).join('\n\n');
  const identificado = identificar(texto, agora);
  return Object.fromEntries(CAMPOS.map(campo => [campo, String(identificado[campo] || '')]));
}
function rotulosDesconhecidos(mensagens) {
  const conhecidos = /^(?:t[ií]tulo|chap[eé]u|subt[ií]tulo|bigode|reda[çc][aã]o|corpo|texto|autor|autoria|categoria(?: sugerida)?|data|imagem(?: de)?(?: destaque)?(?: sugerida)?|imagem anexa|foto|fonte|legenda da imagem|cr[eé]ditos?(?:\/origem da imagem| da imagem)?|tags|portal(?:\(is\))? recomendado(?:\(s\))?)$/i;
  return [...new Set(mensagens.flatMap(item => item.texto.split('\n'))
    .map(linha => /^\s*([\p{L} ]{2,30})\s*:/u.exec(linha)?.[1]?.trim())
    .filter(rotulo => rotulo && !conhecidos.test(rotulo)))];
}
function classificarMensagem(item, agora) {
  const campos = identificar(item.texto, agora);
  const rotulo = /^\s*(?:\*{0,2})(t[ií]tulo|chap[eé]u|subt[ií]tulo|bigode|reda[çc][aã]o|texto)\s*:/i.exec(item.texto)?.[1]?.toLowerCase() || '';
  return { titulo:!!campos.titulo, corpo:!!campos.redacao,
    rotuloTitulo:/t[ií]tulo/i.test(rotulo), rotuloCorpo:/reda|texto/i.test(rotulo),
    rotuloOutro:/chap|subt|bigode/i.test(rotulo) };
}
function proporGrupos(mensagens, agora) {
  const grupos = [];
  let atual = [];
  let sinais = { titulo:false, corpo:false };
  const fechar = () => { if (atual.length) grupos.push(atual); atual=[]; sinais={ titulo:false, corpo:false }; };
  for (const item of mensagens) {
    if (!item.texto.trim()) { fechar(); continue; }
    const novo = classificarMensagem(item, agora);
    const novaMateria = atual.length && ((sinais.titulo && novo.rotuloTitulo) ||
      (sinais.titulo && sinais.corpo && novo.titulo && !novo.rotuloOutro));
    if (novaMateria) fechar();
    atual.push(item);
    sinais.titulo ||= novo.titulo;
    sinais.corpo ||= novo.corpo;
  }
  fechar();
  return grupos;
}

function criarCapturaMaterias(pasta = PASTA_PADRAO, relogio = () => new Date()) {
  const arquivo = path.join(pasta, 'estado.json');
  const pastaFotos = path.join(pasta, 'fotos');
  const pastaBackups = path.join(pasta, 'backups');
  let fila = Promise.resolve();
  async function lerValido(caminho) { return validarEstado(JSON.parse(await fs.readFile(caminho, 'utf8'))); }
  async function ler() {
    try { return await lerValido(arquivo); }
    catch (erro) {
      if (erro.code === 'ENOENT') return novoEstado();
      const backups = (await fs.readdir(pastaBackups).catch(() => [])).filter(nome => /^estado-.*\.json$/.test(nome)).sort().reverse();
      for (const nome of backups) {
        try {
          const recuperado = await lerValido(path.join(pastaBackups, nome));
          await fs.mkdir(pasta, { recursive:true });
          await fs.rename(arquivo, path.join(pasta, `estado-corrompido-${Date.now()}-${randomUUID()}.json`));
          await gravar(recuperado, false);
          return { ...recuperado, avisoRecuperacao:'Rascunhos recuperados de um backup. O arquivo danificado foi preservado.' };
        } catch { /* Tenta o próximo backup válido. */ }
      }
      throw new Error('A caixa de entrada está corrompida e nenhum backup válido foi encontrado. Nada foi sobrescrito.');
    }
  }
  async function gravar(estado, backup = true) {
    validarEstado(estado);
    await fs.mkdir(pasta, { recursive:true });
    if (backup) {
      try {
        await fs.access(arquivo);
        await fs.mkdir(pastaBackups, { recursive:true });
        await fs.copyFile(arquivo, path.join(pastaBackups, `estado-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.json`));
      } catch (erro) { if (erro.code !== 'ENOENT') throw erro; }
    }
    const temporario = `${arquivo}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporario, JSON.stringify(estado, null, 2) + '\n', { flag:'wx', encoding:'utf8' });
      await fs.rename(temporario, arquivo);
    } finally { await fs.rm(temporario, { force:true }).catch(() => {}); }
  }
  function alterar(acao) {
    const tarefa = fila.then(async () => {
      const estado = await ler();
      const resultado = await acao(estado);
      await gravar(estado);
      return resultado;
    });
    fila = tarefa.catch(() => {});
    return tarefa;
  }
  const agora = () => relogio().toISOString();
  async function armazenarFotos(fotos) {
    if (!Array.isArray(fotos) || fotos.length > 10) throw new Error('Anexe até dez fotos por entrada.');
    const guardadas = [];
    for (const foto of fotos) {
      if (typeof foto?.dados !== 'string' || foto.dados.length > MAX_FOTO * 1.4 + 100) throw new Error('Foto inválida ou maior que 12 MB.');
      const bytes = Buffer.from(foto.dados, 'base64');
      const tipo = tipoImagem(bytes);
      if (!tipo || bytes.length > MAX_FOTO || !bytes.length) throw new Error('Use fotos JPEG, PNG, WebP ou GIF de até 12 MB.');
      const id = hash(bytes);
      await fs.mkdir(pastaFotos, { recursive:true });
      const destino = path.join(pastaFotos, `${id}.${tipo}`);
      try { await fs.writeFile(destino, bytes, { flag:'wx' }); }
      catch (erro) { if (erro.code !== 'EEXIST') throw erro; }
      guardadas.push({ id, tipo, nome:String(foto.nome || 'foto').slice(0, 150), tamanho:bytes.length });
    }
    return guardadas;
  }
  async function receber(entrada) {
    if (entrada?.metodo !== 'colar') throw new Error('Método de captura indisponível nesta fase.');
    if (typeof entrada.texto !== 'string' || entrada.texto.length > MAX_TEXTO) throw new Error('Texto inválido ou maior que 120 mil caracteres.');
    const fotos = await armazenarFotos(entrada.fotos || []);
    const partes = separarMensagens(entrada.texto, relogio());
    if (!partes.length && !fotos.length) throw new Error('Cole uma mensagem ou anexe uma fotografia.');
    if (!partes.length) partes.push({ texto:'', textoOriginal:'', recebidoEm:agora(), remetente:'', horarioInformado:'' });
    else if (partes.length > 1 && fotos.length) partes.push({ texto:'', textoOriginal:'', recebidoEm:agora(), remetente:'', horarioInformado:'' });
    return alterar(estado => {
      const novas = [], duplicatas = [];
      for (let i = 0; i < partes.length; i++) {
        const parte = partes[i];
        const identificadorExterno = entrada.identificador
          ? `${String(entrada.identificador).slice(0, 180)}:${i + 1}` : '';
        if (identificadorExterno && estado.mensagens.some(item => item.identificadorExterno === identificadorExterno)) {
          duplicatas.push(identificadorExterno); continue;
        }
        const fotosDaParte = (!parte.texto.trim() || partes.length === 1) ? fotos : [];
        const assinatura = hash(parte.texto + '\n' + fotosDaParte.map(foto => foto.id).join(','));
        const semelhante = estado.mensagens.find(item => item.assinatura === assinatura);
        const item = { id:randomUUID(), metodo:'colar', origem:String(entrada.origem || 'WhatsApp — texto colado').slice(0, 200),
          identificadorExterno, texto:parte.texto, textoOriginal:parte.textoOriginal,
          recebidoEm:parte.recebidoEm, horarioInformado:parte.horarioInformado,
          remetente:parte.remetente, fotos:fotosDaParte, assinatura,
          duplicataPossivel:semelhante?.id || null, rascunhoId:null, descartada:false };
        estado.mensagens.push(item); novas.push(item.id);
      }
      return { novas, duplicatas };
    });
  }
  async function organizar() {
    return alterar(estado => {
      const soltas = estado.mensagens.filter(item => !item.rascunhoId && !item.descartada && item.texto.trim());
      const grupos = proporGrupos(soltas, agora());
      const ids = [];
      for (const grupo of grupos) {
        const campos = camposDe(grupo, agora());
        const desconhecidos = rotulosDesconhecidos(grupo);
        const id = randomUUID();
        const fotos = grupo.flatMap(item => item.fotos);
        const rascunho = { id, mensagemIds:grupo.map(item => item.id), campos,
          fotoId:fotos.length === 1 ? fotos[0].id : null,
          ambiguo:fotos.length > 1 || grupo.some(item => item.duplicataPossivel) ||
            grupo.length > 1 || desconhecidos.length > 0,
          rotulosDesconhecidos:desconhecidos,
          status:'revisao', criadoEm:agora(), atualizadoEm:agora(),
          motivo:fotos.length > 1 ? 'Escolha a fotografia correspondente.' :
            grupo.some(item => item.duplicataPossivel) ? 'Possível mensagem duplicada.' :
            grupo.length > 1 ? 'Confira se as mensagens pertencem à mesma matéria.' :
            desconhecidos.length ? 'Há campos não reconhecidos; confira o texto original.' : '' };
        estado.rascunhos.push(rascunho);
        grupo.forEach(item => { item.rascunhoId = id; });
        ids.push(id);
      }
      return { criados:ids.length, ids };
    });
  }
  async function importarLote(entrada) {
    if (typeof entrada?.texto !== 'string' || !entrada.texto.trim() || entrada.texto.length > MAX_TEXTO)
      throw new Error('Cole uma ou mais matérias, com até 120 mil caracteres.');
    const partes = separarMensagens(entrada.texto, relogio()).filter(item => item.texto.trim());
    if (!partes.length) throw new Error('Não foi possível encontrar uma matéria no texto colado.');
    return alterar(estado => {
      const ids = [], duplicatas = [];
      for (const parte of partes) {
        const assinatura = hash(parte.texto);
        const existente = estado.mensagens.find(item => item.assinatura === assinatura && !item.descartada);
        if (existente) { duplicatas.push(existente.rascunhoId || existente.id); continue; }
        const mensagemId = randomUUID(), rascunhoId = randomUUID();
        const campos = identificar(parte.texto, agora());
        estado.mensagens.push({ id:mensagemId, metodo:'colar', origem:String(entrada.origem || 'E-mail colado no Adicionar Matérias').slice(0, 200),
          identificadorExterno:'', texto:parte.texto, textoOriginal:parte.textoOriginal,
          recebidoEm:parte.recebidoEm, horarioInformado:parte.horarioInformado,
          remetente:parte.remetente, fotos:[], assinatura, duplicataPossivel:null,
          rascunhoId, descartada:false });
        estado.rascunhos.push({ id:rascunhoId, mensagemIds:[mensagemId], campos,
          fotoId:null, ambiguo:false, rotulosDesconhecidos:rotulosDesconhecidos([parte]),
          status:'na-fila', criadoEm:agora(), atualizadoEm:agora(),
          motivo:(!campos.titulo || !campos.redacao) ? 'Confira os campos ausentes antes de preencher o CMS.' : '' });
        ids.push(rascunhoId);
      }
      return { identificadas:partes.length, novas:ids.length, ids, duplicatas };
    });
  }
  function analisarLote(entrada) {
    if (typeof entrada?.texto !== 'string' || !entrada.texto.trim() || entrada.texto.length > MAX_TEXTO)
      throw new Error('Cole uma ou mais matérias, com até 120 mil caracteres.');
    const partes = separarMensagens(entrada.texto, relogio()).filter(item => item.texto.trim());
    if (!partes.length) throw new Error('Não foi possível encontrar uma matéria no texto colado.');
    return { quantidade:partes.length, materias:partes.map(parte => ({
      texto:parte.texto, textoOriginal:parte.textoOriginal,
      resultado:identificarMateria(parte.texto, relogio())
    })) };
  }
  async function listar() {
    // Aguarda qualquer gravação em andamento. Assim o painel nunca recebe um
    // estado anterior enquanto a distribuição automática muda na-fila para
    // encaminhado.
    await fila;
    return ler();
  }
  async function atualizar(id, alteracoes) {
    return alterar(estado => {
      // Só o cartão em revisão aceita edição. Um evento atrasado da interface
      // não pode devolver para revisão um rascunho que já foi aprovado ou
      // encaminhado a um quadro.
      const rascunho = estado.rascunhos.find(item => item.id === id && item.status === 'revisao');
      if (!rascunho) throw new Error('Rascunho em revisão não encontrado.');
      if (!alteracoes || CAMPOS.some(campo => alteracoes[campo] !== undefined &&
          (typeof alteracoes[campo] !== 'string' || alteracoes[campo].length > MAX_TEXTO)))
        throw new Error('Campos de revisão inválidos.');
      for (const campo of CAMPOS) if (alteracoes[campo] !== undefined) rascunho.campos[campo] = alteracoes[campo];
      rascunho.status = 'revisao'; rascunho.atualizadoEm = agora();
      return structuredClone(rascunho);
    });
  }
  async function juntar(ids) {
    return alterar(estado => {
      if (!Array.isArray(ids) || ids.length !== 2 || ids[0] === ids[1]) throw new Error('Escolha dois rascunhos distintos.');
      const [primeiro, segundo] = ids.map(id => estado.rascunhos.find(item => item.id === id && item.status === 'revisao'));
      if (!primeiro || !segundo) throw new Error('Escolha dois rascunhos em revisão.');
      const conflitos = CAMPOS.filter(campo => primeiro.campos[campo] && segundo.campos[campo] &&
        primeiro.campos[campo] !== segundo.campos[campo]);
      for (const campo of CAMPOS) if (!primeiro.campos[campo]) primeiro.campos[campo] = segundo.campos[campo];
      if (primeiro.fotoId && segundo.fotoId && primeiro.fotoId !== segundo.fotoId) primeiro.fotoId = null;
      else primeiro.fotoId ||= segundo.fotoId;
      primeiro.mensagemIds.push(...segundo.mensagemIds);
      primeiro.rotulosDesconhecidos = [...new Set([...(primeiro.rotulosDesconhecidos || []), ...(segundo.rotulosDesconhecidos || [])])];
      segundo.mensagemIds.forEach(id => { estado.mensagens.find(item => item.id === id).rascunhoId = primeiro.id; });
      estado.rascunhos = estado.rascunhos.filter(item => item.id !== segundo.id);
      primeiro.ambiguo = true;
      primeiro.motivo = conflitos.length ? `Campos conflitantes: ${conflitos.join(', ')}. Confira os originais.` : 'Confira o agrupamento manual.';
      primeiro.atualizadoEm = agora();
      return structuredClone(primeiro);
    });
  }
  async function separar(id, mensagemId) {
    return alterar(estado => {
      const atual = estado.rascunhos.find(item => item.id === id && item.status === 'revisao');
      if (!atual || atual.mensagemIds.length < 2 || !atual.mensagemIds.includes(mensagemId))
        throw new Error('Escolha uma mensagem de um grupo com pelo menos duas.');
      atual.mensagemIds = atual.mensagemIds.filter(item => item !== mensagemId);
      const mensagem = estado.mensagens.find(item => item.id === mensagemId);
      const novoId = randomUUID();
      mensagem.rascunhoId = novoId;
      atual.campos = camposDe(estado.mensagens.filter(item => atual.mensagemIds.includes(item.id)), agora());
      atual.rotulosDesconhecidos = rotulosDesconhecidos(estado.mensagens.filter(item => atual.mensagemIds.includes(item.id)));
      atual.fotoId = null; atual.ambiguo = true; atual.motivo = 'Grupo separado: confira campos e foto.';
      atual.atualizadoEm = agora();
      const novo = { id:novoId, mensagemIds:[mensagemId], campos:camposDe([mensagem], agora()),
        rotulosDesconhecidos:rotulosDesconhecidos([mensagem]),
        fotoId:mensagem.fotos.length === 1 ? mensagem.fotos[0].id : null,
        ambiguo:true, motivo:'Mensagem separada: confira os campos.',
        status:'revisao', criadoEm:agora(), atualizadoEm:agora() };
      estado.rascunhos.push(novo);
      return { atual:structuredClone(atual), novo:structuredClone(novo) };
    });
  }
  async function associarFoto(id, fotoId) {
    return alterar(estado => {
      const rascunho = estado.rascunhos.find(item => item.id === id && item.status === 'revisao');
      if (!rascunho) throw new Error('Rascunho em revisão não encontrado.');
      if (fotoId !== null && !estado.mensagens.some(item => item.fotos.some(foto => foto.id === fotoId)))
        throw new Error('Fotografia não encontrada na caixa de entrada.');
      rascunho.fotoId = fotoId;
      rascunho.atualizadoEm = agora();
      return structuredClone(rascunho);
    });
  }
  async function confirmarGrupo(id) {
    return alterar(estado => {
      const rascunho = estado.rascunhos.find(item => item.id === id && item.status === 'revisao');
      if (!rascunho) throw new Error('Rascunho em revisão não encontrado.');
      rascunho.ambiguo = false; rascunho.motivo = ''; rascunho.atualizadoEm = agora();
      return structuredClone(rascunho);
    });
  }
  async function aprovar(id) {
    return alterar(estado => {
      const rascunho = estado.rascunhos.find(item => item.id === id && item.status === 'revisao');
      if (!rascunho) throw new Error('Rascunho em revisão não encontrado.');
      if (rascunho.ambiguo) throw new Error('Confirme o agrupamento e a fotografia antes de aprovar.');
      if (!rascunho.campos.titulo.trim() || !rascunho.campos.redacao.trim())
        throw new Error('Título e corpo precisam ser conferidos antes da aprovação.');
      rascunho.status = 'aprovado'; rascunho.atualizadoEm = agora();
      return structuredClone(rascunho);
    });
  }
  async function marcarEncaminhado(id) {
    return alterar(estado => {
      const rascunho = estado.rascunhos.find(item => item.id === id && item.status === 'aprovado');
      if (!rascunho) throw new Error('Rascunho aprovado não encontrado.');
      rascunho.status = 'encaminhado'; rascunho.atualizadoEm = agora();
      return structuredClone(rascunho);
    });
  }
  async function marcarEstado(id, status, motivo = '') {
    const permitidos = new Set(['aprovado','na-fila','encaminhado','liberada','preenchendo','preenchida','aguardando-fotografia','aguardando-revisao','publicacao-nao-confirmada','publicada']);
    if (!permitidos.has(status)) throw new Error('Estado de rascunho inválido.');
    return alterar(estado => {
      const rascunho = estado.rascunhos.find(item => item.id === id && item.status !== 'descartado');
      if (!rascunho) throw new Error('Rascunho não encontrado.');
      rascunho.status = status; rascunho.motivo = String(motivo || '').slice(0, 500); rascunho.atualizadoEm = agora();
      return structuredClone(rascunho);
    });
  }
  async function prepararEncaminhamento(id) {
    const estado = await ler();
    const rascunho = estado.rascunhos.find(item => item.id === id &&
      ['revisao','aprovado','encaminhado','na-fila','liberada','aguardando-fotografia','aguardando-revisao','publicacao-nao-confirmada'].includes(item.status));
    if (!rascunho) throw new Error('Rascunho disponível não encontrado.');
    const mensagens = rascunho.mensagemIds.map(mensagemId => estado.mensagens.find(item => item.id === mensagemId)).filter(Boolean);
    let fotoCaminho = null, fotoNome = null;
    if (rascunho.fotoId) {
      const foto = estado.mensagens.flatMap(item => item.fotos).find(item => item.id === rascunho.fotoId);
      if (!foto) throw new Error('A fotografia associada não existe mais na caixa de entrada.');
      const caminho = path.join(pastaFotos, `${foto.id}.${foto.tipo}`);
      const bytes = await fs.readFile(caminho);
      if (hash(bytes) !== foto.id) throw new Error('Arquivo de fotografia danificado.');
      fotoCaminho = caminho; fotoNome = foto.nome;
    }
    return { ...structuredClone(rascunho), mensagens:structuredClone(mensagens), fotoCaminho, fotoNome };
  }
  async function descartar(id) {
    return alterar(estado => {
      const rascunho = estado.rascunhos.find(item => item.id === id && !['descartado','preenchida','publicada'].includes(item.status));
      if (!rascunho) throw new Error('Rascunho não encontrado para descarte.');
      rascunho.status = 'descartado'; rascunho.atualizadoEm = agora();
      rascunho.mensagemIds.forEach(mensagemId => { estado.mensagens.find(item => item.id === mensagemId).descartada = true; });
      return structuredClone(rascunho);
    });
  }
  async function mover(id, direcao, ordemVisivel = []) {
    if (![-1, 1].includes(direcao)) throw new Error('Direção inválida para reordenar a fila.');
    return alterar(estado => {
      const pendente = item => !['descartado','preenchida','publicada'].includes(item.status);
      const permitidos = Array.isArray(ordemVisivel) && ordemVisivel.length
        ? new Set(ordemVisivel.filter(item => typeof item === 'string')) : null;
      const indices = estado.rascunhos.map((item, indice) => pendente(item) && (!permitidos || permitidos.has(item.id)) ? indice : -1).filter(indice => indice >= 0);
      const atualNaFila = indices.findIndex(indice => estado.rascunhos[indice].id === id);
      const destinoNaFila = atualNaFila + direcao;
      if (atualNaFila < 0) throw new Error('Matéria não encontrada na fila.');
      if (destinoNaFila < 0 || destinoNaFila >= indices.length) return structuredClone(estado.rascunhos[indices[atualNaFila]]);
      const atual = indices[atualNaFila], destino = indices[destinoNaFila];
      [estado.rascunhos[atual], estado.rascunhos[destino]] = [estado.rascunhos[destino], estado.rascunhos[atual]];
      estado.rascunhos[destino].atualizadoEm = agora();
      return structuredClone(estado.rascunhos[destino]);
    });
  }
  async function obterFoto(id) {
    const estado = await ler();
    const foto = estado.mensagens.flatMap(item => item.fotos).find(item => item.id === id);
    if (!foto) throw new Error('Foto não encontrada.');
    const bytes = await fs.readFile(path.join(pastaFotos, `${foto.id}.${foto.tipo}`));
    if (hash(bytes) !== foto.id) throw new Error('Arquivo de fotografia danificado.');
    return `data:${TIPOS[foto.tipo]};base64,${bytes.toString('base64')}`;
  }
  return { receber, organizar, analisarLote, importarLote, listar, atualizar, juntar, separar, associarFoto,
    confirmarGrupo, aprovar, marcarEncaminhado, marcarEstado, prepararEncaminhamento, descartar, mover, obterFoto };
}

module.exports = { criarCapturaMaterias, separarMensagens, proporGrupos, PASTA_PADRAO };
