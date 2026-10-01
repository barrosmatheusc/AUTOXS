const { test } = require('node:test');
const assert = require('node:assert/strict');
const { abrirMateriaEmSegundoPlano, prepararAbaMateria, converterData, coletarMaterias, processarLote, enviarMateria } = require('../autoxs');

const materia = (id, data = '01/01/2026 00:00') => ({ titulo: `Matéria ${id}`, data, url: `https://redacao.tribunaweb.com.br/news/${id}/edit` });

function operacoesPara(estados, opcoes = {}) {
  const eventos = [];
  const operacoes = {
    abrir: async m => {
      eventos.push(`abrir:${m.titulo}`);
      if (opcoes.falhaAbertura === m.titulo) throw new Error('navegação falhou');
      return { titulo: m.titulo, close: async () => eventos.push(`fechar:${m.titulo}`) };
    },
    ler: async aba => {
      eventos.push(`ler:${aba.titulo}`);
      if (opcoes.falhaLeitura) throw new Error('campo ausente');
      return estados[aba.titulo];
    },
    enviar: async aba => {
      eventos.push(`enviar:${aba.titulo}`);
      return opcoes.envioConfirmado !== false;
    },
    pesquisar: async aba => {
      eventos.push(`pesquisar:${aba.titulo}`);
      if (opcoes.falhaPesquisa) throw new Error('modal não abriu');
    },
    log: () => {}
  };
  return { operacoes, eventos };
}

test('datas: aceita 2026 e rejeita datas inválidas', () => {
  assert.equal(converterData('01/01/2026 00:00').getFullYear(), 2026);
  for (const valor of ['', '31/02/2026', '01/13/2026', '01/01/2026 25:00']) {
    assert.equal(converterData(valor), null);
  }
});

test('abre todo o lote primeiro; envia e fecha somente com chapéu e foto', async () => {
  const lote = [materia(1), materia(2), materia(3), materia(4), materia(5)];
  const { operacoes, eventos } = operacoesPara({
    'Matéria 1': { temChapeu: true, temImagem: true },
    'Matéria 2': { temChapeu: false, temImagem: true },
    'Matéria 3': { temChapeu: true, temImagem: false },
    'Matéria 4': { temChapeu: false, temImagem: false },
    'Matéria 5': { temChapeu: true, temImagem: null }
  });
  const resumo = await processarLote(lote, operacoes);
  assert.deepEqual(eventos.slice(0, 5), lote.map(m => `abrir:${m.titulo}`));
  assert.deepEqual(eventos.filter(e => e.startsWith('enviar:')), ['enviar:Matéria 1']);
  assert.deepEqual(eventos.filter(e => e.startsWith('fechar:')), ['fechar:Matéria 1']);
  assert.deepEqual(eventos.filter(e => e.startsWith('pesquisar:')), ['pesquisar:Matéria 3', 'pesquisar:Matéria 4']);
  assert.deepEqual(resumo, { abertas: 5, enviadas: 1, pendentes: 4, erros: 0 });
});

test('não abre matérias de 2025 e limita a página a 25 abas', async () => {
  const lote = [materia('antiga', '31/12/2025 23:59'), ...Array.from({ length: 28 }, (_, i) => materia(i))];
  const estados = Object.fromEntries(lote.map(m => [m.titulo, { temChapeu: false, temImagem: true }]));
  const { operacoes, eventos } = operacoesPara(estados);
  await processarLote(lote, operacoes);
  assert.equal(eventos.some(e => e === 'abrir:Matéria antiga'), false);
  assert.ok(eventos.filter(e => e.startsWith('abrir:')).length <= 25);
});

test('envio não confirmado mantém a aba aberta', async () => {
  const { operacoes, eventos } = operacoesPara({ 'Matéria 1': { temChapeu: true, temImagem: true } }, { envioConfirmado: false });
  const resumo = await processarLote([materia(1)], operacoes);
  assert.equal(resumo.enviadas, 0);
  assert.equal(resumo.pendentes, 1);
  assert.equal(eventos.some(e => e.startsWith('fechar:')), false);
});

