const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns');
const net = require('node:net');
const { identidadeMateria, chaveTitulo } = require('./compartilhar-materias');

const LIMITE_BYTES = 1024 * 1024;
const LIMITE_REDIRECIONAMENTOS = 3;
const TIMEOUT_MS = 12000;
const DOMINIO = 'tribunadosertao.com.br';

function validarUrlMateria(valor) {
  let url;
  try { url = new URL(String(valor || '').trim()); }
  catch { throw new Error('Informe uma URL válida da matéria.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port ||
      !['tribunadosertao.com.br', 'www.tribunadosertao.com.br'].includes(url.hostname.toLowerCase()) ||
      !identidadeMateria(url.href)) {
    throw new Error(`Somente links públicos de matérias de ${DOMINIO} são aceitos.`);
  }
  return url;
}

function ipPublico(endereco) {
  const tipo = net.isIP(endereco);
  if (tipo === 4) {
    const [a, b, c] = endereco.split('.').map(Number);
    return a !== 0 && a !== 10 && a !== 127 && a < 224 &&
      !(a === 100 && b >= 64 && b <= 127) && !(a === 169 && b === 254) &&
      !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && b === 168) &&
      !(a === 192 && ((b === 0 && [0, 2].includes(c)) || (b === 88 && c === 99))) &&
      !(a === 198 && ([18, 19].includes(b) || (b === 51 && c === 100))) &&
      !(a === 203 && b === 0 && c === 113);
  }
  if (tipo === 6) {
    const ip = endereco.toLowerCase();
    if (ip.includes('.') || ip.startsWith('::ffff:')) return false;
    const primeiro = parseInt(ip.split(':')[0] || '0', 16);
    return primeiro >= 0x2000 && primeiro <= 0x3fff &&
      !(primeiro === 0x2001 && parseInt(ip.split(':')[1] || '0', 16) === 0xdb8);
  }
  return false;
}

async function requisitar(url) {
  let limiteDns;
  const prazoDns = new Promise((_, reject) => {
    limiteDns = setTimeout(() => reject(new Error('Tempo esgotado ao localizar o endereço da matéria.')), TIMEOUT_MS);
  });
  let enderecos;
  try { enderecos = await Promise.race([dns.promises.lookup(url.hostname, { all:true }), prazoDns]); }
  finally { clearTimeout(limiteDns); }
  if (!enderecos.length || enderecos.some(item => !ipPublico(item.address))) {
    throw new Error('O endereço de rede da matéria não é público.');
  }
  const escolhido = enderecos[0];
  return new Promise((resolve, reject) => {
    const agente = url.protocol === 'https:' ? https : http;
    const pedido = agente.get(url, {
      timeout:TIMEOUT_MS, headers:{ Accept:'text/html', 'Accept-Encoding':'identity', 'User-Agent':'AutoXS/1.0' },
      lookup:(_hostname, _opcoes, callback) => callback(null, escolhido.address, escolhido.family)
    }, resposta => {
      const partes = [];
      let tamanho = 0;
      resposta.on('data', parte => {
        tamanho += parte.length;
        if (tamanho > LIMITE_BYTES) { pedido.destroy(new Error('A página excedeu o limite de tamanho.')); return; }
        partes.push(parte);
      });
      resposta.on('end', () => { clearTimeout(limiteTempo); resolve({ status:resposta.statusCode, location:resposta.headers.location,
        contentType:resposta.headers['content-type'] || '', html:Buffer.concat(partes).toString('utf8') }); });
      resposta.on('error', erro => { clearTimeout(limiteTempo); reject(erro); });
    });
    const limiteTempo = setTimeout(() => pedido.destroy(new Error('Tempo esgotado ao buscar a matéria.')), TIMEOUT_MS);
    pedido.on('error', erro => { clearTimeout(limiteTempo); reject(erro); });
  });
}

async function baixarMateria(valor, requisicao = requisitar) {
  let url = validarUrlMateria(valor);
  for (let saltos = 0; saltos <= LIMITE_REDIRECIONAMENTOS; saltos++) {
    let resposta;
    try { resposta = await requisicao(url); }
    catch (erro) { throw new Error(`Não foi possível acessar a matéria: ${erro.message}`); }
    if ([301, 302, 303, 307, 308].includes(resposta.status)) {
      if (saltos === LIMITE_REDIRECIONAMENTOS) throw new Error('A matéria redirecionou muitas vezes.');
      url = validarUrlMateria(new URL(resposta.location || '', url).href);
      continue;
    }
    if (resposta.status !== 200) throw new Error(`A página da matéria respondeu HTTP ${resposta.status || 'desconhecido'}.`);
    if (!/^text\/html(?:\s*;|\s*$)/i.test(resposta.contentType)) throw new Error('O link não retornou uma página HTML.');
    const html = String(resposta.html || '');
    if (Buffer.byteLength(html, 'utf8') > LIMITE_BYTES) throw new Error('A página excedeu o limite de tamanho.');
    return { html, url:identidadeMateria(url.href) };
  }
  throw new Error('A matéria redirecionou muitas vezes.');
}

