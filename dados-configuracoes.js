(() => {
  const $ = seletor => document.querySelector(seletor);
  // Mesma ordem e os mesmos nomes exibidos no painel de Estatísticas do dia.
  const NUMEROS = [['concluidas', 'Matérias concluídas'],
    ['atualizacoesAutomaticas', 'Atualizações automáticas'],
    ['finalizadasManualmente', 'Finalizações manuais'],
    ['aguardandoRevisao', 'Aguardando revisão'],
    ['adicionadas', 'Enviar Matérias'], ['erros', 'Erros']];
  const diaBR = dia => /^\d{4}-\d{2}-\d{2}$/.test(dia || '')
    ? dia.split('-').reverse().join('/') : 'data não informada';
  const horaBR = iso => {
    const data = new Date(iso);
    return Number.isNaN(data.getTime()) ? '' : ` às ${data.toLocaleTimeString('pt-BR')}`;
  };
  const curto = id => String(id || '').slice(0, 8);
  let token = null;
  let ocupado = false;
  let podeConfirmar = false;
  let versaoPrevia = 0;
  function bloquear(ativo) {
    ocupado = ativo;
    for (const id of ['dados-importar', 'dados-exportar', 'dados-confirmar'])
      $('#' + id).disabled = ativo;
    $('#dados-estado').setAttribute('aria-busy', String(ativo));
  }
  function recado(texto, erro = false) {
    $('#dados-estado').textContent = texto;
    $('#dados-estado').style.color = erro ? '#ffbbb5' : '';
  }
  async function chamar(pedido) {
    const resposta = await window.dadosAutoXS(pedido);
    if (!resposta?.ok) throw new Error(resposta?.mensagem || 'Operação não concluída.');
    return resposta;
  }
  function limparPrevia() {
    versaoPrevia++;
    token = null;
    podeConfirmar = false;
    $('#dados-previa').hidden = true;
    $('#dados-arquivo').value = '';
  }
  $('#dados-importar').addEventListener('click', () => {
    if (ocupado) return;
    $('#dados-arquivo').value = ''; // Permite selecionar novamente o mesmo arquivo.
    recado('Selecione o arquivo JSON para conferir a prévia.');
    $('#dados-arquivo').click();
  });
  $('#dados-arquivo').addEventListener('change', async evento => {
    const arquivo = evento.target.files?.[0];
    limparPrevia();
    const versao = versaoPrevia;
    if (!arquivo) return;
    if (arquivo.size > 5_000_000) { recado('Escolha um JSON de até 5 MB.', true); return; }
    bloquear(true);
    try {
      recado('Validando arquivo e comparando com o histórico local...');
      const resposta = await chamar({ acao:'prever', conteudo:await arquivo.text() });
      if (versao !== versaoPrevia) return;
      token = resposta.token;
      const p = resposta.previa;
      podeConfirmar = p.novosTotais + p.atualizadosTotais + p.novosLinks > 0;
      const doc = p.arquivo || {};
      $('#dados-origem').textContent = doc.propria
        ? `Este arquivo foi exportado por ESTE computador (${curto(doc.instalacao)}), dia ${diaBR(doc.dia)}${horaBR(doc.exportadoEm)}. Os números locais já estão no painel e não serão somados outra vez.`
        : `Origem: computador ${curto(doc.instalacao)} · Data dos registros: ${diaBR(doc.dia)} · Exportado${horaBR(doc.exportadoEm)}.`;
      $('#dados-numeros').replaceChildren(...NUMEROS.map(([chave, nome]) => {
        const recebido = p.recebidos?.[chave] ?? 0;
        const somar = p.acrescimo?.[chave] ?? 0;
        const contado = p.jaContabilizados?.[chave] ?? 0;
        const item = document.createElement('li');
        item.textContent = `${nome}: ${recebido} recebido(s) · ${somar >= 0 ? '+' : ''}${somar} no painel${contado ? ` · ${contado} já contabilizado(s)` : ''}`;
        return item;
      }));
      $('#dados-resumo').textContent = `Resultado previsto: ${p.novosTotais} origem(ns) nova(s) · ${p.atualizadosTotais} total(is) atualizado(s) · ${p.novosLinks} link(s) novo(s) · ${p.linksRepetidos ?? 0} link(s) duplicado(s) · ${p.repetidos} item(ns) já contabilizado(s) · ${p.expirados} de outros dias · ${p.invalidos} inválido(s) · ${p.ambiguos} ambíguo(s).`;
      $('#dados-links-rotulo').hidden = !p.titulosNovos.length;
      $('#dados-titulos').replaceChildren(...p.titulosNovos.map(titulo => {
        const item = document.createElement('li'); item.textContent = titulo || 'Matéria sem título'; return item;
      }));
      $('#dados-previa').hidden = false;
      recado(podeConfirmar
        ? 'Prévia pronta. Confira os totais e links antes de confirmar.'
        : doc.propria
          ? 'Nada a importar: o arquivo é deste mesmo computador e seus números já estão no painel.'
          : 'Nada a importar: estes dados já estão contabilizados no painel ou são de outros dias.');
    } catch (erro) { if (versao === versaoPrevia) recado(erro.message, true); }
    finally { bloquear(false); $('#dados-confirmar').disabled = !podeConfirmar; }
  });
  $('#dados-cancelar').addEventListener('click', () => { limparPrevia(); recado('Importação cancelada. Nenhum dado foi alterado.'); });
  $('#dados-confirmar').addEventListener('click', async () => {
    if (!token || ocupado) return;
    if (!await window.confirmarAutoXS('Importar somente os totais e links novos de hoje? Um backup local será criado antes da gravação.')) return;
    bloquear(true);
    try {
      recado('Criando backup e mesclando registros...');
      const resposta = await chamar({ acao:'confirmar', token });
      limparPrevia();
      recado(`${resposta.resultado.novosTotais} origem(ns) nova(s), ${resposta.resultado.atualizadosTotais} total(is) atualizado(s) e ${resposta.resultado.novosLinks} link(s) importado(s). Histórico anterior preservado.`);
    } catch (erro) { recado(erro.message, true); }
    finally { bloquear(false); $('#dados-confirmar').disabled = !podeConfirmar; }
  });
  $('#dados-exportar').addEventListener('click', async () => {
    if (ocupado) return;
    bloquear(true);
    try {
      recado('Preparando os registros de hoje...');
      const resposta = await chamar({ acao:'exportar' });
      recado(resposta.resultado.cancelado ? 'Exportação cancelada.' :
        `${resposta.resultado.estatisticas} conjunto(s) de totais e ${resposta.resultado.links} link(s) exportado(s) para ${resposta.resultado.destino}.`);
    } catch (erro) { recado(erro.message, true); }
    finally { bloquear(false); $('#dados-confirmar').disabled = !podeConfirmar; }
  });
})();
