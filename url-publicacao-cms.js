const { urlPublica } = require('./historico-producao');

const ORIGEM_CMS = 'https://redacao.tribunaweb.com.br';

function urlEdicao(valor) {
  try {
    const url = new URL(String(valor), ORIGEM_CMS);
    if (url.origin !== ORIGEM_CMS || !/^\/news\/edit\/\d+\/?$/.test(url.pathname)) return '';
    return url.origin + url.pathname;
  } catch { return ''; }
}

function atributos(tag) {
  const resultado = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    resultado[match[1].toLowerCase()] = match[2] ?? match[3];
  }
  return resultado;
}

function decodificar(valor) {
  return String(valor || '').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#(?:39|x27);/gi, "'");
}

function candidatosHtml(html) {
  const encontrados = [];
  for (const match of html.matchAll(/<(?:link|meta)\b[^>]*>/gi)) {
    const a = atributos(match[0]);
    if (a.rel?.toLowerCase() === 'canonical' || a.property?.toLowerCase() === 'og:url') {
      encontrados.push(a.href || a.content);
    }
  }
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const a = atributos(match[1]);
    const rotulo = decodificar(match[2].replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (/^(?:visualizar|ver (?:mat[eé]ria|not[ií]cia|publica[cç][aã]o|no site)|abrir (?:mat[eé]ria|not[ií]cia))\b/i.test(rotulo)) {
      encontrados.push(a.href);
    }
  }
  return encontrados;
}

function candidatosJson(valor) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return [];
  const encontrados = [];
  for (const chave of ['public_url', 'published_url', 'permalink', 'url_publica', 'urlPublica']) {
    if (typeof valor[chave] === 'string') encontrados.push(valor[chave]);
  }
  for (const chave of ['edit_url', 'editUrl', 'url_edicao']) {
    if (typeof valor[chave] === 'string') encontrados.push(valor[chave]);
  }
  for (const chave of ['article', 'news', 'materia', 'data']) {
    if (valor[chave] && !Array.isArray(valor[chave])) encontrados.push(...candidatosJson(valor[chave]));
  }
  return encontrados;
}

function extrairDadosPublicacao({ urlResposta = '', location = '', contentType = '', corpo = '' }) {
  const candidatos = [urlResposta, location];
  if (/\bjson\b/i.test(contentType)) {
    try { candidatos.push(...candidatosJson(JSON.parse(corpo))); } catch { /* Resposta não utilizável. */ }
  } else if (/\bhtml\b/i.test(contentType)) {
    // A listagem inteira do CMS pode conter links de outras matérias.
    // Só a página de edição identificada fornece contexto suficiente.
    if ([location, urlResposta].some(urlEdicao)) candidatos.push(...candidatosHtml(corpo));
  }
  const urlCms = candidatos.map(urlEdicao).find(Boolean) || '';
  const idCms = /\/news\/edit\/(\d+)/.exec(urlCms)?.[1];
  const publicas = [...new Set(candidatos.map(urlPublica).filter(url => {
    if (!url) return false;
    return !idCms || /\/(\d+)-[^/]+\/?$/.exec(new URL(url).pathname)?.[1] === idCms;
  }))];
  // Mais de uma matéria na resposta não permite atribuição segura.
  return {
    urlOriginal: publicas.length === 1 ? publicas[0] : '',
    urlCms,
    ambiguo: publicas.length > 1
  };
}

module.exports = { extrairDadosPublicacao, urlEdicao };
