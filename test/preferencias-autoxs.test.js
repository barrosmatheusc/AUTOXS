const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { criarPreferenciasAutoXS } = require('../preferencias-autoxs');

test('preferências locais persistem, validam valores e restauram padrões', async () => {
  const pasta = await fs.mkdtemp(path.join(os.tmpdir(), 'autoxs-config-'));
  const arquivo = path.join(pasta, 'preferencias.json');
  try {
    const preferencias = criarPreferenciasAutoXS({ arquivo });
    assert.deepEqual(await preferencias.ler(), preferencias.padroes());
    const dados = await preferencias.salvar({
      tema:'claro', tamanho:'ampliado', logsDetalhados:true,
      confirmacoes:true, pastaVideos:pasta, senha:'não salvar'
    });
    assert.equal(dados.tema, 'claro');
    assert.equal(dados.pastaVideos, pasta);
    assert.equal(JSON.parse(await fs.readFile(arquivo, 'utf8')).senha, undefined);
    assert.deepEqual(await criarPreferenciasAutoXS({ arquivo }).ler(), dados);
    await assert.rejects(preferencias.salvar({ ...dados, pastaVideos:'pasta-relativa' }), /caminho absoluto/);
    assert.deepEqual(await preferencias.ler(), dados);
    assert.deepEqual(await preferencias.restaurar(), preferencias.padroes());
    assert.deepEqual(await criarPreferenciasAutoXS({ arquivo }).ler(), preferencias.padroes());
  } finally { await fs.rm(pasta, { recursive:true, force:true }); }
});
