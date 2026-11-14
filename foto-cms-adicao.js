const fs = require('node:fs/promises');
const path = require('node:path');
const { buscarFotoLocal } = require('./foto-local');

const ORIGEM = 'https://redacao.tribunaweb.com.br';
const URL_ADICIONAR = `${ORIGEM}/news/add`;
const URL_UPLOAD = 'https://redacao.tribunaweb.com.br/images/save';
const ESPERA = 20_000;
const ESPERA_UPLOAD = 180_000;
const SEL = Object.freeze({
  campoArquivo:'#datatableMultipleUploadImages', cartao:'.dt-card-item', idDaMidia:'input[name="image_id"]',
  filtro:'#system_datatable_wrapper .dataTables_filter input', informacao:'#system_datatable_wrapper .dataTables_info',
  tituloCartao:'.card-title-item',
  modalImagem:'#inpModalImagemBox', legenda:'#inpModalImagemBoxLegenda', credito:'#inpModalImagemBoxCreditos',
  padrao:'#inpModalImagemBoxUpdateGlobal', lapis:'form .card button[data-type="image"]', salvar:'button.btn-success'
});

const falha = (etapa, mensagem, extra = {}) => ({ ok:false, etapa, mensagem, publicada:false, ...extra });
const normalizar = valor => String(valor || '').normalize('NFC').replace(/\s+/g, ' ').trim();

