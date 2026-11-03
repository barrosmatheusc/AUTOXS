// Interface local de download e transcrição. O processamento permanece no processo Node.
(() => {
  const campos = {
    url:document.querySelector('#url-instagram'),
    pasta:document.querySelector('#pasta-destino'),
    escolher:document.querySelector('#escolher-pasta'),
    processar:document.querySelector('#baixar-transcrever'),
    cancelar:document.querySelector('#cancelar-processamento'),
    repetir:document.querySelector('#repetir-transcricao'),
    abrir:document.querySelector('#abrir-pasta-video'),
    statusDownload:document.querySelector('#status-download'),
    statusTranscricao:document.querySelector('#status-transcricao'),
    arquivo:document.querySelector('#arquivo-salvo'),
    etapas:document.querySelector('#etapas-processamento'),
    transcricao:document.querySelector('#transcricao'),
    copiar:document.querySelector('#copiar-transcricao'),
    salvar:document.querySelector('#salvar-transcricao')
  };
  let processando = false;
  let linkProcessado = null;

  function estado(elemento,texto,erro=false) {
    elemento.textContent=texto;
    elemento.classList.toggle('erro',erro);
  }
  function ocupado(sim) {
    processando=sim;
    campos.processar.disabled=sim;
    campos.cancelar.disabled=!sim;
    campos.escolher.disabled=sim;
    campos.repetir.disabled=sim;
    campos.url.disabled=sim;
  }
  function etapa(texto) {
    const item=document.createElement('li');
    item.textContent=texto;
    campos.etapas.append(item);
    campos.etapas.scrollTop=campos.etapas.scrollHeight;
    if (/baixando|validando publicação|download concluído|salvando vídeo|vídeo salvo/i.test(texto))
      estado(campos.statusDownload,texto,texto.startsWith('❌'));
    else if (/extraindo áudio|transcrevendo|transcrição|fala identificável/i.test(texto))
      estado(campos.statusTranscricao,texto,texto.startsWith('❌'));
    if (texto.startsWith('✅ Vídeo salvo: ')) {
      campos.arquivo.hidden=false;
      campos.arquivo.textContent=texto;
      campos.abrir.hidden=false;
    }
  }
  window.atualizarProcessamentoVideos=etapa;
  window.atualizarPastaVideos=(pasta,erro=false)=>estado(campos.pasta,pasta,erro);

  campos.escolher.addEventListener('click',async()=>{
    if(processando) return;
    campos.escolher.disabled=true;
    try {
      const resultado=await window.operacaoGeradorVideos({acao:'escolherPastaDestino'});
      if(!resultado.cancelado) window.atualizarPastaVideos(resultado.pasta);
    } catch(erro) { estado(campos.statusDownload,`Falha ao escolher pasta: ${erro.message}`,true); }
    finally { campos.escolher.disabled=false; }
  });
  campos.processar.addEventListener('click',async()=>{
    if(processando) return;
    ocupado(true);
    campos.etapas.replaceChildren();
    campos.repetir.hidden=true;
    estado(campos.statusDownload,'Iniciando download...');
    estado(campos.statusTranscricao,'Aguardando download...');
    const link=campos.url.value.trim();
    try {
      const resultado=await window.operacaoGeradorVideos({acao:'processar',url:link});
      linkProcessado=link;
      campos.arquivo.hidden=false;
      campos.arquivo.textContent=`Vídeo salvo: ${resultado.caminho}`;
      campos.abrir.hidden=false;
      campos.transcricao.value=resultado.transcricao || '';
      estado(campos.statusDownload,`Vídeo salvo em ${resultado.caminho}`);
      if(resultado.erroTranscricao) {
        campos.repetir.hidden=false;
        estado(campos.statusTranscricao,`Falha na transcrição: ${resultado.erroTranscricao}`,true);
      } else estado(campos.statusTranscricao,resultado.transcricao?'Transcrição concluída.':'Vídeo sem fala identificável.');
    } catch(erro) {
      const mensagem=erro.message || 'Não foi possível baixar o vídeo.';
      etapa(`❌ ${mensagem}`);
      if (campos.arquivo.hidden) estado(campos.statusDownload,mensagem,true);
      else estado(campos.statusTranscricao,mensagem,true);
    } finally { ocupado(false); }
  });
  campos.cancelar.addEventListener('click',async()=>{
    if(!processando) return;
    campos.cancelar.disabled=true;
    try {
      await window.operacaoGeradorVideos({acao:'cancelar'});
      estado(campos.arquivo.hidden ? campos.statusDownload : campos.statusTranscricao,'Processamento cancelado.');
    }
    catch(erro) { estado(campos.statusDownload,`Falha ao cancelar: ${erro.message}`,true); }
  });
  campos.repetir.addEventListener('click',async()=>{
    if(processando || !linkProcessado) return;
    ocupado(true);
    estado(campos.statusTranscricao,'Tentando transcrever novamente...');
    try {
      const resultado=await window.operacaoGeradorVideos({acao:'transcrever',url:linkProcessado});
      campos.transcricao.value=resultado.transcricao || '';
      campos.repetir.hidden=true;
      estado(campos.statusTranscricao,resultado.transcricao?'Transcrição concluída.':'Vídeo sem fala identificável.');
    } catch(erro) { estado(campos.statusTranscricao,`Falha na transcrição: ${erro.message}`,true); }
    finally { ocupado(false); }
  });
  campos.abrir.addEventListener('click',async()=>{
    try { await window.operacaoGeradorVideos({acao:'abrirPastaVideo'}); }
    catch(erro) { estado(campos.statusDownload,`Não foi possível abrir a pasta: ${erro.message}`,true); }
  });
  campos.copiar.addEventListener('click',async()=>{
    try { await navigator.clipboard.writeText(campos.transcricao.value); estado(campos.statusTranscricao,'Transcrição copiada.'); }
    catch { estado(campos.statusTranscricao,'Não foi possível copiar a transcrição.',true); }
  });
  campos.salvar.addEventListener('click',()=>{
    const arquivo=new Blob([campos.transcricao.value],{type:'text/plain;charset=utf-8'});
    const endereco=URL.createObjectURL(arquivo);
    const link=document.createElement('a');
    link.href=endereco;
    link.download='transcricao-video.txt';
    link.click();
    setTimeout(()=>URL.revokeObjectURL(endereco),30000);
  });
})();
