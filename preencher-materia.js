const { textoParaHtml } = require('./texto-para-html');
const { instalarBotaoLegenda } = require('./botao-legenda');
const ORIGEM = 'https://redacao.tribunaweb.com.br';
const URL_ADICIONAR = ORIGEM + '/news/add';
const normalizar = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
// Inputs do CMS têm uma linha; a revisão permite colar texto com quebras.
// Preserva letras, acentos e caixa, normalizando apenas espaços e Unicode.
const linhaUnica = s => String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim();
function validarCampos(entrada) {
  const nomes = ['categoria','data','titulo','chapeu','bigode','redacao','autor','imagem'];
  if (!entrada || nomes.some(k => typeof entrada[k] !== 'string')) throw new Error('Confira os campos da matéria antes de enviar ao formulário.');
  const campos = Object.fromEntries(nomes.map(k => [k, entrada[k].trim() ? entrada[k] : '']));
  for (const chave of ['categoria', 'titulo', 'chapeu', 'bigode', 'autor']) campos[chave] = linhaUnica(campos[chave]);
  // Garante a caixa alta no formulário mesmo após uma edição manual na revisão.
  campos.chapeu = campos.chapeu.trim().toLocaleUpperCase('pt-BR');
  if (nomes.some(k => campos[k].length > 120000)) throw new Error('A matéria ultrapassou o tamanho permitido.');
  formatarData(campos.data);
  return campos;
}
function formatarData(valor) {
  if (!String(valor).trim()) return '';
  const p = String(valor).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!p) throw new Error('Confira a data de publicação.');
  const [,a,m,d,h,min,seg='0'] = p;
  const data = new Date(Date.UTC(+a,+m-1,+d,+h,+min,+seg));
  if (data.getUTCFullYear()!==+a || data.getUTCMonth()!==+m-1 || data.getUTCDate()!==+d || +h>23 || +min>59 || +seg>59) throw new Error('Confira a data de publicação.');
  return d + '/' + m + '/' + a + ' ' + h + ':' + min + ':' + seg.padStart(2,'0');
}
async function selecionarPortais(aba) {
  const portais = [
    { nome: 'Tribuna do Agreste', rotulo: /\bTribuna\s+do\s+Agreste\b/i },
    { nome: 'Tribuna do Sertão', rotulo: /\bTribuna\s+do\s+Sert[aã]o\b/i }
  ];
  const caixas = [];
  for (const portal of portais) {
    // Localiza pelo nome do portal, sem depender da ordem ou de códigos numéricos.
    const caixa = aba.getByLabel(portal.rotulo).and(aba.locator('input[type="checkbox"]'));
    if (await caixa.count() !== 1) throw new Error('Não foi possível identificar a caixa do portal ' + portal.nome + '. Confira os portais no formulário.');
    caixas.push({ caixa, nome: portal.nome });
  }
  for (const { caixa, nome } of caixas) {
    try {
      // check mantém marcada uma caixa que já estiver selecionada.
      await caixa.check();
      if (!await caixa.isChecked()) throw new Error('Portal não selecionado.');
    } catch {
      throw new Error('Não foi possível marcar o portal ' + nome + '. Confira a caixa no formulário.');
    }
  }
}
async function preencherCampos(aba, entrada) {
  const campos = validarCampos(entrada);
  const avisos = [];
  const categoria = aba.locator('#inp_category_id');
  await categoria.waitFor({state:'attached'});
  const opcoes = await categoria.locator('option').evaluateAll(os => os.map(o => ({valor:o.value, texto:o.textContent.trim()})));
  let categoriaSelecionada = '';
  if (campos.categoria) {
    const candidatas = opcoes.filter(o => o.valor && normalizar(o.texto) === normalizar(campos.categoria));
    if (candidatas.length !== 1) throw new Error('A categoria “' + campos.categoria + '” não existe ou está ambígua no site. Use Alterar na revisão. Categorias disponíveis: ' + opcoes.filter(o=>o.valor).map(o=>o.texto).join(', ') + '.');
    await categoria.selectOption({value:candidatas[0].valor});
    categoriaSelecionada = candidatas[0].texto;
  } else {
    // Não escolhe uma categoria por conta própria quando a revisão estiver em branco.
    await categoria.selectOption(opcoes.some(o => o.valor === '') ? {value:''} : []);
  }
  for (const [id,chave] of [['#inp_title','titulo'],['#inp_hat','chapeu'],['#inp_subtitle','bigode'],['#inp_author','autor']]) {
    const campo = aba.locator(id); await campo.fill(campos[chave]);
    await campo.blur();
    const recebido = await campo.evaluate(e => ({ valor: e.value, limite: e.maxLength }));
    if (linhaUnica(recebido.valor) !== campos[chave]) {
      const detalhe = 'Na revisão: ' + JSON.stringify(campos[chave]) + '. No site: ' + JSON.stringify(recebido.valor) + '.';
      const limite = recebido.limite >= 0 ? ' O campo informa um limite de ' + recebido.limite + ' caracteres.' : '';
      // A publicação continua manual. Uma divergência de autor ou bigode não impede
      // preencher o corpo, a data e os portais, mas precisa ficar visível.
      if (chave === 'autor' || chave === 'bigode') avisos.push('Confira o ' + chave + ' antes de publicar. ' + detalhe + limite);
      else throw new Error('O site não aceitou o conteúdo completo de ' + chave + '. ' + detalhe + limite);
    }
  }
  const fonte = aba.locator('.rx-source');
  const alternar = aba.locator('a[data-command="source.toggle"]');
  if (!await fonte.isVisible()) await alternar.click();
  await fonte.waitFor({state:'visible'});
  const html = textoParaHtml(campos.redacao);
  await fonte.fill(html);
  if (await fonte.evaluate(e=>e.value) !== html) throw new Error('A redação não foi preenchida por completo.');
  await alternar.click();
  await aba.locator('.rx-editor[contenteditable="true"]').waitFor({state:'visible'});
  // O editor sincroniza o conteúdo no textarea usado pelo formulário quando sai do modo HTML.
  const textoEditor = await aba.locator('.rx-editor').innerText();
  if (campos.redacao && !textoEditor.trim()) throw new Error('O editor do site ficou vazio. Confira a redação.');
  const data = aba.locator('#inp_publish_date');
  // O calendário do site retira o foco do input ao clicar; preenche sem abri-lo.
  await data.evaluate((e,valor) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
    setter.call(e,valor);
    e.dispatchEvent(new Event('input',{bubbles:true}));
    e.dispatchEvent(new Event('change',{bubbles:true}));
  }, formatarData(campos.data));
  if (await data.evaluate(e=>e.value) !== formatarData(campos.data)) throw new Error('Confira a data no formulário do site.');
  await selecionarPortais(aba);
  if (campos.imagem.trim()) avisos.push('Imagem indicada na revisão: selecione o arquivo correspondente na Imagem de Destaque.');
  return { envioManual:true, categoria:categoriaSelecionada, avisos };
}
function criarEnvioIndividual(context, garantirLogin, prepararFotos, criarAba) {
  let abaAdicionar = null;
  let ultimoEnvio = null;
  async function obterAba() {
    if (!abaAdicionar || abaAdicionar.isClosed()) {
      abaAdicionar = await criarAba();
      ultimoEnvio = null;
      try {
        // Cada espaço de adição tem seu próprio botão, inclusive antes da foto.
        await instalarBotaoLegenda(abaAdicionar);
        await prepararFotos(abaAdicionar);
      }
      catch (erro) {
        await abaAdicionar.close().catch(() => {});
        abaAdicionar = null;
        throw erro;
      }
    }
    return abaAdicionar;
  }
  async function abrirFormulario(aba) {
    await aba.goto(ORIGEM, {waitUntil:'domcontentloaded'});
    if (!await garantirLogin(aba)) throw new Error('Não foi possível entrar no site. Confira o acesso configurado.');
    await aba.goto(URL_ADICIONAR, {waitUntil:'domcontentloaded'});
    await aba.locator('#inp_title').waitFor({state:'visible'});
    // Reposiciona junto ao rótulo após abrir um novo formulário na mesma aba.
    await instalarBotaoLegenda(aba);
  }
  const enviar = async (entrada, log = async()=>{}) => {
    const campos = validarCampos(entrada.campos);
    const id = entrada.id;
    if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(id)) throw new Error('Identifique a matéria novamente para preencher o site.');
    const conteudo = JSON.stringify(campos);
    const reutilizada = abaAdicionar !== null && !abaAdicionar.isClosed();
    const aba = await obterAba();
    if (ultimoEnvio && ultimoEnvio.id === id && ultimoEnvio.concluido && ultimoEnvio.conteudo === conteudo && aba.url() === URL_ADICIONAR) {
      const titulo = aba.locator('#inp_title');
      if (await titulo.count() === 1 && await titulo.evaluate(e => e.value) === campos.titulo) {
        await selecionarPortais(aba);
        await aba.bringToFront();
        return { ...ultimoEnvio.resultado, reutilizada:true };
      }
    }
    const registro = {id,concluido:false,conteudo};
    ultimoEnvio = registro;
    await log(reutilizada ? 'Abrindo um novo formulário na mesma aba…' : 'Abrindo Adicionar no site…');
    // Reabre Adicionar para limpar também foto, categoria e demais dados da matéria anterior.
    await abrirFormulario(aba);
    if (await aba.locator('#inp_title').evaluate(e=>e.value)) throw new Error('O formulário não está vazio. Confira a aba aberta.');
    await log('Preenchendo os campos da matéria…');
    registro.resultado = await preencherCampos(aba,campos);
    registro.concluido = true;
    await aba.evaluate(avisos => {
      const aviso=document.createElement('div'); aviso.id='autoxs-aviso-envio'; aviso.setAttribute('role','status');
      aviso.textContent='AUTOXS — Confira os campos e clique no botão de enviar do site quando quiser publicar a matéria.' + (avisos.length ? ' ' + avisos.join(' ') : '');
      aviso.style.cssText='position:fixed;bottom:18px;left:18px;right:18px;z-index:2147483647;padding:16px;background:#193c2a;color:#fff;border:1px solid #a2edc5;border-radius:12px;font:14px Segoe UI;pointer-events:none';
      document.body.appendChild(aviso);
    }, registro.resultado.avisos);
    await aba.locator('#inp_title').scrollIntoViewIfNeeded();
    await aba.bringToFront();
    return registro.resultado;
  };
  enviar.listarCategorias = async () => {
    const aba = await obterAba();
    // Lê o formulário já aberto sem apagar uma matéria que esteja sendo editada.
    if (new URL(aba.url()).origin !== ORIGEM || await aba.locator('#inp_category_id').count() !== 1) {
      await abrirFormulario(aba);
    }
    const categoria = aba.locator('#inp_category_id');
    await categoria.waitFor({state:'attached'});
    const nomes = await categoria.locator('option').evaluateAll(os => os
      .filter(o => o.value && !o.disabled && !o.closest('optgroup')?.disabled)
      .map(o => o.textContent.trim()).filter(Boolean));
    if (!nomes.length) throw new Error('Não foi possível carregar as categorias do site. Tente novamente.');
    return [...new Set(nomes)];
  };
  return enviar;
}

function criarEnvioAoSite(context, garantirLogin, prepararFotos = async () => {}, criarAba = () => context.newPage()) {
  const espacos = new Map();
  function obterEspaco(numero) {
    if (!Number.isInteger(numero) || numero < 1 || numero > 4) throw new Error('Escolha um dos quatro espaços de adição.');
    if (!espacos.has(numero)) {
      espacos.set(numero, criarEnvioIndividual(context, garantirLogin, prepararFotos, criarAba));
    }
    return espacos.get(numero);
  }
  const enviar = (entrada, log) => obterEspaco(entrada.espaco ?? 1)(entrada, log);
  enviar.listarCategorias = (numero = 1) => obterEspaco(numero).listarCategorias();
  return enviar;
}
module.exports = { preencherCampos, criarEnvioAoSite, formatarData, validarCampos };
