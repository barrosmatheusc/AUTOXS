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

test('painel inclui sem remetente e atribui responsável pelos botões existentes', async () => {
  let buscas = 0;
  await comPainel(async () => { buscas++; return { url, titulo:'Título público', chapeu:'POLÍTICA', subtitulo:'' }; },
    async ({ pagina, historico, painel }) => {
      await pagina.locator('#manual-url').fill(url);
      assert.equal(await pagina.locator('#manual-enviado-por').count(), 0);
      await pagina.getByRole('button', { name:'Buscar informações' }).click();
      assert.equal(buscas, 1);
      await pagina.locator('#manual-previa').waitFor({ state:'visible' });
      assert.equal(await pagina.locator('#manual-titulo').inputValue(), 'Título público');
      assert.equal((await historico.consultar('2026-10-22')).compartilh.length, 0);
      await pagina.locator('#manual-subtitulo').fill('Linha fina conferida.');
      await pagina.getByRole('button', { name:'Adicionar à lista' }).click();
      await pagina.getByRole('heading', { name:'Título público' }).waitFor();
      assert.match(await pagina.locator('.materia').innerText(), /Manual/);
      assert.doesNotMatch(await pagina.locator('.materia').innerText(), /Enviado por:/);
      const item = (await historico.consultar('2026-10-22')).compartilh[0];
      assert.equal(await historico.compartilhavel(item.id), '*POLÍTICA*\n\n*Título público*\n\n*_Linha fina conferida._*\n\n'+url);
      const grupo=pagina.getByRole('group', { name:'Responsável por Título público' });
      for(const nome of ['Vladimir','Cinara','Land'])assert.equal(await grupo.getByRole('button', { name:nome }).count(),1);
      await pagina.getByRole('group', { name:'Responsável por Título público' }).getByRole('button', { name:'Cinara' }).click();
      await pagina.waitForFunction(() => document.querySelector('.materia-responsavel')?.textContent === 'Cinara');
      assert.equal((await historico.consultar('2026-10-22')).compartilh[0].responsavelId, 'inicial-2');
      await pagina.reload();
      await pagina.locator('#data').fill('2026-10-22');
      await pagina.locator('#data').dispatchEvent('change');
      await pagina.getByRole('button', { name:'Seleção de Links', exact:true }).click();
      await pagina.locator('.materia-titulo', { hasText:'Título público' }).waitFor();
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
      await pagina.getByRole('button', { name:'Buscar informações' }).click();
      await pagina.locator('#manual-previa').waitFor({ state:'visible' });
      assert.match(await pagina.locator('#status').innerText(), /Preencha os dados manualmente/);
      await pagina.locator('#manual-titulo').fill('Título digitado');
      await pagina.getByRole('button', { name:'Adicionar à lista' }).click();
      await pagina.getByRole('heading', { name:'Título digitado' }).waitFor();
      assert.equal((await historico.consultar('2026-10-22')).compartilh.length, 1);
      await pagina.locator('#manual-url').fill(url+'?utm_source=whatsapp');
      await pagina.getByRole('button', { name:'Buscar informações' }).click();
      await pagina.locator('#manual-titulo').fill('Duplicata');
      await pagina.getByRole('button', { name:'Adicionar à lista' }).click();
      await pagina.waitForFunction(() => document.querySelector('#status')?.textContent.includes('já está na Seleção de Links'));
      assert.match(await pagina.locator('#status').innerText(), /já está na Seleção de Links/);
      assert.equal((await historico.consultar('2026-10-22')).compartilh.length, 1);
    });
});

