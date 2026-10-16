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

test('somente os três assuntos restritos exigem revisão em qualquer categoria', () => {
  for (const dados of [
    { categoria:'Arqueologia', chapeu:'PESQUISA', titulo:'Estudo revela nova descoberta' },
    { categoria:'Ciência', chapeu:'ASTRONOMIA', titulo:'Estudo revela nova descoberta' },
    { categoria:'Esportes', chapeu:'DESCOBERTA', titulo:'Escavação arqueológica revela sítio antigo' },
    { categoria:'Ciência', chapeu:'DESCOBERTA', titulo:'Telescópio registra nova galáxia' },
    { categoria:'Cultura', chapeu:'AGENDA', titulo:'Programação é divulgada' },
    { categoria:'Geral', chapeu:'AGENDA', titulo:'Festival cultural anuncia atrações' },
    { categoria:'Esportes', chapeu:'AGENDA', titulo:'Festival de cinema anuncia atrações' }
  ]) assert.equal(conferirCategoriaEsportes(dados).revisar, true, dados.titulo);
});

test('menções vagas e outros assuntos não bloqueiam a publicação automática', () => {
  for (const dados of [
    { categoria:'Esportes', chapeu:'FUTEBOL', titulo:'Estrela do time marca na final' },
    { categoria:'Esportes', chapeu:'COPA', titulo:'Equipe abre espaço para novos atletas' },
    { categoria:'Esportes', chapeu:'TORNEIO', titulo:'Campeonato promove a cultura da paz' },
    { categoria:'Gastronomia', chapeu:'RECEITAS', titulo:'Restaurante apresenta novo cardápio' },
    { categoria:'Política', chapeu:'INTERNACIONAL', titulo:'Governos discutem acordo após conflito' },
    { categoria:'Geral', chapeu:'ASTROLOGIA', titulo:'Horóscopo desta semana' }
  ]) assert.equal(conferirCategoriaEsportes(dados).revisar, false, dados.titulo);
});

test('assunto esportivo misturado com astronomia ou arqueologia fica pendente', () => {
  for (const titulo of [
    'Jogo de futebol é interrompido por eclipse solar',
    'Atleta visita sítio arqueológico após competição'
  ]) assert.equal(conferirCategoriaEsportes({ categoria:'Esportes', chapeu:'ESPORTE', titulo }).revisar, true);
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
