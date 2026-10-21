const PAGINACAO = '.pagination, .dataTables_paginate, .dt-paging, nav[aria-label*="pagina" i], nav[aria-label*="página" i]';

// Esta leitura também é usada durante a espera pela troca da listagem.
function estadoListagem(entrada) {
  const seletor = typeof entrada === 'string' ? entrada : entrada.seletor;
  const visivel = el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const navegacoes = [...document.querySelectorAll(seletor)].filter(visivel);
  const atuais = navegacoes.flatMap(el => [...el.querySelectorAll('[aria-current="page"], .active, .current')])
    .filter(visivel).map(el => (el.textContent || el.getAttribute('aria-label') || '').trim())
    .map(texto => texto.match(/^(?:p[aá]gina\s*)?(\d+)(?:\s*\(.*\))?$/i)?.[1]).filter(Boolean).map(Number);
  const carregando = [...document.querySelectorAll('.dataTables_processing, .dt-processing, table[aria-busy="true"]')].some(visivel);
  const links = [...document.querySelectorAll('a[href]')].filter(visivel)
    .map(el => el.getAttribute('href')).filter(href => /\/news\/(?:edit\/\d+|\d+\/edit)(?:[/?#]|$)/.test(href));
  const estado = { pagina: atuais.length && atuais.every(n => n === atuais[0]) ? atuais[0] : null,
    paginacao: navegacoes.length > 0, carregando, assinatura: [...new Set(links)].sort().join('|') };
  if (typeof entrada === 'string') return estado;
  return estado.pagina === entrada.numero && !estado.carregando &&
    (entrada.mesmaPagina || estado.assinatura !== entrada.anterior);
}

async function selecionarPaginaListagem(aba, numero) {
  if (!Number.isInteger(numero) || numero < 1) throw new Error('Número de página inválido na fila.');
  const antes = await aba.evaluate(estadoListagem, PAGINACAO);
  if (!antes.carregando && antes.pagina === numero) return;
  // Sem controles de paginação, a listagem oferece somente a primeira página.
  if (!antes.paginacao && numero === 1 && !antes.carregando) return;
  const navegacao = aba.locator(PAGINACAO).filter({visible:true});
  const nome = new RegExp('^(?:p[aá]gina\\s*)?' + numero + '$', 'i');
  const controles = navegacao.locator('a, button, [role="button"]').filter({hasText:nome})
    .or(navegacao.getByRole('link', {name:nome}))
    .or(navegacao.getByRole('button', {name:nome})).filter({visible:true});
  if (!await controles.count()) throw new Error('Página ' + numero + ' não está disponível na fila filtrada. Nenhuma matéria foi aberta.');
  const controle = controles.first();
  if (await controle.evaluate(el => el.matches(':disabled') || Boolean(el.closest('.disabled, [aria-disabled="true"]')))) {
    throw new Error('Página ' + numero + ' não está disponível para seleção. Nenhuma matéria foi aberta.');
  }
  await controle.click();
  // Confere o indicador da página e a renovação das matérias, inclusive em paginação AJAX.
  try {
    await aba.waitForFunction(estadoListagem,
      {seletor:PAGINACAO, numero, anterior:antes.assinatura, mesmaPagina:antes.pagina === numero}, {timeout:15000});
  } catch {
    throw new Error('Não foi possível confirmar o carregamento da página ' + numero + '. Nenhuma matéria foi aberta.');
  }
}

async function aguardarTabelaListagem(aba) {
  try {
    await aba.waitForFunction(() => {
      const carregando = [...document.querySelectorAll('.dataTables_processing, .dt-processing, table[aria-busy="true"]')]
        .some(el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden');
      const linhas = [...document.querySelectorAll('table tbody tr, [role="row"]')]
        .filter(el => el.getClientRects().length > 0 && el.querySelector('td, [role="cell"]'));
      return !carregando && linhas.length > 0;
    }, null, { timeout:15000 });
  } catch {
    throw new Error('A tabela de notícias não terminou de carregar; nenhuma linha será presumida.');
  }
}

async function avancarPaginaListagem(aba, numeroAtual) {
  const antes = await aba.evaluate(estadoListagem, PAGINACAO);
  if (!antes.paginacao) return false;
  if (antes.pagina !== numeroAtual || antes.carregando) {
    throw new Error(`A página ${numeroAtual} não está confirmada antes de avançar.`);
  }
  const navegacao = aba.locator(PAGINACAO).filter({ visible:true });
  const proximoNumero = numeroAtual + 1;
  const nomeNumero = new RegExp('^(?:p[aá]gina\\s*)?' + proximoNumero + '$', 'i');
  const numerico = navegacao.locator('a, button, [role="button"]').filter({ hasText:nomeNumero }).filter({ visible:true });
  const nomeProximo = /^(?:pr[oó]xim[ao]|next|seguinte|[›»])$/i;
  const seguinte = navegacao.getByRole('link', { name:nomeProximo })
    .or(navegacao.getByRole('button', { name:nomeProximo })).filter({ visible:true });
  const controle = await numerico.count() ? numerico.first() : seguinte.first();
  if (!await controle.count()) return false;
  const indisponivel = await controle.evaluate(el => el.matches(':disabled') ||
    Boolean(el.closest('.disabled, [aria-disabled="true"]')));
  if (indisponivel) return false;
  await controle.click();
  try {
    await aba.waitForFunction(estadoListagem,
      { seletor:PAGINACAO, numero:proximoNumero, anterior:antes.assinatura, mesmaPagina:false },
      { timeout:15000 });
  } catch {
    throw new Error(`A navegação para a página ${proximoNumero} não atualizou a tabela; busca interrompida.`);
  }
  return true;
}
module.exports = { selecionarPaginaListagem, avancarPaginaListagem, aguardarTabelaListagem, estadoListagem };
