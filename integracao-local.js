// Ponte opcional. Os módulos de análise de fotos e sua configuração pertencem
// somente à instalação pessoal e nunca são necessários para iniciar o AutoXS.
const fs = require('node:fs');
const path = require('node:path');

function carregarIntegracaoLocal({ diretorio = __dirname, carregar = require,
  registrar = mensagem => console.warn(mensagem) } = {}) {
  if (!fs.existsSync(path.join(diretorio, 'config-local.json'))) return null;
  const caminhoPainel = path.join(diretorio, 'hermes-painel.js');
  try {
    if (!fs.existsSync(caminhoPainel)) throw new Error('painel local não encontrado');
    const seletor = carregar(path.join(diretorio, 'hermes-seletor.js'));
    const estado = carregar(path.join(diretorio, 'hermes-estado.js'));
    const fila = carregar(path.join(diretorio, 'hermes-fila.js')).filaHermes;
    const conferirCandidata = carregar(path.join(diretorio, 'hermes-dom.js')).conferirCandidata;
    if (typeof seletor.lerConfigLocal !== 'function' ||
        typeof seletor.salvarConfigLocal !== 'function' ||
        typeof estado.obter !== 'function' || typeof estado.assinar !== 'function' ||
        typeof fila?.iniciarFaseAutoXS !== 'function' ||
        typeof fila?.registrarPendencia !== 'function' ||
        typeof fila?.processar !== 'function' || typeof conferirCandidata !== 'function') {
      throw new Error('módulos locais incompletos');
    }
    return { lerConfigLocal:seletor.lerConfigLocal, salvarConfigLocal:seletor.salvarConfigLocal,
      estado, filaHermes:fila, conferirCandidata, caminhoPainel };
  } catch (erro) {
    registrar(`⚠️ Integração local indisponível: ${erro.message}. O AutoXS continuará normalmente.`);
    return null;
  }
}

module.exports = { carregarIntegracaoLocal };
