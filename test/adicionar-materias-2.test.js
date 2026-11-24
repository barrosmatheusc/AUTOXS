const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {identificarMateria}=require('../identificar-materia');
const {separarMensagens,criarCapturaMaterias}=require('../captura-materias');
const {buscarFotoLocal}=require('../foto-local');

const radar=(n,titulo,imagem)=>`INÍCIO DA MATÉRIA ${n}\n### TÍTULO\n${titulo}\n### CHAPÉU\nGERAL\n### BIGODE\nSubtítulo da matéria ${n}.\n### TEXTO\nCorpo editorial completo da matéria ${n}, preservado sem os metadados técnicos.\n### AUTOR\nTexto: Ana Souza\n### IMAGEM DE DESTAQUE SUGERIDA\n${imagem}\n### LEGENDA DA IMAGEM\nLegenda ${n}\n### CRÉDITO/ORIGEM DA IMAGEM\nFoto: José Silva\n### TAGS\ntag ${n}\n### PORTAL(IS) RECOMENDADO(S)\nTribuna do Sertão\nFIM DA MATÉRIA ${n}`;

test('três matérias Radar de Notícias são separadas e preservam metadados',()=>{
  const partes=separarMensagens([radar(1,'Título um','um.jpg'),radar(2,'Título dois','dois.jpg'),radar(3,'Título três','tres.jpg')].join('\n\n'),new Date());
  assert.equal(partes.length,3);
  const campos=partes.map(item=>identificarMateria(item.texto).campos);
  assert.deepEqual(campos.map(c=>c.titulo),['Título um','Título dois','Título três']);
  assert.equal(campos[0].bigode,'Subtítulo da matéria 1.');
  assert.equal(campos[0].autor,'Ana Souza');
  assert.equal(campos[0].imagemNome,'um.jpg');
  assert.equal(campos[0].legendaImagem,'Legenda 1');
  assert.equal(campos[0].creditoImagem,'José Silva');
  assert.doesNotMatch(campos[0].redacao,/PORTAL|CRÉDITO|TAGS|IMAGEM DE DESTAQUE/);
});

test('formato Gemini reconhece LEGENDA e CRÉDITOS DA FOTO sem levá-los ao corpo',()=>{
  const texto=`MATÉRIA 1
CATEGORIA: Alagoas
CHAPÉU: EDUCAÇÃO
TÍTULO: Prefeitura anuncia investimentos na educação municipal
BIGODE: Novas ações serão realizadas nas escolas municipais
AUTOR: Assessoria de Comunicação
LEGENDA: Estudantes participam de atividades na escola municipal
CRÉDITOS DA FOTO: João Silva/Assessoria
TEXTO:
Conteúdo completo da matéria.
FIM DE MATÉRIA 1`;
  const [parte]=separarMensagens(texto,new Date());
  const {campos}=identificarMateria(parte.texto);
  assert.equal(campos.legendaImagem,'Estudantes participam de atividades na escola municipal');
  assert.equal(campos.creditoImagem,'João Silva/Assessoria');
  assert.equal(campos.autor,'Assessoria de Comunicação');
  assert.equal(campos.redacao,'Conteúdo completo da matéria.');
  assert.doesNotMatch(campos.redacao,/LEGENDA|CRÉDITOS DA FOTO/);
});

test('campos vazios de legenda e créditos permanecem vazios e fora do corpo',()=>{
  const {campos}=identificarMateria(`TÍTULO: Notícia sem metadados
CHAPÉU: GERAL
BIGODE: Resumo da notícia.
AUTOR: Redação
LEGENDA:
CRÉDITOS DA FOTO:
TEXTO:
Corpo preservado.`);
  assert.equal(campos.legendaImagem,'');
  assert.equal(campos.creditoImagem,'');
  assert.equal(campos.redacao,'Corpo preservado.');
});

