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
        const tipoEditor = figura.getAttribute('data-rx-type');
        const somenteEspacos = elemento => [...elemento.childNodes].every(no =>
          no.nodeType === Node.ELEMENT_NODE ||
          (no.nodeType === Node.TEXT_NODE && !no.textContent.trim()));
        if ((!tipoEditor || tipoEditor === 'image') && unicoNo &&
            somenteEspacos(figura) && (conteudo === imagem || somenteEspacos(conteudo)) &&
            !figura.textContent.trim()) confirmadas.push(figura);
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
  if (await campoTexto.count() !== 1) {
    return { ok: false, removidas: 0, aviso: 'Campo HTML enviado pelo formulário não identificado; revisão manual necessária.' };
  }
  const htmlFormulario = await campoTexto.inputValue();
  const formulario = htmlFormulario ? await aba.evaluate(analisarImagensAgenciaBrasil, htmlFormulario) : null;
  if (formulario?.ambiguas.length) {
    return { ok: false, removidas: 0, aviso: 'Imagem ambígua no HTML da matéria; revisão manual necessária.' };
  }
  let previa = null;
  if (!fonteAberta) {
    previa = await aba.evaluate(analisarImagensAgenciaBrasil, await editor.innerHTML());
    if (previa.ambiguas.length) return { ok: false, removidas: 0, aviso: 'Imagem possivelmente ligada à Agência Brasil no corpo; revisão manual necessária.' };
    if (!previa.removidas && !formulario?.removidas) return { ok: true, removidas: 0 };
    await alternar.click();
    await fonte.waitFor({ state: 'visible' });
  }
  const original = await fonte.inputValue();
  const resultado = await aba.evaluate(analisarImagensAgenciaBrasil, original);
  if (resultado.ambiguas.length || (previa?.removidas && !resultado.removidas)) {
    return { ok: false, removidas: 0, aviso: 'Identificação da imagem não é consistente no editor HTML; revisão manual necessária.' };
  }
  if (!resultado.removidas && !formulario?.removidas) {
    if (!fonteAberta) await alternar.click();
    return { ok: true, removidas: 0 };
  }
  // O campo submetido pode conservar uma cópia antiga do HTML. Só sincronize
  // quando sua versão sem logotipo for idêntica à fonte do editor.
  if (formulario?.removidas && formulario.html.trim() !== resultado.html.trim()) {
    return { ok: false, removidas: 0, aviso: 'Corpo visual e HTML do formulário divergem além do logotipo; revisão manual necessária.' };
  }
  if (resultado.removidas) await fonte.fill(resultado.html);
  await alternar.click();
  await editor.waitFor({ state: 'visible' });
  let htmlEnviado = await campoTexto.inputValue();
  let persistido = await aba.evaluate(analisarImagensAgenciaBrasil, htmlEnviado);
  if (persistido.removidas && persistido.html.trim() === resultado.html.trim()) {
    await campoTexto.evaluate((campo, html) => {
      campo.value = html;
      campo.dispatchEvent(new Event('input', { bubbles:true }));
      campo.dispatchEvent(new Event('change', { bubbles:true }));
    }, resultado.html);
    htmlEnviado = await campoTexto.inputValue();
    persistido = await aba.evaluate(analisarImagensAgenciaBrasil, htmlEnviado);
  }
  const depois = await aba.evaluate(analisarImagensAgenciaBrasil, await editor.innerHTML());
  if (depois.removidas || depois.ambiguas.length || persistido.removidas || persistido.ambiguas.length ||
      persistido.html.trim() !== resultado.html.trim()) {
    return { ok: false, removidas: resultado.removidas, aviso: 'Logotipo ou divergência persiste no HTML enviado pelo formulário; revisão manual necessária.' };
  }
  const corpoDoFormulario = await campoTexto.evaluate(campo => {
    const formulario = campo.closest('form');
    if (!formulario || !campo.name) return null;
    const valores = new FormData(formulario).getAll(campo.name);
    return valores.length === 1 ? valores[0] : null;
  });
  if (corpoDoFormulario !== resultado.html) {
    return { ok: false, removidas: resultado.removidas, aviso: 'Não foi possível confirmar o HTML que o formulário enviará; revisão manual necessária.' };
  }
  return { ok: true, removidas: resultado.removidas || formulario?.removidas || 0 };
}

function extrairHtmlRequisicao(requisicao) {
  const cabecalho = String(requisicao.headers()['content-type'] || '');
  const tipo = cabecalho.toLowerCase();
  const corpo = requisicao.postData();
  if (typeof corpo !== 'string') return null;
  if (tipo.includes('application/x-www-form-urlencoded')) return new URLSearchParams(corpo).get('text');
  if (tipo.includes('application/json')) {
    try {
      const dados = JSON.parse(corpo);
      return typeof dados?.text === 'string' ? dados.text : null;
    } catch { return null; }
  }
  if (tipo.includes('multipart/form-data')) {
    const limite = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(cabecalho)?.slice(1).find(Boolean);
    if (!limite) return null;
    for (const parte of corpo.split(`--${limite}`)) {
      const separador = parte.indexOf('\r\n\r\n');
      if (separador < 0 || !/^content-disposition:[^\r\n]*\bname="text"/im.test(parte.slice(0, separador))) continue;
      return parte.slice(separador + 4).replace(/\r\n$/, '');
    }
  }
  return null;
}

module.exports = { analisarImagensAgenciaBrasil, prepararImagensAgenciaBrasil, extrairHtmlRequisicao };
