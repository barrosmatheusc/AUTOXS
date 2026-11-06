const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { chromium } = require('playwright');
const { carregarIntegracaoLocal } = require('../integracao-local');
const { processarLote } = require('../autoxs');
const { criarPainelManual } = require('../painel-manual');
const { criarHistoricoProducao } = require('../historico-producao');

function pastaTemporaria(fn) {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'autoxs-local-'));
  try { return fn(pasta); } finally { fs.rmSync(pasta, { recursive:true, force:true }); }
}

function modulosFalsos(pasta, ativo, painelFotos = false) {
  fs.writeFileSync(path.join(pasta, 'config-local.json'), JSON.stringify({ hermes:{ ativo } }));
  fs.writeFileSync(path.join(pasta, 'hermes-painel.js'), '// painel local simulado');
  let processos = 0;
  const estado = { obter:() => ({ estado:'desligado' }), assinar:() => () => {}, publicar:valor => valor };
  const fila = { iniciarFaseAutoXS:() => true, registrarPendencia:() => 1,
    processar:() => { processos++; return { estado:'concluida' }; },
    emAndamento:() => false, parar:() => false };
  const carregar = nome => {
    if (nome.endsWith('hermes-seletor.js'))
      return { lerConfigLocal:() => ({ ativo, painelFotos }),
        salvarConfigLocal:async () => ({ ativo, painelFotos }) };
    if (nome.endsWith('hermes-estado.js')) return estado;
    if (nome.endsWith('hermes-fila.js')) return { filaHermes:fila };
    if (nome.endsWith('hermes-dom.js')) return { conferirCandidata:() => ({ encontrados:1, confere:true }) };
    if (nome.endsWith('hermes-memoria.js')) return { criarMemoriaVisual:() => ({ registrar:async () => null }) };
    throw new Error('Módulo inesperado');
  };
  return { carregar, processos:() => processos };
}

test('sem configuração e sem módulos privados a integração não é carregada', () => {
  pastaTemporaria(pasta => {
    assert.equal(carregarIntegracaoLocal({ diretorio:pasta,
      carregar:() => { throw new Error('não deve carregar módulos'); } }), null);
  });
  // Novo processo: mesmo quando um require privado falha, o núcleo carrega.
  const codigo = `const M=require('module'); const original=M._load;
    M._load=function(nome,...resto){if(/hermes-(fila|dom|seletor|estado)/.test(nome))
      throw Object.assign(new Error('ausente'),{code:'MODULE_NOT_FOUND'});
      return original.call(this,nome,...resto)};
    const app=require('./autoxs'); const painel=require('./painel-manual');
    if(typeof app.processarLote!=='function'||typeof painel.criarPainelManual!=='function') process.exit(1);`;
  const resultado = spawnSync(process.execPath, ['-e', codigo], { cwd:path.join(__dirname, '..'), encoding:'utf8' });
  assert.equal(resultado.status, 0, resultado.stderr);
});

test('módulos presentes e desabilitados não iniciam processo', () => pastaTemporaria(pasta => {
  const falso = modulosFalsos(pasta, false);
  const integracao = carregarIntegracaoLocal({ diretorio:pasta, carregar:falso.carregar });
  assert.equal(integracao.lerConfigLocal().ativo, false);
  assert.equal(typeof integracao.filaHermes.processar, 'function');
  assert.equal(falso.processos(), 0);
}));

test('módulos presentes e habilitados ficam disponíveis sem iniciar automaticamente', () => pastaTemporaria(pasta => {
  const falso = modulosFalsos(pasta, true);
  const integracao = carregarIntegracaoLocal({ diretorio:pasta, carregar:falso.carregar });
  assert.equal(integracao.lerConfigLocal().ativo, true);
  assert.equal(typeof integracao.conferirCandidata, 'function');
  assert.equal(falso.processos(), 0);
}));

test('falha de carregamento é registrada e não bloqueia o núcleo', () => pastaTemporaria(pasta => {
  modulosFalsos(pasta, true);
  const mensagens = [];
  const integracao = carregarIntegracaoLocal({ diretorio:pasta,
    carregar:() => { throw new Error('arquivo local com erro'); }, registrar:m => mensagens.push(m) });
  assert.equal(integracao, null);
  assert.match(mensagens[0], /arquivo local com erro/);
}));

