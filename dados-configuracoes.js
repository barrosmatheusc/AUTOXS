(() => {
  const $ = seletor => document.querySelector(seletor);
  let token = null;
  let ocupado = false;
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
    token = null;
    $('#dados-previa').hidden = true;
    $('#dados-arquivo').value = '';
  }
  $('#dados-importar').addEventListener('click', () => {
    if (!ocupado) $('#dados-arquivo').click();
  });
  $('#dados-arquivo').addEventListener('change', async evento => {
    const arquivo = evento.target.files?.[0];
    limparPrevia();
    if (!arquivo) return;
    if (arquivo.size > 5_000_000) { recado('Escolha um JSON de até 5 MB.', true); return; }
    ocupado = true;
    try {
      recado('Validando arquivo e comparando com o histórico local...');
      const resposta = await chamar({ acao:'prever', conteudo:await arquivo.text() });
      token = resposta.token;
      const p = resposta.previa;
      $('#dados-resumo').textContent = `${p.novos} novo(s) · ${p.atualizados} atualizado(s) · ${p.repetidos} repetido(s) · ${p.expirados} de outros dias · ${p.invalidos} inválido(s) · ${p.ambiguos} ambíguo(s).`;
      $('#dados-titulos').replaceChildren(...p.titulosNovos.map(titulo => {
        const item = document.createElement('li'); item.textContent = titulo || 'Matéria sem título'; return item;
      }));
      $('#dados-confirmar').disabled = p.novos === 0 && p.atualizados === 0;
      $('#dados-previa').hidden = false;
      recado('Confira a prévia antes de confirmar.');
    } catch (erro) { recado(erro.message, true); }
    finally { ocupado = false; }
  });
  $('#dados-cancelar').addEventListener('click', () => { limparPrevia(); recado('Importação cancelada. Nenhum dado foi alterado.'); });
  $('#dados-confirmar').addEventListener('click', async () => {
    if (!token || ocupado) return;
    if (!confirm('Importar somente os registros novos e seguros de hoje? Um backup local será criado antes da gravação.')) return;
    ocupado = true;
    try {
      recado('Criando backup e mesclando registros...');
      const resposta = await chamar({ acao:'confirmar', token });
      limparPrevia();
      recado(`${resposta.resultado.novos} registro(s) importado(s), ${resposta.resultado.atualizados} atualizado(s). Histórico anterior preservado.`);
    } catch (erro) { recado(erro.message, true); }
    finally { ocupado = false; }
  });
  $('#dados-exportar').addEventListener('click', async () => {
    if (ocupado) return;
    ocupado = true;
    try {
      recado('Preparando os registros de hoje...');
      const resposta = await chamar({ acao:'exportar' });
      recado(resposta.resultado.cancelado ? 'Exportação cancelada.' :
        `${resposta.resultado.registros} registro(s) exportado(s) para ${resposta.resultado.destino}.`);
    } catch (erro) { recado(erro.message, true); }
    finally { ocupado = false; }
  });
})();
