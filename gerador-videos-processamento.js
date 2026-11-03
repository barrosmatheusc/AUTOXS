const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { fileURLToPath } = require('node:url');

const PASTA_DADOS = path.join(__dirname, 'gerador-videos', 'dados');
const EXTENSOES_VIDEO = new Set(['.mp4', '.webm', '.mov', '.mkv']);

async function pastaDownloadsWindows() {
  if (process.platform !== 'win32') throw new Error('Escolha uma pasta para salvar o vídeo.');
  const comando = '$shell = New-Object -ComObject Shell.Application; $shell.Namespace("shell:Downloads").Self.Path';
  const { stdout } = await executarComando('powershell.exe', ['-NoProfile','-Command',comando]);
  const pasta = stdout.trim();
  if (!pasta || !(await fs.stat(pasta).catch(() => null))?.isDirectory())
    throw new Error('Não foi possível localizar a pasta Downloads do Windows. Escolha outra pasta.');
  return pasta;
}

async function escolherPastaWindows() {
  if (process.platform !== 'win32') throw new Error('Escolha de pasta disponível somente no Windows.');
  const comando = '$shell = New-Object -ComObject Shell.Application; ' +
    '$item = $shell.BrowseForFolder(0,"Escolha a pasta para os vídeos do AutoXS",0,0); ' +
    'if ($item) { [Console]::Out.Write($item.Self.Path) }';
  const { stdout } = await executarComando('powershell.exe',['-NoProfile','-Command',comando]);
  return stdout.trim() || null;
}

async function abrirPastaWindows(pasta) {
  if (process.platform !== 'win32') throw new Error('Abertura de pasta disponível somente no Windows.');
  await new Promise((resolve,reject) => {
    const processo = spawn('explorer.exe',[pasta],{detached:true,stdio:'ignore',windowsHide:false});
    processo.once('error',reject);
    processo.once('spawn',()=>{processo.unref();resolve();});
  });
  return { pasta };
}

function validarUrlInstagram(valor) {
  let url;
  try { url = new URL(valor); } catch { throw new Error('Informe um link válido do Instagram.'); }
  if (url.protocol !== 'https:' || !['instagram.com', 'www.instagram.com'].includes(url.hostname.toLowerCase()))
    throw new Error('Use um link HTTPS público do Instagram.');
  const partes = /^\/(reel|p|tv)\/([a-zA-Z0-9_-]+)\/?$/.exec(url.pathname);
  if (!partes) throw new Error('Use o link de um Reel ou publicação do Instagram.');
  return { url: `https://www.instagram.com/${partes[1]}/${partes[2]}/`, id: partes[2] };
}

function erroCancelado() { const erro = new Error('Processamento cancelado.'); erro.name = 'AbortError'; return erro; }

