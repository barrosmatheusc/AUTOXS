const normalizar = texto => String(texto || '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// A revisão automática considera apenas os três assuntos excluídos da
// publicação automática. A ausência de palavras esportivas não é um bloqueio.
const assuntosRestritos = [
  ['arqueologia', /\barqueolog(?:ia|ic[oa]s?|[oa]s?)\b/, /\barqueolog(?:ia|ic[oa]s?|[oa]s?)\b|\bsitios? arqueologicos?\b/],
  ['astronomia', /\bastronom(?:ia|ic[oa]s?|[oa]s?)\b/, /\bastronom(?:ia|ic[oa]s?|[oa]s?)\b|\b(?:astrofisica|telescopios?|exoplanetas?|galaxias?|constelacoes?|asteroides?|eclipse(?:s)? (?:solar|lunar))\b/],
  ['cultura', /\bcultura\b/, /(?:^cultura\b|\b(?:festival|mostra|agenda|programacao|evento|politica|patrimonio|projeto|edital|setor|centro)(?: de| da)? cultura\b|\b(?:festival|mostra|agenda|programacao|evento|politica|patrimonio|projeto|edital|setor|centro) cultur(?:al|ais)\b|\b(?:na|da|para a) cultura\b|\b(?:festival|mostra) (?:de )?(?:musica|cinema|teatro|danca|literatura)\b|\bexposicao (?:de )?(?:arte|fotografia)\b)/]
];

function conferirCategoriaEsportes({ categoria, titulo, chapeu }) {
  const categoriaNormalizada = normalizar(categoria);
  const tituloNormalizado = normalizar(titulo);
  const chapeuNormalizado = normalizar(chapeu);
  const assuntos = assuntosRestritos
    .filter(([, categoriaRestrita, tituloRestrito]) =>
      categoriaRestrita.test(categoriaNormalizada) ||
      categoriaRestrita.test(chapeuNormalizado) ||
      tituloRestrito.test(tituloNormalizado))
    .map(([nome]) => nome);
  if (!assuntos.length) return { revisar: false, mensagem: '' };
  return {
    revisar: true,
    mensagem: `Assunto a conferir: ${assuntos.join(', ')}. Não enviar automaticamente; revise a matéria e a categoria.`
  };
}

async function mostrarConferenciaCategoria(aba, resultado) {
  await aba.evaluate(({ revisar, mensagem }) => {
    document.getElementById('autoxs-conferencia-categoria')?.remove();
    if (!revisar) return;
    const aviso = document.createElement('div');
    aviso.id = 'autoxs-conferencia-categoria';
    aviso.setAttribute('role', 'note');
    aviso.textContent = mensagem;
    aviso.style.cssText = 'position:fixed;top:12px;left:12px;max-width:420px;z-index:2147483646;padding:14px;border:1px solid #e9bc57;border-radius:10px;background:#fff3cd;color:#513b05;font:14px/1.5 Segoe UI;pointer-events:none';
    document.body.appendChild(aviso);
  }, resultado);
}

module.exports = { conferirCategoriaEsportes, mostrarConferenciaCategoria };
