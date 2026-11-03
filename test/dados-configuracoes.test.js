const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const { criarHistoricoProducao } = require('../historico-producao');

test('central mostra prévia, cancela sem gravar e só importa após confirmação', async () => {
  const browser = await chromium.launch({ channel:'msedge', headless:true });
  const contexto = await browser.newContext();
  const pagina = await contexto.newPage();
  const chamadas = [];
  await pagina.exposeFunction('configuracoesAutoXS', async () => ({ ok:true,
    preferencias:{ tema:'automatico', tamanho:'normal', logsDetalhados:false, confirmacoes:true, pastaVideos:'' }, versao:'1.0.0' }));
  await pagina.exposeFunction('dadosAutoXS', async pedido => {
    chamadas.push(pedido.acao);
    if (pedido.acao === 'prever') return { ok:true, token:'teste', previa:{
      novosTotais:1, atualizadosTotais:0, novosLinks:1,
      repetidos:1, expirados:1, invalidos:0, ambiguos:0, linksRepetidos:1,
      arquivo:{ instalacao:'8f2c1a3b-0000-4000-8000-000000000000', dia:'2026-11-03',
        exportadoEm:'2026-11-03T19:17:07.624Z', propria:false },
      recebidos:{ concluidas:12, atualizacoesAutomaticas:5, finalizadasManualmente:4,
        adicionadas:3, aguardandoRevisao:1, erros:0 },
      jaContabilizados:{ concluidas:2, atualizacoesAutomaticas:1, finalizadasManualmente:0,
        adicionadas:1, aguardandoRevisao:0, erros:0 },
      acrescimo:{ concluidas:10, atualizacoesAutomaticas:4, finalizadasManualmente:4,
        adicionadas:2, aguardandoRevisao:1, erros:0 },
      titulosNovos:['Matéria de hoje'] } };
    if (pedido.acao === 'confirmar') return { ok:true, resultado:{ novosTotais:1, atualizadosTotais:0, novosLinks:1 } };
    return { ok:true, resultado:{ cancelado:true } };
  });
  try {
    await pagina.goto(pathToFileURL(path.join(__dirname, '..', 'painel-manual.html')).href);
    await pagina.getByRole('button', { name:'Configurações' }).click();
    await pagina.getByRole('button', { name:'Dados e Sincronização' }).click();
    assert.equal(await pagina.getByText('Supabase').isVisible(), true);
    async function selecionarArquivo() {
      await pagina.locator('#dados-arquivo').setInputFiles({ name:'hoje.json',
        mimeType:'application/json', buffer:Buffer.from('{"versao":1}') });
      await pagina.locator('#dados-previa').waitFor({ state:'visible' });
    }
    await selecionarArquivo();
    assert.match(await pagina.locator('#dados-resumo').textContent(), /1 origem/);
    assert.match(await pagina.locator('#dados-origem').textContent(), /Origem: computador 8f2c1a3b/);
    assert.match(await pagina.locator('#dados-origem').textContent(), /03\/11\/2026/);
    const numeros = await pagina.locator('#dados-numeros li').allTextContents();
    assert.match(numeros[0], /Matérias concluídas: 12 recebido\(s\) · \+10 no painel · 2 já contabilizado\(s\)/);
    assert.match(numeros[4], /Enviar Matérias: 3 recebido/);
    assert.equal(chamadas.filter(acao => acao === 'confirmar').length, 0);
    await pagina.locator('#dados-cancelar').click();
    assert.equal(await pagina.locator('#dados-previa').isVisible(), false);
    assert.equal(chamadas.filter(acao => acao === 'confirmar').length, 0);
    await selecionarArquivo();
    // Nenhum ouvinte de 'dialog' é registrado aqui, igual ao AutoXS em uso.
    await pagina.locator('#dados-confirmar').click();
    await pagina.locator('#confirmar-acao').waitFor({ state:'visible' });
    await pagina.locator('#confirmar-cancelar').click();
    assert.equal(chamadas.filter(acao => acao === 'confirmar').length, 0);
    await pagina.locator('#dados-confirmar').click();
    await pagina.locator('#confirmar-acao').waitFor({ state:'visible' });
    await pagina.locator('#confirmar-sim').click();
    await pagina.getByText(/Histórico anterior preservado/).waitFor();
    assert.equal(chamadas.filter(acao => acao === 'confirmar').length, 1);
  } finally { await contexto.close(); await browser.close(); }
});

