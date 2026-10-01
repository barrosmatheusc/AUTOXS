const normalizar = texto => String(texto || '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// Sinais editoriais, não uma classificação infalível. Termos vagos como
// estrela, espaço, receita e luta, isolados, não determinam outro assunto.
const outrosAssuntos = [
  ['astronomia', /\b(?:astronom(?:ia|os?|icas?|icos?)|astrofisica|nasa|telescopios?|exoplanetas?|asteroides?|meteoritos?|galaxias?|constelacoes|buracos? negros?|eclipse(?:s)? (?:solar|lunar)|sistema solar|estacao espacial|james webb|chuva de meteoros)\b/],
  ['guerra ou conflito internacional', /\b(?:guerras?|bombardeios?|cessar[- ]fogo|invasao militar|conflito armado|ataque(?:s)? (?:aereo|aereos|militar|militares)|misseis|missil|tropas|refens|otan)\b/],
  ['gastronomia', /\b(?:gastronomia|culinaria|restaurantes?|confeitaria|sobremesas?|ingredientes?|chefs? de cozinha|receita de (?:bolo|torta|pao|pudim|lasanha)|modo de preparo)\b/],
  ['astrologia', /\b(?:astrolog(?:ia|os?|icas?|icos?)|horoscopos?|zodiaco|signos?|mapa astral|ascendente em|mercurio retrogrado|previsao astral)\b/],
  ['arqueologia', /\b(?:arqueolog(?:ia|os?|icas?|icos?)|escavacoes|escavacao|sitios? arqueologicos?|artefatos?|foss(?:il|eis)|paleontolog(?:ia|os?)|dinossauros?|mumias?|tumbas?|civilizacoes antigas)\b/]
];
const sinaisEsportivos = /\b(?:futebol|futsal|basquete|voleibol|volei|handebol|tenis|atletismo|natacao|ciclismo|ginastica|surfe|surf|skate|judo|jiu[- ]jitsu|boxe|mma|ufc|automobilismo|formula (?:1|um)|f1|motogp|olimpiadas|olimpic[oa]s?|paralimpic[oa]s?|brasileirao|libertadores|champions league|premier league|copa do (?:mundo|brasil)|nba|nfl|fifa|cbf|atletas?|jogador(?:a|es|as)?|goleir[oa]s?|atacantes?|zagueir[oa]s?|treinador(?:a|es|as)?|tecnico de futebol|gols?|penaltis?|artilheir[oa]s?|partida de|campeonato(?:s)? (?:brasileiro|paulista|carioca|alagoano|pernambucano))\b/;

function conferirCategoriaEsportes({ categoria, titulo, chapeu }) {
  if (!/^esportes?$/.test(normalizar(categoria))) return { revisar: false, mensagem: '' };
  const texto = normalizar(titulo) + ' ' + normalizar(chapeu);
  const assuntos = outrosAssuntos.filter(([, regra]) => regra.test(texto)).map(([nome]) => nome);
  const temEsporte = sinaisEsportivos.test(texto);
  if (assuntos.length) {
    return {
      revisar: true,
      mensagem: 'Categoria a conferir: está em Esportes, mas o título ou chapéu indica ' +
        assuntos.join(', ') + (temEsporte ? ' junto com referências esportivas.' : '.') +
        ' Confira a categoria antes de enviar manualmente.'
    };
  }
  if (!temEsporte || !normalizar(titulo)) {
    return { revisar: true, mensagem: 'Categoria a conferir: não foi possível confirmar Esportes pelo título e chapéu. Confira antes de enviar manualmente.' };
  }
  return { revisar: false, mensagem: 'Categoria Esportes compatível com os termos do título e chapéu.' };
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