const ENTIDADES = { amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", nbsp:' ',
  aacute:'á', eacute:'é', iacute:'í', oacute:'ó', uacute:'ú', agrave:'à',
  acirc:'â', ecirc:'ê', ocirc:'ô', atilde:'ã', otilde:'õ', ccedil:'ç' };
function decodificar(valor) {
  return String(valor || '').replace(/&(#(?:x[\da-f]+|\d+)|[a-z]+);/gi, (inteiro, entidade) => {
    if (entidade[0] === '#') {
      const codigo = entidade[1]?.toLowerCase() === 'x' ? parseInt(entidade.slice(2), 16) : Number(entidade.slice(1));
      return codigo > 0 && codigo <= 0x10ffff ? String.fromCodePoint(codigo) : inteiro;
    }
    return ENTIDADES[entidade.toLowerCase()] ?? inteiro;
  });
}
function limpar(valor) { return decodificar(valor).replace(/\s+/g, ' ').trim(); }
function atributos(tag) {
  const resultado = {};
  const inicio = /^<\/?[\w:-]+/.exec(tag)?.[0].length || 0;
  const trecho = tag.slice(inicio).replace(/\/?\s*>$/, '');
  for (const match of trecho.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    resultado[match[1].toLowerCase()] = decodificar(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return resultado;
}
function arvore(html) {
  const raiz = { tag:'root', attrs:{}, filhos:[], pai:null };
  const pilha = [raiz];
  const vazios = new Set(['meta','link','img','br','hr','input','source','area','base','wbr']);
  // Metadados estruturados em <meta> são usados; scripts externos e JSON-LD
  // não são executados nem tratados como conteúdo editorial visível.
  const seguro = String(html).replace(/<!--[^]*?-->|<(script|style|template|noscript)\b[^>]*>[^]*?<\/\1\s*>/gi, '');
  const tokens = seguro.match(/<![^>]*>|<\/?[\w:-]+(?:"[^"]*"|'[^']*'|[^'">])*>|[^<]+/g) || [];
  for (const token of tokens) {
    if (token.startsWith('<!')) continue;
    if (token.startsWith('</')) {
      const nome = /^<\/([\w:-]+)/.exec(token)?.[1].toLowerCase();
      const indice = pilha.findLastIndex(item => item.tag === nome);
      if (indice > 0) pilha.length = indice;
    } else if (token.startsWith('<')) {
      const nome = /^<([\w:-]+)/.exec(token)?.[1].toLowerCase();
      if (!nome) continue;
      const pai = pilha.at(-1);
      const no = { tag:nome, attrs:atributos(token), filhos:[], pai };
      pai.filhos.push(no);
      if (!vazios.has(nome) && !token.endsWith('/>')) pilha.push(no);
    } else if (!['script','style','template','noscript'].some(nome => pilha.some(item => item.tag === nome))) {
      pilha.at(-1).filhos.push(token);
    }
  }
  return raiz;
}
function coletar(no, predicado, resultado = []) {
  if (typeof no === 'string') return resultado;
  if (predicado(no)) resultado.push(no);
  for (const filho of no.filhos) coletar(filho, predicado, resultado);
  return resultado;
}
function texto(no) { return typeof no === 'string' ? no : no.filhos.map(texto).join(' '); }
function classe(no, nome) { return String(no.attrs.class || '').split(/\s+/).includes(nome); }
function dentro(no, predicado) { for (let pai = no.pai; pai; pai = pai.pai) if (predicado(pai)) return true; return false; }
function unico(valores) { return [...new Set(valores.map(limpar).filter(Boolean))]; }

