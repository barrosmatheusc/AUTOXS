const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { criarCapturaMaterias, separarMensagens } = require('../captura-materias');

const png = Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]).toString('base64');
async function local(t) {
  const pasta = await fs.mkdtemp(path.join(os.tmpdir(),'autoxs-captura-'));
  t.after(() => fs.rm(pasta,{recursive:true,force:true}));
  return { pasta, central:criarCapturaMaterias(pasta) };
}
const receber = (central,texto,fotos=[]) => central.receber({metodo:'colar',texto,origem:'Teste fictício',fotos});

test('matéria completa conserva original e organiza campos sem serviço externo',async t=>{
  const {central}=await local(t);
  const original='Título: Ponte nova é inaugurada\nChapéu: OBRAS\nSubtítulo: Estrutura liga bairros\nRedação: A ponte foi aberta nesta terça-feira.';
  await receber(central,original);
  assert.equal((await central.organizar()).criados,1);
  const dados=await central.listar();
  assert.equal(dados.mensagens[0].textoOriginal,original);
  assert.match(dados.rascunhos[0].campos.titulo,/Ponte nova/);
  assert.match(dados.rascunhos[0].campos.redacao,/ponte foi aberta/);
});

test('cópia de mensagens WhatsApp preserva horário, remetente e ordem original',async t=>{
  const {central}=await local(t);
  const texto='[09:00, 03/11/2026] Redação: Chapéu: CIDADE\n[09:01, 03/11/2026] Redação: Título: Rua é reaberta\n[09:02, 03/11/2026] Redação: Redação: Obras terminaram hoje.';
  assert.equal(separarMensagens(texto,new Date()).length,3);
  await receber(central,texto);
  const dados=await central.listar();
  assert.equal(dados.mensagens.length,3);
  assert.equal(dados.mensagens[1].remetente,'Redação');
  assert.match(dados.mensagens[2].texto,/Obras terminaram/);
  await central.organizar();
  const grupo=(await central.listar()).rascunhos[0];
  assert.equal(grupo.ambiguo,true);
});

test('duas notícias consecutivas rotuladas viram rascunhos separados',async t=>{
  const {central}=await local(t);
  await receber(central,'[09:00, 03/11/2026] A: Título: Primeira notícia\n[09:01, 03/11/2026] A: Redação: Primeiro texto.\n[09:02, 03/11/2026] A: Título: Segunda notícia\n[09:03, 03/11/2026] A: Redação: Segundo texto.');
  assert.equal((await central.organizar()).criados,2);
});

test('duas notícias coladas sem cabeçalho são separadas por novos títulos explícitos',async t=>{
  const {central}=await local(t);
  await receber(central,'Título: Primeira notícia\nRedação: Primeiro texto.\n\nTítulo: Segunda notícia\nRedação: Segundo texto.');
  assert.equal((await central.listar()).mensagens.length,2);
  assert.equal((await central.organizar()).criados,2);
});

test('várias fotos persistem e exigem escolha humana',async t=>{
  const {central,pasta}=await local(t);
  await receber(central,'Título: Foto da cidade\nRedação: Uma reportagem fictícia.',[
    {nome:'a.png',dados:png},{nome:'b.png',dados:png}]);
  await central.organizar();
  const dados=await central.listar(), r=dados.rascunhos[0];
  assert.equal(r.ambiguo,true);
  assert.equal(dados.mensagens[0].fotos.length,2);
  assert.match(await central.obterFoto(dados.mensagens[0].fotos[0].id),/^data:image\/png;base64,/);
  assert.equal((await criarCapturaMaterias(pasta).listar()).mensagens[0].fotos.length,2);
});

test('fotos de lote com duas notícias não são atribuídas por suposição',async t=>{
  const {central}=await local(t);
  await receber(central,'Título: Primeira\nRedação: Texto um.\nTítulo: Segunda\nRedação: Texto dois.',[{nome:'sem-associacao.png',dados:png}]);
  const dados=await central.listar();
  assert.equal(dados.mensagens.length,3);
  assert.equal(dados.mensagens[2].fotos.length,1);
  await central.organizar();
  const rascunhos=(await central.listar()).rascunhos;
  assert.equal(rascunhos.length,2);
  assert.equal(rascunhos.every(item=>item.fotoId===null),true);
  await central.associarFoto(rascunhos[1].id,dados.mensagens[2].fotos[0].id);
  assert.equal((await central.listar()).rascunhos[1].fotoId,dados.mensagens[2].fotos[0].id);
});

test('mensagem repetida é sinalizada, não incorporada silenciosamente',async t=>{
  const {central}=await local(t);
  await receber(central,'Título: Repetida\nRedação: Texto igual.');
  await receber(central,'Título: Repetida\nRedação: Texto igual.');
  await central.organizar();
  const dados=await central.listar();
  assert.equal(dados.mensagens.length,2);
  assert.equal(dados.rascunhos.some(r=>r.ambiguo),true);
});

test('rótulo desconhecido fica sinalizado para revisão sem inventar campo',async t=>{
  const {central}=await local(t);
  await receber(central,'Título: Notícia fictícia\nBairro: Centro\nRedação: Texto confirmado.');
  await central.organizar();
  const r=(await central.listar()).rascunhos[0];
  assert.deepEqual(r.rotulosDesconhecidos,['Bairro']);
  assert.equal(r.ambiguo,true);
});

test('campos ausentes, correção manual, aprovação e divisão de mensagens',async t=>{
  const {central}=await local(t);
  await receber(central,'[09:00, 03/11/2026] A: Chapéu: BAIRROS\n[09:01, 03/11/2026] A: Redação: Obra segue em andamento.');
  await central.organizar();
  let dados=await central.listar(); let r=dados.rascunhos[0];
  await assert.rejects(central.aprovar(r.id),/Confirme|Título/);
  await central.separar(r.id,r.mensagemIds[1]);
  dados=await central.listar(); assert.equal(dados.rascunhos.length,2);
  r=dados.rascunhos[0];
  await central.atualizar(r.id,{titulo:'Obra em bairro',redacao:'Obra segue em andamento.'});
  await central.confirmarGrupo(r.id);
  assert.equal((await central.aprovar(r.id)).status,'aprovado');
  assert.equal((await central.marcarEncaminhado(r.id)).status,'encaminhado');
});

test('backup recupera estado corrompido sem apagar arquivo original',async t=>{
  const {central,pasta}=await local(t);
  await receber(central,'Título: Antes\nRedação: Primeiro texto.');
  await receber(central,'Título: Depois\nRedação: Segundo texto.');
  await fs.writeFile(path.join(pasta,'estado.json'),'{incompleto','utf8');
  const recuperado=await criarCapturaMaterias(pasta).listar();
  assert.ok(recuperado.avisoRecuperacao);
  assert.ok(recuperado.mensagens.length>=1);
  assert.ok((await fs.readdir(pasta)).some(nome=>nome.startsWith('estado-corrompido-')));
});

test('sem backup válido, corrupção não é sobrescrita',async t=>{
  const {central,pasta}=await local(t);
  await fs.writeFile(path.join(pasta,'estado.json'),'{quebrado','utf8');
  await assert.rejects(central.listar(),/corrompida/);
  assert.equal(await fs.readFile(path.join(pasta,'estado.json'),'utf8'),'{quebrado');
});