test('lote editorial simulado funciona sem integração local', async () => {
  const eventos = [];
  const materias = [{ titulo:'Com foto', url:'https://cms.local/1' },
    { titulo:'Sem foto', url:'https://cms.local/2' }];
  const resumo = await processarLote(materias, {
    abrir:async materia => ({ titulo:materia.titulo, url:() => materia.url,
      close:async () => eventos.push('fechada') }),
    ler:async aba => ({ temChapeu:true, temImagem:aba.titulo === 'Com foto' }),
    enviar:async () => { eventos.push('enviada'); return true; },
    pesquisar:async () => 'termo', log:async () => {}
  });
  assert.equal(resumo.enviadas, 1);
  assert.equal(resumo.pendentes, 1);
  assert.deepEqual(eventos, ['enviada', 'fechada']);
});

test('painel sem integração mostra configurações e permite prévia de dados', async () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'autoxs-painel-sem-local-'));
  const browser = await chromium.launch({ channel:'msedge', headless:true });
  const contexto = await browser.newContext();
  try {
    const historico = criarHistoricoProducao(path.join(pasta, 'historico-autoxs.json'));
    const painel = await criarPainelManual(contexto, async () =>
      ({ abertas:0, enviadas:0, pendentes:0, erros:0 }), null,
      undefined, historico, null, null, null, null, null);
    assert.equal(await painel.locator('#hermes').isVisible(), false);
    assert.equal(await painel.evaluate(() => typeof window.hermesAutoXS), 'undefined');
    await painel.getByRole('button', { name:'Configurações' }).click();
    await painel.getByRole('button', { name:'Dados e Sincronização' }).click();
    assert.equal(await painel.locator('#dados-exportar').isVisible(), true);
    const documento = await historico.exportarDadosHoje(randomUUID());
    const resposta = await painel.evaluate(conteudo =>
      window.dadosAutoXS({ acao:'prever', conteudo:JSON.stringify(conteudo) }), documento);
    assert.equal(resposta.ok, true);
    assert.equal(resposta.previa.novosTotais, 0);
  } finally {
    await contexto.close(); await browser.close();
    fs.rmSync(pasta, { recursive:true, force:true });
  }
});

test('painel local habilitado conserva o controle, sem iniciar processo', async () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'autoxs-painel-local-'));
  fs.writeFileSync(path.join(pasta, 'config-local.json'), JSON.stringify({ hermes:{ ativo:true } }));
  fs.writeFileSync(path.join(pasta, 'hermes-painel.js'),
    'window.atualizarHermes = () => {};');
  // A area visual do Hermes de fotos esta em standby: ela so aparece com
  // painelFotos: true. Aqui o teste pede a exibicao, porque e justamente o
  // controle visivel que ele verifica.
  const falso = modulosFalsos(pasta, true, true);
  const integracao = carregarIntegracaoLocal({ diretorio:pasta, carregar:falso.carregar });
  const browser = await chromium.launch({ channel:'msedge', headless:true });
  const contexto = await browser.newContext();
  try {
    const painel = await criarPainelManual(contexto, async () =>
      ({ abertas:0, enviadas:0, pendentes:0, erros:0 }), null,
      undefined, null, null, null, null, null, integracao);
    assert.equal(await painel.locator('#hermes').isVisible(), true);
    assert.equal(await painel.evaluate(() => typeof window.hermesAutoXS), 'function');
    assert.equal(falso.processos(), 0);
    await painel.reload();
    await painel.locator('#hermes').waitFor({ state:'visible' });
    assert.equal(falso.processos(), 0);
  } finally {
    await contexto.close(); await browser.close();
    fs.rmSync(pasta, { recursive:true, force:true });
  }
});