test('erro de importação permanece visível e o mesmo arquivo pode ser escolhido novamente', async () => {
  const browser = await chromium.launch({ channel:'msedge', headless:true });
  const contexto = await browser.newContext();
  const pagina = await contexto.newPage();
  let tentativas = 0;
  await pagina.exposeFunction('configuracoesAutoXS', async () => ({ ok:true,
    preferencias:{ tema:'escuro', tamanho:'normal', logsDetalhados:false, confirmacoes:false, pastaVideos:'' },
    versao:'1.0.0' }));
  await pagina.exposeFunction('dadosAutoXS', async pedido => {
    if (pedido.acao === 'prever') {
      tentativas++;
      return { ok:false, mensagem:'Arquivo inválido para teste.' };
    }
    return { ok:true, resultado:{ cancelado:true } };
  });
  try {
    await pagina.goto(pathToFileURL(path.join(__dirname, '..', 'painel-manual.html')).href);
    await pagina.getByRole('button', { name:'Configurações' }).click();
    await pagina.getByRole('button', { name:'Dados e Sincronização' }).click();
    const arquivo = { name:'repetido.json', mimeType:'application/json', buffer:Buffer.from('{}') };
    await pagina.locator('#dados-arquivo').setInputFiles(arquivo);
    await pagina.getByText('Arquivo inválido para teste.').waitFor();
    assert.equal(await pagina.locator('#dados-importar').isEnabled(), true);
    assert.equal(await pagina.locator('#dados-confirmar').isEnabled(), false);
    await pagina.locator('#dados-arquivo').setInputFiles(arquivo);
    await pagina.waitForFunction(() => document.querySelector('#dados-estado').textContent === 'Arquivo inválido para teste.');
    assert.equal(tentativas, 2);
  } finally { await contexto.close(); await browser.close(); }
});

// Regressão: o AutoXS não registra ouvinte de 'dialog' no Playwright, então
// window.confirm era descartado e devolvia false. A confirmação da importação
// nunca chegava ao backend: a prévia aparecia, o clique não fazia nada e o
// painel continuava com os números antigos.
test('importação real grava e soma os totais sem nenhum ouvinte de dialog', async () => {
  const pasta = await fs.mkdtemp(path.join(os.tmpdir(), 'autoxs-importar-'));
  const instalacaoLocal = randomUUID();
  const instalacaoRemota = randomUUID();
  const historico = criarHistoricoProducao(path.join(pasta, 'historico.json'),
    () => new Date('2026-11-03T15:00:00Z'));
  const vindo = (operacao, situacao, formaConclusao, hora, cmsId, urlOriginal) => ({
    origem:{ instalacao:instalacaoRemota, registro:randomUUID() }, operacao, situacao, formaConclusao,
    criadoEm:'2026-11-03T13:' + hora + ':00.000Z',
    concluidoEm:situacao === 'concluido' ? '2026-11-03T13:' + hora + ':30.000Z' : null,
    atualizadoEm:'2026-11-03T13:' + hora + ':30.000Z',
    titulo:'Matéria ' + cmsId, chapeu:'', subtitulo:'', urlOriginal, cmsId, ocultoSelecao:false });
  // Arquivo no formato antigo (versão 1), como o exportado por outro computador.
  const documento = { versao:1, instalacao:instalacaoRemota, dia:'2026-11-03',
    exportadoEm:'2026-11-03T14:50:00.000Z', registros:[
      vindo('atualizar', 'concluido', 'automatico', '00', '700001', ''),
      vindo('atualizar', 'concluido', 'manual', '10', '700002', ''),
      vindo('adicionar', 'concluido', 'manual', '20', '700003',
        'https://www.tribunadosertao.com.br/cidades/2026/11/03/700003-materia'),
      vindo('atualizar', 'aguardandoRevisao', null, '30', '700004', '')
    ] };
  const browser = await chromium.launch({ channel:'msedge', headless:true });
  const contexto = await browser.newContext();
  const pagina = await contexto.newPage();
  const previas = new Map();
  await pagina.exposeFunction('configuracoesAutoXS', async () => ({ ok:true,
    preferencias:{ tema:'escuro', tamanho:'normal', logsDetalhados:false, confirmacoes:false, pastaVideos:'' },
    versao:'1.0.0' }));
  await pagina.exposeFunction('dadosAutoXS', async pedido => {
    try {
      if (pedido.acao === 'prever') {
        const recebido = JSON.parse(pedido.conteudo);
        const previa = await historico.preverImportacao(recebido, instalacaoLocal);
        const token = randomUUID();
        previas.set(token, { documento:recebido, previa });
        return { ok:true, token, previa };
      }
      if (pedido.acao === 'confirmar') {
        const entrada = previas.get(pedido.token);
        if (!entrada) throw new Error('A prévia expirou. Escolha o arquivo novamente.');
        return { ok:true,
          resultado:await historico.importarDadosHoje(entrada.documento, entrada.previa, instalacaoLocal) };
      }
      throw new Error('Operação de dados inválida.');
    } catch (erro) { return { ok:false, mensagem:erro.message }; }
  });
  try {
    await pagina.goto(pathToFileURL(path.join(__dirname, '..', 'painel-manual.html')).href);
    await pagina.getByRole('button', { name:'Configurações' }).click();
    await pagina.getByRole('button', { name:'Dados e Sincronização' }).click();
    const arquivo = { name:'AUTOXS_DADOS_2026-11-03.json', mimeType:'application/json',
      buffer:Buffer.from(JSON.stringify(documento)) };

    await pagina.locator('#dados-arquivo').setInputFiles(arquivo);
    await pagina.locator('#dados-previa').waitFor({ state:'visible' });
    assert.match(await pagina.locator('#dados-origem').textContent(),
      new RegExp('Origem: computador ' + instalacaoRemota.slice(0, 8)));
    assert.match((await pagina.locator('#dados-numeros li').allTextContents())[0],
      /Matérias concluídas: 3 recebido\(s\) · \+3 no painel/);
    await pagina.locator('#dados-confirmar').click();
    await pagina.locator('#confirmar-sim').click();
    await pagina.getByText(/Histórico anterior preservado/).waitFor();

    const depois = await historico.consultar('2026-11-03');
    assert.deepEqual(depois.estatisticasImportadas, { concluidas:3, atualizacoesAutomaticas:1,
      finalizadasManualmente:2, adicionadas:1, aguardandoRevisao:1, erros:0 });
    assert.equal(depois.estatisticas.concluidas, 3);
    assert.equal(depois.compartilh.length, 1);

    // O mesmo arquivo outra vez não soma nada e avisa que já está contabilizado.
    await pagina.locator('#dados-arquivo').setInputFiles(arquivo);
    await pagina.locator('#dados-previa').waitFor({ state:'visible' });
    assert.match(await pagina.locator('#dados-estado').textContent(), /já estão contabilizados/);
    assert.equal(await pagina.locator('#dados-confirmar').isEnabled(), false);
    const repetido = await historico.consultar('2026-11-03');
    assert.deepEqual(repetido.estatisticas, depois.estatisticas);
    assert.equal(repetido.compartilh.length, 1);
  } finally {
    await contexto.close(); await browser.close();
    await fs.rm(pasta, { recursive:true, force:true });
  }
});

