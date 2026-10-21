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
    const urls = ['src', 'data-src', 'data-original', 'data-lazy-src'].map(atributo => imagem.getAttribute(atributo) || '')
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
        const link = imagem.closest('a');
        const somenteImagemNoLink = link && link.children.length === 1 &&
          link.firstElementChild === imagem && [...link.childNodes].every(no =>
            no === imagem || (no.nodeType === Node.TEXT_NODE && !no.textContent.trim()));
        confirmadas.push(somenteImagemNoLink ? link : imagem);
      } else {
        // Aceita wrappers conhecidos somente quando cada nível contém um
        // único filho rumo ao logo. Legenda, texto ou outra mídia impedem a remoção.
        const exclusivo = elemento => {
          if (elemento === imagem) return true;
          if (!['FIGURE', 'A', 'DIV', 'SPAN', 'P'].includes(elemento.tagName) ||
              elemento.children.length !== 1 ||
              [...elemento.childNodes].some(no => no.nodeType !== Node.ELEMENT_NODE &&
                (no.nodeType !== Node.TEXT_NODE || no.textContent.trim()))) return false;
          if (elemento.tagName === 'A' && !elemento.getAttribute('href')) return false;
          return exclusivo(elemento.firstElementChild);
        };
        const tipoEditor = figura.getAttribute('data-rx-type');
        if ((!tipoEditor || tipoEditor === 'image') && exclusivo(figura)) confirmadas.push(figura);
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

// Compara o conteúdo editorial, não os bytes de serializações diferentes do
// mesmo DOM. Conserva destinos de links, imagens, legendas, mídia e atributos;
// somente ordem de atributos, entidades e espaços de formatação são neutros.
function compararCorposAgenciaBrasil({ primeiro, segundo }) {
  const blocos = new Set(['ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DIV', 'FIGCAPTION',
    'FIGURE', 'FOOTER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'OL', 'P',
    'SECTION', 'TABLE', 'TBODY', 'TD', 'TH', 'THEAD', 'TR', 'UL']);
  const preservarEspacos = new Set(['PRE', 'CODE', 'SCRIPT', 'STYLE', 'TEXTAREA']);
  const modelo = html => {
    const template = document.createElement('template');
    template.innerHTML = String(html || '');
    const converter = (no, pai = null) => {
      if (no.nodeType === Node.TEXT_NODE) {
        const exato = pai && preservarEspacos.has(pai.tagName);
        return { tipo:'texto', valor: exato ? no.textContent.replace(/\r\n?/g, '\n')
          : no.textContent.replace(/\s+/g, ' ') };
      }
      if (no.nodeType === Node.COMMENT_NODE) return { tipo:'comentario', valor:no.textContent };
      if (no.nodeType !== Node.ELEMENT_NODE && no.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return null;
      const filhos = [...no.childNodes].flatMap((filho, indice, todos) => {
        if (filho.nodeType === Node.TEXT_NODE && !filho.textContent.trim() &&
            !preservarEspacos.has(no.tagName)) {
          const anterior = todos.slice(0, indice).reverse().find(item => item.nodeType !== Node.TEXT_NODE || item.textContent.trim());
          const seguinte = todos.slice(indice + 1).find(item => item.nodeType !== Node.TEXT_NODE || item.textContent.trim());
          if ((!anterior || blocos.has(anterior.tagName)) && (!seguinte || blocos.has(seguinte.tagName))) return [];
        }
        const convertido = converter(filho, no);
        return convertido ? [convertido] : [];
      });
      if (blocos.has(no.tagName)) {
        if (filhos[0]?.tipo === 'texto') filhos[0].valor = filhos[0].valor.trimStart();
        if (filhos.at(-1)?.tipo === 'texto') filhos.at(-1).valor = filhos.at(-1).valor.trimEnd();
        if (filhos[0]?.tipo === 'texto' && !filhos[0].valor) filhos.shift();
        if (filhos.at(-1)?.tipo === 'texto' && !filhos.at(-1).valor) filhos.pop();
      }
      if (no.nodeType === Node.DOCUMENT_FRAGMENT_NODE) return { tipo:'raiz', filhos };
      // O Redactor acrescenta estes atributos somente ao DOM visual. A
      // matéria 787704 confirma que eles não existem no HTML do formulário.
      const atributosInternos = new Set(['data-rx-type', 'data-rx-first-level',
        'data-rx-style-cache']);
      const atributos = [...no.attributes].filter(atributo =>
        !atributosInternos.has(atributo.name) &&
        !(atributo.name === 'contenteditable' && no.hasAttribute('data-rx-type')) &&
        !(atributo.name === 'class' && !atributo.value.trim())
      ).map(atributo => {
        let valor = atributo.value;
        if (atributo.name === 'class') valor = valor.split(/\s+/).filter(Boolean).sort().join(' ');
        if (atributo.name === 'style') valor = [...no.style].sort().map(nome =>
          `${nome}:${no.style.getPropertyValue(nome).trim()}${no.style.getPropertyPriority(nome) ? '!important' : ''}`).join(';');
        if (atributo.name === 'target') valor = valor.toLowerCase();
        return [atributo.name, valor];
      }).sort(([a], [b]) => a.localeCompare(b));
      return { tipo:'elemento', tag:no.tagName.toLowerCase(), atributos, filhos };
    };
    return converter(template.content);
  };
  const a = modelo(primeiro), b = modelo(segundo);
  const diferenca = (esquerda, direita, caminho = 'corpo') => {
    if (esquerda.tipo !== direita.tipo || esquerda.tag !== direita.tag) return `${caminho}: elemento diferente`;
    if (esquerda.valor !== direita.valor) return `${caminho}: texto ou comentário diferente`;
    if (JSON.stringify(esquerda.atributos) !== JSON.stringify(direita.atributos)) return `${caminho}: atributos diferentes`;
    if ((esquerda.filhos?.length || 0) !== (direita.filhos?.length || 0)) return `${caminho}: quantidade de elementos diferente`;
    for (let i = 0; i < (esquerda.filhos?.length || 0); i++) {
      const erro = diferenca(esquerda.filhos[i], direita.filhos[i], `${caminho}/${esquerda.filhos[i].tag || esquerda.filhos[i].tipo}[${i + 1}]`);
      if (erro) return erro;
    }
    return '';
  };
  const motivo = diferenca(a, b);
  return { equivalentes: !motivo, motivo };
}

async function conferirCorpos(aba, primeiro, segundo) {
  return aba.evaluate(compararCorposAgenciaBrasil, { primeiro, segundo });
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
    await alternar.click();
    await fonte.waitFor({ state: 'visible' });
  }
  const original = await fonte.inputValue();
  const resultado = await aba.evaluate(analisarImagensAgenciaBrasil, original);
  if (resultado.ambiguas.length) {
    return { ok: false, removidas: 0, aviso: 'Identificação da imagem não é consistente no editor HTML; revisão manual necessária.' };
  }
  if (!resultado.removidas && !formulario?.removidas && !previa?.removidas) {
    if (!fonteAberta) await alternar.click();
    const visual = await aba.evaluate(analisarImagensAgenciaBrasil, await editor.innerHTML());
    const enviado = await aba.evaluate(analisarImagensAgenciaBrasil, await campoTexto.inputValue());
    if (visual.removidas || visual.ambiguas.length || enviado.removidas || enviado.ambiguas.length) {
      return { ok:false, removidas:0, aviso:'Logotipo presente após conferir o editor e o formulário; revisão manual necessária.' };
    }
    return { ok:true, removidas:0 };
  }
  // As três representações devem preservar o mesmo conteúdo após a remoção.
  // O editor pode reordenar atributos e serializar entidades de outra forma.
  for (const [nome, html] of [['visual', previa?.html], ['formulário', formulario?.html]]) {
    if (html == null) continue;
    const comparacao = await conferirCorpos(aba, html, resultado.html);
    if (!comparacao.equivalentes) {
      return { ok: false, removidas: 0, aviso: `Corpo ${nome} e fonte HTML divergem além do logotipo (${comparacao.motivo}); revisão manual necessária.` };
    }
  }
  if (resultado.removidas) await fonte.fill(resultado.html);
  await alternar.click();
  await editor.waitFor({ state: 'visible' });
  let htmlEnviado = await campoTexto.inputValue();
  let persistido = await aba.evaluate(analisarImagensAgenciaBrasil, htmlEnviado);
  if (persistido.removidas && (await conferirCorpos(aba, persistido.html, resultado.html)).equivalentes) {
    await campoTexto.evaluate((campo, html) => {
      campo.value = html;
      campo.dispatchEvent(new Event('input', { bubbles:true }));
      campo.dispatchEvent(new Event('change', { bubbles:true }));
    }, resultado.html);
    htmlEnviado = await campoTexto.inputValue();
    persistido = await aba.evaluate(analisarImagensAgenciaBrasil, htmlEnviado);
  }
  const depois = await aba.evaluate(analisarImagensAgenciaBrasil, await editor.innerHTML());
  const visualFinal = await conferirCorpos(aba, depois.html, resultado.html);
  const formularioFinal = await conferirCorpos(aba, persistido.html, resultado.html);
  if (depois.removidas || depois.ambiguas.length || persistido.removidas || persistido.ambiguas.length ||
      !visualFinal.equivalentes || !formularioFinal.equivalentes) {
    const etapa = depois.removidas || depois.ambiguas.length ? 'editor visual ainda contém o logotipo ou imagem ambígua'
      : persistido.removidas || persistido.ambiguas.length ? 'campo HTML do formulário ainda contém o logotipo ou imagem ambígua'
        : !visualFinal.equivalentes ? `editor visual divergente (${visualFinal.motivo})`
          : `campo HTML do formulário divergente (${formularioFinal.motivo})`;
    return { ok: false, removidas: resultado.removidas, aviso: `Após sincronização, ${etapa}; revisão manual necessária.` };
  }
  const corpoDoFormulario = await campoTexto.evaluate(campo => {
    const formulario = campo.closest('form');
    if (!formulario || !campo.name) return null;
    const valores = new FormData(formulario).getAll(campo.name);
    return valores.length === 1 ? valores[0] : null;
  });
  if (corpoDoFormulario !== htmlEnviado) {
    return { ok: false, removidas: resultado.removidas, aviso: 'Não foi possível confirmar o HTML que o formulário enviará; revisão manual necessária.' };
  }
  return { ok: true, removidas: resultado.removidas || previa?.removidas || formulario?.removidas || 0 };
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

module.exports = { analisarImagensAgenciaBrasil, compararCorposAgenciaBrasil, prepararImagensAgenciaBrasil, extrairHtmlRequisicao };
