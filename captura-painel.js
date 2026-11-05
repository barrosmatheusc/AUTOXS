(() => {
  const $ = seletor => document.querySelector(seletor);
  const dialogo = $('#captura-dialogo');
  const estado = $('#captura-estado');
  const CAMPOS = [['titulo','Título'],['chapeu','Chapéu'],['bigode','Subtítulo'],['redacao','Corpo'],['autor','Autor'],['categoria','Categoria']];
  let dados = { mensagens:[], rascunhos:[] };
  let trabalhando = false;
  const botao = $('#abrir-captura');
  const aviso = texto => { estado.textContent = texto; };
  const el = (tag, texto = '', classe = '') => {
    const no = document.createElement(tag); no.textContent = texto; if (classe) no.className = classe; return no;
  };
  function acao(tipo, outros = {}) {
    if (typeof window.capturaAutoXS !== 'function') throw new Error('Central indisponível. Reinicie o AutoXS para instalar a caixa de entrada.');
    return window.capturaAutoXS({ acao:tipo, ...outros });
  }
  async function executar(tarefa) {
    if (trabalhando) return;
    trabalhando = true; dialogo.setAttribute('aria-busy','true');
    try { await tarefa(); await carregar(); }
    catch (erro) { aviso(erro.message || 'Não foi possível concluir a operação. Os dados foram preservados.'); }
    finally { trabalhando = false; dialogo.removeAttribute('aria-busy'); }
  }
  async function carregar() {
    dados = await acao('listar');
    renderizar();
    if (dados.avisoRecuperacao) aviso(dados.avisoRecuperacao);
  }
  function fotoInfo(id) { return dados.mensagens.flatMap(item => item.fotos).find(foto => foto.id === id); }
  async function miniatura(id, destino) {
    try { const img = document.createElement('img'); img.alt = fotoInfo(id)?.nome || 'Foto anexada'; img.src = await acao('foto',{ id }); destino.append(img); }
    catch { destino.append(el('span','Prévia indisponível')); }
  }
  function renderizarMensagens() {
    const lista = $('#captura-mensagens'); lista.replaceChildren();
    for (const item of dados.mensagens.filter(item => !item.descartada)) {
      const cartao = el('div','','captura-mensagem');
      cartao.append(el('small',`${item.origem} · ${item.horarioInformado || new Date(item.recebidoEm).toLocaleString('pt-BR')}${item.remetente ? ' · '+item.remetente : ''}`));
      cartao.append(el('p',item.textoOriginal || '(somente fotografias)'));
      if (item.duplicataPossivel) cartao.append(el('strong','Possível duplicata; confira antes de aprovar.'));
      const fotos = el('div','','captura-fotos'); item.fotos.forEach(foto => miniatura(foto.id,fotos)); cartao.append(fotos);
      lista.append(cartao);
    }
  }
  function renderizarRascunho(r) {
    const cartao = el('article','','captura-cartao'); cartao.dataset.status = r.status;
    cartao.append(el('h4',r.campos.titulo || 'Título não identificado'));
    cartao.append(el('small',`${r.status} · ${r.mensagemIds.length} mensagem(ns)${r.ambiguo ? ' · agrupamento exige confirmação' : ''}`));
    if (r.motivo) cartao.append(el('p',r.motivo));
    if (r.rotulosDesconhecidos?.length) cartao.append(el('p',`Rótulos não identificados: ${r.rotulosDesconhecidos.join(', ')}. Confira o original.`));
    const faltam = [!r.campos.titulo && 'título',!r.campos.redacao && 'corpo',!r.campos.chapeu && 'chapéu',!r.fotoId && 'foto'].filter(Boolean);
    if (faltam.length) cartao.append(el('p',`Campos para conferir: ${faltam.join(', ')}.`));
    const originais = el('details'); originais.append(el('summary','Ver mensagens originais'));
    for (const id of r.mensagemIds) {
      const msg = dados.mensagens.find(item => item.id === id);
      if (!msg) continue;
      originais.append(el('p',msg.textoOriginal || '(somente fotografia)'));
      if (r.status === 'revisao' && r.mensagemIds.length > 1) {
        const separar = el('button','Separar esta mensagem'); separar.type='button';
        separar.addEventListener('click',() => executar(async () => { await acao('separar',{ id:r.id,mensagemId:id }); aviso('Mensagem separada. Confira os dois rascunhos.'); }));
        originais.append(separar);
      }
    }
    cartao.append(originais);
    if (r.status === 'revisao') {
      const editores = {};
      for (const [campo,rotulo] of CAMPOS) {
        const linha = el('div','','captura-campo'); const label=el('label',rotulo); const input=document.createElement(campo === 'redacao' || campo === 'bigode' ? 'textarea' : 'input');
        input.value = r.campos[campo] || ''; label.append(input); linha.append(label); cartao.append(linha); editores[campo]=input;
      }
      const fotoLabel=el('label','Fotografia associada'); const fotoSelect=document.createElement('select');
      fotoSelect.append(new Option('Nenhuma (escolher no CMS depois)',''));
      const fotosUnicas=new Map(dados.mensagens.flatMap(item=>item.fotos).map(foto=>[foto.id,foto]));
      for (const foto of fotosUnicas.values()) fotoSelect.append(new Option(foto.nome,foto.id));
      fotoSelect.value=r.fotoId||''; fotoLabel.append(fotoSelect); cartao.append(fotoLabel);
      const previa=el('div','','captura-fotos'); cartao.append(previa); if(r.fotoId) miniatura(r.fotoId,previa);
      const salvarCampos=() => acao('atualizar',{id:r.id,campos:Object.fromEntries(CAMPOS.map(([chave])=>[chave,editores[chave].value]))});
      fotoSelect.addEventListener('change',() => executar(async () => { await salvarCampos(); await acao('associarFoto',{id:r.id,fotoId:fotoSelect.value||null}); aviso('Campos e foto salvos no rascunho.'); }));
      const botoes=el('div','','captura-acoes');
      const salvar=el('button','Salvar correções'); salvar.type='button'; salvar.addEventListener('click',() => executar(async () => {
        await salvarCampos(); aviso('Correções salvas.');
      })); botoes.append(salvar);
      if (r.ambiguo) { const confirmar=el('button','Confirmar agrupamento'); confirmar.type='button'; confirmar.addEventListener('click',() => executar(async () => { await salvarCampos(); await acao('confirmarGrupo',{id:r.id}); aviso('Campos salvos e agrupamento confirmado por você.'); })); botoes.append(confirmar); }
      const aprovar=el('button','Aprovar rascunho'); aprovar.type='button'; aprovar.addEventListener('click',() => executar(async () => { await salvarCampos(); await acao('aprovar',{id:r.id}); aviso('Rascunho aprovado. Use Encaminhar para carregar em um quadro livre.'); })); botoes.append(aprovar);
      const outros=dados.rascunhos.filter(item=>item.id!==r.id && item.status==='revisao');
      if(outros.length) { const seletor=document.createElement('select'); seletor.append(new Option('Juntar com...','')); for(const outro of outros) seletor.append(new Option(outro.campos.titulo||'Sem título',outro.id)); botoes.append(seletor); const juntar=el('button','Juntar'); juntar.type='button'; juntar.addEventListener('click',() => executar(async () => { if(!seletor.value) throw new Error('Escolha outro rascunho.'); await acao('juntar',{ids:[r.id,seletor.value]}); aviso('Mensagens reunidas. Confira os campos conflitantes.'); })); botoes.append(juntar); }
      cartao.append(botoes);
    }
    if(r.status==='aprovado' || r.status==='encaminhado') { const encaminhar=el('button',r.status==='encaminhado' ? 'Reabrir em quadro livre' : 'Encaminhar para quadro livre'); encaminhar.type='button'; encaminhar.addEventListener('click',() => executar(async () => {
      const mensagens=r.mensagemIds.map(id=>dados.mensagens.find(item=>item.id===id)).filter(Boolean);
      const resposta=window.receberRascunhoCaptura({ ...r, mensagens, fotoNome:fotoInfo(r.fotoId)?.nome });
      if(!resposta?.ok) throw new Error(resposta?.mensagem||'Nenhum quadro disponível.');
      if(r.status==='aprovado') await acao('marcarEncaminhado',{id:r.id});
      aviso(`Matéria carregada no quadro ${resposta.espaco}. Confira antes de usar Enviar matéria ao site.`);
    })); cartao.append(encaminhar); }
    if(r.status!=='encaminhado' && r.status!=='descartado') { const descartar=el('button','Descartar rascunho'); descartar.type='button'; descartar.addEventListener('click',() => {
      if(!confirm('Descartar este rascunho e suas mensagens da fila?')) return;
      executar(async () => { await acao('descartar',{id:r.id}); aviso('Rascunho descartado.'); });
    }); cartao.append(descartar); }
    return cartao;
  }
  function renderizar() {
    renderizarMensagens();
    const fila=$('#captura-rascunhos'); fila.replaceChildren();
    const visiveis=dados.rascunhos.filter(item=>item.status!=='descartado');
    $('#captura-quantidade').textContent=`(${visiveis.filter(item=>item.status!=='encaminhado').length})`;
    for (const r of visiveis) fila.append(renderizarRascunho(r));
    if(!visiveis.length) fila.append(el('p','Nenhum rascunho ainda. Guarde mensagens e clique em Organizar.'));
  }
  botao.addEventListener('click',() => { dialogo.showModal(); executar(async()=>{ await carregar(); }); });
  $('#fechar-captura').addEventListener('click',() => dialogo.close());
  $('#captura-fotos').addEventListener('change',evento => {
    const destino=$('#captura-previa-arquivos'); destino.replaceChildren();
    for(const arquivo of evento.target.files) { const img=document.createElement('img'); img.alt=arquivo.name; const url=URL.createObjectURL(arquivo); img.src=url; img.addEventListener('load',()=>URL.revokeObjectURL(url),{once:true}); destino.append(img); }
  });
  $('#guardar-captura').addEventListener('click',() => executar(async()=>{
    const arquivos=[...$('#captura-fotos').files]; const fotos=[];
    for(const arquivo of arquivos) { const bytes=new Uint8Array(await arquivo.arrayBuffer()); let binario=''; for(let i=0;i<bytes.length;i+=8192) binario+=String.fromCharCode(...bytes.subarray(i,i+8192)); fotos.push({nome:arquivo.name,dados:btoa(binario)}); }
    const resposta=await acao('receber',{entrada:{metodo:'colar',origem:$('#captura-origem').value,texto:$('#captura-texto').value,fotos}});
    $('#captura-texto').value=''; $('#captura-fotos').value=''; $('#captura-previa-arquivos').replaceChildren();
    aviso(`${resposta.novas.length} mensagem(ns) guardada(s). ${resposta.duplicatas.length} duplicata(s) ignorada(s).`);
  }));
  $('#organizar-captura').addEventListener('click',() => executar(async()=>{ const resposta=await acao('organizar'); aviso(`${resposta.criados} rascunho(s) criado(s). Confira os agrupamentos antes de aprovar.`); }));
})();