test('arquivo exportado pela própria instalação é identificado na prévia', async () => {
  const pasta = await fs.mkdtemp(path.join(os.tmpdir(), 'autoxs-propria-'));
  const instalacao = randomUUID();
  const historico = criarHistoricoProducao(path.join(pasta, 'historico.json'),
    () => new Date('2026-11-03T15:00:00Z'));
  const browser = await chromium.launch({ channel:'msedge', headless:true });
  const contexto = await browser.newContext();
  const pagina = await contexto.newPage();
  await pagina.exposeFunction('configuracoesAutoXS', async () => ({ ok:true,
    preferencias:{ tema:'escuro', tamanho:'normal', logsDetalhados:false, confirmacoes:false, pastaVideos:'' },
    versao:'1.0.0' }));
  await pagina.exposeFunction('dadosAutoXS', async pedido => {
    try {
      return { ok:true, token:'t',
        previa:await historico.preverImportacao(JSON.parse(pedido.conteudo), instalacao) };
    } catch (erro) { return { ok:false, mensagem:erro.message }; }
  });
  try {
    await historico.registrar({ operacao:'adicionar', chave:'800001', titulo:'Matéria local',
      situacao:'concluido', formaConclusao:'manual',
      urlOriginal:'https://www.tribunadosertao.com.br/cidades/2026/11/03/800001-materia' });
    const documento = await historico.exportarDadosHoje(instalacao);
    await pagina.goto(pathToFileURL(path.join(__dirname, '..', 'painel-manual.html')).href);
    await pagina.getByRole('button', { name:'Configurações' }).click();
    await pagina.getByRole('button', { name:'Dados e Sincronização' }).click();
    await pagina.locator('#dados-arquivo').setInputFiles({ name:'proprio.json',
      mimeType:'application/json', buffer:Buffer.from(JSON.stringify(documento)) });
    await pagina.locator('#dados-previa').waitFor({ state:'visible' });
    assert.match(await pagina.locator('#dados-origem').textContent(), /exportado por ESTE computador/);
    assert.match(await pagina.locator('#dados-estado').textContent(), /deste mesmo computador/);
    assert.equal(await pagina.locator('#dados-confirmar').isEnabled(), false);
  } finally {
    await contexto.close(); await browser.close();
    await fs.rm(pasta, { recursive:true, force:true });
  }
});

