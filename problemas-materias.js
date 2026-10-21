(function iniciarPainelProblemas() {
  const registros = new Map();
  const secao = document.querySelector('#problemas-materias');
  const lista = document.querySelector('#lista-problemas');
  const contador = document.querySelector('#contador-problemas');
  if (!secao || !lista || !contador) return;

  function urlEdicaoSegura(valor) {
    try {
      const url = new URL(valor);
      return url.protocol === 'https:' && url.hostname === 'redacao.tribunaweb.com.br' &&
        /^\/news\/(?:edit\/\d+|\d+\/edit)\/?$/.test(url.pathname) ? url.href : '';
    } catch { return ''; }
  }

  function desenhar() {
    const abertos = new Set([...lista.querySelectorAll('details[open]')].map(elemento => elemento.dataset.chave));
    lista.replaceChildren();
    contador.textContent = String(registros.size);
    secao.hidden = registros.size === 0;
    for (const [chave, registro] of registros) {
      const cartao = document.createElement('details');
      cartao.className = 'problema-cartao' + (registro.situacao === 'Corrigido' ? ' corrigido' : '');
      cartao.dataset.chave = chave;
      cartao.open = abertos.has(chave) || !registro.visto;
      registro.visto = true;
      const resumo = document.createElement('summary');
      const titulo = document.createElement('span');
      titulo.className = 'problema-titulo';
      titulo.textContent = `${registro.numero ? `Matéria ${registro.numero} — ` : ''}${registro.titulo}`;
      const situacao = document.createElement('span');
      situacao.className = 'problema-situacao';
      situacao.textContent = registro.situacao;
      resumo.append(titulo, situacao);
      cartao.append(resumo);
      const detalhes = document.createElement('div');
      detalhes.className = 'problema-detalhes';
      if (registro.fonte) {
        const fonte = document.createElement('p');
        fonte.textContent = `Fonte: ${registro.fonte}`;
        detalhes.append(fonte);
      }
      const motivos = document.createElement('ul');
      for (const problema of registro.problemas.values()) {
        const item = document.createElement('li');
        item.textContent = `${problema.corrigido ? '✓ ' : ''}${problema.descricao}`;
        motivos.append(item);
      }
      detalhes.append(motivos);
      const href = urlEdicaoSegura(registro.url);
      if (href) {
        const link = document.createElement('a');
        link.href = href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = 'Abrir edição no CMS';
        detalhes.append(link);
      }
      cartao.append(detalhes);
      lista.append(cartao);
    }
  }

  window.registrarProblemaMateria = evento => {
    const materia = evento?.materia;
    const chave = String(materia?.url || materia?.id || '').trim();
    if (!chave) return;
    const corrigido = evento.situacao === 'Corrigido';
    let registro = registros.get(chave);
    if (corrigido) {
      if (!registro) return;
      for (const [chaveProblema, problema] of registro.problemas) {
        if (!evento.codigo || chaveProblema.startsWith(`${evento.codigo}\u0000`)) problema.corrigido = true;
      }
      const pendentes = [...registro.problemas.values()].filter(problema => !problema.corrigido);
      registro.situacao = pendentes.length === 0 ? 'Corrigido' :
        pendentes.some(problema => problema.situacao === 'Erro técnico') ? 'Erro técnico' : 'Revisão necessária';
      desenhar();
      return;
    }
    const descricao = String(evento.descricao || '').trim();
    if (!descricao) return;
    if (!registro) {
      registro = { url:materia.url, numero:evento.numero, titulo:String(materia.titulo || 'Sem título'),
        fonte:String(materia.fonte || ''), problemas:new Map(), situacao:'Revisão necessária', visto:false };
      registros.set(chave, registro);
    }
    registro.problemas.set(`${String(evento.codigo || '')}\u0000${descricao}`, { descricao, situacao:evento.situacao, corrigido:false });
    registro.situacao = [...registro.problemas.values()].some(problema => !problema.corrigido && problema.situacao === 'Erro técnico')
      ? 'Erro técnico' : 'Revisão necessária';
    desenhar();
  };
  window.limparProblemasMaterias = () => { registros.clear(); desenhar(); };
})();