function executarComando(binario, argumentos, { signal, cwd } = {}) {
  if (signal?.aborted) return Promise.reject(erroCancelado());
  return new Promise((resolve, reject) => {
    const filho = spawn(binario, argumentos, { cwd, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', encerrado = false;
    const decodificadorStdout = new StringDecoder('utf8');
    const decodificadorStderr = new StringDecoder('utf8');
    const parar = () => {
      if (process.platform === 'win32' && filho.pid)
        spawn('taskkill', ['/PID', String(filho.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => filho.kill());
      else filho.kill('SIGTERM');
    };
    signal?.addEventListener('abort', parar, { once: true });
    filho.stdout.on('data', dados => { stdout = (stdout + decodificadorStdout.write(dados)).slice(-2_000_000); });
    filho.stderr.on('data', dados => { stderr = (stderr + decodificadorStderr.write(dados)).slice(-2_000_000); });
    const concluir = (erro, codigo) => {
      if (encerrado) return;
      encerrado = true;
      stdout += decodificadorStdout.end();
      stderr += decodificadorStderr.end();
      signal?.removeEventListener('abort', parar);
      if (signal?.aborted) reject(erroCancelado());
      else if (erro) reject(erro);
      else if (codigo !== 0) reject(new Error(stderr.trim().split(/\r?\n/).slice(-3).join(' ') || `${binario} terminou com código ${codigo}.`));
      else resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
    };
    filho.on('error', erro => concluir(new Error(`Não foi possível iniciar ${path.basename(binario)}: ${erro.message}`)));
    filho.on('close', codigo => concluir(null, codigo));
  });
}

function criarProcessadorVideos({ pastaDados = PASTA_DADOS, executar = executarComando,
  binarios = {}, modelo = process.env.AUTOXS_WHISPER_MODEL || 'small', informar = () => {},
  resolverDownloads = pastaDownloadsWindows, selecionarDiretorio = escolherPastaWindows,
  abrirDiretorio = abrirPastaWindows, pastaInicial = null, aoSelecionarPasta = async () => {} } = {}) {
  const pythonLocal = path.join(__dirname, 'gerador-videos', '.venv',
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const comandos = {
    ytdlp: binarios.ytdlp || process.env.AUTOXS_YTDLP || null,
    ffmpeg: binarios.ffmpeg || process.env.AUTOXS_FFMPEG || null,
    ffprobe: binarios.ffprobe || process.env.AUTOXS_FFPROBE || null,
    python: binarios.python || process.env.AUTOXS_PYTHON ||
      (fsSync.existsSync(pythonLocal) ? pythonLocal : 'python')
  };
  let tarefa = null;
  let ffmpegLocal = null;
  let pastaSelecionada = pastaInicial;
  let ultimoVideoSalvo = null;
  const executarYtdlp = (argumentos, opcoes) => comandos.ytdlp
    ? executar(comandos.ytdlp, argumentos, opcoes)
    : executar(comandos.python, ['-m', 'yt_dlp', ...argumentos], opcoes);
  async function obterFfmpeg(signal) {
    if (comandos.ffmpeg) return comandos.ffmpeg;
    if (!ffmpegLocal) {
      const resposta = await executar(comandos.python,
        ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'], { signal });
      ffmpegLocal = resposta.stdout.trim();
      if (!ffmpegLocal) throw new Error('FFmpeg não encontrado no ambiente do Gerador.');
    }
    return ffmpegLocal;
  }
  const avisar = (texto, tarefaAtual) => {
    if (tarefaAtual?.signal.aborted) return;
    informar(texto);
    console.log(`[VÍDEOS] ${texto}`);
  };
  async function sondar(arquivo, signal) {
    const { stdout } = comandos.ffprobe
      ? await executar(comandos.ffprobe,
        ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name', '-of', 'json', arquivo], { signal })
      : await executar(comandos.python, [path.join(__dirname, 'gerador-videos', 'sondar.py'), arquivo], { signal });
    let dados;
    try { dados = JSON.parse(stdout); } catch { throw new Error('Não foi possível validar o arquivo de vídeo.'); }
    const tipos = (dados.streams || []).map(item => item.codec_type);
    if (!tipos.includes('video')) throw new Error('A publicação não contém um vídeo reproduzível.');
    return { audio: tipos.includes('audio'),
      codecVideo:dados.streams.find(item=>item.codec_type==='video')?.codec_name,
      codecAudio:dados.streams.find(item=>item.codec_type==='audio')?.codec_name || null };
  }
  async function arquivoExistente(id, signal) {
    const pasta = path.join(pastaDados, 'originais');
    const nomes = await fs.readdir(pasta).catch(() => []);
    for (const nome of nomes) {
      if (!(nome.startsWith(`instagram-${id}-`) || nome.startsWith(`instagram-${id}.`)) ||
          !EXTENSOES_VIDEO.has(path.extname(nome).toLowerCase())) continue;
      const arquivo = path.join(pasta, nome);
      if ((await fs.stat(arquivo)).size < 1024) continue;
      try { return { arquivo, ...await sondar(arquivo, signal) }; } catch { /* Baixa novamente se o cache estiver inválido. */ }
    }
    return null;
  }
  async function baixar(referencia, signal, tarefaAtual) {
    let video = await arquivoExistente(referencia.id, signal);
    if (video) { avisar('✅ Download anterior validado; reutilizando vídeo.', tarefaAtual); return video; }
    avisar('⏳ Validando publicação...', tarefaAtual);
    const { stdout } = await executarYtdlp(
      ['--ignore-config', '--no-playlist', '--dump-single-json', '--skip-download', referencia.url], { signal });
    let dados;
    try { dados = JSON.parse(stdout); } catch { throw new Error('O Instagram não forneceu dados válidos da publicação.'); }
    if (dados.entries?.length > 1) throw new Error('Publicação com vários itens: escolha o link direto de um único vídeo.');
    const item = dados.entries?.[0] || dados;
    if (item.vcodec === 'none' || (!item.vcodec && !item.formats?.some(formato => formato.vcodec && formato.vcodec !== 'none')))
      throw new Error('A publicação não contém vídeo acessível.');
    const pasta = path.join(pastaDados, 'originais');
    const temporarios = path.join(pastaDados, 'temporarios');
    await fs.mkdir(pasta, { recursive: true });
    await fs.mkdir(temporarios, { recursive: true });
    avisar('⏳ Baixando vídeo...', tarefaAtual);
    const nomeBase = `instagram-${referencia.id}-${randomUUID()}`;
    const destino = path.join(pasta, `${nomeBase}.%(ext)s`);
    const ffmpeg = await obterFfmpeg(signal);
    const pastaTemporaria = path.join(temporarios, nomeBase);
    await fs.mkdir(pastaTemporaria, { recursive: true });
    let download;
    try {
      download = await executarYtdlp(
        ['--ignore-config', '--no-playlist', '--no-warnings', '--no-progress', '--no-overwrites',
          '-P', `temp:${pastaTemporaria}`,
          '-f', 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best', '--merge-output-format', 'mp4',
          '--ffmpeg-location', ffmpeg,
          '--print', 'after_move:filepath', '-o', destino, referencia.url], { signal });
    } finally {
      if (path.dirname(path.resolve(pastaTemporaria)) === path.resolve(temporarios))
        await fs.rm(pastaTemporaria, { recursive: true, force: true });
    }
    const arquivo = download.stdout.split(/\r?\n/).at(-1)?.trim();
    if (!arquivo || path.dirname(path.resolve(arquivo)) !== path.resolve(pasta) ||
        !path.basename(arquivo).startsWith(`${nomeBase}.`) ||
        !EXTENSOES_VIDEO.has(path.extname(arquivo).toLowerCase()))
      throw new Error('Não foi possível confirmar o arquivo baixado.');
    if ((await fs.stat(arquivo)).size < 1024) throw new Error('O arquivo baixado está vazio ou incompleto.');
    video = { arquivo, ...await sondar(arquivo, signal) };
    avisar('✅ Download concluído e vídeo validado.', tarefaAtual);
    return video;
  }
  async function transcrever(video, id, signal, tarefaAtual) {
    if (!video.audio) { avisar('Vídeo sem faixa de áudio; não há fala para transcrever.', tarefaAtual); return { texto: '', idioma: null, semAudio: true }; }
    const temporarios = path.join(pastaDados, 'temporarios');
    const transcricoes = path.join(pastaDados, 'transcricoes');
    await fs.mkdir(temporarios, { recursive: true });
    await fs.mkdir(transcricoes, { recursive: true });
    const audio = path.join(temporarios, `${id}-${randomUUID()}.wav`);
    try {
      avisar('⏳ Extraindo áudio...', tarefaAtual);
      await executar(await obterFfmpeg(signal), ['-nostdin', '-v', 'error', '-i', video.arquivo,
        '-vn', '-ac', '1', '-ar', '16000', '-f', 'wav', audio], { signal });
      avisar('⏳ Transcrevendo vídeo...', tarefaAtual);
      const resposta = await executar(comandos.python,
        [path.join(__dirname, 'gerador-videos', 'transcrever.py'), audio, modelo], { signal });
      let resultado;
      try { resultado = JSON.parse(resposta.stdout); } catch { throw new Error('A transcrição não retornou um resultado válido.'); }
      if (typeof resultado.texto !== 'string') throw new Error('A transcrição não retornou texto válido.');
      if (signal.aborted) throw erroCancelado();
      await fs.writeFile(path.join(transcricoes, `instagram-${id}-${randomUUID()}.txt`), resultado.texto, { encoding: 'utf8', flag: 'wx' });
      avisar(resultado.texto ? '✅ Transcrição concluída.' : 'Nenhuma fala identificável no vídeo.', tarefaAtual);
      return resultado;
    } finally { await fs.rm(audio, { force: true }).catch(() => {}); }
  }
  async function obterPastaDestino() {
    const pasta = path.resolve(pastaSelecionada || await resolverDownloads());
    if (!(await fs.stat(pasta).catch(() => null))?.isDirectory())
      throw new Error('A pasta de destino não está disponível. Escolha outra pasta.');
    return pasta;
  }
  async function escolherPastaDestino() {
    if (tarefa) throw new Error('Aguarde o processamento terminar para trocar a pasta.');
    const pasta = await selecionarDiretorio();
    if (!pasta) return { pasta:await obterPastaDestino(),cancelado:true };
    const resolvida = await definirPastaDestino(pasta);
    await aoSelecionarPasta(resolvida);
    return { pasta:resolvida,cancelado:false };
  }
  async function definirPastaDestino(pasta) {
    if (tarefa) throw new Error('Aguarde o processamento terminar para trocar a pasta.');
    if (pasta === null) { pastaSelecionada = null; return obterPastaDestino(); }
    const resolvida = path.resolve(pasta);
    if (!(await fs.stat(resolvida).catch(() => null))?.isDirectory())
      throw new Error('A pasta escolhida não está disponível.');
    pastaSelecionada = resolvida;
    return resolvida;
  }
  async function abrirPastaVideo() {
    if (!ultimoVideoSalvo || !(await fs.stat(ultimoVideoSalvo).catch(() => null))?.isFile())
      throw new Error('Baixe e salve um vídeo antes de abrir a pasta.');
    return abrirDiretorio(path.dirname(ultimoVideoSalvo));
  }
  async function salvarVideo(video, id, signal, tarefaAtual) {
    const pasta = await obterPastaDestino();
    const base = `Instagram_${id}`;
    let origem = video.arquivo;
    let convertido = null;
    avisar('⏳ Salvando vídeo no computador...', tarefaAtual);
    try {
      const codecsCompativeis = video.codecVideo === 'h264' && (!video.audio || video.codecAudio === 'aac');
      if (path.extname(origem).toLowerCase() !== '.mp4' || !codecsCompativeis) {
        const temporarios = path.join(pastaDados,'temporarios');
        await fs.mkdir(temporarios,{recursive:true});
        convertido = path.join(temporarios,`${base}-${randomUUID()}.mp4`);
        const binario = await obterFfmpeg(signal);
        const entrada = ['-nostdin','-v','error','-i',origem,'-map','0:v:0','-map','0:a:0?'];
        if (codecsCompativeis) {
          await executar(binario,[...entrada,'-c','copy','-movflags','+faststart','-y',convertido],{signal});
        } else {
          await executar(binario,[...entrada,'-c:v','libx264','-preset','veryfast','-crf','23',
            '-c:a','aac','-b:a','128k','-movflags','+faststart','-y',convertido],{signal});
        }
        const verificado=await sondar(convertido,signal);
        if (verificado.codecVideo !== 'h264' || (verificado.audio && verificado.codecAudio !== 'aac'))
          throw new Error('O vídeo convertido não possui codecs compatíveis com MP4.');
        origem = convertido;
      }
      for (let numero=1;numero<=1000;numero++) {
        if (signal.aborted) throw erroCancelado();
        const nome = numero===1 ? `${base}.mp4` : `${base} (${numero}).mp4`;
        const destino = path.join(pasta,nome);
        try {
          await fs.copyFile(origem,destino,fsSync.constants.COPYFILE_EXCL);
          if (signal.aborted) { await fs.rm(destino,{force:true}); throw erroCancelado(); }
          try { await sondar(destino,signal); }
          catch (erro) { await fs.rm(destino,{force:true}); throw erro; }
          ultimoVideoSalvo = destino;
          avisar(`✅ Vídeo salvo: ${destino}`,tarefaAtual);
          return { caminho:destino,nome,pasta,url:pathToFileURL(destino).href };
        } catch (erro) {
          if (erro.code !== 'EEXIST') {
            await fs.rm(destino,{force:true}).catch(() => {});
            throw erro;
          }
        }
      }
      throw new Error('A pasta já contém muitas cópias desse vídeo.');
    } finally { if (convertido) await fs.rm(convertido,{force:true}).catch(() => {}); }
  }
  async function iniciar(url) {
    if (tarefa) throw new Error('Já existe um vídeo em processamento.');
    const referencia = validarUrlInstagram(url);
    const controlador = new AbortController();
    const atual = { controlador, signal: controlador.signal };
    tarefa = atual;
    try {
      avisar('⏳ Validando link...', atual);
      const video = await baixar(referencia, atual.signal, atual);
      const salvo = await salvarVideo(video,referencia.id,atual.signal,atual);
      const resultado = { url:salvo.url,arquivo:salvo.nome,caminho:salvo.caminho,pasta:salvo.pasta,
        transcricao: '', idioma: null, erroTranscricao: null };
      try {
        const texto = await transcrever(video, referencia.id, atual.signal, atual);
        resultado.transcricao = texto.texto;
        resultado.idioma = texto.idioma || null;
      } catch (erro) {
        if (atual.signal.aborted) throw erroCancelado();
        resultado.erroTranscricao = erro.message;
        avisar(`❌ Falha na transcrição: ${erro.message}`, atual);
      }
      if (atual.signal.aborted) throw erroCancelado();
      return resultado;
    } finally { if (tarefa === atual) tarefa = null; }
  }
  async function tentarTranscricao(url) {
    if (tarefa) throw new Error('Já existe um vídeo em processamento.');
    const referencia = validarUrlInstagram(url);
    const controlador = new AbortController();
    const atual = { controlador, signal: controlador.signal };
    tarefa = atual;
    try {
      const video = await arquivoExistente(referencia.id, atual.signal);
      if (!video) throw new Error('Vídeo baixado não encontrado; use o botão principal.');
      const resultado = await transcrever(video, referencia.id, atual.signal, atual);
      if (atual.signal.aborted) throw erroCancelado();
      return { transcricao: resultado.texto, idioma: resultado.idioma || null };
    } finally { if (tarefa === atual) tarefa = null; }
  }
  function cancelar() { if (!tarefa) return false; tarefa.controlador.abort(); return true; }
  return { iniciar, tentarTranscricao, cancelar, obterPastaDestino, escolherPastaDestino, definirPastaDestino, abrirPastaVideo };
}

module.exports = { validarUrlInstagram, executarComando, criarProcessadorVideos, escolherPastaWindows };
