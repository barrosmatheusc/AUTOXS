const { test } = require('node:test');
const assert = require('node:assert/strict');
const { conferirCategoriaEsportes } = require('../conferir-esportes');
const { processarLote } = require('../autoxs');

test('futebol, campeonato estadual e outras modalidades não exigem palavra-chave específica', () => {
  for (const dados of [
    { categoria:'Esportes', chapeu:'FUTEBOL', titulo:'Time vence após disputa de pênaltis' },
    { categoria:'Vida Esportiva', chapeu:'ESTADUAL', titulo:'Final do campeonato alagoano termina com virada' },
    { categoria:'Esportes', chapeu:'COMPETIÇÃO', titulo:'Equipe conquista medalha na natação' },
    { categoria:'Esportes', chapeu:'DESTAQUE', titulo:'Clube anuncia nova comissão' },
    { categoria:'Esportes', chapeu:'ESPORTE', titulo:'Atletas disputam torneio de badminton' }
  ]) assert.equal(conferirCategoriaEsportes(dados).revisar, false, dados.titulo);
});

test('Cultura exige categoria explícita; Arqueologia e Astronomia seguem pelo assunto principal', () => {
  for (const dados of [
    { categoria:'Arqueologia', chapeu:'PESQUISA', titulo:'Estudo revela nova descoberta' },
    { categoria:'Ciência', chapeu:'ASTRONOMIA', titulo:'Estudo revela nova descoberta' },
    { categoria:'Ciência', chapeu:'DESCOBERTA', titulo:'Telescópio registra nova galáxia' },
    { categoria:'Cultura', chapeu:'AGENDA', titulo:'Programação é divulgada' }
  ]) assert.equal(conferirCategoriaEsportes(dados).revisar, true, dados.titulo);
});

test('menções vagas e outros assuntos não bloqueiam a publicação automática', () => {
  for (const dados of [
    { categoria:'Esportes', chapeu:'FUTEBOL', titulo:'Estrela do time marca na final' },
    { categoria:'Esportes', chapeu:'COPA', titulo:'Equipe abre espaço para novos atletas' },
    { categoria:'Esportes', chapeu:'TORNEIO', titulo:'Campeonato promove a cultura da paz' },
    { categoria:'Esportes', chapeu:'CULTURA ESPORTIVA', titulo:'Clube lança novo projeto' },
    { categoria:'Geral', chapeu:'CULTURA', titulo:'Cultura organizacional ganha espaço nas empresas' },
    { categoria:'Geral', chapeu:'AGENDA', titulo:'Festival cultural anuncia atrações' },
    { categoria:'Turismo', chapeu:'LAZER', titulo:'Evento cultural movimenta cidade' },
    { categoria:'Educação', chapeu:'ESCOLA', titulo:'Estudantes participam de atividades culturais' },
    { categoria:'Gastronomia', chapeu:'RECEITAS', titulo:'Restaurante apresenta novo cardápio' },
    { categoria:'Política', chapeu:'INTERNACIONAL', titulo:'Governos discutem acordo após conflito' },
    { categoria:'Geral', chapeu:'ASTROLOGIA', titulo:'Horóscopo desta semana' }
  ]) assert.equal(conferirCategoriaEsportes(dados).revisar, false, dados.titulo);
});

test('menção incidental a astronomia ou arqueologia em notícia esportiva não bloqueia', () => {
  for (const titulo of [
    'Jogo de futebol é interrompido por eclipse solar',
    'Atleta visita sítio arqueológico após competição'
  ]) assert.equal(conferirCategoriaEsportes({ categoria:'Esportes', chapeu:'ESPORTE', titulo }).revisar, false);
});

test('Esportes é liberado por padrão, inclusive sem palavras esportivas no título', () => {
  for (const titulo of [
    'Equipe de basquete conquista campeonato',
    'Prefeitura realiza torneio esportivo em escola',
    'Novos talentos entram em campo nesta semana'
  ]) assert.equal(conferirCategoriaEsportes({ categoria:'Esportes', chapeu:'DESTAQUE', titulo }).revisar, false, titulo);
});

test('assunto principal inequívoco em Esportes pede mudança para Geral', () => {
  for (const [titulo, assunto] of [
    ['Observatório registra descoberta de novo planeta', 'astronomia'],
    ['Pesquisadores encontram artefatos em escavação arqueológica', 'arqueologia'],
    ['Festival de teatro anuncia programação cultural', 'cultura'],
    ['Exposição de arte reúne artistas da região', 'cultura']
  ]) {
    const resultado = conferirCategoriaEsportes({ categoria:'Esportes', chapeu:'DESTAQUE', titulo });
    assert.equal(resultado.revisar, false, titulo);
    assert.equal(resultado.categoriaDestino, 'Geral');
    assert.match(resultado.mensagem, new RegExp(assunto));
  }
});

