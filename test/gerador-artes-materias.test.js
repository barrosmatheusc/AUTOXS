const { test } = require('node:test');
const assert = require('node:assert/strict');
const { criarGeradorArtesMaterias, enderecoFotoValido, obterFotografia } = require('../gerador-artes-materias');

const urlA = 'https://www.tribunadosertao.com.br/politica/2026/10/25/10001-noticia-a';
const urlB = 'https://www.tribunadosertao.com.br/esportes/2026/10/25/10002-noticia-b';
const foto = 'https://img.dhost.cloud/1280x720/https://tdan.nyc3.digitaloceanspaces.com/images/foto.webp';
const imagemWebp = Buffer.concat([Buffer.from('RIFF0000WEBP'), Buffer.alloc(20)]);

function criarConsulta(opcoes = {}) {
  let candidatos = opcoes.candidatos || [
    { url:urlA, titulo:'Notícia A', chapeu:'POLÍTICA' },
    { url:urlB, titulo:'Notícia B', chapeu:'ESPORTES' }
  ];
  const chamadas = [];
  const compartilhamento = {
    consultarCandidatos:async () => candidatos,
    consultarMateria:async entrada => {
      chamadas.push(entrada.url);
      if (opcoes.falha) return { ok:false, mensagem:'Falha de carregamento da página.' };
      return { ok:true, dados:{ url:entrada.url, tituloPagina:entrada.url === urlA ? 'Notícia A' : 'Notícia B',
        chapeuPublicado:entrada.url === urlA ? 'POLÍTICA' : 'ESPORTES',
        imagemDestaque:opcoes.semFoto ? '' : (opcoes.imagem || foto) } };
    }
  };
  const request = { get:async () => ({ status:()=>200, url:()=>foto,
    headers:()=>({ 'content-type':'image/webp', 'content-length':String(imagemWebp.length) }),
    body:async()=>imagemWebp }) };
  return { gerador:criarGeradorArtesMaterias(compartilhamento, opcoes.request || request),
    chamadas, atualizar:novos => { candidatos = novos; } };
}

test('lista Últimas, atualiza os candidatos e só prepara a matéria escolhida', async () => {
  const { gerador, chamadas, atualizar } = criarConsulta();
  const primeira = await gerador.listar();
  assert.deepEqual(primeira.map(item => item.titulo), ['Notícia A', 'Notícia B']);
  assert.equal(primeira[0].data, '25/10/2026');
  const selecionada = await gerador.preparar(urlB);
  assert.deepEqual(chamadas, [urlB]);
  assert.equal(selecionada.titulo, 'Notícia B');
  assert.equal(selecionada.chapeu, 'ESPORTES');
  assert.match(selecionada.fotoDataUrl, /^data:image\/webp;base64,/);
  atualizar([{ url:urlA, titulo:'Notícia A', chapeu:'POLÍTICA' }]);
  assert.equal((await gerador.listar()).length, 1);
  await assert.rejects(gerador.preparar(urlB), /não está na lista atual/);
});

test('não mistura título, URL ou foto de outra matéria', async () => {
  const { gerador, chamadas } = criarConsulta();
  await gerador.listar();
  await assert.rejects(gerador.preparar('https://www.tribunadosertao.com.br/politica/2026/10/25/10003-outra'), /não está na lista atual/);
  assert.deepEqual(chamadas, []);
  const trocado = criarGeradorArtesMaterias({ consultarCandidatos:async()=>[{url:urlA,titulo:'Notícia A'}],
    consultarMateria:async()=>({ok:true,dados:{url:urlB,tituloPagina:'Notícia B',imagemDestaque:foto}}) },
  { get:async()=>{ throw new Error('Não deve buscar a foto.'); } });
  await trocado.listar();
  await assert.rejects(trocado.preparar(urlA), /não corresponde/);
});

test('sem foto, logo ou falha de imagem mantém texto e pede seleção manual', async () => {
  for (const opcoes of [{semFoto:true},{imagem:'https://cdn.exemplo.com/logo-agenciabrasil.svg'},
    {request:{get:async()=>{ throw new Error('Imagem indisponível.'); }}}]) {
    const {gerador}=criarConsulta(opcoes);
    await gerador.listar();
    const dados=await gerador.preparar(urlA);
    assert.equal(dados.titulo, 'Notícia A');
    assert.equal(dados.chapeu, 'POLÍTICA');
    assert.equal(dados.fotoDataUrl, '');
    assert.match(dados.avisoFoto, /manualmente/);
  }
  assert.equal(enderecoFotoValido('https://cdn.exemplo.com/logo-agenciabrasil.svg'), '');
  assert.equal(enderecoFotoValido('https://tribunadosertao.com.br/img/share.png'), '');
  assert.equal(enderecoFotoValido('https://cdn.exemplo.com/advertisement/banner.jpg'), '');
  assert.equal(enderecoFotoValido('http://localhost/foto.jpg'), '');
});

test('erro da página não importa dados parciais nem busca outra foto', async () => {
  const {gerador,chamadas}=criarConsulta({falha:true});
  await gerador.listar();
  await assert.rejects(gerador.preparar(urlA), /Falha de carregamento/);
  assert.deepEqual(chamadas,[urlA]);
});

test('download recusa redirecionamento e conteúdo que não é fotografia', async () => {
  const resposta = (status, tipo, bytes) => ({status:()=>status,url:()=>foto,
    headers:()=>({'content-type':tipo}),body:async()=>bytes});
  await assert.rejects(obterFotografia({get:async()=>resposta(302,'image/webp',imagemWebp)},foto),/não respondeu/);
  await assert.rejects(obterFotografia({get:async()=>resposta(200,'text/html',Buffer.from('<html>'))},foto),/não é JPG/);
  await assert.rejects(obterFotografia({get:async()=>resposta(200,'image/webp',Buffer.from('<html>'))},foto),/não corresponde/);
});
