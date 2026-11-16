const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { criarHistoricoProducao } = require('../historico-producao');

test('arquivo zerado por queda de energia é restaurado da cópia anterior', async () => {
  const pasta = await fs.mkdtemp(path.join(os.tmpdir(), 'hist-'));
  const arquivo = path.join(pasta, 'historico-autoxs.json');
  const historico = criarHistoricoProducao(arquivo);
  await historico.registrar({ operacao: 'adicionar', situacao: 'aguardandoRevisao', chave: 'a', titulo: 'A' });
  await historico.registrar({ operacao: 'adicionar', situacao: 'aguardandoRevisao', chave: 'b', titulo: 'B' });
  await fs.writeFile(arquivo, Buffer.alloc(5000)); // simula o arquivo cheio de bytes nulos
  const novo = criarHistoricoProducao(arquivo);
  await novo.registrar({ operacao: 'adicionar', situacao: 'aguardandoRevisao', chave: 'c', titulo: 'C' });
  const estado = JSON.parse(await fs.readFile(arquivo, 'utf8'));
  assert.ok(estado.registros.length >= 2);
  await fs.rm(pasta, { recursive: true, force: true });
});