test('falha na leitura ou pesquisa mantém a aba aberta', async () => {
  for (const opcoes of [{ falhaLeitura: true }, { falhaPesquisa: true }]) {
    const { operacoes, eventos } = operacoesPara({ 'Matéria 1': { temChapeu: false, temImagem: false } }, opcoes);
    const resumo = await processarLote([materia(1)], operacoes);
    assert.equal(resumo.erros, 1);
    assert.equal(resumo.pendentes, 1);
    assert.equal(eventos.some(e => /^(enviar|fechar):/.test(e)), false);
  }
});

test('falha de abertura não impede o processamento das outras matérias', async () => {
  const { operacoes, eventos } = operacoesPara({ 'Matéria 2': { temChapeu: true, temImagem: true } }, { falhaAbertura: 'Matéria 1' });
  const resumo = await processarLote([materia(1), materia(2)], operacoes);
  assert.equal(resumo.erros, 1);
  assert.equal(resumo.enviadas, 1);
  assert.ok(eventos.includes('fechar:Matéria 2'));
});

test('IA não bloqueia a próxima matéria e só envia após legenda e nova conferência', { timeout: 2000 }, async () => {
  const estados = {
    'Matéria 1': { temChapeu:true, temImagem:false, categoria:'RJ em Foco' },
    'Matéria 2': { temChapeu:true, temImagem:true }
  };
  const { operacoes, eventos } = operacoesPara(estados);
  let liberarImagem;
  const espera = new Promise(resolve => { liberarImagem = resolve; });
  operacoes.gerarImagem = async () => {
    eventos.push('gerando:1');
    await espera;
    estados['Matéria 1'].temImagem = true;
    eventos.push('legenda-salva:1');
    return true;
  };
  const enviar = operacoes.enviar;
  operacoes.enviar = async aba => {
    const confirmado = await enviar(aba);
    if (aba.titulo === 'Matéria 2') liberarImagem();
    return confirmado;
  };
  const resumo = await processarLote([materia(1), materia(2)], operacoes);
  assert.deepEqual(eventos.filter(e => e.startsWith('enviar:')), ['enviar:Matéria 2', 'enviar:Matéria 1']);
  assert.ok(eventos.indexOf('enviar:Matéria 2') < eventos.indexOf('legenda-salva:1'));
  assert.ok(eventos.indexOf('legenda-salva:1') < eventos.lastIndexOf('ler:Matéria 1'));
  assert.equal(eventos.filter(e => e === 'ler:Matéria 1').length, 2);
  assert.deepEqual(resumo, { abertas:2, enviadas:2, pendentes:0, erros:0 });
});

test('falha na legenda mantém a aba aberta mesmo quando a foto já apareceu', async () => {
  const estados = { 'Matéria 1': { temChapeu:true, temImagem:false, categoria:'RJ em Foco' } };
  const { operacoes, eventos } = operacoesPara(estados);
  operacoes.gerarImagem = async () => {
    estados['Matéria 1'].temImagem = true;
    throw new Error('Legenda não foi salva');
  };
  const resumo = await processarLote([materia(1)], operacoes);
  assert.equal(eventos.some(e => /^(enviar|fechar):/.test(e)), false);
  assert.deepEqual(resumo, { abertas:1, enviadas:0, pendentes:1, erros:1 });
});

test('foto gerada sem chapéu continua pendente', async () => {
  const estados = { 'Matéria 1': { temChapeu:false, temImagem:false, categoria:'RJ em Foco' } };
  const { operacoes, eventos } = operacoesPara(estados);
  operacoes.gerarImagem = async () => { estados['Matéria 1'].temImagem = true; return true; };
  const resumo = await processarLote([materia(1)], operacoes);
  assert.equal(eventos.some(e => /^(enviar|fechar):/.test(e)), false);
  assert.deepEqual(resumo, { abertas:1, enviadas:0, pendentes:1, erros:0 });
});

