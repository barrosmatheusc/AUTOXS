const { test } = require('node:test');
const assert = require('node:assert/strict');
const { criarSessaoAtualizacaoDiscreta } = require('../sessao-atualizacao-discreta');

test('sessão discreta usa Chrome gráfico e perfil exclusivo sem focar automaticamente', async () => {
  let lancamentos = 0, focos = 0, fechamentos = 0;
  const pagina = { url:()=> 'about:blank', isClosed:()=>false, bringToFront:async()=>{ focos++; } };
  const ouvintes = new Map();
  const contexto = { pages:()=>[pagina], newPage:async()=>pagina,
    on:(nome, fn)=>ouvintes.set(nome,fn), close:async()=>{ fechamentos++; ouvintes.get('close')?.(); } };
  const chromium = { launchPersistentContext:async (perfil, opcoes)=>{
    lancamentos++;
    assert.equal(perfil, 'C:\\manual\\perfil-atualizacao-discreta');
    assert.deepEqual(opcoes, { channel:'chrome', headless:false, viewport:null });
    return contexto;
  } };
  const sessao = criarSessaoAtualizacaoDiscreta(chromium, 'C:\\manual\\perfil-atualizacao-discreta');
  assert.equal(await sessao.obterListagem(), pagina);
  assert.equal(await sessao.obterListagem(), pagina);
  assert.equal(lancamentos, 1);
  assert.equal(focos, 0);
  assert.equal(focos, 0);
  await sessao.encerrar();
  assert.equal(fechamentos, 1);
});
