const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { criarHistoricoProducao } = require('../historico-producao');
const { validarUrlMateria, buscarInformacoes, buscarInformacoesNaListagem, ipPublico } = require('../links-manuais');

const url = 'https://www.tribunadosertao.com.br/politica/2026/10/22/12345-noticia-teste';
const cabecalho = '<main><header class="news-header"><h1 class="news-header__title">Título &amp; notícia</h1>';
const fim = '<div class="info">Autoria e data</div></header><article><p>Primeiro parágrafo do corpo.</p></article></main>';
const resposta = html => async () => ({ status:200, contentType:'text/html; charset=utf-8', html });

test('extrai título, chapéu e subtítulo editoriais sem executar scripts externos', async () => {
  const html = `<meta property="article:section" content="Política"><script>document.write('<h1>Falso</h1>')</script>`+
    `${cabecalho}<a rel="category">ELEIÇÕES</a><p class="news-header__excerpt">Linha fina visível.</p>${fim}`;
  const dados = await buscarInformacoes(url, resposta(html));
  assert.deepEqual(dados, { titulo:'Título & notícia', chapeu:'ELEIÇÕES', subtitulo:'Linha fina visível.', url });
});

test('usa categoria principal quando não há chapéu editorial', async () => {
  const dados = await buscarInformacoes(url, resposta('<meta property="article:section" content="Política">'+cabecalho+fim));
  assert.equal(dados.chapeu, 'POLÍTICA');
  assert.equal(dados.subtitulo, '');
});

test('categoria genérica e descrição SEO não viram chapéu ou subtítulo', async () => {
  const dados = await buscarInformacoes(url, resposta('<meta property="article:section" content="Geral">'+
    '<meta name="description" content="Notícias de Alagoas, do Brasil e do mundo">'+cabecalho+fim));
  assert.equal(dados.chapeu, '');
  assert.equal(dados.subtitulo, '');
});

test('falha de acesso e título ambíguo deixam a edição manual disponível', async () => {
  await assert.rejects(buscarInformacoes(url, async () => { throw new Error('sem rede'); }), /Não foi possível acessar/);
  await assert.rejects(buscarInformacoes(url, resposta('<main><p>Sem título editorial</p></main>')), /Título editorial/);
});

test('URL restringe domínio, credenciais, IP e redirecionamento; resposta tem limite', async () => {
  for (const destino of ['http://127.0.0.1/politica/2026/10/22/1-a',
    'https://www.tribunadosertao.com.br.evil.test/politica/2026/10/22/1-a',
    'https://usuario:senha@www.tribunadosertao.com.br/politica/2026/10/22/1-a',
    'https://www.tribunadosertao.com.br/news/edit/1']) {
    assert.throws(() => validarUrlMateria(destino));
  }
  assert.equal(ipPublico('127.0.0.1'), false);
  assert.equal(ipPublico('192.168.1.1'), false);
  assert.equal(ipPublico('8.8.8.8'), true);
  await assert.rejects(buscarInformacoes(url, async () => ({ status:302, location:'http://127.0.0.1/', contentType:'text/html' })), /Somente links públicos/);
  await assert.rejects(buscarInformacoes(url, resposta('x'.repeat(1024 * 1024 + 1))), /limite de tamanho/);
});

function compartilharSimulado(paginas, dados = { titulo:'Título & notícia', chapeu:'ELEIÇÕES', subtitulo:'Linha fina visível.' }) {
  const progresso = [];
  let leitura = 0;
  return { progresso, get leitura() { return leitura; },
    consultarMateria:async () => { leitura++; return { ok:true, dados }; },
    consultarPaginas:async ({ limitePaginas, sinal, progresso:avisar, pararQuando }) => {
      const candidatos = [];
      for (let pagina = 0; pagina < Math.min(paginas.length, limitePaginas); pagina++) {
        if (sinal?.aborted) return { candidatos:[], cancelado:true, paginasVisitadas:pagina };
        const mensagem=`Procurando na página ${pagina + 1}`;
        progresso.push(mensagem); await avisar?.(mensagem);
        candidatos.push(...paginas[pagina]);
        if (pararQuando(paginas[pagina], candidatos)) return { candidatos, paginasVisitadas:pagina + 1 };
      }
      return { candidatos, paginasVisitadas:Math.min(paginas.length, limitePaginas),
        limiteAtingido:paginas.length > limitePaginas };
    } };
}