function paginaListagem(itens) {
  const linha = item => ({
    isVisible: async () => item.visivel !== false,
    innerText: async () => `${item.data} ${item.titulo}`,
    locator: seletor => seletor === 'a'
      ? { evaluateAll: async callback => callback((item.links ?? [item.url]).filter(Boolean).map(href => ({ textContent: 'Editar', title: '', getAttribute: nome => nome === 'href' ? href : null }))) }
      : { count: async () => 8, nth: () => ({ innerText: async () => item.titulo }) }
  });
  return {
    url: () => 'https://redacao.tribunaweb.com.br/news',
    locator: () => ({ count: async () => itens.length, nth: i => linha(itens[i]) })
  };
}

test('coleta ignora antigas, inválidas, invisíveis, sem edição, duplicadas e URLs externas', async () => {
  const itens = [
    materia(1), materia(2, '31/12/2025 23:59'), materia(3), materia(1),
    materia(4, '31/02/2026'), { ...materia(5), links: [] },
    { ...materia(6), visivel: false }, { ...materia(7), url: 'https://example.com/news/7/edit' },
    { ...materia(8), links: [materia(8).url, materia(9).url] }
  ];
  const coletadas = await coletarMaterias(paginaListagem(itens));
  assert.deepEqual(coletadas.map(m => m.titulo), ['Matéria 1', 'Matéria 3']);
});

test('coleta retorna até 25 matérias elegíveis na página', async () => {
  const itens = Array.from({ length: 30 }, (_, i) => materia(i));
  const coletadas = await coletarMaterias(paginaListagem(itens));
  assert.equal(coletadas.length, 25);
});

function campoSimulado(campo) {
  campo.or = () => campo;
  campo.filter = () => campo;
  return campo;
}
function paginaEnvio({ status = 200, confirma = true, valido = true, botao = true } = {}) {
  let clicou = false;
  const formulario = {
    count: async () => 1,
    getByRole: () => campoSimulado({ count: async () => botao ? 1 : 0, isEnabled: async () => true, click: async () => { clicou = true; } }),
    evaluate: async callback => callback({ checkValidity: () => valido, action: materia(1).url })
  };
  const pagina = {
    getByRole: () => campoSimulado({ locator: () => formulario }),
    url: () => materia(1).url,
    locator: () => ({ allTextContents: async () => [] }),
    waitForResponse: async predicado => {
      const resposta = { request: () => ({ method: () => 'POST' }), url: () => materia(1).url, status: () => status };
      assert.equal(predicado(resposta), true);
      return resposta;
    },
    waitForFunction: async () => { if (!confirma) throw new Error('sem confirmação'); }
  };
  return { pagina, clicou: () => clicou };
}

test('envio exige resposta sem erro e confirmação da interface', async () => {
  for (const [opcoes, esperado] of [[{}, true], [{ status: 422 }, false], [{ status: 500 }, false], [{ confirma: false }, false]]) {
    const { pagina } = paginaEnvio(opcoes);
    assert.equal(await enviarMateria(pagina), esperado);
  }
});

test('formulário inválido ou botão ausente não dispara envio', async () => {
  for (const opcoes of [{ valido: false }, { botao: false }]) {
    const mock = paginaEnvio(opcoes);
    if (opcoes.botao === false) await assert.rejects(enviarMateria(mock.pagina), /Botão Enviar/);
    else assert.equal(await enviarMateria(mock.pagina), false);
    assert.equal(mock.clicou(), false);
  }
});

