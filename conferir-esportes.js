const normalizar = texto => String(texto || '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

// A revisão automática considera apenas os três assuntos excluídos da
// publicação automática. A ausência de palavras esportivas não é um bloqueio.
const assuntosRestritos = [
  ['arqueologia', /\barqueolog(?:ia|ic[oa]s?|[oa]s?)\b/, /\barqueolog(?:ia|ic[oa]s?|[oa]s?)\b|\bsitios? arqueologicos?\b/],
  ['astronomia', /\bastronom(?:ia|ic[oa]s?|[oa]s?)\b/, /\bastronom(?:ia|ic[oa]s?|[oa]s?)\b|\b(?:astrofisica|telescopios?|exoplanetas?|galaxias?|constelacoes?|asteroides?|eclipse(?:s)? (?:solar|lunar))\b/]
];

const tituloEsportivo = /^(?:jogo|partida|time|equipe|clube|atleta|campeonato|torneio|selecao|futebol)\b/;
const categoriaCultura = /(?:^|\s*[/|>,;-]\s*)cultura(?:$|\s*[/|>,;-]\s*)/;
const categoriaEsportiva = /^(?:esportes?|vida esportiva)$/;
const ehCategoriaEsportiva = categoria => categoriaEsportiva.test(normalizar(categoria));
const mancheteEsportiva = /^(?:(?:a|o|as|os) )?(?:jogo|partida|time|equipe|clube|atletas?|campeonato|torneio|selecao|futebol|basquete|cultura esportiva|prefeitura (?:realiza|promove) torneio)\b/;
const contextoEsportivo = /\b(?:futebol|basquete|voleibol|natacao|atletas?|times?|equipes?|clubes?|campeonatos?|torneios?|partidas?|modalidades? esportivas?|esportes?)\b/;
const indicadoresEsportes = [
  ['astronomia', /\b(?:observatorios? astronomicos?|observatorios? registra|telescopios?|planetas?|galaxias?|descobertas? espaciais?|missoes? espaciais?|astronomia|exoplanetas?)\b/],
  ['arqueologia', /\b(?:arqueolog(?:ia|icos?|icas?|os?|as?)|escavac(?:ao|oes) arqueologicas?|sitios? arqueologicos?|artefatos? (?:historicos?|em escavac(?:ao|oes))|civilizac(?:ao|oes) antigas?)\b/],
  ['cultura', /\b(?:festiva(?:l|is) (?:de teatro|culturais?)|teatro|literatura|exposic(?:ao|oes) (?:de arte|artisticas?)|patrimonio cultural|artistas? da regiao)\b/]
];
const chapeuRestrito = /^(?:astronomia|arqueologia|cultura)$/;

function revisarEsportes({ titulo, chapeu, subtitulo, conteudo }) {
  const manchete = normalizar(titulo);
  const rotulo = normalizar(chapeu);
  const contexto = normalizar(`${subtitulo || ''} ${String(conteudo || '').slice(0, 1800)}`);
  // O assunto expresso pela manchete prevalece sobre menções secundárias,
  // inclusive quando o chapéu contém uma das palavras restritas.
  if (mancheteEsportiva.test(manchete)) return { revisar:false, mensagem:'' };
  const assuntosNoTitulo = indicadoresEsportes.filter(([, padrao]) => padrao.test(manchete)).map(([nome]) => nome);
  const assuntosNoContexto = indicadoresEsportes.filter(([, padrao]) => padrao.test(contexto)).map(([nome]) => nome);
  const assuntoNoContexto = assuntosNoContexto[0];
  const esporteNoTitulo = contextoEsportivo.test(manchete);
  const esporteNoContexto = contextoEsportivo.test(contexto);
  const chapeuEsportivo = contextoEsportivo.test(rotulo);
  const assuntoPrincipal = assuntosNoTitulo.length === 1 ? assuntosNoTitulo[0] :
    chapeuRestrito.test(rotulo) && assuntosNoContexto.length === 1 &&
    assuntosNoContexto[0] === rotulo ? rotulo : '';
  if (assuntoPrincipal && !esporteNoTitulo && !esporteNoContexto && !chapeuEsportivo &&
      !assuntosNoTitulo.some(assunto => assunto !== assuntoPrincipal) &&
      !assuntosNoContexto.some(assunto => assunto !== assuntoPrincipal) &&
      (!chapeuRestrito.test(rotulo) || rotulo === assuntoPrincipal)) return {
    revisar:false,
    categoriaDestino:'Geral',
    assunto:assuntoPrincipal,
    mensagem:`Categoria Esportes incompatível com o assunto principal (${assuntoPrincipal}); alterar para Geral antes do envio.`
  };
  if (assuntosNoTitulo.length) return {
    revisar:true,
    mensagem:`Revisão editorial: categoria Esportes, mas o título indica ${assuntosNoTitulo.join(', ')} junto de sinais conflitantes. Confirme o assunto principal.`
  };
  if (assuntoNoContexto) return {
    revisar:true,
    mensagem:`Revisão editorial: categoria Esportes, mas ${assuntoNoContexto} aparece no resumo ou início do texto${esporteNoContexto ? ' junto de sinais esportivos' : ''}. Confirme o assunto principal.`
  };
  if (chapeuRestrito.test(rotulo) && !esporteNoContexto) return {
    revisar:true,
    mensagem:`Revisão editorial: chapéu ${chapeu} conflita com a categoria Esportes e o assunto principal está inconclusivo. Confira antes de enviar.`
  };
  return { revisar:false, mensagem:'' };
}

function conferirCategoriaEsportes({ categoria, titulo, chapeu, subtitulo, conteudo }) {
  const categoriaNormalizada = normalizar(categoria);
  if (ehCategoriaEsportiva(categoria)) return revisarEsportes({ titulo, chapeu, subtitulo, conteudo });
  // Geral é o destino validado para os assuntos principais que chegaram
  // incorretamente em Esportes; não os bloqueie outra vez após a correção.
  if (categoriaNormalizada === 'geral') return { revisar:false, mensagem:'' };
  const tituloNormalizado = normalizar(titulo);
  const chapeuNormalizado = normalizar(chapeu);
  const assuntos = assuntosRestritos
    .filter(([, categoriaRestrita, tituloRestrito]) =>
      categoriaRestrita.test(categoriaNormalizada) ||
      categoriaRestrita.test(chapeuNormalizado) ||
      (!tituloEsportivo.test(tituloNormalizado) && tituloRestrito.test(tituloNormalizado)))
    .map(([nome]) => nome);
  // Cultura exige classificação editorial explícita; palavras no título ou
  // chapéu podem descrever esporte, educação, turismo ou outro assunto.
  if (categoriaCultura.test(categoriaNormalizada)) assuntos.push('cultura');
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

module.exports = { conferirCategoriaEsportes, mostrarConferenciaCategoria, ehCategoriaEsportiva };
