const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

async function identificarInstalacao(arquivo = path.join(__dirname, 'instalacao-autoxs.id')) {
  try {
    const id = (await fs.readFile(arquivo, 'utf8')).trim();
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Identificador local da instalação inválido.');
    return id;
  } catch (erro) {
    if (erro.code !== 'ENOENT') throw erro;
    const id = randomUUID();
    try { await fs.writeFile(arquivo, id + '\n', { encoding:'utf8', flag:'wx' }); return id; }
    catch (falha) {
      if (falha.code === 'EEXIST') return identificarInstalacao(arquivo);
      throw falha;
    }
  }
}
module.exports = { identificarInstalacao };
