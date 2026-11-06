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
    // A memória visual é opcional: uma instalação sem ela continua com o
    // Hermes inteiro, apenas sem observar as escolhas de fotografia.
    let memoriaVisual = null;
    try {
      const modulo = carregar(path.join(diretorio, 'hermes-memoria.js'));
      // Prefere a instância compartilhada do módulo: a fila do Hermes grava
      // nela, e o painel precisa ler o mesmo cache.
      const criada = typeof modulo.memoriaVisual?.registrar === 'function'
        ? modulo.memoriaVisual
        : (typeof modulo.criarMemoriaVisual === 'function'
          ? modulo.criarMemoriaVisual(path.join(diretorio, 'hermes-memoria.json')) : null);
      if (typeof criada?.registrar === 'function') memoriaVisual = criada;
      // Ligação explícita: só a inicialização real do AutoXS faz a fila
      // observar. Nenhum teste e nenhum require solto grava no arquivo real.
      if (memoriaVisual) fila.usarMemoria?.(memoriaVisual);
    } catch (erro) {
      registrar(`⚠️ Memória visual indisponível: ${erro.message}. O AutoXS continuará normalmente.`);
    }
    return { lerConfigLocal:seletor.lerConfigLocal, salvarConfigLocal:seletor.salvarConfigLocal,
      estado, filaHermes:fila, conferirCandidata, caminhoPainel, memoriaVisual };
  } catch (erro) {
    registrar(`⚠️ Integração local indisponível: ${erro.message}. O AutoXS continuará normalmente.`);
    return null;
  }
}

module.exports = { carregarIntegracaoLocal };
