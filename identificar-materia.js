(function (root) {
  const normalizar = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  function removerEnfase(texto) {
    let resultado = String(texto || '');
    // Retira os pares de negrito/itálico do WhatsApp e Markdown, inclusive aninhados.
    // Os limites preservam sublinhados dentro de nomes, endereços e palavras.
    const enfase = /(^|[\s([{"'“‘])(\*{1,3}|_{1,3})(?=\S)([^\r\n]*?\S)\2(?=$|[\s)\]}.,!?;:"'”’])/gu;
    for (let i = 0; i < 4; i++) {
      const semMarcas = resultado.replace(enfase, (_, antes, marca, conteudo) => antes + conteudo);
      if (semMarcas === resultado) break;
      resultado = semMarcas;
    }
    return resultado;
  }
  const limpar = s => removerEnfase(String(s || '').replace(/^\s*#{1,6}\s*/, ''))
    .replace(/\\\s*$/, '').trim();
  function normalizarTextoCopiado(texto) {
    // Decodifica apenas espaços; outras entidades continuam como texto seguro.
    return String(texto || '').replace(/\r\n?/g, '\n')
      .replace(/&(?:nbsp|#0*32|#0*160|#x0*20|#x0*a0);/gi, ' ')
      // Cabeçalho copiado do WhatsApp: remove horário, data e remetente,
      // preservando a mensagem após os dois-pontos e todas as quebras de linha.
      // O remetente não é a assinatura da matéria. A limpeza também é usada
      // antes de enviar o texto ao Gemini.
      .replace(/^[ \t\u200e\u200f\ufeff]*\[(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?,[ \t]*(?:0?[1-9]|[12]\d|3[01])\/(?:0?[1-9]|1[0-2])\/(?:\d{4}|\d{2})\][ \t\u200e\u200f]+[^\r\n:]+:[ \t]*/gm, '')
      .replace(/\\[ \t]*$/gm, '');
  }
  function limparEstruturasCopiadas(texto) {
    // A barra no fim da linha representa uma quebra no Markdown copiado.
    // Mantém a quebra e os destaques, necessários para reconhecer o bigode.
    const linhas = normalizarTextoCopiado(texto).split('\n');
    const creditoImagem = valor => /^(?:fonte\s+da\s+imagem|creditos?\s+(?:da\s+imagem|da\s+foto|das\s+imagens|das\s+fotos))\s*:/
      .test(normalizar(limpar(valor)));
    const celulas = linha => linha.trim().replace(/^\|/, '').replace(/\|$/, '')
      .split(/(?<!\\)\|/).map(valor => valor.trim());
    for (let i = 0; i < linhas.length; i++) {
      if (/^\s*\|/.test(linhas[i])) {
        const inicio = i;
        while (i + 1 < linhas.length && /^\s*\|/.test(linhas[i + 1])) i++;
        const conteudo = linhas.slice(inicio, i + 1).flatMap(celulas)
          .filter(valor => valor && !/^:?-+:?$/.test(valor));
        // Só elimina blocos vazios ou dedicados ao crédito de foto.
        // Uma tabela com qualquer outro dado continua integralmente no texto.
        if (conteudo.every(creditoImagem)) {
          for (let j = inicio; j <= i; j++) linhas[j] = '';
        }
      } else if (creditoImagem(linhas[i])) {
        linhas[i] = '';
      }
    }
    return linhas;
  }
  function horarioAtual(data = new Date()) {
    const partes = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(data);
    const p = Object.fromEntries(partes.map(v => [v.type, v.value]));
    return p.year + '-' + p.month + '-' + p.day + 'T' + p.hour + ':' + p.minute + ':' + p.second;
  }
  function normalizarTitulo(titulo, contexto = '', sugestaoIA = '') {
    const original = String(titulo || '');
    const maiusculas = valor => /\p{L}/u.test(valor) && valor === valor.toLocaleUpperCase('pt-BR') && valor !== valor.toLocaleLowerCase('pt-BR');
    if (!maiusculas(original)) return original;
    const comparar = valor => valor.normalize('NFC').toLocaleLowerCase('pt-BR');
    // A IA só pode mudar a caixa das letras: não pode trocar palavras,
    // pontuação, números ou acentos do título extraído do original.
    const sugestao = String(sugestaoIA || '').trim();
    if (sugestao && !maiusculas(sugestao) && comparar(sugestao) === comparar(original.trim())) return sugestao;
    const grafias = new Map();
    for (const sigla of ('STF STJ TSE TST STE STM OAB MPF MPE MPT PGR PGE DPE DPU ONU OMS SUS UTI UBS SAMU INSS FGTS CLT IBGE IPCA PIB ICMS ISS IPTU IPVA CPF CNPJ RG CNH MEC ENEM USP UFRJ UFAL UFG UFPE UFMG UFRGS UFF UERJ UnB Unesp Unicamp PUC NASA ESA EUA UE OTAN BRICS FIFA CBF COB COI F1 NBA NFL UFC MMA PT PL MDB PSDB PSB PSOL PDT PP PSD PV PCdoB AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO BR TV FM AM IA').split(' ')) grafias.set(comparar(sigla), sigla);
    const comuns = new Set(('a o as os um uma uns umas de da do das dos e em no na nos nas por para com sem ao aos que se como quando onde quem seu sua seus suas este esta isso esse essa ele ela eles elas nesta neste neste apos após antes durante segundo confira veja saiba entenda conheça hoje ontem amanhã amanha novo nova novos novas governo prefeitura presidente ministro ministra senador senadora deputado deputada prefeito prefeita evento programação programacao assessoria redação redacao').split(' '));
    const palavras = /[\p{L}\p{N}]+(?:[-’'][\p{L}\p{N}]+)*/gu;
    // Aprende a grafia no bigode e no corpo, sem reaproveitar linhas em caixa alta.
    for (const linha of String(contexto || '').split('\n').filter(linha => !maiusculas(linha.trim()))) {
      const tokens = [...linha.matchAll(palavras)];
      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i], valor = token[0], chave = comparar(valor);
        if (comuns.has(chave) || !/\p{Lu}/u.test(valor) || valor.length < 2) continue;
        const antes = linha.slice(0, token.index).trimEnd();
        const iniciaFrase = !antes || /[.!?…]["”')\]]*$/.test(antes);
        const proximo = tokens[i + 1];
        const nomeComposto = proximo && /^\p{Lu}/u.test(proximo[0]) &&
          /^\s+$/.test(linha.slice(token.index + valor.length, proximo.index));
        if ((!iniciaFrase || nomeComposto || maiusculas(valor)) && !grafias.has(chave)) grafias.set(chave, valor);
      }
    }
    let primeira = true;
    return original.replace(palavras, palavra => {
      const chave = comparar(palavra);
      // Preserva também siglas compostas, como OAB-SP e TRE-AL.
      let valor = grafias.get(chave) || palavra.split('-')
        .map(parte => grafias.get(comparar(parte)) || parte.toLocaleLowerCase('pt-BR')).join('-');
      if (primeira && /\p{L}/u.test(valor)) {
        if (!grafias.has(chave)) valor = valor.replace(/\p{L}/u, letra => letra.toLocaleUpperCase('pt-BR'));
        primeira = false;
      }
      return valor;
    });
  }
  function identificarAssinaturaFinal(linhas) {
    const preenchidas = linhas.map((linha, indice) => ({ indice, texto: limpar(linha) }))
      .filter(linha => linha.texto);
    const contato = texto => /^(?:e-?mail|instagram|facebook|site|contatos?|telefones?|tel\.?|whats(?:app)?)\s*:/i.test(texto) ||
      /^[^\s@]+\\?@[^\s@]+\.[^\s@]+$/.test(texto) || /^@[\w.]+$/.test(texto) ||
      /^https?:\/\/\S+$/i.test(texto) || /^(?:\+?\d[\d\s()+.\/-]*|\(\d{2}\)[\d\s.\/-]+)$/.test(texto);
    const nomeCurto = texto => texto.length <= 120 && texto.split(/\s+/).length <= 12 &&
      /^[\p{L}\p{N}][\p{L}\p{N}\s&'’().-]*$/u.test(texto) && !/[.!?]$/.test(texto);
    // Só reconhece um bloco de assinatura no fim, depois de texto corrido.
    // Contatos do SERVIÇO e nomes citados nos parágrafos continuam na redação.
    for (let posicao = preenchidas.length - 1; posicao >= 0; posicao--) {
      const linha = preenchidas[posicao];
      const assinatura = linha.texto.match(/^((?:da\s+)?(?:assessoria(?:\s+de\s+(?:imprensa|comunica[çc][aã]o))?|reda[çc][aã]o))(?:\s*[:–—-]\s*(.+))?\s*:?$/i);
      if (!assinatura || !preenchidas.slice(0, posicao).some(anterior => anterior.texto.length >= 80 && /[.!?…][”"']?$/.test(anterior.texto))) continue;
      if (assinatura[2] && !nomeCurto(assinatura[2])) continue;
      const partes = [assinatura[1], ...(assinatura[2] ? [assinatura[2]] : [])];
      let temContato = false, nomes = 0, valido = true;
      for (const seguinte of preenchidas.slice(posicao + 1)) {
        if (contato(seguinte.texto)) { temContato = true; continue; }
        // Uma linha curta imediatamente depois de Assessoria identifica a agência.
        if (!temContato && nomes < 1 && !assinatura[2] && /assessoria/i.test(assinatura[1]) && nomeCurto(seguinte.texto)) {
          partes.push(seguinte.texto); nomes++; continue;
        }
        valido = false; break;
      }
      if (valido) return { autor: partes.join(' '), indices: preenchidas.slice(posicao).map(item => item.indice) };
    }
    return null;
  }
  function identificarMateria(texto, agora = new Date()) {
    if (typeof texto !== 'string' || !texto.trim()) throw new Error('Cole o texto da matéria para identificar os campos.');
    if (texto.length > 120000) throw new Error('Cole uma matéria de cada vez, com até 120 mil caracteres.');
    const campos = { categoria: '', data: horarioAtual(agora), titulo: '', chapeu: '', bigode: '', redacao: '', autor: '', imagem: '' };
    const origem = {};
    const linhas = limparEstruturasCopiadas(texto);
    const assinaturaFinal = identificarAssinaturaFinal(linhas);
    const retirar = new Set(assinaturaFinal?.indices || []);
    const nomes = { categoria: 'categoria', 'categoria sugerida': 'categoria', editoria: 'categoria', titulo: 'titulo', chapeu: 'chapeu', bigode: 'bigode', subtitulo: 'bigode', autor: 'autor', autora: 'autor', autoria: 'autor', 'imagem destaque': 'imagem', 'imagem de destaque': 'imagem', 'foto destaque': 'imagem', 'foto de destaque': 'imagem', redacao: 'redacao', texto: 'redacao', 'texto da materia': 'redacao' };
    const informados = new Set();
    const lerRotulo = linha => {
      const limpa = limpar(linha);
      const par = limpa.match(/^([^:]{1,50}):\s*(.*)$/);
      const rotulo = normalizar(par ? par[1].trim() : limpa);
      if (!Object.prototype.hasOwnProperty.call(nomes, rotulo)) return null;
      // “Redação” sozinha continua podendo ser a assinatura, inclusive após AUTOR.
      // Para nomear o corpo, aceita “Redação:” ou um cabeçalho marcado “REDAÇÃO”.
      if (!par && rotulo === 'redacao' && !(limpa === 'REDAÇÃO' && /\*\*|^\s*#/.test(linha))) return null;
      return { campo: nomes[rotulo], valor: par ? par[2].trim() : '' };
    };
    let blocoCMS = false;
    let blocoServico = false;
    let corpoExplicito = false;
    let inicioCorpo = linhas.length;
    let posicaoTitulo = -1;
    let posicaoAutor = linhas.length;
    for (let i = 0; i < linhas.length; i++) {
      if (retirar.has(i)) continue;
      const limpa = limpar(linhas[i]);
      const chave = normalizar(limpa);
      // Os dados do evento pertencem à redação, inclusive Quando e Horário.
      // Uma nova seção encerra o serviço para permitir metadados posteriores.
      if (/^servico\s*:?$/.test(chave)) {
        blocoServico = true;
        blocoCMS = false;
        continue;
      }
      if (blocoServico && (/^\s*#{1,6}\s/.test(linhas[i]) || /^dados para o cms\s*:?$/.test(chave))) blocoServico = false;
      if (blocoServico) continue;
      if (/^materia\s+\d+(?:\s+de\s+\d+)?\s*$/i.test(chave)) { retirar.add(i); continue; }
      if (/^dados para o cms\s*:?$/.test(chave)) { blocoCMS = true; retirar.add(i); continue; }
      // A seção editorial que vem depois dos metadados continua no corpo.
      if (blocoCMS && (/^\s*#{1,6}\s/.test(linhas[i]) || /^(transparencia|fontes|referencias)\s*:?$/.test(chave))) blocoCMS = false;
      const par = limpa.match(/^([^:]{1,50}):\s*(.*)$/);
      const rotulo = par ? normalizar(par[1].trim()) : '';
      const identificado = lerRotulo(linhas[i]);
      const campo = identificado?.campo;
      if (campo) {
        informados.add(campo);
        if (campo === 'redacao') {
          corpoExplicito = true;
          inicioCorpo = Math.min(inicioCorpo, i);
          linhas[i] = identificado.valor;
        } else {
          let valor = identificado.valor;
          if (campo === 'bigode') {
            // Um bigode pode ocupar várias linhas antes do marcador explícito TEXTO.
            // Só reúne esse bloco quando o próximo rótulo confirma o início do corpo.
            let proximoRotulo = i + 1;
            while (proximoRotulo < linhas.length && !lerRotulo(linhas[proximoRotulo])) proximoRotulo++;
            if (proximoRotulo < linhas.length && lerRotulo(linhas[proximoRotulo]).campo === 'redacao') {
              const partes = [valor, ...linhas.slice(i + 1, proximoRotulo).map(limpar)].filter(Boolean);
              valor = partes.join(' ');
              for (let j = i + 1; j < proximoRotulo; j++) retirar.add(j);
            }
          }
          // Aceita também o rótulo sozinho (com ou sem dois-pontos) e o valor abaixo.
          if (!valor) {
            let proxima = i + 1;
            while (proxima < linhas.length && !linhas[proxima].trim()) proxima++;
            if (proxima < linhas.length && !lerRotulo(linhas[proxima])) {
              valor = limpar(linhas[proxima]);
              retirar.add(proxima);
            }
          }
          if (valor && !campos[campo]) {
            campos[campo] = valor; origem[campo] = 'Informado no texto';
            if (campo === 'titulo') posicaoTitulo = i;
          }
          if (campo === 'autor') posicaoAutor = Math.min(posicaoAutor, i);
          retirar.add(i);
        }
      } else if (blocoCMS || /^(slug|meta descricao|tags|data|data de publicacao|publicacao|horario)$/.test(rotulo)) {
        retirar.add(i);
      } else if (!corpoExplicito && /^por\s+\S/i.test(limpa) && limpa.length < 150 && !/[.!?]$/.test(limpa)) {
        if (!campos.autor) { campos.autor = limpa.replace(/^por\s+/i, ''); origem.autor = 'Assinatura no texto'; }
        posicaoAutor = Math.min(posicaoAutor, i);
        retirar.add(i);
      }
    }
    // Referências de imagem ficam separadas do texto antes de procurar o título.
    // Não representam uma foto já selecionada ou enviada ao CMS.
    for (let i = 0; i < linhas.length; i++) {
      if (retirar.has(i)) continue;
      // Ao copiar um e-mail, o anexo pode virar apenas “image.jpeg” entre
      // título e bigode. Ignora somente um nome de arquivo inteiro e isolado;
      // preserva URLs, frases que citam arquivos e campos de imagem explícitos.
      const nomeArquivo = limpar(linhas[i]);
      if (/^[\p{L}\p{N}_][\p{L}\p{N}_.()\-]*\.(?:jpe?g|png|webp|gif|avif|heic|heif|bmp|tiff?)$/iu.test(nomeArquivo)) {
        retirar.add(i);
        continue;
      }
      const foto = linhas[i].trim().match(/^!\[([^\]]*)\]\(([^\s)]+)(?:\s+"[^"]*")?\)$/);
      if (!foto) continue;
      if (!campos.imagem) { campos.imagem = foto[2]; origem.imagem = 'Imagem indicada no texto'; }
      retirar.add(i);
    }
    const disponiveis = () => linhas.map((_, i) => i)
      .filter(i => i < inicioCorpo && !retirar.has(i) && linhas[i].trim());
    const caixaAlta = texto => /\p{L}/u.test(texto) && texto === texto.toLocaleUpperCase('pt-BR') && texto !== texto.toLocaleLowerCase('pt-BR');
    const linhaEditorial = i => !/^\s*(?:#{3,6}\s|[|!>]|[-*+]\s|\d+[.)]\s)/.test(linhas[i]);
    const tipoAssinatura = (i, permitirLinhaSeguida = false) => {
      if (!linhaEditorial(i) || /^\s*#/.test(linhas[i])) return '';
      const assinatura = limpar(linhas[i]);
      if (/^(?:da\s+)?(?:redacao|assessoria(?:\s+de\s+(?:imprensa|comunicacao))?)$/.test(normalizar(assinatura))) return 'equipe';
      // Uma assinatura destacada no WhatsApp pode vir colada ao primeiro parágrafo.
      const destacada = /^(\*{1,3}|_{1,3})\S[^\r\n]*\1$/.test(linhas[i].trim());
      if (assinatura.length > 100 || (!permitirLinhaSeguida && !destacada && (linhas[i + 1] || '').trim())) return '';
      const partes = assinatura.split(/\s+/);
      const particula = p => /^(?:de|da|do|das|dos|e)$/i.test(p);
      const nome = p => /^(?:\p{Lu}[\p{L}'’\-]*|\p{Lu}\.)$/u.test(p);
      if (partes.length < 2 || partes.length > 8 || particula(partes[0]) || particula(partes[partes.length - 1])) return '';
      return partes.every(p => particula(p) || nome(p)) && partes.filter(p => !particula(p)).length >= 2 ? 'pessoa' : '';
    };
    const identificarAssinaturaNoCabecalho = () => {
      if (posicaoTitulo < 0) return;
      // Examina só a primeira linha restante após os cabeçalhos, nunca o corpo inteiro.
      const indice = disponiveis().find(i => i > posicaoTitulo &&
        limpar(linhas[i]) !== campos.titulo && limpar(linhas[i]) !== campos.bigode);
      if (indice === undefined || indice >= posicaoAutor) return;
      const tipo = tipoAssinatura(indice);
      if (!tipo || !linhas.some((l, i) => i > indice && !retirar.has(i) && l.trim())) return;
      const assinatura = limpar(linhas[indice]);
      if (campos.autor && normalizar(campos.autor) !== normalizar(assinatura)) return;
      if (!campos.autor) {
        campos.autor = assinatura;
        origem.autor = tipo === 'equipe' ? 'Assinatura entre o cabeçalho e o texto' : 'Sugestão: nome isolado após o cabeçalho';
      }
      posicaoAutor = indice;
      retirar.add(indice);
    };

    // Um título repetido antes dos dados para o CMS define onde começa o cabeçalho.
    if (campos.titulo) {
      const repetido = disponiveis().find(i => limpar(linhas[i]) === campos.titulo);
      if (repetido !== undefined) posicaoTitulo = repetido;
    }

    // Chapéu opcional: uma chamada curta em caixa alta, somente no início.
    // Exige um título logo depois para não confundir um título inteiro em maiúsculas.
    const abertura = disponiveis();
    const primeiro = abertura[0];
    const seguinte = abertura[1];
    if (!campos.chapeu && !informados.has('chapeu') && primeiro !== undefined && primeiro < posicaoAutor) {
      const chamada = limpar(linhas[primeiro]);
      const tituloSeguinte = seguinte === undefined ? '' : limpar(linhas[seguinte]);
      const tituloExplicitoDepois = campos.titulo && posicaoTitulo > primeiro &&
        !linhas.slice(primeiro + 1, posicaoTitulo).some((l, deslocamento) => l.trim() && !retirar.has(primeiro + 1 + deslocamento));
      const tituloSemRotuloDepois = !campos.titulo && seguinte !== undefined && linhaEditorial(seguinte) &&
        tituloSeguinte.length >= 15 && tituloSeguinte.length <= 240 &&
        !caixaAlta(tituloSeguinte) && !/[.!?…]$/.test(tituloSeguinte);
      if (!/^\s*#/.test(linhas[primeiro]) && caixaAlta(chamada) && chamada.length <= 80 &&
          chamada.split(/\s+/).length <= 10 && !/[.!?…]$/.test(chamada) &&
          (tituloExplicitoDepois || tituloSemRotuloDepois)) {
        campos.chapeu = chamada;
        origem.chapeu = 'Sugestão: chamada inicial em caixa alta';
        retirar.add(primeiro);
      }
    }

    // O título fica no começo; cabeçalhos de seções no corpo não o substituem.
    if (!campos.titulo && !informados.has('titulo')) {
      const indice = disponiveis()[0];
      if (indice !== undefined && linhaEditorial(indice) && limpar(linhas[indice]).length <= 240) {
        campos.titulo = limpar(linhas[indice]); posicaoTitulo = indice;
        origem.titulo = /^\s*#{1,2}\s/.test(linhas[indice]) ? 'Identificado pelo formato' : 'Sugestão: título no início do texto';
        retirar.add(indice);
      }
    }

    // Texto sem formatação: título, resumo, assinatura e corpo podem vir em
    // linhas seguidas. A assinatura delimita o bigode mesmo com ponto final.
    // Restringe a regra às primeiras linhas após o título, nunca ao corpo inteiro.
    if (posicaoTitulo >= 0 && !campos.bigode && !informados.has('bigode')) {
      const cabecalho = disponiveis().filter(i => i > posicaoTitulo);
      const [indiceResumo, indiceAssinatura, indiceCorpo] = cabecalho;
      if (indiceCorpo !== undefined && indiceAssinatura < posicaoAutor) {
        const resumo = limpar(linhas[indiceResumo]);
        const assinatura = limpar(linhas[indiceAssinatura]);
        const corpo = limpar(linhas[indiceCorpo]);
        const tipo = tipoAssinatura(indiceAssinatura, true);
        const temResumo = linhaEditorial(indiceResumo) && resumo.length >= 20 && resumo.length <= 360 &&
          !caixaAlta(resumo) && !tipoAssinatura(indiceResumo, true);
        const temCorpo = linhaEditorial(indiceCorpo) && corpo.length >= 60 && /\p{Ll}/u.test(corpo) &&
          !tipoAssinatura(indiceCorpo, true);
        if (temResumo && tipo && temCorpo && (!campos.autor || normalizar(campos.autor) === normalizar(assinatura))) {
          campos.bigode = resumo;
          origem.bigode = 'Sugestão: resumo entre o título e a assinatura';
          if (!campos.autor) {
            campos.autor = assinatura;
            origem.autor = 'Assinatura entre o subtítulo e o texto';
          }
          posicaoAutor = indiceAssinatura;
          retirar.add(indiceResumo); retirar.add(indiceAssinatura);
        }
      }
    }

    // Uma assinatura logo após o título não deve virar bigode quando ele estiver ausente.
    identificarAssinaturaNoCabecalho();

    // Sem rótulo, o bigode é o resumo entre o título e a abertura da redação.
    // Regra editorial: um resumo destacado com _ ou * logo após o título pode
    // ser bigode mesmo com ponto final. A posição e o destaque são considerados
    // antes de retirar as marcas do WhatsApp; destaques no corpo não entram aqui.
    if (!campos.bigode && !informados.has('bigode') && posicaoTitulo >= 0) {
      const depoisTitulo = disponiveis().filter(i => i > posicaoTitulo);
      const indice = depoisTitulo[0];
      if (indice !== undefined && indice < posicaoAutor) {
        const indices = [indice];
        const marcado = /^\s*###\s+/.test(linhas[indice]);
        const destacado = /^(\*{1,3}|_{1,3})\S[^\r\n]*\1$/.test(linhas[indice].trim());
        // O fechamento da ênfase delimita o resumo: não junta os parágrafos
        // seguintes quando o texto chega sem linhas vazias pelo WhatsApp.
        if (!marcado && !destacado) {
          for (let i = indice + 1; i < inicioCorpo && !retirar.has(i) && linhas[i].trim(); i++) {
            if (/^\s*#/.test(linhas[i]) || !linhaEditorial(i) || tipoAssinatura(i)) break;
            indices.push(i);
          }
        }
        const resumo = indices.map(i => limpar(linhas[i])).join(' ');
        const haCorpoDepois = linhas.some((l, i) => i > indices[indices.length - 1] && !retirar.has(i) && l.trim());
        const resumoDestacado = destacado && linhaEditorial(indice) && !tipoAssinatura(indice) &&
          resumo.length >= 20 && resumo.length <= 360 && !caixaAlta(resumo) && haCorpoDepois;
        const resumoSemRotulo = linhaEditorial(indice) && !/^\s*#/.test(linhas[indice]) &&
          resumo.length >= 20 && resumo.length <= 360 && !caixaAlta(resumo) &&
          !/[.!?…]$/.test(resumo) && haCorpoDepois;
        if (marcado || resumoDestacado || resumoSemRotulo) {
          campos.bigode = resumo;
          origem.bigode = marcado ? 'Identificado pelo formato' : resumoDestacado
            ? 'Sugestão: resumo destacado logo abaixo do título'
            : 'Sugestão: resumo logo abaixo do título';
          indices.forEach(i => retirar.add(i));
        }
      }
    }
    for (let i = 0; i < linhas.length; i++) {
      const limpa = limpar(linhas[i]);
      if (i < inicioCorpo && ((campos.titulo && limpa === campos.titulo) || (campos.bigode && limpa === campos.bigode))) retirar.add(i);
    }
    // Com o bigode separado, a assinatura passa a ser a primeira linha disponível.
    identificarAssinaturaNoCabecalho();
    if (!campos.autor && assinaturaFinal) {
      campos.autor = assinaturaFinal.autor;
      origem.autor = 'Assinatura no final da matéria';
    }
    // Quando existe TEXTO/REDAÇÃO explícito, o corpo começa ali. O conteúdo do
    // próprio rótulo já foi separado; título, chapéu e bigode anteriores ficam fora.
    campos.redacao = linhas.filter((_, i) => !retirar.has(i) && (!corpoExplicito || i >= inicioCorpo))
      .join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!campos.categoria && !informados.has('categoria')) {
      const assunto = normalizar(campos.titulo + ' ' + campos.chapeu + ' ' + campos.bigode);
      const regras = [
        ['Clima e Tempo', /previsao do tempo|previsao.*\d+\s*°c|radar clima|possibilidade de chuva|temperaturas?|nebulosidade/],
        ['Esportes', /futebol|campeonato|formula 1|\bf1\b|olimpiadas|copa do mundo/],
        ['Política', /eleicoes|presidencial|senado|camara dos deputados|\bstf\b|\boab\b|governo|prefeito|governador/],
        ['Economia', /inflacao|\bpib\b|taxa de juros|\bselic\b|bolsa de valores/],
        ['Saúde', /vacinacao|vacina|epidemia|hospital|dengue/]
      ];
      const sugestao = regras.find(([, expressao]) => expressao.test(assunto));
      if (sugestao) { campos.categoria = sugestao[0]; origem.categoria = 'Sugestão pelo assunto — confira a categoria do site'; }
    }
    if (/^(?:nao (?:informad[oa]|fornecid[oa]|identificad[oa])|sem autor|em branco|ausente|n\/a|[-—])\.?$/.test(normalizar(campos.autor))) {
      campos.autor = ''; delete origem.autor;
    }
    // A revisão e o preenchimento do site recebem o texto sem marcas de ênfase.
    // A redação mantém suas quebras de linha e demais estruturas, como tabelas.
    for (const campo of ['categoria', 'titulo', 'chapeu', 'bigode', 'redacao', 'autor']) {
      campos[campo] = removerEnfase(campos[campo]);
    }
    campos.chapeu = campos.chapeu.trim().toLocaleUpperCase('pt-BR');
    const tituloNormalizado = normalizarTitulo(campos.titulo, campos.bigode + '\n' + campos.redacao);
    if (tituloNormalizado !== campos.titulo) {
      campos.titulo = tituloNormalizado;
      origem.titulo = 'Maiúsculas ajustadas pelo contexto — confira nomes próprios e siglas';
    }
    return { campos, origem };
  }
  const api = { identificarMateria, horarioAtual, normalizarTextoCopiado, limparEstruturasCopiadas, removerEnfase, normalizarTitulo };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.IdentificadorMateria = api;
})(typeof window !== 'undefined' ? window : globalThis);
