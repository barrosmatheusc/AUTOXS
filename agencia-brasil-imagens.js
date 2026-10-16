// Executada no contexto da página: analisa uma cópia inerte do HTML do corpo.
function analisarImagensAgenciaBrasil(html) {
  const modelo = document.createElement('template');
  modelo.innerHTML = String(html || '');
  const normalizar = valor => String(valor || '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const agencia = valor => /\b(?:agencia brasil|agenciabrasil)\b/.test(normalizar(valor));
  const marca = valor => /\b(?:logo|logotipo|marca|identidade visual)\b/.test(normalizar(valor));
  const credito = valor => /^(?:foto|fotografia|imagem|credito)\s+(?:da\s+)?agencia brasil\b/.test(normalizar(valor));
  const nomeArquivo = valor => {
    try {
      const caminho = decodeURIComponent(String(valor || '').split(/[?#]/)[0]);
      return caminho.split('/').pop() || '';
    } catch { return ''; }
  };
  const imagens = [...modelo.content.querySelectorAll('img')];
  const confirmadas = [];
  const ambiguas = [];
  imagens.forEach((imagem, indice) => {
    const rotulos = ['alt', 'title', 'aria-label', 'id', 'class', 'data-type', 'data-role']
      .map(atributo => imagem.getAttribute(atributo) || '').filter(Boolean);
    const urls = ['src', 'data-src', 'data-original'].map(atributo => imagem.getAttribute(atributo) || '')
      .concat((imagem.getAttribute('srcset') || '').split(',').map(item => item.trim().split(/\s+/)[0]))
      .filter(Boolean);
    const nomes = urls.map(nomeArquivo);
    const identificada = rotulos.some(valor => agencia(valor) && marca(valor)) ||
      nomes.some(valor => agencia(valor) && marca(valor));
    const suspeita = rotulos.some(valor => agencia(valor) && !credito(valor)) ||
      nomes.some(agencia);
    if (identificada && !imagem.closest('picture')) {
      const figura = imagem.closest('figure');
      if (!figura) {
        confirmadas.push(imagem);
      } else {
        const filhos = [...figura.children];
        const conteudo = filhos.length === 1 ? filhos[0] : null;
        const unicoNo = conteudo === imagem ||
          (conteudo?.tagName === 'A' && Boolean(conteudo.getAttribute('href')) &&
            conteudo.children.length === 1 && conteudo.firstElementChild === imagem);
        // O figure do editor só pode conter a imagem (e seu link). Texto,
        // legenda, outra mídia ou estrutura desconhecida exigem revisão.
        if (figura.getAttribute('data-rx-type') === 'image' &&
            unicoNo && !figura.textContent.trim()) confirmadas.push(figura);
        else ambiguas.push(indice + 1);
      }
    } else if (identificada || suspeita) ambiguas.push(indice + 1);
  });
  // Uma dúvida em qualquer imagem impede alterações parciais antes da revisão.
  if (ambiguas.length) return { html: String(html || ''), removidas: 0, ambiguas };
  for (const elemento of confirmadas) elemento.remove();
  return {
    html: confirmadas.length ? modelo.innerHTML : String(html || ''),
    removidas: confirmadas.length,
    ambiguas: []
  };
}

async function prepararImagensAgenciaBrasil(aba) {
  const editor = aba.locator('.rx-editor');
  const fonte = aba.locator('.rx-source');
  const alternar = aba.locator('a[data-command="source.toggle"]');
  if (await editor.count() !== 1 || await fonte.count() !== 1 || await alternar.count() !== 1) {
    return { ok: false, removidas: 0, aviso: 'Editor da matéria não identificado; confira a imagem da Agência Brasil manualmente.' };
  }
  const fonteAberta = await fonte.isVisible();
  // O HTML submetido pelo formulário pode estar defasado em relação ao editor.
  // Confira as duas representações antes de considerar a limpeza concluída.
  const campoTexto = aba.locator('#inp_text, textarea[name="text"]');
  const htmlFormulario = await campoTexto.count() === 1 ? await campoTexto.inputValue() : '';
  const formulario = htmlFormulario ? await aba.evaluate(analisarImagensAgenciaBrasil, htmlFormulario) : null;
  if (formulario?.ambiguas.length) {
    return { ok: false, removidas: 0, aviso: 'Imagem ambígua no HTML da matéria; revisão manual necessária.' };
  }
  let previa = null;
  if (!fonteAberta) {
    previa = await aba.evaluate(analisarImagensAgenciaBrasil, await editor.innerHTML());
    if (previa.ambiguas.length) return { ok: false, removidas: 0, aviso: 'Imagem possivelmente ligada à Agência Brasil no corpo; revisão manual necessária.' };
    if (formulario?.removidas && !previa.removidas) {
      return { ok: false, removidas: 0, aviso: 'Logotipo presente no HTML do formulário, mas ausente no editor; revisão manual necessária.' };
    }
    if (!previa.removidas && !formulario?.removidas) return { ok: true, removidas: 0 };
    await alternar.click();
    await fonte.waitFor({ state: 'visible' });
  }
  const original = await fonte.inputValue();
  const resultado = await aba.evaluate(analisarImagensAgenciaBrasil, original);
  if (resultado.ambiguas.length || ((previa?.removidas || formulario?.removidas) && !resultado.removidas)) {
    if (!fonteAberta) await alternar.click();
    return { ok: false, removidas: 0, aviso: 'Identificação da imagem não é consistente no editor HTML; revisão manual necessária.' };
  }
  if (!resultado.removidas) {
    if (!fonteAberta) await alternar.click();
    return { ok: true, removidas: 0 };
  }
  await fonte.fill(resultado.html);
  await alternar.click();
  await editor.waitFor({ state: 'visible' });
  const depois = await aba.evaluate(analisarImagensAgenciaBrasil, await editor.innerHTML());
  const htmlEnviado = await campoTexto.count() === 1 ? await campoTexto.inputValue() : '';
  const persistido = htmlEnviado ? await aba.evaluate(analisarImagensAgenciaBrasil, htmlEnviado) : null;
  if (depois.removidas || depois.ambiguas.length || persistido?.removidas || persistido?.ambiguas.length) {
    return { ok: false, removidas: resultado.removidas, aviso: 'Não foi possível confirmar a limpeza no editor; revisão manual necessária.' };
  }
  return { ok: true, removidas: resultado.removidas };
}

module.exports = { analisarImagensAgenciaBrasil, prepararImagensAgenciaBrasil };
