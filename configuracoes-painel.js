(() => {
  const $ = seletor => document.querySelector(seletor);
  const dialogo = $('#configuracoes');
  const quadro = $('.coluna-producao iframe');
  const padroes = { tema:'escuro', tamanho:'normal', logsDetalhados:false,
    confirmacoes:false, pastaVideos:null, buscarFotosAutomaticamente:true,
    pastaFotos:'G:\\Meu Drive\\Tribuna', fotosClima:{} };
  let preferencias = { ...padroes };
  let versao = '—';
  let pastaFotosDisponivel = null;
  let fotoClimaSelecionada = null;
  let fila = Promise.resolve();
  const registros = [];

  function informar(mensagem, erro = false) {
    $('#config-estado').textContent = mensagem;
    $('#config-estado').style.color = erro ? '#ffbbb5' : '';
  }
  function temaResolvido() {
    return preferencias.tema === 'automatico'
      ? (matchMedia('(prefers-color-scheme: light)').matches ? 'claro' : 'escuro')
      : preferencias.tema;
  }
  function aplicar() {
    const tema = temaResolvido();
    document.documentElement.dataset.tema = tema;
    document.documentElement.dataset.tamanho = preferencias.tamanho;
    quadro.contentWindow?.postMessage({ tipo:'autoxs-aparencia', tema,
      tamanho:preferencias.tamanho }, '*');
    $('#config-tema').value = preferencias.tema;
    $('#config-tamanho').value = preferencias.tamanho;
    $('#config-logs').checked = preferencias.logsDetalhados;
    $('#config-confirmacoes').checked = preferencias.confirmacoes;
    $('#config-destino').value = preferencias.pastaVideos ? 'personalizado' : 'downloads';
    $('#config-pasta-atual').textContent = preferencias.pastaVideos || 'Downloads do Windows';
    $('#config-versao').textContent = versao;
    $('#config-buscar-fotos').checked = preferencias.buscarFotosAutomaticamente !== false;
    $('#config-pasta-fotos').value = preferencias.pastaFotos || '';
    $('#config-pasta-fotos-estado').textContent = !preferencias.pastaFotos ? 'Pasta não configurada.'
      : pastaFotosDisponivel === false ? 'Pasta indisponível neste computador. A matéria ficará com FOTO PENDENTE.'
      : pastaFotosDisponivel === true ? 'Pasta disponível neste computador.' : 'Configuração local deste computador.';
    renderizarFotosClima();
    $('#config-info-tecnica').textContent = `AutoXS ${versao} · painel local · tema ${tema} · tamanho ${preferencias.tamanho}.`;
  }
  function renderizarFotosClima() {
    const lista = $('#config-clima-lista');
    lista.replaceChildren();
    const entradas = Object.entries(preferencias.fotosClima || {}).sort(([a],[b]) => a.localeCompare(b, 'pt-BR'));
    if (!entradas.length) { lista.textContent = 'Nenhuma cidade cadastrada.'; return; }
    for (const [cidade, foto] of entradas) {
      const item = document.createElement('div'); item.className = 'config-pasta';
      const texto = document.createElement('span'); texto.textContent = `${cidade} — mídia ${foto.id}${foto.nome ? ` — ${foto.nome}` : ''}`;
      if (foto.url) { const img=document.createElement('img'); img.src=foto.url; img.alt=`Fotografia padrão de ${cidade}`; img.width=80; img.height=52; img.style.objectFit='cover'; item.append(img); }
      const excluir = document.createElement('button'); excluir.type='button'; excluir.textContent='Excluir';
      excluir.addEventListener('click', async () => {
        if (!await window.confirmarAutoXS(`Excluir a fotografia padrão de ${cidade}?`)) return;
        const fotosClima={...(preferencias.fotosClima||{})}; delete fotosClima[cidade]; await salvar({fotosClima});
      });
      item.append(texto, excluir); lista.append(item);
    }
  }
  function renderizarResultadoFotos(itens) {
    const lista=$('#config-clima-resultados'); lista.replaceChildren();
    if (!itens.length) { lista.textContent='Nenhuma fotografia encontrada com esse termo.'; return; }
    for (const foto of itens) {
      const botao=document.createElement('button'); botao.type='button'; botao.className='config-foto-opcao';
      botao.setAttribute('aria-pressed',String(fotoClimaSelecionada?.id===foto.id));
      if (foto.url) { const imagem=document.createElement('img'); imagem.src=foto.url; imagem.alt=foto.nome||`Mídia ${foto.id}`; botao.append(imagem); }
      const texto=document.createElement('span'); texto.textContent=`${foto.nome||'Sem nome'} · mídia ${foto.id}`; botao.append(texto);
      botao.addEventListener('click',()=>{
        fotoClimaSelecionada=foto;
        $('#config-clima-id').value=foto.id; $('#config-clima-url').value=foto.url||'';
        lista.querySelectorAll('button').forEach(item=>item.setAttribute('aria-pressed',String(item===botao)));
        $('#config-clima-estado').textContent=`Selecionada: ${foto.nome||`mídia ${foto.id}`}.`;
      });
      lista.append(botao);
    }
  }
  async function operacao(pedido) {
    const resposta = await window.configuracoesAutoXS(pedido);
    if (!resposta?.ok) throw new Error(resposta?.mensagem || 'Não foi possível atualizar as configurações.');
    return resposta;
  }
  function salvar(alteracoes) {
    const executar = async () => {
      try {
        const resposta = await operacao({ acao:'salvar', preferencias:{ ...preferencias, ...alteracoes } });
        preferencias = resposta.preferencias;
        pastaFotosDisponivel = resposta.pastaFotosDisponivel;
        aplicar();
        informar('Preferências salvas neste computador.');
        return true;
      } catch (erro) {
        aplicar();
        informar(erro.message, true);
        return false;
      }
    };
    fila = fila.then(executar);
    return fila;
  }
  function registrar(mensagem) {
    if (!preferencias.logsDetalhados) return;
    registros.push(`${new Date().toLocaleTimeString('pt-BR')}  ${String(mensagem).slice(0, 500)}`);
    if (registros.length > 200) registros.shift();
    $('#config-registros').textContent = registros.join('\n') || 'Nenhuma mensagem registrada nesta sessão.';
  }

  const exibirProgressoOriginal = window.exibirProgresso;
  window.exibirProgresso = mensagem => {
    registrar(mensagem);
    return exibirProgressoOriginal(mensagem);
  };
  window.confirmarInicioAtualizacao = async pagina =>
    !preferencias.confirmacoes || await window.confirmarAutoXS(`Iniciar a atualização da página ${pagina}?`);

  $('#abrir-configuracoes').addEventListener('click', () => {
    informar('');
    dialogo.showModal();
  });
  $('#fechar-configuracoes').addEventListener('click', () => dialogo.close());
  dialogo.addEventListener('click', evento => { if (evento.target === dialogo) dialogo.close(); });
  dialogo.addEventListener('close',()=>{ void operacao({acao:'fecharFotosCms'}).catch(()=>{}); });
  dialogo.querySelectorAll('[data-config-aba]').forEach(botao => botao.addEventListener('click', () => {
    dialogo.querySelectorAll('[data-config-aba]').forEach(item =>
      item.setAttribute('aria-current', String(item === botao)));
    dialogo.querySelectorAll('[data-config-secao]').forEach(secao =>
      { secao.hidden = secao.dataset.configSecao !== botao.dataset.configAba; });
  }));
  $('#config-tema').addEventListener('change', evento => void salvar({ tema:evento.target.value }));
  $('#config-tamanho').addEventListener('change', evento => void salvar({ tamanho:evento.target.value }));
  $('#config-logs').addEventListener('change', evento => void salvar({ logsDetalhados:evento.target.checked }));
  $('#config-confirmacoes').addEventListener('change', evento => void salvar({ confirmacoes:evento.target.checked }));
  $('#config-destino').addEventListener('change', evento => {
    if (evento.target.value === 'downloads') void salvar({ pastaVideos:null });
    else if (!preferencias.pastaVideos) $('#config-escolher-pasta').click();
  });
  $('#config-escolher-pasta').addEventListener('click', async () => {
    try {
      const resposta = await operacao({ acao:'escolherPasta' });
      if (resposta.pasta) await salvar({ pastaVideos:resposta.pasta });
      else aplicar();
    } catch (erro) { aplicar(); informar(erro.message, true); }
  });
  $('#config-buscar-fotos').addEventListener('change', evento => void salvar({ buscarFotosAutomaticamente:evento.target.checked }));
  $('#config-escolher-pasta-fotos').addEventListener('click', async () => {
    try {
      const resposta = await operacao({ acao:'escolherPastaFotos' });
      if (resposta.pasta) await salvar({ pastaFotos:resposta.pasta });
      else aplicar();
    } catch (erro) { aplicar(); informar(erro.message, true); }
  });
  $('#config-clima-buscar').addEventListener('click', async () => {
    const cidade=$('#config-clima-cidade').value.normalize('NFC').trim();
    const termo=($('#config-clima-termo').value||cidade).normalize('NFC').trim();
    if (!cidade) return informar('Informe primeiro a cidade que receberá esta fotografia.',true);
    const botao=$('#config-clima-buscar'); botao.disabled=true; $('#config-clima-estado').textContent='Consultando o banco do CMS…';
    try {
      const resposta=await operacao({acao:'buscarFotosCms',termo});
      fotoClimaSelecionada=null; renderizarResultadoFotos(resposta.itens||[]);
      $('#config-clima-estado').textContent=`${(resposta.itens||[]).length} fotografia(s) encontrada(s). Escolha uma miniatura.`;
    } catch (erro) { $('#config-clima-estado').textContent=erro.message; informar(erro.message,true); }
    finally { botao.disabled=false; }
  });
  $('#config-clima-id').addEventListener('input',()=>{ if (fotoClimaSelecionada?.id!==$('#config-clima-id').value.trim()) fotoClimaSelecionada=null; });
  $('#config-clima-salvar').addEventListener('click', async () => {
    const cidade=$('#config-clima-cidade').value.normalize('NFC').trim();
    const id=$('#config-clima-id').value.trim();
    const url=$('#config-clima-url').value.trim();
    if (!cidade || !/^\d+$/.test(id) || (url && !/^https?:\/\//i.test(url))) return informar('Informe cidade, ID numérico real e uma URL válida quando usada.', true);
    const nome=fotoClimaSelecionada?.id===id ? fotoClimaSelecionada.nome : '';
    if (!await salvar({ fotosClima:{...(preferencias.fotosClima||{}), [cidade]:{id,url,nome}} })) return;
    await operacao({acao:'fecharFotosCms'}).catch(()=>{});
    fotoClimaSelecionada=null;
    $('#config-clima-cidade').value=''; $('#config-clima-termo').value=''; $('#config-clima-id').value=''; $('#config-clima-url').value='';
    $('#config-clima-resultados').replaceChildren(); $('#config-clima-estado').textContent='Associação salva neste computador.';
  });
  $('#restaurar-configuracoes').addEventListener('click', async () => {
    if (!await window.confirmarAutoXS('Restaurar as preferências padrão deste computador?')) return;
    await fila;
    try {
      const resposta = await operacao({ acao:'restaurar' });
      preferencias = resposta.preferencias;
      pastaFotosDisponivel = resposta.pastaFotosDisponivel;
      aplicar();
      informar('Preferências padrão restauradas.');
    } catch (erro) { informar(erro.message, true); }
  });
  quadro.addEventListener('load', aplicar);
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (preferencias.tema === 'automatico') aplicar();
  });
  void (async () => {
    try {
      const resposta = await operacao({ acao:'obter' });
      preferencias = resposta.preferencias;
      versao = resposta.versao;
      pastaFotosDisponivel = resposta.pastaFotosDisponivel;
      aplicar();
    } catch (erro) { aplicar(); informar(erro.message, true); }
  })();
})();