function extrairInformacoes(html, url) {
  const raiz = arvore(html);
  const cabecalhos = coletar(raiz, no => no.tag === 'header' && classe(no, 'news-header') &&
    dentro(no, pai => pai.tag === 'main'));
  const titulos = unico(cabecalhos.flatMap(cabecalho => coletar(cabecalho,
    no => no.tag === 'h1' && classe(no, 'news-header__title')).map(texto)));
  if (!titulos.length) titulos.push(...unico(coletar(raiz, no => no.tag === 'main')
    .flatMap(main => coletar(main, no => no.tag === 'h1').map(texto))));
  if (titulos.length !== 1) throw new Error('Título editorial não identificado de forma inequívoca; preencha os dados manualmente.');
  const cabecalho = cabecalhos.find(no => coletar(no, item => item.tag === 'h1' && classe(item, 'news-header__title'))
    .some(item => limpar(texto(item)) === titulos[0]));
  const filhos = cabecalho?.filhos.filter(item => typeof item !== 'string') || [];
  const indiceTitulo = filhos.findIndex(no => no.tag === 'h1' && classe(no, 'news-header__title'));
  const indiceInfo = filhos.findIndex(no => classe(no, 'info'));
  const subtitulos = unico(filhos.slice(indiceTitulo + 1, indiceInfo < 0 ? undefined : indiceInfo)
    .filter(no => no.tag === 'p' && classe(no, 'news-header__excerpt') && !('hidden' in no.attrs))
    .map(texto));
  const chapeus = unico(coletar(cabecalho || raiz, no =>
    (no.attrs.rel || '').split(/\s+/).includes('category') ||
    (classe(no, 'news-header__category') && no.tag !== 'meta')).map(texto));
  const categorias = unico(coletar(raiz, no => no.tag === 'meta' &&
    no.attrs.property === 'article:section').map(no => no.attrs.content));
  const categoriaConfiavel = categorias.length === 1 &&
    !['geral', 'notícias', 'noticias', 'últimas', 'ultimas', 'home'].includes(categorias[0].toLocaleLowerCase('pt-BR'));
  const chapeu = chapeus.length === 1 ? chapeus[0] :
    !chapeus.length && categoriaConfiavel ? categorias[0].toLocaleUpperCase('pt-BR') : '';
  return { titulo:titulos[0].slice(0, 500), chapeu:chapeu.slice(0, 120),
    subtitulo:subtitulos.length === 1 && subtitulos[0] !== titulos[0] ? subtitulos[0].slice(0, 1000) : '', url };
}

async function buscarInformacoes(valor, requisicao = requisitar) {
  const pagina = await baixarMateria(valor, requisicao);
  return extrairInformacoes(pagina.html, pagina.url);
}

async function buscarInformacoesNaListagem(valor, compartilhamento, { sinal, progresso, limitePaginas = 10 } = {}) {
  const url = identidadeMateria(validarUrlMateria(valor).href);
  if (!compartilhamento?.consultarMateria || !compartilhamento?.consultarPaginas) {
    throw new Error('A consulta pública de Últimas não está disponível. Preencha os campos manualmente.');
  }
  if (sinal?.aborted) throw new Error('Busca cancelada.');
  await progresso?.('Lendo a matéria informada…');
  if (sinal?.aborted) throw new Error('Busca cancelada.');
  let leitura;
  try { leitura = await compartilhamento.consultarMateria({ url, titulo:'', chapeu:'' }, sinal); }
  catch (erro) {
    if (sinal?.aborted) throw new Error('Busca cancelada.');
    return { url, titulo:'', chapeu:'', subtitulo:'', aviso:`Não foi possível acessar a matéria: ${erro.message}` };
  }
  if (sinal?.aborted) throw new Error('Busca cancelada.');
  if (!leitura?.ok || !leitura.dados?.titulo) {
    return { url, titulo:'', chapeu:'', subtitulo:'',
      aviso:`Não foi possível extrair o título da matéria: ${leitura?.mensagem || 'título não encontrado'}.` };
  }
  const dados = { url, titulo:leitura.dados.titulo, chapeu:leitura.dados.chapeu || '',
    subtitulo:leitura.dados.subtitulo || '' };
  const chave = chaveTitulo(dados.titulo);
  if (chave.length < 12) return { ...dados, aviso:'Título curto demais para confirmar a matéria em Últimas.' };
  let resultado;
  try {
    resultado = await compartilhamento.consultarPaginas({ limitePaginas, sinal, progresso,
      pararQuando:candidatos => candidatos.some(item =>
        identidadeMateria(item.url) === url && chaveTitulo(item.titulo) === chave) });
  } catch (erro) {
    if (sinal?.aborted) throw new Error('Busca cancelada.');
    return { ...dados, aviso:`Não foi possível consultar Últimas: ${erro.message}` };
  }
  if (sinal?.aborted || resultado?.cancelado) throw new Error('Busca cancelada.');
  const candidatos = resultado?.candidatos || [];
  const correspondentes = candidatos.filter(item => identidadeMateria(item.url) === url && chaveTitulo(item.titulo) === chave);
  if (correspondentes.length) return { ...dados, chapeu:dados.chapeu || correspondentes[0].chapeu || '' };
  const tituloEmOutraUrl = candidatos.some(item => chaveTitulo(item.titulo) === chave);
  const urlComOutroTitulo = candidatos.some(item => identidadeMateria(item.url) === url);
  const motivo = tituloEmOutraUrl || urlComOutroTitulo
    ? 'Título e URL não correspondem à mesma matéria em Últimas; confira os dados manualmente.'
    : `Matéria não encontrada nas ${resultado?.paginasVisitadas || 0} página(s) de Últimas consultada(s)` +
      (resultado?.limiteAtingido ? `; limite de ${limitePaginas} páginas atingido.` : '.');
  return { ...dados, aviso:motivo };
}

module.exports = { validarUrlMateria, baixarMateria, extrairInformacoes, buscarInformacoes,
  buscarInformacoesNaListagem, ipPublico };
