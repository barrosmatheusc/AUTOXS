(() => {
  const $ = seletor => document.querySelector(seletor);
  const dialogo = $('#configuracoes');
  const quadro = $('.coluna-producao iframe');
  const padroes = { tema:'escuro', tamanho:'normal', logsDetalhados:false,
    confirmacoes:false, pastaVideos:null };
  let preferencias = { ...padroes };
  let versao = '—';
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
    $('#config-info-tecnica').textContent = `AutoXS ${versao} · painel local · tema ${tema} · tamanho ${preferencias.tamanho}.`;
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
        aplicar();
        informar('Preferências salvas neste computador.');
      } catch (erro) {
        aplicar();
        informar(erro.message, true);
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
  window.confirmarInicioAtualizacao = pagina =>
    !preferencias.confirmacoes || confirm(`Iniciar a atualização da página ${pagina}?`);

  $('#abrir-configuracoes').addEventListener('click', () => {
    informar('');
    dialogo.showModal();
  });
  $('#fechar-configuracoes').addEventListener('click', () => dialogo.close());
  dialogo.addEventListener('click', evento => { if (evento.target === dialogo) dialogo.close(); });
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
  $('#restaurar-configuracoes').addEventListener('click', async () => {
    if (!confirm('Restaurar as preferências padrão deste computador?')) return;
    await fila;
    try {
      const resposta = await operacao({ acao:'restaurar' });
      preferencias = resposta.preferencias;
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
      aplicar();
    } catch (erro) { aplicar(); informar(erro.message, true); }
  })();
})();