test('busca manual reutiliza a leitura editorial e confirma título e URL na primeira página', async () => {
  const fonte = compartilharSimulado([[{ url, titulo:'Titulo & noticia' }]]);
  const dados = await buscarInformacoesNaListagem(url, fonte);
  assert.deepEqual(dados, { url, titulo:'Título & notícia', chapeu:'ELEIÇÕES', subtitulo:'Linha fina visível.' });
  assert.equal(fonte.leitura, 1);
  assert.deepEqual(fonte.progresso, ['Procurando na página 1']);
});

test('chapéu editorial prevalece; chapéu da listagem só preenche campo ausente', async () => {
  const candidato = [{ url, titulo:'Título & notícia', chapeu:'CATEGORIA DA LISTAGEM' }];
  assert.equal((await buscarInformacoesNaListagem(url, compartilharSimulado([candidato]))).chapeu, 'ELEIÇÕES');
  const semChapeu = compartilharSimulado([candidato], { titulo:'Título & notícia', chapeu:'', subtitulo:'' });
  const dados = await buscarInformacoesNaListagem(url, semChapeu);
  assert.equal(dados.chapeu, 'CATEGORIA DA LISTAGEM');
  assert.equal(dados.subtitulo, '');
});

test('busca nas páginas seguintes sem aceitar título semelhante ou URL diferente', async () => {
  const outra = 'https://www.tribunadosertao.com.br/politica/2026/10/22/99999-outra-noticia';
  const fonte = compartilharSimulado([
    [{ url:outra, titulo:'Título & notícia' }, { url, titulo:'Título & notícia hoje' }],
    [{ url, titulo:'Título & notícia' }]
  ]);
  const dados = await buscarInformacoesNaListagem(url, fonte);
  assert.equal(dados.aviso, undefined);
  assert.deepEqual(fonte.progresso, ['Procurando na página 1', 'Procurando na página 2']);
  const naoEncontrada = await buscarInformacoesNaListagem(url, compartilharSimulado([
    [{ url:outra, titulo:'Título & notícia' }, { url, titulo:'Título & notícia hoje' }]
  ]));
  assert.match(naoEncontrada.aviso, /Título e URL não correspondem/);
  assert.equal(naoEncontrada.titulo, 'Título & notícia');
});

test('falhas da listagem e ausência de subtítulo preservam dados para preenchimento manual', async () => {
  const semSubtitulo = compartilharSimulado([[]], { titulo:'Título & notícia', chapeu:'POLÍTICA', subtitulo:'' });
  const parcial = await buscarInformacoesNaListagem(url, semSubtitulo);
  assert.equal(parcial.subtitulo, '');
  assert.equal(parcial.chapeu, 'POLÍTICA');
  assert.match(parcial.aviso, /não encontrada/i);
  const erro = await buscarInformacoesNaListagem(url, {
    consultarMateria:async () => ({ ok:true, dados:{ titulo:'Título & notícia', chapeu:'POLÍTICA' } }),
    consultarPaginas:async () => { throw new Error('listagem indisponível'); }
  });
  assert.match(erro.aviso, /Últimas: listagem indisponível/);
  const semTitulo = await buscarInformacoesNaListagem(url, {
    consultarMateria:async () => ({ ok:false, mensagem:'página indisponível' }), consultarPaginas:async () => { throw Error('não deveria consultar'); }
  });
  assert.match(semTitulo.aviso, /extrair o título/);
});

