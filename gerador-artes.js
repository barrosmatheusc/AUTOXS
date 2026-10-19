// O mesmo canvas de 1080 x 1350 é usado para a prévia e para o PNG.
// Apenas foto, chapéu e título são editáveis; os elementos fixos são redesenhados.
(() => {
  const canvas = document.querySelector('#arte');
  const ctx = canvas.getContext('2d');
  const campos = {
    chapeu:document.querySelector('#chapeu'), titulo:document.querySelector('#titulo'),
    foto:document.querySelector('#foto'), zoom:document.querySelector('#zoom'),
    x:document.querySelector('#posicao-x'), y:document.querySelector('#posicao-y'),
    restaurar:document.querySelector('#restaurar'), exportar:document.querySelector('#exportar'),
    aviso:document.querySelector('#aviso')
  };
  const areaFoto = { x:63, y:0, largura:1017, altura:1350 };
  const estado = { imagem:null, logo:null, erroFoto:'', arrasto:null };

  function arredondado(x, y, largura, altura, raio, cor) {
    ctx.beginPath();
    ctx.roundRect(x, y, largura, altura, raio);
    ctx.fillStyle = cor;
    ctx.fill();
  }

  function linhasDoTitulo(titulo) {
    const palavras = titulo.trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
    if (!palavras.length) return [];
    ctx.font = '700 50px Arial, sans-serif';
    const linhas = [];
    let atual = '';
    for (const palavra of palavras) {
      if (ctx.measureText(palavra).width > 880) return null;
      const tentativa = atual ? `${atual} ${palavra}` : palavra;
      if (atual && ctx.measureText(tentativa).width > 880) {
        linhas.push(atual);
        atual = palavra;
      } else atual = tentativa;
    }
    if (atual) linhas.push(atual);
    return linhas;
  }

  function encaixe() {
    if (!estado.imagem) return null;
    const escala = Math.max(areaFoto.largura / estado.imagem.naturalWidth,
      areaFoto.altura / estado.imagem.naturalHeight) * Number(campos.zoom.value);
    const largura = estado.imagem.naturalWidth * escala;
    const altura = estado.imagem.naturalHeight * escala;
    const alcanceX = (largura - areaFoto.largura) / 2;
    const alcanceY = (altura - areaFoto.altura) / 2;
    return { largura, altura, alcanceX, alcanceY,
      x:areaFoto.x - alcanceX + alcanceX * Number(campos.x.value) / 100,
      y:areaFoto.y - alcanceY + alcanceY * Number(campos.y.value) / 100 };
  }

  function textoRastreado(texto, x, y, espaco) {
    for (const letra of texto) {
      ctx.fillText(letra, x, y);
      x += ctx.measureText(letra).width + espaco;
    }
  }

  function desenhar() {
    ctx.clearRect(0, 0, 1080, 1350);
    ctx.fillStyle = '#344239';
    ctx.fillRect(0, 0, 1080, 1350);
    if (estado.imagem) {
      const foto = encaixe();
      ctx.save();
      ctx.beginPath();
      ctx.rect(areaFoto.x, areaFoto.y, areaFoto.largura, areaFoto.altura);
      ctx.clip();
      ctx.drawImage(estado.imagem, foto.x, foto.y, foto.largura, foto.altura);
      ctx.restore();
    }
    ctx.fillStyle = '#039e38';
    ctx.fillRect(0, 0, 61, 1350);
    ctx.fillStyle = '#f3f5ef';
    ctx.fillRect(61, 0, 2, 1350);
    if (estado.logo) ctx.drawImage(estado.logo, 800, 42, 240, 66.3);

    const chapeu = campos.chapeu.value.trim().toLocaleUpperCase('pt-BR');
    const titulo = campos.titulo.value.trim();
    const linhas = linhasDoTitulo(titulo);
    let erroTitulo = '';
    if (linhas === null) erroTitulo = 'Uma palavra do título ultrapassa a largura da arte.';
    else if (linhas.length > 5) erroTitulo = 'Título longo demais para o espaço do modelo. Ajuste o texto antes de exportar.';
    ctx.font = '700 47px Arial, sans-serif';
    const larguraChapeu = ctx.measureText(chapeu).width;
    if (larguraChapeu > 865) erroTitulo = 'O chapéu ultrapassa o espaço do modelo. Ajuste o texto.';
    if (!erroTitulo && linhas?.length) {
      const inicio = 980 - (linhas.length - 3) * 64;
      const topoChapeu = inicio - 94;
      if (topoChapeu < 580) erroTitulo = 'O texto ultrapassa a área editorial do modelo.';
      else {
        if (chapeu) {
          arredondado(93, topoChapeu, larguraChapeu + 40, 76, 19, '#039e38');
          ctx.fillStyle = '#fff';
          ctx.font = '700 47px Arial, sans-serif';
          ctx.fillText(chapeu, 113, topoChapeu + 55);
        }
        ctx.font = '700 50px Arial, sans-serif';
        linhas.forEach((linha, indice) => {
          const topo = inicio + indice * 64;
          arredondado(93, topo, ctx.measureText(linha).width + 38, 79, 19, 'rgba(0,0,0,.70)');
          ctx.fillStyle = '#fff';
          ctx.fillText(linha, 112, topo + 56);
        });
      }
    }

    ctx.fillStyle = '#000';
    ctx.fillRect(454, 1278, 626, 72);
    ctx.fillStyle = '#fff';
    ctx.font = '700 20px Arial, sans-serif';
    textoRastreado('TRIBUNADOSERTAO.COM.BR', 604, 1316, 4);

    const completo = Boolean(estado.imagem && estado.logo && chapeu && titulo && !erroTitulo && !estado.erroFoto);
    campos.exportar.disabled = !completo;
    campos.aviso.textContent = estado.erroFoto || erroTitulo ||
      (!estado.logo ? 'O logotipo oficial ainda não carregou; a exportação está indisponível.' :
        !estado.imagem ? 'Escolha uma fotografia para completar a arte.' :
        !chapeu || !titulo ? 'Preencha o chapéu e o título para exportar.' :
        'Prévia pronta. Confira a arte antes de exportar.');
    campos.aviso.classList.toggle('erro', Boolean(estado.erroFoto || erroTitulo));
  }

  window.configurarLogoGerador = async dataUrl => {
    const logo = new Image();
    logo.src = dataUrl;
    try {
      await logo.decode();
      if (!logo.naturalWidth || !logo.naturalHeight) throw new Error('Logotipo inválido.');
      estado.logo = logo;
    } catch {
      estado.logo = null;
    }
    desenhar();
    return Boolean(estado.logo);
  };

  campos.foto.addEventListener('change', async () => {
    const arquivo = campos.foto.files?.[0];
    if (!arquivo) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(arquivo.type) || arquivo.size > 40 * 1024 * 1024) {
      estado.erroFoto = 'Escolha uma foto JPG, PNG ou WebP de até 40 MB.';
      desenhar();
      return;
    }
    const url = URL.createObjectURL(arquivo);
    try {
      const imagem = new Image();
      imagem.src = url;
      await imagem.decode();
      if (!imagem.naturalWidth || !imagem.naturalHeight) throw new Error('Arquivo de imagem inválido.');
      estado.imagem = imagem;
      estado.erroFoto = '';
      campos.restaurar.click();
    } catch {
      estado.erroFoto = 'Não foi possível carregar essa fotografia.';
      desenhar();
    } finally { URL.revokeObjectURL(url); }
  });
  for (const campo of [campos.chapeu, campos.titulo, campos.zoom, campos.x, campos.y])
    campo.addEventListener('input', desenhar);
  campos.restaurar.addEventListener('click', () => {
    campos.zoom.value = '1'; campos.x.value = '0'; campos.y.value = '0'; desenhar();
  });

  canvas.addEventListener('pointerdown', evento => {
    if (!estado.imagem) return;
    estado.arrasto = { x:evento.clientX, y:evento.clientY,
      posX:Number(campos.x.value), posY:Number(campos.y.value) };
    canvas.setPointerCapture(evento.pointerId);
    canvas.classList.add('arrastando');
  });
  canvas.addEventListener('pointermove', evento => {
    if (!estado.arrasto) return;
    const foto = encaixe();
    const escala = canvas.width / canvas.getBoundingClientRect().width;
    const limite = valor => Math.max(-100, Math.min(100, valor));
    if (foto.alcanceX > 0.5) campos.x.value = String(limite(estado.arrasto.posX +
      (evento.clientX - estado.arrasto.x) * escala * 100 / foto.alcanceX));
    if (foto.alcanceY > 0.5) campos.y.value = String(limite(estado.arrasto.posY +
      (evento.clientY - estado.arrasto.y) * escala * 100 / foto.alcanceY));
    desenhar();
  });
  const pararArrasto = () => { estado.arrasto = null; canvas.classList.remove('arrastando'); };
  canvas.addEventListener('pointerup', pararArrasto);
  canvas.addEventListener('pointercancel', pararArrasto);

  campos.exportar.addEventListener('click', async () => {
    if (campos.exportar.disabled) return;
    try {
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('Não foi possível gerar o PNG.');
      const nome = 'tribuna-sertao-arte.png';
      if (typeof window.showSaveFilePicker === 'function') {
        try {
          const destino = await window.showSaveFilePicker({ suggestedName:nome,
            types:[{ description:'Imagem PNG', accept:{ 'image/png':['.png'] } }] });
          const arquivo = await destino.createWritable();
          await arquivo.write(blob);
          await arquivo.close();
          campos.aviso.textContent = 'PNG salvo com 1080 × 1350 pixels.';
          return;
        } catch (erro) { if (erro.name === 'AbortError') return; }
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = nome;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      campos.aviso.textContent = 'PNG gerado com 1080 × 1350 pixels.';
    } catch (erro) {
      campos.aviso.textContent = erro.message || 'Não foi possível exportar a arte.';
      campos.aviso.classList.add('erro');
    }
  });
  desenhar();
})();
