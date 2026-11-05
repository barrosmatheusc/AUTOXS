const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { analisarLinhas, selecionarCem, criarContadorPendentesCms } = require('../pendencias-cms');

const linha = (id,titulo,data='05/11/2026 10:00') =>
  ({titulo,data,hrefs:[`/news/edit/${id}`]});
const referencia = linha(999,'Quanto foi o jogo Brasil x Japão hoje? Veja resultado dos gols','14/10/2025 16:11');

test('conta só matérias antes da referência e prefere ID após identificá-lo',() => {
  const primeira=analisarLinhas([linha(1,'Primeira'),linha(2,'Segunda'),referencia,linha(3,'Não contar')]);
  assert.equal(primeira.quantidade,2);
  assert.equal(primeira.encontrou,true);
  assert.equal(primeira.referenciaId,'999');
  const segunda=analisarLinhas([linha(4,'Outra'),linha(999,'Título alterado','05/11/2026 10:00')],
    {referenciaId:primeira.referenciaId});
  assert.equal(segunda.quantidade,1);
  assert.equal(segunda.encontrou,true);
});

test('não confunde título com data diferente nem aceita link ambíguo',() => {
  const outraData=analisarLinhas([linha(1,referencia.titulo,'15/10/2025 16:11')]);
  assert.equal(outraData.encontrou,false);
  assert.equal(outraData.quantidade,1);
  assert.throws(()=>analisarLinhas([{titulo:'Pendente',hrefs:[]},referencia]),/sem link de edição único/);
  assert.throws(()=>analisarLinhas([{titulo:'Pendente',hrefs:['/news/edit/1','/news/edit/2']},referencia]),/sem link de edição único/);
  assert.throws(()=>analisarLinhas([{titulo:'Pendente',hrefs:['https://outro.test/news/edit/1']},referencia]),/sem link de edição único/);
});

test('não duplica matéria repetida entre páginas',() => {
  const vistos=new Set();
  assert.equal(analisarLinhas([linha(1,'Primeira')],{vistos}).quantidade,1);
  assert.equal(analisarLinhas([linha(1,'Primeira'),referencia],{vistos}).quantidade,0);
});

function tabela(itens) {
  return `<table><tbody>${itens.map(item => `<tr><td>✓</td><td><a href="/news/edit/${item.id}">Editar</a></td>
    <td></td><td></td><td></td><td></td><td></td><td>${item.titulo}</td><td>${item.data}</td></tr>`).join('')}</tbody></table>`;
}

test('consulta simulada seleciona 100, usa sessão existente e preserva último número na falha',async () => {
  const navegador=await chromium.launch({channel:'msedge',headless:true});
  try {
    const context=await navegador.newContext();
    const principal=await context.newPage();
    await context.addCookies([{name:'cms_session',value:'teste',domain:'redacao.tribunaweb.com.br',path:'/'}]);
    await context.addCookies([{name:'outro_site',value:'privado',domain:'outro.test',path:'/'}]);
    let visitas=0, falhar=false;
    let navegadoresFechados=0;
    const iniciarNavegador=async()=>({
      newContext:async opcoes=>{
        assert.deepEqual(opcoes.storageState.cookies.map(cookie=>cookie.name),['cms_session']);
        const consulta=await navegador.newContext(opcoes);
        await consulta.route('**/news',async rota => {
          visitas++;
          if(falhar) return rota.abort();
          return rota.fulfill({status:200,contentType:'text/html; charset=utf-8',body:`<!doctype html><html><head><meta charset="utf-8"></head><body>
        <select id="filterExtra"><option>Todos</option><option value="sem-edicao">Com integração (sem edição)</option></select>
        <button type="button">Filtrar</button>
        <select name="news_length"><option value="25">25</option><option value="100">100</option></select>
        ${tabela([{id:1,titulo:'Primeira',data:'05/11/2026 10:00'},
          {id:2,titulo:'Segunda',data:'05/11/2026 09:00'},
          {id:999,titulo:referencia.titulo,data:'14/10/2025 16:11'}])}</body></html>`});
        });
        return consulta;
      },
      close:async()=>{navegadoresFechados++;}
    });
    const contador=criarContadorPendentesCms(context,{iniciarNavegador});
    const [a,b]=await Promise.all([contador.consultar(),contador.consultar()]);
    assert.equal(visitas,1);
    assert.equal(a.quantidade,2,JSON.stringify(a));
    assert.equal(b.quantidade,2);
    assert.equal(a.desatualizado,false);
    assert.deepEqual(context.pages(),[principal],'a página principal não foi alterada pela consulta');
    assert.equal(navegadoresFechados,1,'o navegador de consulta foi fechado');
    falhar=true;
    const antigo=await contador.consultar();
    assert.equal(antigo.quantidade,2);
    assert.equal(antigo.desatualizado,true);
    assert.ok(antigo.motivo);
    assert.deepEqual(context.pages(),[principal],'a página principal não foi alterada após erro');
    assert.equal(navegadoresFechados,2,'o navegador de consulta foi fechado após erro');
    await context.close();
  } finally { await navegador.close(); }
});