test('uma aba lenta não bloqueia as demais; só depois o fluxo muda de aba e analisa', { timeout: 2000 }, async () => {
  const eventos = [];
  let liberarPrimeira;
  const primeiraCarga = new Promise(resolve => { liberarPrimeira = resolve; });
  const carregamentos = new WeakMap();
  let numero = 0;
  const contexto = {
    newPage: async () => {
      const id = ++numero;
      return {
        goto: url => {
          eventos.push(`navegar:${id}`);
          return id === 1 ? primeiraCarga : Promise.resolve();
        },
        bringToFront: async () => eventos.push(`foco:${id}`),
        url: () => materia(id).url,
        locator: () => ({}), getByRole: () => campoSimulado({ waitFor: async () => eventos.push(`pronta:${id}`) })
      };
    }
  };
  const listagem = { bringToFront: async () => eventos.push('listagem') };
  const lote = processarLote([materia(1), materia(2), materia(3)], {
    abrir: m => abrirMateriaEmSegundoPlano(contexto, listagem, m, carregamentos),
    preparar: aba => prepararAbaMateria(aba, carregamentos),
    ler: async aba => {
      eventos.push(`analisar:${aba.url()}`);
      return { temChapeu: false, temImagem: true };
    },
    log: () => {}
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(numero, 3, 'Todas as abas devem abrir enquanto a primeira ainda carrega');
  assert.deepEqual(eventos.slice(0, 6), ['navegar:1', 'listagem', 'navegar:2', 'listagem', 'navegar:3', 'listagem']);
  assert.equal(eventos.some(e => e.startsWith('analisar:')), false);
  liberarPrimeira();
  const resumo = await lote;
  assert.deepEqual(eventos.filter(e => /^(foco|pronta|analisar):/.test(e)), [
    'foco:1', 'pronta:1', `analisar:${materia(1).url}`,
    'foco:2', 'pronta:2', `analisar:${materia(2).url}`,
    'foco:3', 'pronta:3', `analisar:${materia(3).url}`
  ]);
  assert.equal(resumo.pendentes, 3);
});

test('falha de navegação em segundo plano mantém a aba e permite analisar a próxima', async () => {
  const carregamentos = new WeakMap();
  const eventos = [];
  let numero = 0;
  const contexto = {
    newPage: async () => {
      const id = ++numero;
      return {
        goto: async () => { if (id === 1) throw new Error('Falha de conexão'); },
        bringToFront: async () => eventos.push(`foco:${id}`),
        url: () => materia(id).url,
        locator: () => ({}), getByRole: () => campoSimulado({ waitFor: async () => {} }),
        close: async () => eventos.push(`fechar:${id}`)
      };
    }
  };
  const resumo = await processarLote([materia(1), materia(2)], {
    abrir: m => abrirMateriaEmSegundoPlano(contexto, { bringToFront: async () => {} }, m, carregamentos),
    preparar: aba => prepararAbaMateria(aba, carregamentos),
    ler: async aba => {
      eventos.push(`analisar:${aba.url()}`);
      return { temChapeu: false, temImagem: true };
    },
    log: () => {}
  });
  assert.equal(resumo.abertas, 2);
  assert.equal(resumo.erros, 1);
  assert.equal(resumo.pendentes, 2);
  assert.deepEqual(eventos, ['foco:1', 'foco:2', `analisar:${materia(2).url}`]);
});
test('fechar o navegador interrompe o lote sem repetir erros por matéria', async () => {
  let ativo = true;
  let leituras = 0;
  const mensagens = [];
  const resumo = await processarLote([materia(1), materia(2), materia(3)], {
    abrir: async () => ({}),
    ler: async () => {
      leituras++;
      ativo = false;
      throw new Error('Target page, context or browser has been closed');
    },
    ativo: () => ativo,
    log: mensagem => mensagens.push(mensagem)
  });
  assert.equal(leituras, 1);
  assert.equal(resumo.interrompido, true);
  assert.equal(mensagens.filter(m => m.includes('Conferência interrompida')).length, 1);
  assert.equal(mensagens.some(m => m.includes('Target page')), false);
});
