(() => {
  const lista = document.querySelector('#lista-ultimas');
  const estado = document.querySelector('#estado-ultimas');
  const atualizar = document.querySelector('#atualizar-ultimas');
  let ocupada = false;
  let selecionada = '';

  function mensagem(texto, erro = false) {
    estado.textContent = texto;
    estado.classList.toggle('erro', erro);
  }

  function renderizar(materias) {
    lista.replaceChildren();
    for (const materia of materias) {
      const cartao = document.createElement('article');
      cartao.className = 'materia-recente';
      cartao.dataset.selecionada = String(materia.url === selecionada);
      const titulo = document.createElement('h3');
      titulo.textContent = materia.titulo;
      const meta = document.createElement('p');
      meta.textContent = [materia.chapeu, materia.data].filter(Boolean).join(' · ') || 'Chapéu e data indisponíveis';
      const botao = document.createElement('button');
      botao.type = 'button';
      botao.textContent = 'Gerar Arte';
      botao.setAttribute('aria-label', `Gerar Arte: ${materia.titulo}`);
      botao.addEventListener('click', async () => {
        if (ocupada) return;
        ocupada = true;
        atualizar.disabled = true;
        lista.querySelectorAll('button').forEach(item => { item.disabled = true; });
        mensagem(`Carregando “${materia.titulo}”...`);
        try {
          const dados = await window.prepararArteMateria(materia.url);
          if (dados.url !== materia.url) throw new Error('A matéria recebida não corresponde à selecionada.');
          const importacao = await window.importarMateriaGerador(dados);
          selecionada = materia.url;
          lista.querySelectorAll('.materia-recente').forEach(item => {
            item.dataset.selecionada = String(item === cartao);
          });
          mensagem(importacao.fotoCarregada ?
            'Arte preparada. Confira os textos e o enquadramento antes de exportar.' :
            importacao.mensagem || 'Fotografia indisponível. Escolha uma foto manualmente.',
          !importacao.fotoCarregada);
        } catch (erro) {
          mensagem(erro.message || 'Não foi possível preparar esta matéria.', true);
        } finally {
          ocupada = false;
          atualizar.disabled = false;
          lista.querySelectorAll('button').forEach(item => { item.disabled = false; });
        }
      });
      cartao.append(titulo, meta, botao);
      lista.append(cartao);
    }
  }

  async function carregar() {
    if (ocupada) return;
    ocupada = true;
    atualizar.disabled = true;
    mensagem('Carregando últimas matérias...');
    try {
      const materias = await window.listarUltimasArtes();
      if (!Array.isArray(materias) || !materias.length) throw new Error('Nenhuma matéria recente encontrada.');
      renderizar(materias);
      mensagem(`${materias.length} matéria${materias.length === 1 ? '' : 's'} disponível${materias.length === 1 ? '' : 'is'}. Escolha uma publicação.`);
    } catch (erro) {
      mensagem(erro.message || 'Não foi possível carregar as últimas matérias.', true);
    } finally {
      ocupada = false;
      atualizar.disabled = false;
    }
  }

  atualizar.addEventListener('click', carregar);
  void carregar();
})();
