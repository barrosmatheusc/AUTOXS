const fs = require('node:fs/promises');
const path = require('node:path');

const EXTENSOES = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const SUFIXO_COPIA = /\s*\((\d+)\)$/;

function normalizarNome(valor) {
  return String(valor || '').normalize('NFC').trim().toLocaleLowerCase('pt-BR');
}

function assinaturaValida(bytes, extensao) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12) return false;
  if (['.jpg', '.jpeg'].includes(extensao)) return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (extensao === '.png') return bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (extensao === '.gif') return bytes.subarray(0, 4).toString('ascii') === 'GIF8';
  if (extensao === '.webp') return bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  return false;
}

async function validarArquivo(caminho, statInicial = null) {
  const extensao = path.extname(caminho).toLocaleLowerCase('pt-BR');
  if (!EXTENSOES.has(extensao) || /\.(?:tmp|part|crdownload)$/i.test(caminho)) return null;
  const stat = statInicial || await fs.stat(caminho).catch(() => null);
  if (!stat?.isFile() || !stat.size) return null;
  let handle;
  try {
    handle = await fs.open(caminho, 'r');
    const inicio = Buffer.alloc(16);
    const { bytesRead } = await handle.read(inicio, 0, inicio.length, 0);
    if (!assinaturaValida(inicio.subarray(0, bytesRead), extensao)) return null;
  } catch { return null; }
  finally { await handle?.close().catch(() => {}); }
  const statFinal = await fs.stat(caminho).catch(() => null);
  if (!statFinal?.isFile() || statFinal.size !== stat.size || statFinal.mtimeMs !== stat.mtimeMs) return null;
  return { caminho:path.resolve(caminho), nome:path.basename(caminho), tamanho:stat.size, mtimeMs:stat.mtimeMs, extensao };
}

async function buscarFotoLocal({ pasta, nomeEsperado, ativa = true, fsApi = fs } = {}) {
  if (!ativa) return { estado:'desativada', candidatos:[] };
  if (typeof pasta !== 'string' || !path.isAbsolute(pasta)) return { estado:'pasta-indisponivel', candidatos:[], motivo:'Configure uma pasta absoluta de fotografias.' };
  const pastaStat = await fsApi.stat(pasta).catch(() => null);
  if (!pastaStat?.isDirectory()) return { estado:'pasta-indisponivel', candidatos:[], motivo:'A pasta de fotografias não está disponível neste computador.' };
  const esperadoOriginal = String(nomeEsperado || '').trim();
  const esperado = path.basename(esperadoOriginal);
  if (!esperado || esperado !== esperadoOriginal) return { estado:'nome-ausente', candidatos:[], motivo:'A matéria não informou um nome de fotografia válido.' };
  const extEsperada = path.extname(esperado).toLocaleLowerCase('pt-BR');
  if (!EXTENSOES.has(extEsperada)) return { estado:'nome-invalido', candidatos:[], motivo:'O nome indicado não possui uma extensão de imagem permitida.' };
  const baseEsperada = normalizarNome(path.basename(esperado, extEsperada));
  const nomes = await fsApi.readdir(pasta, { withFileTypes:true });
  const possiveis = [];
  for (const entrada of nomes) {
    if (!entrada.isFile()) continue;
    const extensao = path.extname(entrada.name).toLocaleLowerCase('pt-BR');
    if (extensao !== extEsperada && !(extEsperada === '.jpg' && extensao === '.jpeg') && !(extEsperada === '.jpeg' && extensao === '.jpg')) continue;
    const base = normalizarNome(path.basename(entrada.name, path.extname(entrada.name)));
    const exata = base === baseEsperada;
    const copia = !exata && base.replace(SUFIXO_COPIA, '') === baseEsperada && SUFIXO_COPIA.test(base);
    if (!exata && !copia) continue;
    const caminho = path.join(pasta, entrada.name);
    const stat = await fsApi.stat(caminho).catch(() => null);
    const valida = fsApi === fs ? await validarArquivo(caminho, stat) : (stat?.isFile() && stat.size ? { caminho, nome:entrada.name, tamanho:stat.size, mtimeMs:stat.mtimeMs, extensao } : null);
    if (valida) possiveis.push({ ...valida, exata, copia, indiceCopia:Number(base.match(SUFIXO_COPIA)?.[1] || 0) });
  }
  possiveis.sort((a, b) => Number(b.exata) - Number(a.exata) || b.mtimeMs - a.mtimeMs || b.indiceCopia - a.indiceCopia || a.nome.localeCompare(b.nome, 'pt-BR'));
  if (!possiveis.length) return { estado:'nao-encontrada', candidatos:[], motivo:`FOTO PENDENTE — ${esperado} não foi encontrada na pasta configurada.` };
  const escolhida = possiveis[0];
  return { estado:'encontrada', escolhida, candidatos:possiveis, criterio:escolhida.exata ? 'nome-exato' : 'copia-mais-recente' };
}

module.exports = { buscarFotoLocal, validarArquivo, normalizarNome, assinaturaValida, EXTENSOES };
