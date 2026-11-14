const fs = require('node:fs/promises');
const path = require('node:path');

const PADROES = Object.freeze({
  tema: 'escuro', tamanho: 'normal', logsDetalhados: false,
  confirmacoes: false, pastaVideos: null,
  buscarFotosAutomaticamente: true,
  pastaFotos: 'G:\\Meu Drive\\Tribuna',
  fotosClima: {}
});
const ARQUIVO = path.join(__dirname, 'preferencias-autoxs.json');

function validar(preferencias) {
  if (!preferencias || typeof preferencias !== 'object' || Array.isArray(preferencias))
    throw new Error('Preferências inválidas.');
  const resultado = { ...PADROES };
  if (['claro', 'escuro', 'automatico'].includes(preferencias.tema)) resultado.tema = preferencias.tema;
  if (['compacto', 'normal', 'ampliado'].includes(preferencias.tamanho)) resultado.tamanho = preferencias.tamanho;
  if (typeof preferencias.logsDetalhados === 'boolean') resultado.logsDetalhados = preferencias.logsDetalhados;
  if (typeof preferencias.confirmacoes === 'boolean') resultado.confirmacoes = preferencias.confirmacoes;
  if (typeof preferencias.pastaVideos === 'string' && path.isAbsolute(preferencias.pastaVideos))
    resultado.pastaVideos = path.resolve(preferencias.pastaVideos);
  if (typeof preferencias.buscarFotosAutomaticamente === 'boolean')
    resultado.buscarFotosAutomaticamente = preferencias.buscarFotosAutomaticamente;
  if (typeof preferencias.pastaFotos === 'string' && path.isAbsolute(preferencias.pastaFotos))
    resultado.pastaFotos = path.resolve(preferencias.pastaFotos);
  if (preferencias.fotosClima && typeof preferencias.fotosClima === 'object' && !Array.isArray(preferencias.fotosClima)) {
    resultado.fotosClima = {};
    for (const [cidade, foto] of Object.entries(preferencias.fotosClima)) {
      const nome = String(cidade || '').normalize('NFC').trim().slice(0, 100);
      const id = String(foto?.id || '').trim();
      const url = String(foto?.url || '').trim();
      if (!nome || !/^\d+$/.test(id) || (url && !/^https?:\/\//i.test(url))) continue;
      resultado.fotosClima[nome] = { id, url:url.slice(0, 2000), nome:String(foto?.nome || '').slice(0, 180) };
    }
  }
  return resultado;
}

function criarPreferenciasAutoXS({ arquivo = ARQUIVO } = {}) {
  let fila = Promise.resolve();
  async function ler() {
    try { return validar(JSON.parse(await fs.readFile(arquivo, 'utf8'))); }
    catch (erro) {
      if (erro.code !== 'ENOENT') console.warn('[AUTOXS] Preferências locais inválidas; usando padrões.');
      return { ...PADROES };
    }
  }
  async function salvar(entrada) {
    const executar = async () => {
      if (entrada?.pastaFotos != null && (typeof entrada.pastaFotos !== 'string' || !path.isAbsolute(entrada.pastaFotos)))
        throw new Error('A pasta das fotografias deve ser um caminho absoluto.');
      const dados = validar(entrada);
      if (entrada.pastaVideos != null && !dados.pastaVideos)
        throw new Error('A pasta dos vídeos deve ser um caminho absoluto.');
      if (dados.pastaVideos && !(await fs.stat(dados.pastaVideos).catch(() => null))?.isDirectory())
        throw new Error('A pasta dos vídeos não existe ou não está disponível.');
      const temporario = `${arquivo}.${process.pid}.tmp`;
      try {
        await fs.writeFile(temporario, JSON.stringify(dados, null, 2) + '\n', { encoding:'utf8', flag:'w' });
        await fs.rename(temporario, arquivo);
      } catch (erro) {
        await fs.rm(temporario, { force:true }).catch(() => {});
        throw erro;
      }
      return dados;
    };
    const resultado = fila.then(executar);
    fila = resultado.catch(() => {});
    return resultado;
  }
  return { ler, salvar, restaurar: () => salvar({ ...PADROES }), padroes: () => ({ ...PADROES }) };
}

module.exports = { criarPreferenciasAutoXS, validarPreferencias: validar };