// Regressão: a Central de Configurações tinha o miolo preso a
// "max-height: calc(100vh - 210px)", um chute para a altura do cabeçalho, das
// abas e do rodapé. Em tela menor ou com zoom a soma passava do teto do
// diálogo, que tem overflow: hidden, e o conteúdo era cortado sem barra de
// rolagem: o botão "Confirmar importação" ficava inalcançável.
for (const tela of [{ largura:1280, altura:900, tamanho:'normal' },
  { largura:1920, altura:1080, tamanho:'normal' },
  { largura:649, altura:583, tamanho:'ampliado' },
  { largura:800, altura:460, tamanho:'compacto' }]) {
  test(`prévia longa continua rolável e confirmável em ${tela.largura}x${tela.altura} (${tela.tamanho})`, async () => {
    const browser = await chromium.launch({ channel:'msedge', headless:true });
    const contexto = await browser.newContext({ viewport:{ width:tela.largura, height:tela.altura } });
    const pagina = await contexto.newPage();
    let confirmou = false;
    await pagina.exposeFunction('configuracoesAutoXS', async () => ({ ok:true,
      preferencias:{ tema:'escuro', tamanho:tela.tamanho, logsDetalhados:false,
        confirmacoes:false, pastaVideos:'' }, versao:'1.0.0' }));
    await pagina.exposeFunction('dadosAutoXS', async pedido => {
      if (pedido.acao === 'confirmar') { confirmou = true; return { ok:true,
        resultado:{ novosTotais:1, atualizadosTotais:0, novosLinks:20 } }; }
      return { ok:true, token:'teste', previa:{
        novosTotais:1, atualizadosTotais:0, novosLinks:20,
        repetidos:0, expirados:0, invalidos:0, ambiguos:0, linksRepetidos:0,
        arquivo:{ instalacao:'8f2c1a3b-0000-4000-8000-000000000000', dia:'2026-11-03',
          exportadoEm:'2026-11-03T19:17:07.624Z', propria:false },
        recebidos:{ concluidas:161, atualizacoesAutomaticas:79, finalizadasManualmente:82,
          adicionadas:2, aguardandoRevisao:2, erros:0 },
        jaContabilizados:{ concluidas:0, atualizacoesAutomaticas:0, finalizadasManualmente:0,
          adicionadas:0, aguardandoRevisao:0, erros:0 },
        acrescimo:{ concluidas:161, atualizacoesAutomaticas:79, finalizadasManualmente:82,
          adicionadas:2, aguardandoRevisao:2, erros:0 },
        // Vinte títulos longos: a prévia mais alta que o painel chega a mostrar.
        titulosNovos:Array.from({ length:20 },
          (valor, indice) => `Matéria ${indice + 1} com um título bastante longo para esticar a prévia`) } };
    });
    try {
      await pagina.goto(pathToFileURL(path.join(__dirname, '..', 'painel-manual.html')).href);
      await pagina.getByRole('button', { name:'Configurações' }).click();
      await pagina.getByRole('button', { name:'Dados e Sincronização' }).click();
      await pagina.locator('#dados-arquivo').setInputFiles({ name:'hoje.json',
        mimeType:'application/json', buffer:Buffer.from('{"versao":1}') });
      await pagina.locator('#dados-previa').waitFor({ state:'visible' });

      const medidas = await pagina.evaluate(() => {
        const caixa = elemento => elemento.getBoundingClientRect();
        const miolo = document.querySelector('.config-conteudo');
        return { dialogo:caixa(document.querySelector('#configuracoes')).bottom,
          rodapeTopo:caixa(document.querySelector('.config-rodape')).top,
          rodapeBase:caixa(document.querySelector('.config-rodape')).bottom,
          janela:window.innerHeight, rolavel:miolo.scrollHeight > miolo.clientHeight };
      });
      // O diálogo inteiro, rodapé incluído, precisa caber na janela...
      assert.ok(medidas.dialogo <= medidas.janela + 1,
        `o diálogo passa da janela: ${medidas.dialogo} > ${medidas.janela}`);
      assert.ok(medidas.rodapeTopo >= -1 && medidas.rodapeBase <= medidas.janela + 1,
        `o rodapé saiu da janela: ${medidas.rodapeTopo}–${medidas.rodapeBase} em ${medidas.janela}`);
      // ...e o que não couber tem de rolar, em vez de ser cortado.
      assert.equal(medidas.rolavel, true, 'a prévia longa deveria deixar o miolo rolável');

      // Sem rolagem manual: se o botão não for alcançável, o clique estoura.
      await pagina.locator('#dados-confirmar').click();
      await pagina.locator('#confirmar-sim').click();
      await pagina.getByText(/Histórico anterior preservado/).waitFor();
      assert.equal(confirmou, true);
    } finally { await contexto.close(); await browser.close(); }
  });
}
