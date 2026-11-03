const { isIP } = require('node:net');
const { identidadeMateria, chaveTitulo } = require('./compartilhar-materias');

const LIMITE_FOTO = 20 * 1024 * 1024;
const TIPOS_FOTO = new Set(['image/jpeg', 'image/png', 'image/webp']);
const DOMINIOS_IMAGEM = new Set(['img.dhost.cloud', 'tdan.nyc3.digitaloceanspaces.com',
  'tribunadosertao.com.br', 'www.tribunadosertao.com.br']);

function enderecoFotoValido(valor) {
  try {
    const url = new URL(valor);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || isIP(host) ||
        !DOMINIOS_IMAGEM.has(host)) return '';
    if (/(?:^|[\/_-])(logo|favicon|avatar|icon|icone|banner|anuncio|advertisement)(?:[.\/_-]|$)/i
      .test(`${url.pathname} ${url.search}`)) return '';
    if (/\/img\/share\.png$/i.test(url.pathname)) return '';
    return url.href;
  } catch { return ''; }
}

async function obterFotografia(request, endereco) {
  const url = enderecoFotoValido(endereco);
  if (!url) throw new Error('A URL da fotografia principal não é segura.');
  const resposta = await request.get(url, { timeout:20000, maxRedirects:0 });
  if (resposta.status() !== 200 || resposta.url() !== url)
    throw new Error('A fotografia principal não respondeu com uma imagem válida.');
  const tipo = String(resposta.headers()['content-type'] || '').split(';')[0].trim().toLowerCase();
  const tamanhoInformado = Number(resposta.headers()['content-length'] || 0);
  if (!TIPOS_FOTO.has(tipo) || tamanhoInformado > LIMITE_FOTO)
    throw new Error('A fotografia principal não é JPG, PNG ou WebP válido de até 20 MB.');
  const bytes = await resposta.body();
  if (!bytes.length || bytes.length > LIMITE_FOTO) throw new Error('A fotografia principal está vazia ou é grande demais.');
  const assinaturaValida = tipo === 'image/jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8 :
    tipo === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) :
    bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  if (!assinaturaValida) throw new Error('O arquivo recebido não corresponde ao formato da fotografia.');
  return `data:${tipo};base64,${bytes.toString('base64')}`;
}

function criarGeradorArtesMaterias(compartilhamento, request) {
  let materias = new Map();

  async function listar() {
    const candidatos = await compartilhamento.consultarCandidatos();
    const encontrados = new Map();
    for (const candidato of candidatos) {
      const url = identidadeMateria(candidato.url);
      const titulo = String(candidato.titulo || '').replace(/\s+/g, ' ').trim();
      if (!url || !titulo || encontrados.has(url)) continue;
      const partes = /^\/[^/]+\/(\d{4})\/(\d{2})\/(\d{2})\//.exec(new URL(url).pathname);
      encontrados.set(url, { url, titulo, chapeu:String(candidato.chapeu || '').trim(),
        data:partes ? `${partes[3]}/${partes[2]}/${partes[1]}` : '' });
      if (encontrados.size >= 20) break;
    }
    if (!encontrados.size) throw new Error('Nenhuma matéria válida foi encontrada em Últimas.');
    materias = encontrados;
    return [...materias.values()];
  }

  async function preparar(endereco) {
    const url = identidadeMateria(endereco);
    const selecionada = materias.get(url);
    if (!selecionada || selecionada.url !== endereco)
      throw new Error('Esta matéria não está na lista atual. Atualize a lista e selecione novamente.');
    const resultado = await compartilhamento.consultarMateria({ url, titulo:selecionada.titulo,
      chapeu:selecionada.chapeu });
    if (!resultado?.ok) throw new Error(resultado?.mensagem || 'Não foi possível ler a matéria selecionada.');
    const dados = resultado.dados || {};
    if (identidadeMateria(dados.url) !== url ||
        !dados.tituloPagina || chaveTitulo(dados.tituloPagina) !== chaveTitulo(selecionada.titulo))
      throw new Error('O título ou a URL da página não corresponde à matéria escolhida.');
    const titulo = dados.tituloPagina;
    const chapeu = String(dados.chapeuPublicado || selecionada.chapeu || '').trim();
    let fotoDataUrl = '', avisoFoto = '';
    if (!dados.imagemDestaque) avisoFoto = 'Fotografia principal não identificada com segurança. Escolha a foto manualmente.';
    else {
      try { fotoDataUrl = await obterFotografia(request, dados.imagemDestaque); }
      catch (erro) { avisoFoto = `${erro.message} Escolha a foto manualmente.`; }
    }
    return { url, titulo, chapeu, fotoDataUrl, fotoUrl:fotoDataUrl ? dados.imagemDestaque : '', avisoFoto };
  }

  return { listar, preparar };
}

module.exports = { criarGeradorArtesMaterias, enderecoFotoValido, obterFotografia };
