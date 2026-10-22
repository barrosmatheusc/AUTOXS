const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { criarPainelProducao } = require('../painel-producao');
const { criarHistoricoProducao } = require('../historico-producao');

const url = 'https://www.tribunadosertao.com.br/politica/2026/10/22/12345-noticia-teste';
let browser;
before(async () => { browser = await chromium.launch({ channel:'msedge', headless:true }); });
after(async () => { await browser?.close(); });

async function comPainel(buscar, executar) {
  const pasta = await fs.mkdtemp(path.join(os.tmpdir(), 'autoxs-painel-link-manual-'));
  const arquivo = path.join(pasta, 'historico.json');
  const contexto = await browser.newContext();
  const historico = criarHistoricoProducao(arquivo, () => new Date('2026-10-22T15:00:00Z'));
  const painel = criarPainelProducao(contexto, historico, null, null, buscar);
  try {
    const pagina = await painel.abrir('compartilhaveis');
    await pagina.locator('#data').fill('2026-10-22');
    await pagina.locator('#data').dispatchEvent('change');
    await executar({ pagina, historico, painel });
  } finally {
    await contexto.close();
    await fs.rm(pasta, { recursive:true, force:true });
  }
}

test('painel exige redator, mostra prévia editável e só inclui após confirmação', async () => {
  let buscas = 0;
  await comPainel(async () => { buscas++; return { url, titulo:'Título público', chapeu:'POLÍTICA', subtitulo:'' }; },
    async ({ pagina, historico, painel }) => {
      await pagina.locator('#manual-url').fill(url);
      assert.deepEqual(await pagina.locator('#manual-enviado-por option').allTextContents(),
        ['Selecione o redator', 'Vladimir', 'Cinara', 'Land']);
      await pagina.getByRole('button', { name:'Buscar informações' }).click();
      assert.equal(buscas, 0);
      assert.match(await pagina.locator('#status').innerText(), /quem o enviou/);
      await pagina.locator('#manual-enviado-por').selectOption('inicial-2');
      await pagina.getByRole('button', { name:'Buscar informações' }).click();
      await pagina.locator('#manual-previa').waitFor({ state:'visible' });
      assert.equal(await pagina.locator('#manual-titulo').inputValue(), 'Título público');
      assert.equal((await historico.consultar('2026-10-22')).compartilh.length, 0);
      await pagina.locator('#manual-subtitulo').fill('Linha fina conferida.');
      await pagina.getByRole('button', { name:'Adicionar à lista' }).click();
      await pagina.getByRole('heading', { name:'Título público' }).waitFor();
      assert.match(await pagina.locator('.materia').innerText(), /Manual/);
      assert.match(await pagina.locator('.materia').innerText(), /Enviado por: Cinara/);
      const item = (await historico.consultar('2026-10-22')).compartilh[0];
      assert.equal(await historico.compartilhavel(item.id), '*POLÍTICA*\n\n*Título público*\n\n*_Linha fina conferida._*\n\n'+url);
      await pagina.reload();
      await pagina.getByRole('button', { name:'Seleção de Links', exact:true }).click();
      await pagina.getByRole('heading', { name:'Título público' }).waitFor();
      await historico.registrar({ operacao:'adicionar', chave:'novo-auto', titulo:'Outra matéria',
        situacao:'concluido', formaConclusao:'manual' });
      await pagina.getByRole('heading', { name:'Outra matéria' }).waitFor();
      assert.equal((await historico.consultar('2026-10-22')).compartilh.length, 2);
      await painel.abrir('compartilhaveis');
      assert.equal(await pagina.getByRole('heading', { name:'Título público' }).count(), 1);
    });
});

