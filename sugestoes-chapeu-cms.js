const { sugerirChapeus } = require('./sugestoes-chapeu');

const preparadas = new WeakSet();
const ORIGEM = 'https://redacao.tribunaweb.com.br';
const CAMINHO_MATERIA = /^\/news\/(?:add|edit\/[^/]+)\/?$/;

async function instalarSugestoesChapeuCMS(aba) {
  if (preparadas.has(aba)) return;
  await aba.exposeBinding('__autoxsGerarSugestoesChapeu', ({ frame }, campos) => {
    if (frame !== aba.mainFrame()) return [];
    const url = new URL(frame.url());
    if (url.origin !== ORIGEM || !CAMINHO_MATERIA.test(url.pathname)) return [];
    return sugerirChapeus(campos);
  });

  const instalar = () => {
    if (window.__autoxsSugestoesChapeuCMS) return;
    window.__autoxsSugestoesChapeuCMS = true;
    let versao = 0;
    let assinatura = '';
    const campoChapeu = () => document.querySelector('#inp_hat, input[name="hat"], input[name*="chapeu" i], textarea[name*="chapeu" i]');
    const valor = seletor => document.querySelector(seletor)?.value || '';
    const textoRedacao = () => document.querySelector('.rx-editor')?.innerText || document.querySelector('.rx-source')?.value || '';
    async function atualizar() {
      const campo = campoChapeu();
      const anterior = document.getElementById('autoxs-sugestoes-chapeu-cms');
      if (location.origin !== 'https://redacao.tribunaweb.com.br' || !/^\/news\/(?:add|edit\/[^/]+)\/?$/.test(location.pathname) || !campo || campo.value.trim()) {
        anterior?.remove(); assinatura = ''; return;
      }
      const campos = {
        titulo: valor('#inp_title, input[name="title"]'),
        bigode: valor('#inp_subtitle, input[name="subtitle"], textarea[name="subtitle"]'),
        redacao: textoRedacao().slice(0, 6000)
      };
      const chave = JSON.stringify(campos);
      if (anterior?.previousElementSibling === campo && assinatura === chave) return;
      assinatura = chave;
      const atual = ++versao;
      let opcoes;
      try { opcoes = await window.__autoxsGerarSugestoesChapeu(campos); }
      catch { return; }
      if (atual !== versao || !campo.isConnected || campo.value.trim()) return;
      anterior?.remove();
      if (!opcoes.length) return;
      const painel = document.createElement('div');
      painel.id = 'autoxs-sugestoes-chapeu-cms';
      painel.style.cssText = 'margin:8px 0 12px;padding:9px;border:1px solid #81bd96;border-radius:7px;background:#eaf8ee;color:#173d25;display:flex;flex-wrap:wrap;gap:6px;align-items:center';
      const rotulo = document.createElement('strong');
      rotulo.textContent = 'SUGESTÕES DE CHAPÉU';
      rotulo.style.cssText = 'width:100%;font:700 12px Arial,sans-serif';
      painel.appendChild(rotulo);
      for (const sugestao of opcoes) {
        const botao = document.createElement('button');
        botao.type = 'button'; botao.textContent = sugestao;
        botao.style.cssText = 'cursor:pointer;border:1px solid #4c8c61;border-radius:5px;padding:5px 8px;background:#fff;color:#173d25;font:600 12px Arial,sans-serif';
        botao.addEventListener('click', () => {
          const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(campo), 'value')?.set;
          if (setter) setter.call(campo, sugestao);
          else campo.value = sugestao;
          campo.dispatchEvent(new Event('input', { bubbles: true }));
          campo.dispatchEvent(new Event('change', { bubbles: true }));
          painel.remove(); campo.focus();
        });
        painel.appendChild(botao);
      }
      campo.insertAdjacentElement('afterend', painel);
    }
    window.__autoxsAtualizarSugestoesChapeuCMS = atualizar;
    document.addEventListener('input', () => { void atualizar(); });
    window.setInterval(() => { void atualizar(); }, 1200);
    void atualizar();
  };
  await aba.addInitScript(instalar);
  await aba.evaluate(instalar);
  preparadas.add(aba);
}

module.exports = { instalarSugestoesChapeuCMS };
