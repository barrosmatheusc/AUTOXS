const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { criarHistoricoProducao } = require('../historico-producao');
const { confirmarAguardandoPorLinkPublico } = require('../painel-producao');

test('matéria preenchida e não confirmada entra na seleção quando aparece na listagem pública', async () => {
  const pasta = await fs.mkdtemp(path.join(os.tmpdir(), 'autoxs-confirmacao-'));
  const agora = new Date('2026-11-28T15:00:00Z');
  const historico = criarHistoricoProducao(path.join(pasta, 'historico.json'), () => agora);
  await historico.registrar({ operacao:'adicionar', chave:'a', titulo:'Maceió tem máxima de 29°C e chance de chuva', situacao:'aguardandoRevisao' });
  await historico.registrar({ operacao:'adicionar', chave:'b', titulo:'Matéria ainda não publicada no site', situacao:'aguardandoRevisao' });
  const url = 'https://www.tribunadosertao.com.br/alagoas/2026/11/28/1032100-maceio-tem-maxima-de-29c-e-chance-de-chuva';
  const compartilhamento = { consultarPaginas: async () => ({ candidatos:[{ titulo:'Maceió tem máxima de 29°C e chance de chuva', url }], paginasVisitadas:1 }) };
  assert.equal(await confirmarAguardandoPorLinkPublico(historico, compartilhamento), 1);
  const publicadas = await historico.publicadas();
  assert.equal(publicadas.length, 1);
  assert.equal(publicadas[0].urlOriginal, url);
  assert.equal(publicadas[0].formaConclusao, 'automatico');
  assert.equal((await historico.aguardandoPublicacao()).length, 1);
  // Rodar de novo não duplica nem altera.
  assert.equal(await confirmarAguardandoPorLinkPublico(historico, compartilhamento), 0);
  await fs.rm(pasta, { recursive:true, force:true });
});