test('avança para a página seguinte e encerra exatamente antes da referência',async () => {
  const navegador=await chromium.launch({channel:'msedge',headless:true});
  try {
    const contexto=await navegador.newContext();
    await contexto.addCookies([{name:'cms_session',value:'teste',domain:'redacao.tribunaweb.com.br',path:'/'}]);
    const iniciarNavegador=async()=>({
      newContext:async opcoes=>{
        const consulta=await navegador.newContext(opcoes);
        await consulta.route('**/news',rota => rota.fulfill({status:200,contentType:'text/html; charset=utf-8',body:`<!doctype html><html><head><meta charset="utf-8"></head><body>
      <select id="filterExtra"><option value="sem-edicao">Com integração (sem edição)</option></select><button>Filtrar</button>
      <select name="news_length"><option value="100">100</option></select>
      <div id="listagem">${tabela([{id:1,titulo:'Primeira',data:'05/11/2026 10:00'}])}</div>
      <nav class="pagination"><button onclick="document.querySelector('#listagem').innerHTML=window.proxima;this.disabled=true">Próxima</button></nav>
      <script>window.proxima=${JSON.stringify(tabela([{id:2,titulo:'Segunda',data:'05/11/2026 09:00'},
        {id:999,titulo:referencia.titulo,data:'14/10/2025 16:11'}]))}</script></body></html>`}));
        return consulta;
      },
      close:async()=>{}
    });
    const resultado=await criarContadorPendentesCms(contexto,{iniciarNavegador}).consultar();
    assert.equal(resultado.quantidade,2,JSON.stringify(resultado));
    assert.equal(resultado.desatualizado,false);
    assert.equal(contexto.pages().length,0,'não sobra guia após percorrer as páginas');
    await contexto.close();
  } finally { await navegador.close(); }
});

test('sem sessão do CMS não abre about:blank nem altera a página principal',async () => {
  const navegador=await chromium.launch({channel:'msedge',headless:true});
  try {
    const contexto=await navegador.newContext();
    const principal=await contexto.newPage();
    await principal.goto('about:blank');
    const resultado=await criarContadorPendentesCms(contexto).consultar();
    assert.equal(resultado.desatualizado,true);
    assert.equal(contexto.pages().length,1);
    assert.equal(contexto.pages()[0],principal);
  } finally { await navegador.close(); }
});

test('seletor 100 altera apenas o controle visível de matérias',async () => {
  const navegador=await chromium.launch({channel:'msedge',headless:true});
  try {
    const pagina=await navegador.newPage();
    await pagina.setContent('<select id="quantidade-materias"><option>25</option><option>100</option></select><dialog><select name="fotos_length"><option>25</option><option>100</option></select></dialog><table><tr><td>Matéria</td></tr></table>');
    assert.equal(await selecionarCem(pagina),true);
    assert.equal(await pagina.locator('#quantidade-materias').inputValue(),'100');
    assert.equal(await pagina.locator('[name="fotos_length"]').inputValue(),'25');
  } finally { await navegador.close(); }
});

test('indicador aparece ao lado de Estatísticas do dia e conserva o número se falhar',async () => {
  const navegador=await chromium.launch({channel:'msedge',headless:true});
  try {
    const pagina=await navegador.newPage({viewport:{width:1100,height:780}});
    let falhar=false;
    await pagina.exposeFunction('operacaoProducao',async ({acao}) => {
      if(acao==='pendentesCms') return falhar
        ? {ok:true,resultado:{quantidade:7,desatualizado:true,motivo:'CMS indisponível'}}
        : {ok:true,resultado:{quantidade:7,desatualizado:false,motivo:''}};
      if(acao==='consultar') return {ok:true,resultado:{estatisticas:{concluidas:0,atualizacoesAutomaticas:0,finalizadasManualmente:0,adicionadas:0,aguardandoRevisao:0,erros:0},compartilh:[],responsaveis:[]}};
      return {ok:true,resultado:{}};
    });
    await pagina.goto(pathToFileURL(path.join(__dirname,'..','painel-producao.html')).href);
    await pagina.getByText('Faltam 7 matérias para atualizar').waitFor();
    const titulo=await pagina.getByRole('heading',{name:'Estatísticas do dia'}).boundingBox();
    const indicador=await pagina.locator('#pendentes-cms').boundingBox();
    assert.ok(indicador.x>titulo.x);
    assert.ok(Math.abs(indicador.y-titulo.y)<20);
    falhar=true;
    await pagina.evaluate(()=>atualizarPendentesCms());
    assert.match(await pagina.locator('#pendentes-cms').innerText(),/Faltam 7 matérias para atualizar/);
    assert.match(await pagina.locator('#pendentes-cms').innerText(),/desatualizada/);
  } finally { await navegador.close(); }
});