function caminhoRealDaImagem(valor) {
  const texto = String(valor || '');
  const real = /(https?:\/\/[^/]+\/images\/[^"'\s]+)$/i.exec(texto);
  return real ? real[1] : texto;
}

function miniaturaSegura(valor) {
  try {
    const url = new URL(String(valor || ''));
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

function extrairIdentidade(resposta) {
  const achados={id:null,caminho:null};
  const visitar=valor=>{
    if (valor == null) return;
    if (Array.isArray(valor)) return valor.forEach(visitar);
    if (typeof valor === 'object') return Object.entries(valor).forEach(([chave,item])=>{
      if (/^(?:id|image_id|imageId)$/i.test(chave) && /^\d+$/.test(String(item))) achados.id ||= String(item);
      visitar(item);
    });
    const texto=String(valor);
    const caminho=texto.match(/(?:https?:\/\/[^\s"']+)?(\/images\/[^\s"']+)/i);
    if (caminho) achados.caminho ||= caminho[1];
  };
  visitar(resposta); return achados;
}

async function abrirAcervo(aba) {
  const dialog=aba.getByRole('dialog',{name:/Imagem de Destaque/i});
  if (!await dialog.isVisible().catch(()=>false)) {
    const mais=aba.getByRole('button',{name:'+',exact:true});
    if (await mais.count()<2) return falha('abrir-acervo','Não encontrei os botões de Imagem de Destaque.');
    await mais.first().click();
    if (!await dialog.waitFor({state:'visible',timeout:ESPERA}).then(()=>true,()=>false)) return falha('abrir-acervo','O banco de imagens não abriu.');
  }
  return {ok:true,dialog};
}

async function lerImageId(aba) {
  const campo=aba.locator(SEL.idDaMidia);
  if (await campo.count()<1) return null;
  const id=await campo.first().inputValue().catch(()=>'');
  return id && id!=='0' ? id : null;
}

async function lerCartoes(dialog) {
  const locator=dialog.locator(SEL.cartao);
  if (typeof locator.evaluateAll !== 'function') return [];
  return locator.evaluateAll((cartoes, seletorTitulo) => cartoes
    .filter(cartao => Boolean(cartao.getClientRects().length))
    .map(cartao => {
      const imagem=cartao.querySelector('img');
      return { id:String(cartao.getAttribute('data-id') || ''),
        nome:String(cartao.querySelector(seletorTitulo)?.textContent || '').replace(/\s+/g,' ').trim(),
        url:String(imagem?.currentSrc || imagem?.src || '') };
    }).filter(item=>/^\d+$/.test(item.id)), SEL.tituloCartao);
}

async function filtrarAcervo(dialog, termo) {
  const filtro=dialog.locator(SEL.filtro);
  if (typeof filtro.count !== 'function') return;
  if (await filtro.count().catch(()=>0)!==1) return;
  await filtro.fill(String(termo || ''));
  await filtro.press('Enter');
  const limite=Date.now()+ESPERA;
  let marca=''; let iguais=0;
  while(Date.now()<limite) {
    const atual=JSON.stringify(await lerCartoes(dialog));
    if (atual===marca) iguais++; else { marca=atual; iguais=0; }
    if (iguais>=2) return;
    await dialog.page().waitForTimeout(350);
  }
}

async function listarFotosAcervo(aba, termo='') {
  const acervo=await abrirAcervo(aba); if(!acervo.ok) return acervo;
  await filtrarAcervo(acervo.dialog,normalizar(termo));
  const itens=(await lerCartoes(acervo.dialog)).slice(0,100)
    .map(item=>({...item,url:miniaturaSegura(item.url)}));
  return {ok:true,itens,termo:normalizar(termo),publicada:false};
}

async function localizarCartaoPorId(dialog,id,nome='') {
  let cartao=dialog.locator(`${SEL.cartao}[data-id="${String(id).replace(/"/g,'')}"]`);
  const primeiro=typeof cartao.first==='function'?cartao.first():cartao;
  if (await cartao.count()===1 && await primeiro.isVisible?.().catch(()=>true)!==false) return primeiro;
  await filtrarAcervo(dialog,nome || id);
  cartao=dialog.locator(`${SEL.cartao}[data-id="${String(id).replace(/"/g,'')}"]`);
  return await cartao.count()===1 ? (typeof cartao.first==='function'?cartao.first():cartao) : null;
}

async function selecionarPorId(aba, dialog, id, {nome=''}={}) {
  if (!/^\d+$/.test(String(id||''))) return falha('localizar-imagem','O ID da fotografia não é válido.');
  const cartao=await localizarCartaoPorId(dialog,id,nome);
  if (!cartao) return falha('localizar-imagem',`A mídia ${id} não ficou única no banco de imagens.`);
  const anterior=await lerImageId(aba);
  await cartao.locator('img').first().click({timeout:ESPERA});
  await dialog.waitFor({state:'hidden',timeout:ESPERA}).catch(()=>{});
  const final=await lerImageId(aba);
  if (!final || final!==String(id)) return falha('confirmar-imagem',`O formulário não confirmou o image_id ${id}.`,{imageId:final,anterior});
  return {ok:true,estado:'selecionada',imageId:final,publicada:false,reutilizada:anterior===final};
}

async function encontrarEnviada(dialog,identidade,nomeArquivo) {
  if (identidade.id) {
    const direto=dialog.locator(`${SEL.cartao}[data-id="${identidade.id}"]`);
    if (typeof direto.count==='function' && await direto.count()===1)
      return {id:identidade.id,nome:nomeArquivo||'',url:''};
  }
  let itens=await lerCartoes(dialog);
  if (identidade.id) {
    let exatos=itens.filter(item=>item.id===identidade.id);
    if (exatos.length!==1) {
      await filtrarAcervo(dialog,nomeArquivo || identidade.id);
      itens=await lerCartoes(dialog); exatos=itens.filter(item=>item.id===identidade.id);
    }
    if (exatos.length===1) return exatos[0];
  }
  if (identidade.caminho) {
    const alvo=caminhoRealDaImagem(identidade.caminho);
    const porCaminho=itens.filter(item=> {
      const atual=caminhoRealDaImagem(item.url);
      return atual.endsWith(alvo) || alvo.endsWith(atual);
    });
    if (porCaminho.length===1) return porCaminho[0];
    if (porCaminho.length>1) return null;
  }
  if (nomeArquivo) {
    await filtrarAcervo(dialog,nomeArquivo); itens=await lerCartoes(dialog);
    const exatos=itens.filter(item=>item.nome.localeCompare(nomeArquivo,'pt-BR',{sensitivity:'base'})===0);
    const candidatos=exatos.length?exatos:itens;
    if (candidatos.length===1) return candidatos[0];
  }
  return null;
}

async function enviarESelecionar(aba, caminhoLocal) {
  if (!path.isAbsolute(caminhoLocal)) return falha('upload','O caminho da fotografia não é absoluto.');
  if (!(await fs.stat(caminhoLocal).catch(()=>null))?.isFile())
    return falha('upload','A fotografia não está mais disponível na pasta configurada.');
  const acervo=await abrirAcervo(aba); if(!acervo.ok) return acervo;
  const campo=aba.locator(SEL.campoArquivo);
  if (await campo.count()!==1) return falha('upload',`O campo ${SEL.campoArquivo} não foi encontrado.`);
  let retorno=null;
  const resposta=aba.waitForResponse(r=>r.request().method()==='POST'&&r.url().startsWith(URL_UPLOAD),{timeout:ESPERA_UPLOAD})
    .then(async r=>{let corpo;try{corpo=await r.json();}catch{corpo=await r.text().catch(()=>'');}retorno={status:r.status(),corpo};},()=>{});
  await campo.setInputFiles(caminhoLocal); await resposta;
  if (!retorno) return falha('upload','O CMS não confirmou o upload da fotografia.');
  if (retorno.status>=400) return falha('upload',`O CMS recusou o upload (HTTP ${retorno.status}).`);
  const identidade=extrairIdentidade(retorno.corpo);
  const encontrada=await encontrarEnviada(acervo.dialog,identidade,path.basename(caminhoLocal));
  if (!encontrada) return falha('identificar-upload','O upload foi recebido, mas a imagem criada não ficou identificada de forma única. Selecione-a manualmente.',{respostaStatus:retorno.status});
  const selecao=await selecionarPorId(aba,acervo.dialog,encontrada.id,{nome:encontrada.nome});
  return selecao.ok?{...selecao,arquivo:path.basename(caminhoLocal),
    identificadaPor:identidade.id?'id-da-resposta':identidade.caminho?'caminho-da-resposta':'nome-exato'}:selecao;
}

function metadadosPlanejados(campos) {
  const clima=campos.tipoRadar==='clima';
  return { legenda:clima ? String(campos.titulo||'').trim() : String(campos.legendaImagem||campos.titulo||'').trim(),
    credito:String(campos.creditoImagem||'').trim() || null, preservarCredito:!String(campos.creditoImagem||'').trim(), atualizarGlobal:false };
}

async function editarMetadadosLocais(aba, metadados, { permitir = true } = {}) {
  if (!permitir) return falha('metadados-bloqueados','Legenda e crédito não foram alterados porque a edição local está desativada.',{planejados:metadados});
  if (!normalizar(metadados?.legenda)) return falha('metadados','Não há legenda nem título para aplicar à fotografia.');
  const imageIdAntes=await lerImageId(aba);
  if (!imageIdAntes) return falha('metadados','O formulário não confirmou uma imagem de destaque antes da legenda.');
  const lapis=aba.locator(SEL.lapis);
  if (await lapis.count()!==1) return falha('metadados','O botão de edição da imagem não ficou único.');
  await lapis.click({timeout:ESPERA});
  const modal=aba.locator(SEL.modalImagem);
  if (!await modal.waitFor({state:'visible',timeout:ESPERA}).then(()=>true,()=>false)) return falha('metadados','O modal da imagem não abriu.');
  const legenda=modal.locator(SEL.legenda), credito=modal.locator(SEL.credito), global=modal.locator(SEL.padrao);
  if (await legenda.count()!==1) return falha('metadados','O campo de legenda não foi encontrado.');
  const anteriores={legenda:await legenda.inputValue(),credito:await credito.count()===1?await credito.inputValue():null};
  await legenda.fill(normalizar(metadados.legenda));
  let creditoFinal=anteriores.credito;
  if (metadados.credito) {
    if (await credito.count()!==1) return falha('metadados','Foi informado um crédito, mas o campo de créditos não foi encontrado.');
    await credito.fill(normalizar(metadados.credito)); creditoFinal=normalizar(metadados.credito);
  }
  // A alteração pertence somente a esta matéria. Nunca torna legenda/crédito
  // padrão global da mídia sem uma ação explícita do operador.
  if (await global.count()===1 && await global.isChecked()) await global.uncheck();
  const salvar=modal.locator(SEL.salvar).filter({hasText:/^\s*Salvar\s*$/});
  if (await salvar.count()!==1) return falha('metadados','O botão Salvar da imagem não foi encontrado.');
  let status=null;
  const resposta=aba.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/images/save',{timeout:ESPERA})
    .then(r=>{status=r.status();},()=>{});
  await salvar.click(); await resposta;
  const fechou=await modal.waitFor({state:'hidden',timeout:ESPERA}).then(()=>true,()=>false);
  const imageIdDepois=await lerImageId(aba);
  if (status===null || status>=400 || !fechou) return falha('metadados','O CMS não confirmou o salvamento local da legenda e do crédito.',{status});
  if (imageIdDepois!==imageIdAntes) return falha('metadados','A imagem de destaque mudou durante a edição dos metadados.',{imageIdAntes,imageIdDepois});
  return {ok:true,estado:'metadados-confirmados',legenda:normalizar(metadados.legenda),credito:creditoFinal,
    anterior:anteriores,atualizarGlobal:false,imageId:imageIdDepois,publicada:false};
}

function localizarFotoClima(preferencias, campos) {
  if (campos.tipoRadar!=='clima') return null;
  const cidade=String(campos.cidade||'').trim();
  if (!cidade) return null;
  const entrada=Object.entries(preferencias.fotosClima||{}).find(([nome])=>nome.localeCompare(cidade,'pt-BR',{sensitivity:'base'})===0);
  return entrada ? {cidade:entrada[0],...entrada[1]} : null;
}

function criarPreparadorFotos(preferenciasLocais, { permitirMetadados = true } = {}) {
  return async (aba, entrada, log=async()=>{}) => {
    const campos=entrada.campos||{};
    const preferencias=await preferenciasLocais.ler();
    const padrao=localizarFotoClima(preferencias,campos);
    let selecao;
    if (padrao) {
      await log(`Selecionando fotografia padrão de ${padrao.cidade}…`);
      const acervo=await abrirAcervo(aba); if(!acervo.ok) return {estado:'foto-pendente',avisos:[acervo.mensagem]};
      selecao=await selecionarPorId(aba,acervo.dialog,padrao.id,{nome:padrao.nome});
    } else {
      let caminho=entrada.fotoCaminho||null;
      if (!caminho && campos.imagemNome && preferencias.buscarFotosAutomaticamente!==false) {
        await log('Procurando a fotografia na pasta configurada…');
        const busca=await buscarFotoLocal({pasta:preferencias.pastaFotos,nomeEsperado:campos.imagemNome,ativa:true});
        if (busca.estado!=='encontrada') return {estado:'foto-pendente',avisos:[busca.motivo||'FOTO PENDENTE.'],busca};
        caminho=busca.escolhida.caminho;
      }
      if (!caminho) return {estado:'sem-foto-automatica',avisos:campos.imagemNome?['FOTO PENDENTE — escolha a imagem manualmente.']:[]};
      await log('Enviando e confirmando a fotografia…'); selecao=await enviarESelecionar(aba,caminho);
    }
    if (!selecao.ok) return {estado:'foto-pendente',avisos:[selecao.mensagem],diagnostico:selecao};
    const metadados=metadadosPlanejados(campos);
    const edicao=await editarMetadadosLocais(aba,metadados,{permitir:permitirMetadados});
    const avisos=[];
    if (!edicao.ok) avisos.push(edicao.mensagem);
    return {estado:edicao.ok?'foto-e-metadados-confirmados':'foto-confirmada-metadados-pendentes',imageId:selecao.imageId,
      metadados:edicao.ok?edicao:null,avisos,publicada:false};
  };
}

function criarSeletorFotosCms({criarAba,garantirLogin}) {
  let aba=null;
  async function obterAba() {
    if (!aba || aba.isClosed()) aba=await criarAba();
    if (!aba.url().startsWith(URL_ADICIONAR)) {
      await aba.goto(ORIGEM,{waitUntil:'domcontentloaded'});
      if (!await garantirLogin(aba)) throw new Error('Faça login no CMS para consultar o banco de imagens.');
      await aba.goto(URL_ADICIONAR,{waitUntil:'domcontentloaded'});
      await aba.locator('#inp_title').waitFor({state:'visible',timeout:ESPERA});
    }
    return aba;
  }
  return {
    async buscar(termo) { return listarFotosAcervo(await obterAba(),termo); },
    async encerrar() { if (aba && !aba.isClosed()) await aba.close().catch(()=>{}); aba=null; }
  };
}

module.exports={criarPreparadorFotos,criarSeletorFotosCms,enviarESelecionar,selecionarPorId,extrairIdentidade,
  metadadosPlanejados,editarMetadadosLocais,localizarFotoClima,listarFotosAcervo,abrirAcervo,lerImageId,SEL};