test('três matérias Radar Clima são separadas; subtítulo pontuado e chapéu regional são mantidos',()=>{
  const texto=['ALTO SERTÃO\nTítulo climático um\nSubtítulo climático terminado em ponto.\nCidade Um — Corpo da notícia com previsão de chuva e temperatura de 28°C, contendo informações suficientes para identificação.\nImagem anexa: clima-1.jpg',
    'BAIXO SÃO FRANCISCO\nTítulo climático dois\nOutro subtítulo terminado em ponto.\nCidade Dois — Corpo da notícia com nebulosidade e chuva durante o dia, contendo informações editoriais completas.\nImagem anexa: clima-2.jpg',
    'CLIMA\nTítulo climático três\nTerceiro subtítulo terminado em ponto.\nCidade Três — Corpo da notícia com previsão do tempo e temperaturas, contendo informações editoriais completas.\nImagem anexa: clima-3.jpg'].join('\n\n');
  const partes=separarMensagens(texto,new Date()); assert.equal(partes.length,3);
  const campos=partes.map(item=>identificarMateria(item.texto).campos);
  assert.equal(campos[0].chapeu,'ALTO SERTÃO'); assert.equal(campos[1].chapeu,'BAIXO SÃO FRANCISCO');
  assert.match(campos[0].bigode,/ponto\.$/); assert.equal(campos[0].imagemNome,'clima-1.jpg');
  assert.equal(campos[0].tipoRadar,'clima'); assert.equal(campos[0].cidade,'Cidade Um');
});

test('rótulos com travessão identificam os campos e preservam transparência e tabela no corpo',()=>{
  const texto=`**TÍTULO** — Umidade cai a 39% no pico de calor em Palmeira dos Índios

**CHAPÉU** — TEMPO NO AGRESTE

**BIGODE** — Sábado varia de 22°C a 34°C, sem chuva no modelo principal.

**TEXTO** — A leitura disponível perto das 08h indicava 24°C e predomínio de sol.

TRANSPARÊNCIA — Esta matéria foi produzida com auxílio de inteligência artificial e está pendente de revisão editorial.

**PREVISÃO HORA A HORA** — sequência publicada pela fonte consultada.

| Horário | Temperatura |
| ------- | ----------- |
| 08h | 25°C |

**CATEGORIA SUGERIDA** — Clima e Tempo

**AUTOR** — Redação`;
  const {campos}=identificarMateria(texto);
  assert.equal(campos.titulo,'Umidade cai a 39% no pico de calor em Palmeira dos Índios');
  assert.equal(campos.chapeu,'TEMPO NO AGRESTE');
  assert.equal(campos.bigode,'Sábado varia de 22°C a 34°C, sem chuva no modelo principal.');
  assert.equal(campos.categoria,'Clima e Tempo');
  assert.equal(campos.autor,'Redação');
  assert.equal(campos.cidade,'Palmeira dos Índios');
  assert.match(campos.redacao,/^A leitura disponível/);
  assert.match(campos.redacao,/TRANSPARÊNCIA —/);
  assert.match(campos.redacao,/\| 08h \| 25°C \|/);
  assert.doesNotMatch(campos.redacao,/CATEGORIA SUGERIDA|\*\*AUTOR/);
});

test('rótulo editorial funciona com dois-pontos, hífen ou valor na linha seguinte',()=>{
  const {campos}=identificarMateria(`TÍTULO
Notícia identificada sem separador
CHAPÉU - CIDADES
BIGODE: Resumo identificado com dois-pontos.
TEXTO
Primeiro parágrafo preservado no corpo.

Segundo parágrafo preservado.
AUTOR
Redação`);
  assert.equal(campos.titulo,'Notícia identificada sem separador');
  assert.equal(campos.chapeu,'CIDADES');
  assert.equal(campos.bigode,'Resumo identificado com dois-pontos.');
  assert.equal(campos.autor,'Redação');
  assert.equal(campos.redacao,'Primeiro parágrafo preservado no corpo.\n\nSegundo parágrafo preservado.');
});

