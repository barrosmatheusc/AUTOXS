const fs = require('node:fs/promises');
const { spawn } = require('node:child_process');

function escolherDestinoWindows(nome) {
  if (process.platform !== 'win32') throw new Error('Escolha de destino disponível somente no Windows.');
  const comando = `Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.SaveFileDialog; ` +
    `$d.Filter='Arquivo JSON (*.json)|*.json'; $d.FileName='${nome}'; $d.OverwritePrompt=$true; ` +
    `if($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK){[Console]::Out.Write($d.FileName)}`;
  return new Promise((resolve, reject) => {
    const processo = spawn('powershell.exe', ['-NoProfile', '-Sta', '-Command', comando],
      { windowsHide:true, stdio:['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    processo.stdout.setEncoding('utf8'); processo.stderr.setEncoding('utf8');
    processo.stdout.on('data', parte => { stdout += parte; });
    processo.stderr.on('data', parte => { stderr += parte; });
    processo.once('error', reject);
    processo.once('close', codigo => codigo === 0 ? resolve(stdout.trim() || null)
      : reject(new Error(stderr.trim() || 'Não foi possível escolher o destino.')));
  });
}

async function salvarExportacao(documento, escolher = escolherDestinoWindows) {
  const nome = `AUTOXS_DADOS_${documento.dia}.json`;
  const destino = await escolher(nome);
  if (!destino) return { cancelado:true };
  if (!/\.json$/i.test(destino)) throw new Error('Escolha um arquivo com extensão .json.');
  try { await fs.writeFile(destino, JSON.stringify(documento, null, 2) + '\n', { encoding:'utf8', flag:'wx' }); }
  catch (erro) {
    if (erro.code === 'EEXIST') throw new Error('Esse arquivo já existe. Escolha outro nome para não sobrescrever uma exportação anterior.');
    throw erro;
  }
  return { cancelado:false, destino, registros:documento.registros?.length || 0,
    estatisticas:documento.estatisticas?.length || 0, links:documento.links?.length || 0 };
}
module.exports = { salvarExportacao, escolherDestinoWindows };