test('menções culturais incidentais em manchetes esportivas não bloqueiam', () => {
  for (const titulo of [
    'Campeonato de futebol é realizado durante festival cultural',
    'Atletas participam de evento de integração cultural',
    'Clube promove cultura de paz entre torcedores',
    'Cultura esportiva aproxima jovens da prática de basquete'
  ]) assert.equal(conferirCategoriaEsportes({ categoria:'Esportes', chapeu:'CULTURA', titulo,
    conteudo:'O clube promove torneios e reúne atletas da cidade.' }).revisar, false, titulo);
});

test('chapéu e contexto ajudam a distinguir Cultura de esporte e dúvida concreta', () => {
  const cultural = conferirCategoriaEsportes({ categoria:'Esportes', chapeu:'CULTURA',
    titulo:'Programação é anunciada', subtitulo:'Festival de teatro apresenta novas peças' });
  assert.equal(cultural.revisar, false);
  assert.equal(cultural.categoriaDestino, 'Geral');
  assert.match(cultural.mensagem, /cultura/);
  const esportiva = conferirCategoriaEsportes({ categoria:'Esportes', chapeu:'CULTURA',
    titulo:'Programação é anunciada', conteudo:'Torneio de basquete reúne atletas e equipes de escolas.' });
  assert.equal(esportiva.revisar, false);
  const duvida = conferirCategoriaEsportes({ categoria:'Esportes', chapeu:'CULTURA', titulo:'Programação é anunciada' });
  assert.equal(duvida.revisar, true);
  assert.match(duvida.mensagem, /inconclusivo/);
  const conflito = conferirCategoriaEsportes({ categoria:'Esportes', chapeu:'DESTAQUE', titulo:'Programação é anunciada',
    conteudo:'Festival de teatro terá atrações. Atletas participam de torneio.' });
  assert.equal(conflito.revisar, true);
  assert.match(conflito.mensagem, /junto de sinais esportivos/);
});

test('o lote só envia automaticamente matéria completa e sem assunto restrito', async () => {
  let envios = 0, acompanhamentos = 0;
  const materia = { titulo:'Telescópio registra nova galáxia', url:'https://cms.test/news/edit/1' };
  const criarOperacoes = (estado) => ({
    ativo:()=>true, log:async()=>{}, abrir:async()=>({ close:async()=>{} }),
    preparar:async()=>{}, ler:async()=>({
      temChapeu:estado.temChapeu, temImagem:estado.temImagem,
      conferenciaCategoria:conferirCategoriaEsportes({ categoria:estado.categoria, chapeu:'CIÊNCIA', titulo:materia.titulo })
    }),
    enviar:async()=>{ envios++; return true; },
    acompanhar:async()=>{ acompanhamentos++; }
  });
  const restrita = await processarLote([materia], criarOperacoes({ temChapeu:true, temImagem:true, categoria:'Ciência' }));
  assert.equal(restrita.enviadas, 0);
  assert.equal(restrita.pendentes, 1);
  assert.equal(envios, 0);
  assert.equal(acompanhamentos, 1);

  const esporte = { titulo:'Clube anuncia nova comissão', url:'https://cms.test/news/edit/2' };
  const operacoes = criarOperacoes({ temChapeu:true, temImagem:true, categoria:'Esportes' });
  operacoes.ler = async()=>({ temChapeu:true, temImagem:true,
    conferenciaCategoria:conferirCategoriaEsportes({ categoria:'Esportes', chapeu:'DESTAQUE', titulo:esporte.titulo }) });
  const liberada = await processarLote([esporte], operacoes);
  assert.equal(liberada.enviadas, 1);
  assert.equal(envios, 1);

  operacoes.ler = async()=>({ temChapeu:true, temImagem:false,
    conferenciaCategoria:conferirCategoriaEsportes({ categoria:'Esportes', chapeu:'DESTAQUE', titulo:esporte.titulo }) });
  operacoes.pesquisar = async()=>'';
  const semFoto = await processarLote([esporte], operacoes);
  assert.equal(semFoto.enviadas, 0);
  assert.equal(envios, 1);

  operacoes.ler = async()=>({ temChapeu:false, temImagem:true,
    conferenciaCategoria:conferirCategoriaEsportes({ categoria:'Esportes', chapeu:'', titulo:esporte.titulo }) });
  const semChapeu = await processarLote([esporte], operacoes);
  assert.equal(semChapeu.enviadas, 0);
  assert.equal(envios, 1);
});
