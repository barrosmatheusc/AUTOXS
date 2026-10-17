(() => {
  const central = document.querySelector('.central');
  const divisor = document.querySelector('#divisor-paineis');
  const producao = document.querySelector('#coluna-producao');
  if (!central || !divisor || !producao) return;

  const chave = 'autoxs-divisor-paineis-v1';
  const larguraPadrao = 440;
  const minimoAutomacao = 320;
  const minimoProducao = 480;
  const telaLarga = window.matchMedia('(min-width: 981px)');
  let proporcao = null;
  let ponteiroAtivo = null;

  try {
    const valor = Number(localStorage.getItem(chave));
    if (Number.isFinite(valor) && valor > 0 && valor < 1) proporcao = valor;
  } catch { /* A interface continua ajustável quando o armazenamento está indisponível. */ }

  const podeAjustar = () => telaLarga.matches && !producao.hidden;
  function limites() {
    const largura = central.getBoundingClientRect().width;
    const espacamento = parseFloat(getComputedStyle(central).columnGap) || 0;
    const disponivel = largura - divisor.getBoundingClientRect().width - 2 * espacamento;
    return { disponivel, minimo: minimoAutomacao, maximo: disponivel - minimoProducao };
  }

  function ajustar(largura) {
    if (!podeAjustar()) return null;
    const { disponivel, minimo, maximo } = limites();
    if (maximo < minimo) return null;
    const aplicada = Math.min(maximo, Math.max(minimo, largura));
    central.style.setProperty('--largura-automacao', `${aplicada}px`);
    divisor.setAttribute('aria-valuemin', String(Math.ceil(minimo)));
    divisor.setAttribute('aria-valuemax', String(Math.ceil(maximo)));
    divisor.setAttribute('aria-valuenow', String(Math.round(aplicada)));
    divisor.setAttribute('aria-valuetext', `Painel de atualização com ${Math.round(aplicada)} pixels`);
    return { largura: aplicada, disponivel };
  }

  function aplicarPreferencia() {
    if (!podeAjustar() || ponteiroAtivo !== null) return;
    const { disponivel } = limites();
    ajustar(proporcao === null ? larguraPadrao : proporcao * disponivel);
  }

  function guardar(resultado) {
    if (!resultado) return;
    proporcao = resultado.largura / resultado.disponivel;
    try { localStorage.setItem(chave, String(proporcao)); }
    catch { /* A posição continua válida nesta sessão. */ }
  }

  function encerrarPonteiro(evento) {
    if (ponteiroAtivo === null || (evento?.pointerId !== undefined && evento.pointerId !== ponteiroAtivo)) return;
    const concluido = evento?.type === 'pointerup';
    const id = ponteiroAtivo;
    ponteiroAtivo = null;
    central.classList.remove('arrastando');
    if (divisor.hasPointerCapture(id)) divisor.releasePointerCapture(id);
    if (concluido) guardar(ajustar(parseFloat(getComputedStyle(central).getPropertyValue('--largura-automacao'))));
    else aplicarPreferencia();
  }

  divisor.addEventListener('pointerdown', evento => {
    if (evento.button !== 0 || !podeAjustar() || ponteiroAtivo !== null) return;
    evento.preventDefault();
    ponteiroAtivo = evento.pointerId;
    divisor.setPointerCapture(evento.pointerId);
    central.classList.add('arrastando');
  });
  divisor.addEventListener('pointermove', evento => {
    if (evento.pointerId !== ponteiroAtivo) return;
    ajustar(evento.clientX - central.getBoundingClientRect().left);
  });
  divisor.addEventListener('pointerup', encerrarPonteiro);
  divisor.addEventListener('pointercancel', encerrarPonteiro);
  divisor.addEventListener('lostpointercapture', encerrarPonteiro);

  divisor.addEventListener('keydown', evento => {
    if (!podeAjustar()) return;
    const { minimo, maximo } = limites();
    const atual = parseFloat(getComputedStyle(central).getPropertyValue('--largura-automacao')) || larguraPadrao;
    const passo = evento.shiftKey ? 48 : 16;
    const destino = evento.key === 'ArrowLeft' ? atual - passo
      : evento.key === 'ArrowRight' ? atual + passo
        : evento.key === 'Home' ? minimo
          : evento.key === 'End' ? maximo : null;
    if (destino === null) return;
    evento.preventDefault();
    guardar(ajustar(destino));
  });

  divisor.addEventListener('dblclick', evento => {
    if (!podeAjustar()) return;
    evento.preventDefault();
    proporcao = null;
    try { localStorage.removeItem(chave); } catch {}
    aplicarPreferencia();
  });
  window.addEventListener('resize', aplicarPreferencia);
  window.addEventListener('blur', () => encerrarPonteiro());
  aplicarPreferencia();
})();