test('falha de busca permite preencher manualmente e URL repetida é recusada', async () => {
  await comPainel(async () => { throw new Error('Página temporariamente indisponível.'); },
    async ({ pagina, historico }) => {
      await pagina.locator('#manual-url').fill(url);
      await pagina.locator('#manual-enviado-por').selectOption('inicial-2');
      await pagina.getByRole('button', { name:'Buscar informações' }).click();
      await pagina.locator('#manual-previa').waitFor({ state:'visible' });
      assert.match(await pagina.locator('#status').innerText(), /Preencha os dados manualmente/);
      await pagina.locator('#manual-titulo').fill('Título digitado');
      await pagina.getByRole('button', { name:'Adicionar à lista' }).click();
      await pagina.getByRole('heading', { name:'Título digitado' }).waitFor();
      assert.equal((await historico.consultar('2026-10-22')).compartilh.length, 1);
      await pagina.locator('#manual-url').fill(url+'?utm_source=whatsapp');
      await pagina.locator('#manual-enviado-por').selectOption('inicial-1');
      await pagina.getByRole('button', { name:'Buscar informações' }).click();
      await pagina.locator('#manual-titulo').fill('Duplicata');
      await pagina.getByRole('button', { name:'Adicionar à lista' }).click();
      await pagina.waitForFunction(() => document.querySelector('#status')?.textContent.includes('já está na Seleção de Links'));
      assert.match(await pagina.locator('#status').innerText(), /já está na Seleção de Links/);
      assert.equal((await historico.consultar('2026-10-22')).compartilh.length, 1);
    });
});

test('resultado parcial preserva dados e busca cancelada não substitui a prévia', async () => {
  let consultas = 0;
  await comPainel(async (_url, { sinal }) => {
    consultas++;
    if (consultas === 1) return { url, titulo:'Título identificado', chapeu:'', subtitulo:'',
      aviso:'Matéria não encontrada em Últimas.' };
    return new Promise(resolve => sinal.addEventListener('abort', () => resolve({
      url, titulo:'Resultado atrasado incorreto', chapeu:'', subtitulo:''
    }), { once:true }));
  }, async ({ pagina }) => {
    await pagina.locator('#manual-url').fill(url);
    await pagina.locator('#manual-enviado-por').selectOption('inicial-1');
    await pagina.getByRole('button', { name:'Buscar informações' }).click();
    await pagina.locator('#manual-previa').waitFor({ state:'visible' });
    assert.equal(await pagina.locator('#manual-titulo').inputValue(), 'Título identificado');
    assert.match(await pagina.locator('#status').innerText(), /não encontrada/);
    await pagina.locator('#manual-chapeu').fill('CHAPÉU CONFERIDO');
    await pagina.getByRole('button', { name:'Buscar informações' }).click();
    await pagina.getByRole('button', { name:'Cancelar busca' }).click();
    await pagina.waitForFunction(() => document.querySelector('#status')?.textContent.includes('Busca cancelada'));
    assert.equal(await pagina.locator('#manual-titulo').inputValue(), 'Título identificado');
    assert.equal(await pagina.locator('#manual-chapeu').inputValue(), 'CHAPÉU CONFERIDO');
    assert.equal(consultas, 2);
  });
});

test('nova URL limpa campos anteriores, mas nova busca parcial preserva edição da mesma URL', async () => {
  await comPainel(async () => ({ url, titulo:'Título identificado', chapeu:'', subtitulo:'', aviso:'Confira a matéria.' }),
    async ({ pagina }) => {
      await pagina.locator('#manual-url').fill(url);
      await pagina.locator('#manual-enviado-por').selectOption('inicial-3');
      await pagina.getByRole('button', { name:'Buscar informações' }).click();
      await pagina.locator('#manual-previa').waitFor({ state:'visible' });
      await pagina.locator('#manual-chapeu').fill('CHAPÉU MANUAL');
      await pagina.getByRole('button', { name:'Buscar informações' }).click();
      await pagina.waitForFunction(() => document.querySelector('#manual-buscar')?.disabled === false);
      assert.equal(await pagina.locator('#manual-chapeu').inputValue(), 'CHAPÉU MANUAL');
      await pagina.locator('#manual-url').fill(url.replace('12345-', '98765-'));
      assert.equal(await pagina.locator('#manual-titulo').inputValue(), '');
      assert.equal(await pagina.locator('#manual-chapeu').inputValue(), '');
    });
});
