const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { coletarMaterias, percorrerFilaAteReferencia, processarFilaEmGrupos, aguardarVagasAtualizacao } = require('../autoxs');
const { selecionarPaginaListagem, avancarPaginaListagem, aguardarTabelaListagem } = require('../pagina-listagem');

let browser;
before(async () => { browser = await chromium.launch({ channel:'msedge', headless:true }); });
after(async () => { await browser?.close(); });

const referencia = 'Quanto foi o jogo Brasil x Japão hoje? Veja resultado dos gols';
const item = (numero, titulo = `Matéria ${numero}`) => ({ titulo,
  url:`/news/edit/${numero}`, data:'19/10/2026 10:00' });

async function listagemLocal(paginas) {
  const contexto = await browser.newContext();
  await contexto.route('https://redacao.tribunaweb.com.br/news', rota => rota.fulfill({ contentType:'text/html; charset=utf-8', body:`
    <table><tbody id="linhas"></tbody></table><nav class="pagination" aria-label="Paginação"></nav>
    <script>
      const paginas = ${JSON.stringify(paginas)};
      let numero = 1;
      function renderizar() {
        document.querySelector('#linhas').innerHTML = paginas[numero - 1].map(item =>
          '<tr>' + '<td></td>'.repeat(7) + '<td>' + item.titulo + '</td><td></td><td>' + item.data +
          '</td><td><a href="' + item.url + '">Editar</a></td></tr>').join('');
        document.querySelector('.pagination').innerHTML = paginas.map((_, i) =>
          i + 1 === numero ? '<span aria-current="page">' + (i + 1) + '</span>' :
          '<button type="button" data-page="' + (i + 1) + '">' + (i + 1) + '</button>').join('') +
          (numero < paginas.length ? '<button type="button" data-page="' + (numero + 1) + '" aria-label="Próximo">Próximo</button>' :
          '<button type="button" disabled aria-label="Próximo">Próximo</button>');
      }
      document.querySelector('.pagination').addEventListener('click', event => {
        const destino = Number(event.target.dataset.page);
        if (destino) setTimeout(() => { numero = destino; renderizar(); }, 35);
      });
      renderizar();
    </script>` }));
  const pagina = await contexto.newPage();
  await pagina.goto('https://redacao.tribunaweb.com.br/news');
  return { contexto, pagina };
}

async function percorrerPagina(pagina, opcoes = {}) {
  return percorrerFilaAteReferencia({ paginaInicial:opcoes.paginaInicial || 1,
    ativo:opcoes.ativo || (() => true), progresso:opcoes.progresso,
    lerPagina:async () => {
      await aguardarTabelaListagem(pagina);
      const estado = {};
      return { materias:await coletarMaterias(pagina, estado), estado };
    },
    avancar:numero => avancarPaginaListagem(pagina, numero) });
}

test('25 registros por página não encerram a busca antes de Brasil x Japão', async () => {
  const mock = await listagemLocal([
    Array.from({ length:25 }, (_, i) => item(i + 1)),
    Array.from({ length:7 }, (_, i) => item(i + 26)),
    [item(33), item(34, referencia), item(35)]
  ]);
  try {
    const mensagens = [];
    const resultado = await percorrerPagina(mock.pagina, { progresso:texto=>mensagens.push(texto) });
    assert.equal(resultado.limiteEncontrado, true);
    assert.equal(resultado.paginas, 3);
    assert.equal(resultado.registros, 34);
    assert.equal(resultado.materias.length, 33);
    assert.equal(resultado.materias.some(m => m.titulo === referencia), false);
    assert.ok(mensagens.some(m => m.includes('Página 2: 7 registros')));
  } finally { await mock.contexto.close(); }
});

test('página inicial 2 continua à seguinte e evita duplicata entre páginas', async () => {
  const mock = await listagemLocal([[item(1)], [item(2), item(3)], [item(3), item(4, referencia)]]);
  try {
    await selecionarPaginaListagem(mock.pagina, 2);
    const resultado = await percorrerPagina(mock.pagina, { paginaInicial:2 });
    assert.deepEqual(resultado.materias.map(m => m.titulo), ['Matéria 2', 'Matéria 3']);
    assert.equal(resultado.duplicadas, 1);
    assert.equal(resultado.limiteEncontrado, true);
  } finally { await mock.contexto.close(); }
});

