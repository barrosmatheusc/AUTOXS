(function (root) {
  const normalizar = texto => String(texto || '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toLowerCase();
  // Opções editoriais locais: não reescrevem a matéria nem preenchem sem clique.
  const temas = [
    [/\b(?:coracao|cardiovascular|cardiologia|cardiac[oa]s?)\b/, ['SAÚDE DO CORAÇÃO', 'SAÚDE CARDIOVASCULAR', 'CUIDADOS COM A SAÚDE']],
    [/\b(?:miopia|oftalmolog\w*|saude ocular|visao|oculares)\b/, ['SAÚDE OCULAR', 'CUIDADOS COM A VISÃO', 'SAÚDE INFANTIL']],
    [/\b(?:saude|hospital|vacin\w*|dengue|medic\w*|doencas?)\b/, ['SAÚDE', 'CUIDADOS COM A SAÚDE', 'BEM-ESTAR']],
    [/\b(?:chuva|previsao do tempo|temperaturas?|nebulosidade|frio|calor)\b/, ['CLIMA E TEMPO', 'PREVISÃO DO TEMPO', 'RADAR DO TEMPO']],
    [/\b(?:creditos? judicia\w*|precatorios?|compensacao tributaria|arrecadacao|impostos?|tributari\w*)\b/, ['FINANÇAS PÚBLICAS', 'TRIBUTAÇÃO', 'ECONOMIA']],
    [/\b(?:empregos?|microcredito|empreendedor\w*|geracao de renda|vagas de trabalho)\b/, ['EMPREGO E RENDA', 'OPORTUNIDADES', 'DESENVOLVIMENTO ECONÔMICO']],
    [/\b(?:inflacao|selic|pib|juros|economia|investimentos?)\b/, ['ECONOMIA', 'CENÁRIO ECONÔMICO', 'MERCADO']],
    [/\b(?:cultura|artesanato|artistas?|exposicao|caravana cultural|ministerio da cultura)\b/, ['CULTURA', 'AGENDA CULTURAL', 'ARTE E CULTURA']],
    [/\b(?:cinema|filmes?|series?|atores?|atrizes|teatro)\b/, ['CULTURA E ENTRETENIMENTO', 'CINEMA E TV', 'EM CENA']],
    [/\b(?:musica|cantor\w*|shows?|festival musical|concertos?)\b/, ['MÚSICA', 'AGENDA CULTURAL', 'NOS PALCOS']],
    [/\b(?:stf|tribunais?|tribunal|justica|defensoria|oab|judiciario|custas judiciais)\b/, ['JUSTIÇA', 'PODER JUDICIÁRIO', 'DIREITOS E CIDADANIA']],
    [/\b(?:eleitor\w*|eleico\w*|candidat\w*|disputa presidencial|pesquisa eleitoral)\b/, ['ELEIÇÕES', 'CENÁRIO ELEITORAL', 'POLÍTICA']],
    [/\b(?:politica|senador\w*|deputad\w*|governador\w*|presidente|prefeit\w*)\b/, ['POLÍTICA', 'CENÁRIO POLÍTICO', 'VIDA PÚBLICA']],
    [/\b(?:astronom\w*|nasa|telescop\w*|galaxias?|planetas?|asteroides?|universo|sistema solar)\b/, ['ASTRONOMIA', 'CIÊNCIA E ESPAÇO', 'EXPLORAÇÃO ESPACIAL']],
    [/\b(?:astrolog\w*|horoscop\w*|signos?|zodiaco|mapa astral)\b/, ['ASTROLOGIA', 'HORÓSCOPO', 'SIGNOS']],
    [/\b(?:arqueolog\w*|escavaco\w*|foss(?:il|eis)|paleontolog\w*|civilizacoes antigas)\b/, ['ARQUEOLOGIA', 'HISTÓRIA E CIÊNCIA', 'VESTÍGIOS DO PASSADO']],
    [/\b(?:guerras?|bombardeios?|cessar[- ]fogo|misseis|tropas|conflito armado)\b/, ['CENÁRIO INTERNACIONAL', 'CONFLITO INTERNACIONAL', 'GEOPOLÍTICA']],
    [/\b(?:gastronomia|culinaria|restaurantes?|confeitaria|ingredientes?|chef de cozinha)\b/, ['GASTRONOMIA', 'SABORES', 'CULINÁRIA']],
    [/\b(?:futebol|futsal|brasileirao|libertadores|gols?|goleiros?|copa do brasil|cbf)\b/, ['FUTEBOL', 'DENTRO DE CAMPO', 'ESPORTE']],
    [/\b(?:formula 1|f1|automobilismo|motogp|grande premio)\b/, ['AUTOMOBILISMO', 'NAS PISTAS', 'VELOCIDADE']],
    [/\b(?:esportes?|atletas?|basquete|volei|tenis|olimpiadas|natacao|atletismo|judo)\b/, ['ESPORTE', 'DESTAQUE ESPORTIVO', 'NO ESPORTE']],
    [/\b(?:educacao|escolas?|alunos?|professores?|universidade|enem|ensino)\b/, ['EDUCAÇÃO', 'ENSINO', 'FORMAÇÃO']],
    [/\b(?:turismo|turistas?|destinos?|viagens?|roteiros?)\b/, ['TURISMO', 'DESTINOS', 'ROTEIROS']],
    [/\b(?:meio ambiente|sustentabilidade|desmatamento|biodiversidade|preservacao ambiental)\b/, ['MEIO AMBIENTE', 'SUSTENTABILIDADE', 'PRESERVAÇÃO']],
    [/\b(?:tecnologia|inteligencia artificial|software|ciberseguranca|aplicativos?)\b/, ['TECNOLOGIA', 'INOVAÇÃO', 'MUNDO DIGITAL']],
    [/\b(?:policia|policial|prisao|homicidio|assalto|investigacao criminal)\b/, ['SEGURANÇA PÚBLICA', 'OCORRÊNCIA POLICIAL', 'INVESTIGAÇÃO']]
  ];
  function sugerirChapeus(campos = {}, { todas = false } = {}) {
    const limparTexto = texto => String(texto || '').replace(/\r\n?/g, '\n')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[*_]/g, '').replace(/^\s*#{1,6}\s+.*$/gm, '');
    const corpo = limparTexto(campos.redacao).trim();
    const paragrafos = corpo.split(/\n\s*\n/).filter(p => p.trim());
    // Textos do WhatsApp também podem separar os parágrafos com uma única quebra.
    const inicio = (paragrafos.length > 1 ? paragrafos : corpo.split('\n'))
      .filter(p => p.trim()).slice(0, 2);
    let fontes = [limparTexto(campos.bigode), ...inicio].filter(p => p.trim());
    if (!fontes.length) fontes = [limparTexto(campos.titulo)];
    const ignorar = new Set(('a o as os um uma uns umas de da do das dos em no na nos nas por para com sem sob sobre entre ate apos antes ao aos e ou mas que se seu sua seus suas esse essa esses essas este esta estes estas isso isto aquele aquela como quando onde porque pois mais menos muito muita muitos muitas todo toda todos todas cada mesmo mesma ja ainda tambem apenas assim durante segundo conforme atraves meio parte forma vez vezes dia dias ano anos hoje ontem amanha nesta neste nesse nessa ser estar ter fazer foi foram sera serao e sao era eram tem tera teve tinham ha vai vao pode podem deve devem disse diz afirma afirmou destaca destacou explica explicou reforca reforcou realiza realizou promove promover acontece acontecer sera busca reuniu reune conta contou chega chegou fica ficam ajuda ajudam permite permitem mostra mostram manter garantir importante importancia principal principais novo nova novos novas primeiro primeira primeiros primeiras grande grandes melhor melhores maior maiores alem cerca tanto quanto quais qual quem porque desde contra trabalho momento brasil brasileiro brasileira brasileiros brasileiras nesta sexta feira segunda terca quarta quinta sabado domingo gratuito gratuita gratuitos gratuitas').split(' '));
    const conectores = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em']);
    const expressoes = new Set(temas.flatMap(([, opcoes]) => opcoes.map(normalizar)));
    for (const termo of ['saude ocular', 'luz natural', 'atividades ao ar livre', 'geracao de renda', 'geracao de oportunidades', 'atracao de empresas', 'pequenos empreendedores', 'creditos judiciais', 'compensacao tributaria', 'formacao cultural', 'programacao gratuita', 'exposicao de artesanato', 'sistema nacional de cultura', 'justica gratuita', 'custas judiciais', 'politicas publicas', 'saude cardiovascular', 'doencas cardiovasculares', 'atividade fisica', 'alimentacao equilibrada', 'imposto zero', 'sistema solar']) expressoes.add(termo);
    const candidatos = new Map();
    fontes.forEach((fonte, numero) => {
      const peso = numero === 0 && campos.bigode?.trim() ? 9 : 5;
      const palavras = [...fonte.matchAll(/[\p{L}]+(?:[-’'][\p{L}]+)*/gu)];
      const vistos = new Set();
      function incluir(texto, bonus) {
        const chave = normalizar(texto).replace(/\s+/g, ' ').trim();
        if (vistos.has(chave) || texto.length > 45) return;
        vistos.add(chave);
        const anterior = candidatos.get(chave);
        candidatos.set(chave, { texto: texto.toLocaleUpperCase('pt-BR'), pontos: (anterior?.pontos || 0) + peso + bonus });
      }
      for (let i = 0; i < palavras.length; i++) {
        const palavra = palavras[i][0], simples = normalizar(palavra);
        if (ignorar.has(simples) || simples.length < 3) continue;
        for (let tamanho = 5; tamanho >= 2; tamanho--) {
          const grupo = palavras.slice(i, i + tamanho);
          if (grupo.length !== tamanho) continue;
          const ultima = grupo[grupo.length - 1];
          const trecho = fonte.slice(grupo[0].index, ultima.index + ultima[0].length);
          // Não junta termos separados por pontuação, frases ou números.
          if (normalizar(trecho).replace(/\s+/g, ' ') !== grupo.map(p => normalizar(p[0])).join(' ')) continue;
          const conhecido = expressoes.has(normalizar(trecho).replace(/\s+/g, ' '));
          const nomeProprio = grupo.filter(p => !conectores.has(normalizar(p[0]))).length >= 2 &&
            !ignorar.has(normalizar(ultima[0])) && grupo.every(p => conectores.has(normalizar(p[0])) || /^\p{Lu}/u.test(p[0]));
          if (conhecido || nomeProprio) incluir(trecho, conhecido ? 8 : 4);
        }
        const tematico = temas.some(([regra]) => regra.test(simples));
        const substantivo = /(?:cao|coes|dade|dades|mento|mentos|cultura|ismo|ista|istas|logia)$/.test(simples);
        const sigla = palavra.length >= 2 && palavra.length <= 10 && palavra === palavra.toLocaleUpperCase('pt-BR');
        if (tematico || substantivo || sigla) incluir(palavra, tematico ? 3 : 1);
      }
    });
    const resultado = [];
    for (const [chave, candidato] of [...candidatos].sort((a, b) => b[1].pontos - a[1].pontos)) {
      // Evita ocupar vários botões com a mesma expressão e seus fragmentos.
      if (resultado.some(item => (' ' + item.chave + ' ').includes(' ' + chave + ' ') || (' ' + chave + ' ').includes(' ' + item.chave + ' '))) continue;
      resultado.push({ chave, texto: candidato.texto });
      if (!todas && resultado.length === 5) break;
    }
    return resultado.map(item => item.texto);
  }
  const api = { sugerirChapeus };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SugestoesChapeu = api;
})(typeof window !== 'undefined' ? window : globalThis);