test('link manual previamente removido reaparece imediatamente ao incluí-lo outra vez', async () => {
  await comPainel(async () => ({ url, titulo:'Título recuperado', chapeu:'POLÍTICA', subtitulo:'' }),
    async ({ pagina, historico }) => {
      const antigo=await historico.adicionarLinkManual({ url, titulo:'Título antigo' });
      await historico.removerDaSelecao(antigo.id);
      await pagina.locator('#manual-url').fill(url);
      await pagina.getByRole('button', { name:'Buscar informações' }).click();
      await pagina.locator('#manual-previa').waitFor({ state:'visible' });
      await pagina.getByRole('button', { name:'Adicionar à lista' }).click();
      await pagina.getByRole('heading', { name:'Título recuperado' }).waitFor();
      const consulta=await historico.consultar('2026-10-22');
      assert.equal(consulta.registros.length,1);
      assert.equal(consulta.compartilh[0].id,antigo.id);
      await pagina.reload();
      await pagina.locator('#data').fill('2026-10-22');
      await pagina.locator('#data').dispatchEvent('change');
      await pagina.getByRole('button', { name:'Seleção de Links', exact:true }).click();
      await pagina.getByRole('heading', { name:'Título recuperado' }).waitFor();
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

test('remoção do cartão pede confirmação, permite cancelar e persiste sem apagar produção', async () => {
  await comPainel(async () => ({ url, titulo:'Manual', chapeu:'', subtitulo:'' }), async ({ pagina, historico }) => {
    await pagina.locator('#manual-url').fill(url);
    await pagina.getByRole('button', { name:'Buscar informações' }).click();
    await pagina.locator('#manual-previa').waitFor({ state:'visible' });
    await pagina.getByRole('button', { name:'Adicionar à lista' }).click();
    await pagina.getByRole('heading', { name:'Manual' }).waitFor();
    const item = (await historico.consultar('2026-10-22')).compartilh[0];
    await pagina.locator('.materia').getByRole('button', { name:'🗑️ Remover' }).click();
    assert.match(await pagina.locator('.confirmar-remocao').innerText(), /Seleção de Links e do Relatório de Links/);
    assert.equal((await historico.consultar('2026-10-22')).compartilh.length, 1);
    assert.equal((await historico.relatorio('2026-10-22')).semResponsavel.length, 1);
    await pagina.getByRole('button', { name:'Cancelar', exact:true }).click();
    assert.equal(await pagina.getByRole('heading', { name:'Manual', exact:true }).count(), 1);
    assert.equal((await historico.relatorio('2026-10-22')).semResponsavel.length, 1);
    await pagina.locator('.materia').getByRole('button', { name:'🗑️ Remover' }).click();
    await pagina.getByRole('button', { name:'Confirmar remoção' }).click();
    await pagina.waitForFunction(() => !document.querySelector('.materia'));
    const consulta = await historico.consultar('2026-10-22');
    assert.equal(consulta.compartilh.length, 0);
    assert.equal((await historico.relatorio('2026-10-22')).semResponsavel.length, 0);
    assert.equal(consulta.registros.find(registro => registro.id === item.id).ocultoSelecao, true);
    await pagina.getByRole('button', { name:'Relatório de Links', exact:true }).click();
    assert.equal(await pagina.locator('#copiar-relatorio').isDisabled(), true);
    await pagina.getByRole('button', { name:'Gerar relatório' }).click();
    await pagina.waitForFunction(() => document.querySelector('#pendencias-relatorio')?.textContent === 'Nenhuma pendência.');
    assert.doesNotMatch(await pagina.locator('#texto-relatorio').innerText(), /12345-noticia-teste/);
    await pagina.reload();
    await pagina.locator('#data').fill('2026-10-22');
    await pagina.locator('#data').dispatchEvent('change');
    await pagina.getByRole('button', { name:'Seleção de Links', exact:true }).click();
    assert.equal(await pagina.getByRole('heading', { name:'Manual', exact:true }).count(), 0);
    assert.equal((await historico.relatorio('2026-10-22')).semResponsavel.length, 0);
  });
});

test('relatório só nasce no clique, é substituído, fica obsoleto após mudança e copia apenas o atual', async () => {
  await comPainel(async () => ({ url, titulo:'Manual', chapeu:'', subtitulo:'' }), async ({ pagina, historico }) => {
    await pagina.evaluate(() => Object.defineProperty(navigator, 'clipboard', {
      configurable:true, value:{ writeText:async texto => { window.__relatorioCopiado=texto; } }
    }));
    await pagina.locator('#manual-url').fill(url);
    await pagina.getByRole('button', { name:'Buscar informações' }).click();
    await pagina.locator('#manual-previa').waitFor({ state:'visible' });
    await pagina.getByRole('button', { name:'Adicionar à lista' }).click();
    await pagina.getByRole('heading', { name:'Manual', exact:true }).waitFor();
    const item = (await historico.consultar('2026-10-22')).compartilh[0];
    await pagina.getByRole('group', { name:'Responsável por Manual' }).getByRole('button', { name:'Vladimir' }).click();
    await pagina.waitForFunction(() => document.querySelector('.materia-responsavel')?.textContent === 'Vladimir');
    await pagina.getByRole('button', { name:'Relatório de Links', exact:true }).click();
    assert.equal(await pagina.locator('#copiar-relatorio').isDisabled(), true);
    assert.match(await pagina.locator('#texto-relatorio').innerText(), /Nenhum relatório gerado/);
    await pagina.getByRole('button', { name:'Gerar relatório' }).click();
    await pagina.waitForFunction(() => document.querySelector('#texto-relatorio')?.textContent.includes('LINKS VLADIMIR'));
    const primeiro=await pagina.locator('#texto-relatorio').innerText();
    assert.equal((primeiro.match(new RegExp(url,'g'))||[]).length,1);
    await pagina.getByRole('button', { name:'Copiar relatório inteiro' }).click();
    await pagina.waitForFunction(() => window.__relatorioCopiado !== undefined);
    assert.equal(await pagina.evaluate(() => window.__relatorioCopiado), primeiro);
    await pagina.getByRole('button', { name:'Gerar relatório' }).click();
    assert.equal(await pagina.locator('#texto-relatorio').innerText(), primeiro);
    await historico.responsavel(item.id, 'inicial-2');
    await pagina.waitForFunction(() => document.querySelector('#estado-relatorio')?.textContent.includes('desatualizado'));
    assert.equal(await pagina.locator('#copiar-relatorio').isDisabled(), true);
    await pagina.getByRole('button', { name:'Gerar relatório' }).click();
    await pagina.waitForFunction(() => !document.querySelector('#copiar-relatorio')?.disabled &&
      !document.querySelector('#estado-relatorio')?.textContent.includes('desatualizado'));
    const segundo=await pagina.locator('#texto-relatorio').innerText();
    assert.equal((segundo.match(new RegExp(url,'g'))||[]).length,1);
    assert.notEqual(segundo,primeiro);
    await pagina.getByRole('button', { name:'Copiar relatório inteiro' }).click();
    await pagina.waitForFunction(texto => window.__relatorioCopiado === texto, segundo);
    assert.equal(await pagina.evaluate(() => window.__relatorioCopiado), segundo);
    await historico.removerDaSelecao(item.id);
    await pagina.waitForFunction(() => document.querySelector('#estado-relatorio')?.textContent.includes('desatualizado'));
    await pagina.getByRole('button', { name:'Gerar relatório' }).click();
    await pagina.waitForFunction(() => !document.querySelector('#texto-relatorio')?.textContent.includes('12345-noticia-teste'));
    assert.doesNotMatch(await pagina.locator('#texto-relatorio').innerText(), /12345-noticia-teste/);
  });
});

test('reset do relatório pede confirmação, preserva os links e permite gerar novamente', async () => {
  await comPainel(async () => ({ url, titulo:'Manual', chapeu:'', subtitulo:'' }), async ({ pagina, historico }) => {
    await pagina.locator('#manual-url').fill(url);
    await pagina.getByRole('button', { name:'Buscar informações' }).click();
    await pagina.locator('#manual-previa').waitFor({ state:'visible' });
    await pagina.getByRole('button', { name:'Adicionar à lista' }).click();
    await pagina.getByRole('heading', { name:'Manual', exact:true }).waitFor();
    const item=(await historico.consultar('2026-10-22')).compartilh[0];
    await pagina.getByRole('group', { name:'Responsável por Manual' }).getByRole('button', { name:'Vladimir' }).click();
    await pagina.waitForFunction(() => document.querySelector('.materia-responsavel')?.textContent === 'Vladimir');
    await pagina.getByRole('button', { name:'Relatório de Links', exact:true }).click();
    assert.equal(await pagina.locator('#resetar-relatorio').isDisabled(), true);
    await pagina.getByRole('button', { name:'Gerar relatório' }).click();
    await pagina.waitForFunction(() => document.querySelector('#texto-relatorio')?.textContent.includes('LINKS VLADIMIR'));
    const original=await pagina.locator('#texto-relatorio').innerText();
    await pagina.getByRole('button', { name:'Resetar relatório' }).click();
    assert.equal(await pagina.locator('#confirmar-reset-relatorio').isVisible(), true);
    await pagina.getByRole('button', { name:'Cancelar', exact:true }).click();
    assert.equal(await pagina.locator('#confirmar-reset-relatorio').isVisible(), false);
    assert.equal(await pagina.locator('#texto-relatorio').innerText(), original);
    assert.equal(await pagina.locator('#copiar-relatorio').isDisabled(), false);
    await pagina.getByRole('button', { name:'Resetar relatório' }).click();
    await pagina.getByRole('button', { name:'Confirmar reset' }).click();
    assert.match(await pagina.locator('#texto-relatorio').innerText(), /Nenhum relatório gerado/);
    assert.equal(await pagina.locator('#copiar-relatorio').isDisabled(), true);
    assert.equal(await pagina.locator('#resetar-relatorio').isDisabled(), true);
    assert.equal((await historico.consultar('2026-10-22')).compartilh[0].responsavelId, 'inicial-1');
    assert.equal((await historico.consultar('2026-10-22')).compartilh[0].urlOriginal, url);
    await pagina.reload();
    await pagina.locator('#data').fill('2026-10-22');
    await pagina.locator('#data').dispatchEvent('change');
    await pagina.getByRole('button', { name:'Relatório de Links', exact:true }).click();
    assert.match(await pagina.locator('#texto-relatorio').innerText(), /Nenhum relatório gerado/);
    assert.equal(await pagina.locator('#copiar-relatorio').isDisabled(), true);
    assert.equal((await historico.consultar('2026-10-22')).compartilh[0].id, item.id);
    await pagina.getByRole('button', { name:'Gerar relatório' }).click();
    await pagina.waitForFunction(() => document.querySelector('#texto-relatorio')?.textContent.includes('LINKS VLADIMIR'));
    const novo=await pagina.locator('#texto-relatorio').innerText();
    assert.equal((novo.match(new RegExp(url,'g'))||[]).length, 1);
    assert.equal(await pagina.locator('#copiar-relatorio').isDisabled(), false);
  });
});