test('mais de quatro matérias permanecem persistidas na fila',async t=>{
  const pasta=await fs.mkdtemp(path.join(os.tmpdir(),'autoxs-lote-')); t.after(()=>fs.rm(pasta,{recursive:true,force:true}));
  const captura=criarCapturaMaterias(pasta);
  await captura.receber({metodo:'colar',texto:Array.from({length:5},(_,i)=>radar(i+1,`Título ${i+1}`,`foto-${i+1}.jpg`)).join('\n\n')});
  const resultado=await captura.organizar(); assert.equal(resultado.criados,5);
  const estado=await captura.listar(); assert.equal(estado.rascunhos.length,5);
});

test('importação direta reconhece lotes de uma, três e quatro matérias sem duplicar',async t=>{
  for (const quantidade of [1,3,4]) {
    const pasta=await fs.mkdtemp(path.join(os.tmpdir(),`autoxs-direto-${quantidade}-`));
    t.after(()=>fs.rm(pasta,{recursive:true,force:true}));
    const captura=criarCapturaMaterias(pasta);
    const texto=Array.from({length:quantidade},(_,i)=>radar(i+1,`Direta ${i+1}`,`direta-${i+1}.jpg`)).join('\n\n');
    const primeira=await captura.importarLote({texto,origem:'E-mail de teste'});
    assert.equal(primeira.novas,quantidade);
    const repetida=await captura.importarLote({texto,origem:'E-mail de teste'});
    assert.equal(repetida.novas,0); assert.equal(repetida.duplicatas.length,quantidade);
    const estado=await captura.listar(); assert.equal(estado.rascunhos.length,quantidade);
    assert.deepEqual(estado.rascunhos.map(item=>item.campos.imagemNome),
      Array.from({length:quantidade},(_,i)=>`direta-${i+1}.jpg`));
  }
});

test('busca local prioriza nome exato e usa cópia mais recente quando necessário',async t=>{
  const pasta=await fs.mkdtemp(path.join(os.tmpdir(),'autoxs-fotos-')); t.after(()=>fs.rm(pasta,{recursive:true,force:true}));
  const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(24)]);
  await fs.writeFile(path.join(pasta,'Foto Árvore (1).png'),png); await new Promise(r=>setTimeout(r,15));
  await fs.writeFile(path.join(pasta,'FOTO ÁRVORE (2).PNG'),png);
  let busca=await buscarFotoLocal({pasta,nomeEsperado:'foto árvore.png'});
  assert.equal(busca.estado,'encontrada'); assert.equal(busca.escolhida.nome,'FOTO ÁRVORE (2).PNG');
  await fs.writeFile(path.join(pasta,'Foto Árvore.png'),png);
  busca=await buscarFotoLocal({pasta,nomeEsperado:'foto árvore.png'});
  assert.equal(busca.criterio,'nome-exato'); assert.equal(busca.escolhida.nome,'Foto Árvore.png');
});

test('pasta ausente, arquivo incompleto e nome aproximado não viram foto',async t=>{
  const pasta=await fs.mkdtemp(path.join(os.tmpdir(),'autoxs-fotos-')); t.after(()=>fs.rm(pasta,{recursive:true,force:true}));
  await fs.writeFile(path.join(pasta,'foto.jpg'),Buffer.from('incompleto'));
  assert.equal((await buscarFotoLocal({pasta,nomeEsperado:'foto.jpg'})).estado,'nao-encontrada');
  assert.equal((await buscarFotoLocal({pasta:path.join(pasta,'ausente'),nomeEsperado:'foto.jpg'})).estado,'pasta-indisponivel');
  assert.equal((await buscarFotoLocal({pasta,nomeEsperado:'outra-foto.jpg'})).estado,'nao-encontrada');
});