test('em standby a secao do Hermes de fotos fica oculta, sem perder a ponte', async () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'autoxs-painel-standby-'));
  fs.writeFileSync(path.join(pasta, 'config-local.json'), JSON.stringify({ hermes:{ ativo:true } }));
  fs.writeFileSync(path.join(pasta, 'hermes-painel.js'), 'window.atualizarHermes = () => {};');
  const falso = modulosFalsos(pasta, true, false);
  const integracao = carregarIntegracaoLocal({ diretorio:pasta, carregar:falso.carregar });
  const browser = await chromium.launch({ channel:'msedge', headless:true });
  const contexto = await browser.newContext();
  try {
    const painel = await criarPainelManual(contexto, async () =>
      ({ abertas:0, enviadas:0, pendentes:0, erros:0 }), null,
      undefined, null, null, null, null, null, integracao);
    // Oculta, porem presente: ocultar nao e remover.
    assert.equal(await painel.locator('#hermes').count(), 1);
    assert.equal(await painel.locator('#hermes').isVisible(), false);
    // A ponte continua instalada, para a reativacao nao exigir reconstrucao.
    assert.equal(await painel.evaluate(() => typeof window.hermesAutoXS), 'function');
    assert.equal(falso.processos(), 0, 'o standby nao pode iniciar processo nenhum');
    // E o resto do painel segue inteiro.
    for (const botao of ['#atualizar', '#adicionar', '#compartilhar', '#gerador-artes',
      '#gerador-videos', '#abrir-configuracoes'])
      assert.equal(await painel.locator(botao).isVisible(), true, botao);
  } finally {
    await contexto.close(); await browser.close();
    fs.rmSync(pasta, { recursive:true, force:true });
  }
});

test('arquivos pessoais e exportações estão ignorados sem apagar dados locais', () => {
  const raiz = path.join(__dirname, '..');
  const arquivos = ['config-local.json', 'config-local.json.example', 'hermes-seletor.js',
    'hermes-memoria.js', 'hermes-memoria.json', 'backups/hermes-memoria-corrompida-1.json',
    'hermes-painel.js', 'hermes-candidata-1.png', 'test/hermes-fila.test.js',
    'AUTOXS_DADOS_2026-11-03.json', 'historico-autoxs.json', 'instalacao-autoxs.id',
    'backups/exemplo.json', '.env', 'sessao.json'];
  for (const arquivo of arquivos) {
    const ignorado = spawnSync('git', ['check-ignore', '-q', arquivo], { cwd:raiz });
    assert.equal(ignorado.status, 0, `${arquivo} precisa ser ignorado`);
    const rastreado = spawnSync('git', ['ls-files', '--error-unmatch', arquivo], { cwd:raiz, stdio:'ignore' });
    assert.notEqual(rastreado.status, 0, `${arquivo} já é rastreado`);
  }
  const bat = fs.readFileSync(path.join(raiz, 'ATUALIZAR AUTOXS.bat'), 'utf8');
  assert.match(bat, /git merge --ff-only origin\/main/);
  assert.doesNotMatch(bat, /git (?:clean|reset --hard)/);
});

// ---------------------------------------------- memória visual (Fase 0)

test('memória visual fica disponível mesmo com o Hermes desligado', () => pastaTemporaria(pasta => {
  const falso = modulosFalsos(pasta, false);
  const integracao = carregarIntegracaoLocal({ diretorio:pasta, carregar:falso.carregar });
  assert.equal(integracao.lerConfigLocal().ativo, false);
  // Observar a escolha humana não depende de o Hermes estar ligado.
  assert.equal(typeof integracao.memoriaVisual.registrar, 'function');
  assert.equal(falso.processos(), 0);
}));

test('sem o módulo de memória o resto da integração continua inteiro', () => pastaTemporaria(pasta => {
  const falso = modulosFalsos(pasta, true);
  const avisos = [];
  const carregar = nome => {
    if (nome.endsWith('hermes-memoria.js')) throw new Error('módulo ausente');
    return falso.carregar(nome);
  };
  const integracao = carregarIntegracaoLocal({ diretorio:pasta, carregar, registrar:m => avisos.push(m) });
  assert.notEqual(integracao, null, 'a integração não pode cair por causa da memória');
  assert.equal(integracao.memoriaVisual, null);
  assert.equal(typeof integracao.filaHermes.processar, 'function');
  assert.match(avisos.join(' '), /Memória visual indisponível/);
}));

test('módulo de memória sem o formato esperado é ignorado sem derrubar nada', () => pastaTemporaria(pasta => {
  const falso = modulosFalsos(pasta, true);
  const carregar = nome => nome.endsWith('hermes-memoria.js')
    ? { criarMemoriaVisual:() => ({}) } : falso.carregar(nome);
  const integracao = carregarIntegracaoLocal({ diretorio:pasta, carregar });
  assert.notEqual(integracao, null);
  assert.equal(integracao.memoriaVisual, null);
}));

test('sem integração local o núcleo não conhece memória visual', () => pastaTemporaria(pasta => {
  assert.equal(carregarIntegracaoLocal({ diretorio:pasta,
    carregar:() => { throw new Error('não deve carregar módulos'); } }), null);
}));
