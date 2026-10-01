const { normalizarTextoCopiado } = require('./identificar-materia');
const escapar = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function inline(s) {
  // Texto recebido nunca é executado como HTML. Apenas estas marcações são convertidas.
  return escapar(s)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}
function textoParaHtml(texto) {
  // Aplica também a textos colados diretamente ao alterar a redação na revisão.
  const linhas = normalizarTextoCopiado(texto).split('\n');
  const saida = [], paragrafo = [];
  const descarregar = () => { if (paragrafo.length) { saida.push('<p>' + paragrafo.map(inline).join('<br>') + '</p>'); paragrafo.length = 0; } };
  const celulas = l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(v => v.trim());
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    if (!l.trim()) { descarregar(); continue; }
    if (/^\s*\|/.test(l) && /^\s*\|?\s*:?-{2,}/.test(linhas[i + 1] || '')) {
      descarregar();
      let cab = celulas(l); const corpo = []; i += 2;
      while (i < linhas.length && /^\s*\|/.test(linhas[i])) corpo.push(celulas(linhas[i++]));
      i--;
      // Corrige a grade horária colada com todos os horários na primeira célula.
      const horas = (cab[0] || '').match(/\d{1,2}h/g);
      if (horas?.length === cab.length && cab.slice(1).every(c => !c) && horas.join('') === cab[0].replace(/\s/g, '')) cab = horas;
      saida.push('<table><thead><tr>' + cab.map(c => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>' + corpo.map(row => '<tr>' + row.map(c => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>');
    } else {
      const h = l.match(/^\s*(#{1,6})\s+(.+)$/);
      if (h) { descarregar(); const nivel = Math.max(2, h[1].length); saida.push('<h' + nivel + '>' + inline(h[2]) + '</h' + nivel + '>'); }
      else paragrafo.push(l);
    }
  }
  descarregar(); return saida.join('\n');
}
module.exports = { textoParaHtml };