test('referência na primeira página impede navegar; ausência informa a última examinada', async () => {
  const primeiro = await listagemLocal([[item(1), item(2, referencia)], [item(3)]]);
  try {
    const resultado = await percorrerPagina(primeiro.pagina);
    assert.equal(resultado.paginas, 1);
    assert.deepEqual(resultado.materias.map(m => m.titulo), ['Matéria 1']);
  } finally { await primeiro.contexto.close(); }
  const ausente = await listagemLocal([[item(1)], [item(2)]]);
  try {
    const resultado = await percorrerPagina(ausente.pagina);
    assert.equal(resultado.limiteEncontrado, false);
    assert.equal(resultado.ultimaMateria, 'Matéria 2');
    assert.equal(resultado.paginas, 2);
  } finally { await ausente.contexto.close(); }
});

test('notícia parecida sobre Brasil x Japão não se confunde com a referência exata', async () => {
  const parecida = referencia + ' — análise';
  const mock = await listagemLocal([[item(1, parecida)], [item(2, referencia)]]);
  try {
    const resultado = await percorrerPagina(mock.pagina);
    assert.equal(resultado.limiteEncontrado, true);
    assert.equal(resultado.paginas, 2);
    assert.deepEqual(resultado.materias.map(m => m.titulo), [parecida]);
  } finally { await mock.contexto.close(); }
});

test('erro de navegação e cancelamento não declaram o limite encontrado', async () => {
  const leitura = async () => ({ materias:[{ url:'u1', titulo:'Uma' }],
    estado:{ registros:1, ignoradas:[], ultimaMateria:'Uma', limiteEncontrado:false } });
  const falha = await percorrerFilaAteReferencia({ lerPagina:leitura,
    avancar:async () => { throw new Error('AJAX não atualizou a tabela'); } });
  assert.equal(falha.paginas, 1);
  assert.match(falha.erroBusca, /AJAX não atualizou/);
  assert.equal(falha.limiteEncontrado, false);
  let ativo = true;
  const cancelado = await percorrerFilaAteReferencia({ ativo:() => ativo,
    lerPagina:leitura, avancar:async () => { ativo = false; return true; } });
  assert.equal(cancelado.interrompido, true);
  assert.equal(cancelado.limiteEncontrado, false);
});

test('três abas por grupo; após a liberação continua além da terceira matéria', async () => {
  const materias = Array.from({length:8}, (_, i) => item(i + 1));
  let simultaneas = 0, pico = 0, vagas = 3;
  const processadas = [];
  const resumo = await processarFilaEmGrupos(materias, {
    ativo:() => true,
    abrir:async materia => {
      simultaneas++; pico = Math.max(pico, simultaneas);
      processadas.push(materia.titulo);
      return { close:async () => { simultaneas--; }, isClosed:() => false };
    },
    ler:async () => ({ temChapeu:true, temImagem:true }), enviar:async () => true, log:async () => {}
  }, async () => vagas);
  assert.equal(pico, 3);
  assert.equal(resumo.processadas, 8);
  assert.equal(resumo.enviadas, 8);
  assert.equal(processadas.at(-1), 'Matéria 8');
});

test('três pendências aguardam uma vaga; fechamento e cancelamento são respeitados', async () => {
  let abertas = 3, esperas = 0;
  const vagas = await aguardarVagasAtualizacao({ listarAbertas:() => abertas,
    ativo:() => true, esperar:async () => { esperas++; abertas = 2; } });
  assert.equal(vagas, 1);
  assert.equal(esperas, 1);
  let ativo = true;
  const canceladas = await aguardarVagasAtualizacao({ listarAbertas:() => 3,
    ativo:() => ativo, esperar:async () => { ativo = false; } });
  assert.equal(canceladas, 0);
});

test('contagens distinguem matéria elegível de aberta e processada', async () => {
  const resumo = await processarFilaEmGrupos([item(1), item(2)], {
    ativo:() => true, log:async () => {},
    abrir:async materia => {
      if (materia.titulo === 'Matéria 1') throw new Error('aba indisponível');
      return { close:async () => {} };
    },
    ler:async () => ({ temChapeu:true, temImagem:true }), enviar:async () => true
  }, async () => 3);
  assert.equal(resumo.abertas, 1);
  assert.equal(resumo.processadas, 1);
  assert.equal(resumo.enviadas, 1);
  assert.equal(resumo.erros, 1);
});