test('limite e cancelamento impedem nova navegação e resultado tardio', async () => {
  const fonte = compartilharSimulado([[], [], []]);
  const dados = await buscarInformacoesNaListagem(url, fonte, { limitePaginas:2 });
  assert.deepEqual(fonte.progresso, ['Procurando na página 1', 'Procurando na página 2']);
  assert.match(dados.aviso, /limite de 2 páginas/);
  const controlador = new AbortController();
  await assert.rejects(buscarInformacoesNaListagem(url, compartilharSimulado([[{ url, titulo:'Título & notícia' }]]), {
    sinal:controlador.signal, progresso:() => controlador.abort()
  }), /Busca cancelada/);
});

test('registro manual exige redator, confirmação pelo método de inclusão e URL única', async () => {
  const pasta = await fs.mkdtemp(path.join(os.tmpdir(), 'autoxs-link-manual-'));
  const arquivo = path.join(pasta, 'historico.json');
  const relogio = () => new Date('2026-10-22T15:00:00Z');
  const historico = criarHistoricoProducao(arquivo, relogio);
  try {
    const dados = await buscarInformacoes(url, resposta(cabecalho+fim));
    assert.equal((await historico.consultar('2026-10-22')).compartilh.length, 0);
    await assert.rejects(historico.adicionarLinkManual(dados), /Selecione um redator/);
    await assert.rejects(historico.adicionarLinkManual({ ...dados, enviadoPorId:'inicial-4' }), /Selecione um redator/);
    const incluido = await historico.adicionarLinkManual({ ...dados, chapeu:'POLÍTICA', subtitulo:'Linha fina.', enviadoPorId:'inicial-2' });
    assert.equal(incluido.origem, 'manual');
    assert.equal(incluido.enviadoPor, 'Cinara');
    assert.equal(incluido.enviadoPorId, 'inicial-2');
    assert.equal(incluido.concluidoEm, '2026-10-22T15:00:00.000Z');
    const reaberto = criarHistoricoProducao(arquivo, relogio);
    const consulta = await reaberto.consultar('2026-10-22');
    assert.equal(consulta.compartilh.length, 1);
    assert.equal(consulta.compartilh[0].enviadoPor, 'Cinara');
    assert.equal(consulta.estatisticas.adicionadas, 0); // Não foi publicada pelo AutoXS.
    assert.equal(await reaberto.compartilhavel(incluido.id), '*POLÍTICA*\n\n*Título & notícia*\n\n*_Linha fina._*\n\n'+url);
    await assert.rejects(reaberto.adicionarLinkManual({ ...dados, enviadoPorId:'inicial-1', url:url+'?utm_source=grupo' }), /já está/);
    const automatico = await reaberto.registrar({ operacao:'adicionar', chave:'cms-1', titulo:'Outra matéria',
      situacao:'concluido', formaConclusao:'manual', urlOriginal:'https://www.tribunadosertao.com.br/cidades/2026/10/22/99-outra' });
    await assert.rejects(reaberto.adicionarLinkManual({ ...dados, enviadoPorId:'inicial-1', url:automatico.urlOriginal }), /já está/);
    assert.equal((await reaberto.consultar('2026-10-22')).compartilh.length, 2);
    assert.equal((await reaberto.relatorio('2026-10-22')).semResponsavel.length, 2);
    await reaberto.responsavel(incluido.id, 'inicial-1');
    const relatorio = await reaberto.relatorio('2026-10-22');
    assert.match(relatorio.texto, /LINKS VLADIMIR\n\nhttps:\/\/www\.tribunadosertao\.com\.br/);
    assert.doesNotMatch(relatorio.texto, /Cinara/);
    assert.equal((await reaberto.materiasPorResponsavel('2026-10-22')).dia.total, 1);
    const arquivoAntigo = JSON.parse(await fs.readFile(arquivo, 'utf8'));
    const registroAntigo = arquivoAntigo.registros.find(item => item.id === incluido.id);
    registroAntigo.enviadoPor = 'Redatora de registro anterior';
    delete registroAntigo.enviadoPorId;
    await fs.writeFile(arquivo, JSON.stringify(arquivoAntigo));
    assert.equal((await reaberto.consultar('2026-10-22')).compartilh.find(item => item.id === incluido.id).enviadoPor,
      'Redatora de registro anterior');
  } finally { await fs.rm(pasta, { recursive:true, force:true }); }
});
