// Extração local por regras; não usa IA nem serviços externos.
// O termo é uma sugestão editável. Nomes próprios e assuntos podem ser ambíguos.
const ignoradas = new Set(`
  a o as os um uma uns umas de da do das dos em no na nos nas ao aos acoes
  e ou que se por para com sem sob sobre entre ate apos antes durante contra
  pelo pela pelos pelas seu sua seus suas esse essa isso este esta neste nesta
  como mais menos muito pouco ja ainda tambem so nao sim ser estar ter foi sao
  era eram e ha diz disse afirma afirmou aponta revela anuncia anunciou tem
  tera vai vao pode podem deve devem faz fazem fez sera serao estao fica ficou
  volta segue mantem cresce aumenta reduz causa causam chega abre abre-se
  veja confira entenda saiba analise opiniao video videos foto fotos urgente
  novo nova novos novas noticia noticias principais hoje ontem amanha agora
  pais paises governo presidente ministro ministra ministros deputado deputada
  senador senadora governador governadora prefeito prefeita ex-presidente
  ex-ministro ex-ministra ex-governador ex-prefeito cantor cantora ator atriz
  ex-chefao chefao banco pesquisa golpe golpistas venda adesao financiamento
  adotaram recuaram utilizacao reuniao reunioes discurso declaracao
`.trim().split(/\s+/));
const particulas = new Set(['de', 'da', 'do', 'das', 'dos', 'del', 'di', 'van', 'von']);
const chave = texto => texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function extrairTermoBusca(titulo) {
  const texto = String(titulo || '').normalize('NFKC').replace(/\s+/g, ' ').trim()
    .replace(/^(?:an[aá]lise|opini[aã]o|urgente|v[ií]deos?|fotos?|veja|entenda)\s*:\s*/i, '');
  const palavras = [...texto.matchAll(/\p{L}[\p{L}\p{M}'’\-]*/gu)]
    .map(m => ({ texto: m[0], inicio: m.index, fim: m.index + m[0].length }));
  const util = p => p.texto.length > 2 && !ignoradas.has(chave(p.texto));
  const nome = p => p && util(p) && /^\p{Lu}[\p{Ll}\p{M}][\p{L}\p{M}'’\-]*$/u.test(p.texto);
  const adjacente = (a, b) => /^\s+$/.test(texto.slice(a.fim, b.inicio));

  // Uma sigla composta no título costuma identificar uma entidade específica.
  const siglaComposta = palavras.find(p => /^\p{Lu}{2,8}-\p{Lu}{2,8}$/u.test(p.texto));
  if (siglaComposta) return siglaComposta.texto;

  // Prioriza nomes compostos, preservando conectivos: Alexandre de Moraes.
  for (let i = 0; i < palavras.length; i++) {
    if (!nome(palavras[i])) continue;
    let fim = i;
    let nomes = 1;
    while (fim + 1 < palavras.length && nomes < 5) {
      const proxima = palavras[fim + 1];
      if (!adjacente(palavras[fim], proxima)) break;
      if (nome(proxima)) { fim++; nomes++; continue; }
      const seguinte = palavras[fim + 2];
      if (particulas.has(chave(proxima.texto)) && nome(seguinte) && adjacente(proxima, seguinte)) {
        fim += 2; nomes++; continue;
      }
      break;
    }
    if (nomes >= 2) return texto.slice(palavras[i].inicio, palavras[fim].fim);
  }

  // Um nome isolado (Lula, Fachin) ou sigla (BRICS, STF) também pode servir.
  const proprio = palavras.find(nome);
  if (proprio) return proprio.texto;
  const sigla = palavras.find(p => util(p) && /^\p{Lu}{2,8}$/u.test(p.texto));
  if (sigla) return sigla.texto;
  // Sem nome reconhecível, usa a primeira palavra informativa do título.
  return palavras.find(util)?.texto || '';
}

function sugerirTermosBusca(titulo) {
  const texto = String(titulo || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  const palavras = texto.match(/\p{L}[\p{L}\p{M}'’\-]*/gu) || [];
  const compostos = [...texto.matchAll(/\p{Lu}[\p{Ll}\p{M}]+(?:\s+(?:(?:de|da|do|das|dos|del|di|van|von)\s+)?\p{Lu}[\p{Ll}\p{M}]+){1,4}/gu)]
    .map(m => m[0].split(' '))
    .map(partes => { while (partes.length && ignoradas.has(chave(partes[0]))) partes.shift(); return partes.join(' '); });
  const siglas = palavras.filter(p => /^\p{Lu}{2,8}(?:-\p{Lu}{2,8})?$/u.test(p));
  const uteis = palavras.filter(p => p.length > 2 && !ignoradas.has(chave(p)));
  const vistas = new Set();
  return [extrairTermoBusca(texto), ...compostos, ...siglas, ...uteis].filter(termo => {
    if (!termo || termo.length > 120 || ignoradas.has(chave(termo)) || vistas.has(chave(termo))) return false;
    vistas.add(chave(termo));
    return true;
  }).slice(0, 12);
}
module.exports = { extrairTermoBusca, sugerirTermosBusca };