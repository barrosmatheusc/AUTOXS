const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {fileURLToPath} = require('node:url');
const { validarUrlInstagram, criarProcessadorVideos, executarComando } = require('../gerador-videos-processamento');

test('pasta inicial configurada é usada e pode voltar para Downloads', async () => {
  const raiz = path.join(__dirname, '..', 'work');
  await fs.mkdir(raiz, { recursive:true });
  const pasta = await fs.mkdtemp(path.join(raiz, 'gv-config-'));
  const escolhida = path.join(pasta, 'Escolhida');
  const downloads = path.join(pasta, 'Downloads');
  await fs.mkdir(escolhida);
  await fs.mkdir(downloads);
  try {
    const processador = criarProcessadorVideos({
      pastaInicial:escolhida, resolverDownloads:async () => downloads
    });
    assert.equal(await processador.obterPastaDestino(), escolhida);
    assert.equal(await processador.definirPastaDestino(null), downloads);
    assert.equal(await processador.obterPastaDestino(), downloads);
    await assert.rejects(processador.definirPastaDestino(path.join(pasta, 'Ausente')),
      /não está disponível/);
  } finally { await fs.rm(pasta, { recursive:true, force:true }); }
});

const LINK = 'https://www.instagram.com/reel/ABC_123/';
const FRASE_ACENTUADA = 'João não autorizou a publicação. A investigação identificou relação entre os responsáveis e a universidade. ç ã õ á é í ó ú ê';

async function ambiente(configuracao = {}) {
  const raiz = path.join(__dirname, '..', 'work');
  await fs.mkdir(raiz, { recursive: true });
  const pasta = await fs.mkdtemp(path.join(raiz, 'gv-test-'));
  const downloads = path.join(pasta,'Downloads');
  await fs.mkdir(downloads);
  const chamadas = [];
  const mensagens = [];
  const executar = async (binario, args, { signal } = {}) => {
    chamadas.push({ binario, args });
    if (signal?.aborted) throw Object.assign(new Error('Cancelado'), { name: 'AbortError' });
    if ((configuracao.interromper && args.includes('--dump-single-json')) ||
        (configuracao.interromperDownload && args.includes('--print')))
      return new Promise((resolve, reject) => signal.addEventListener('abort',
        () => reject(Object.assign(new Error('Cancelado'), { name: 'AbortError' })), { once: true }));
    if (configuracao.inacessivel && args.includes('--dump-single-json')) throw new Error('Publicação inacessível.');
    if (args.includes('--dump-single-json'))
      return { stdout: JSON.stringify({ vcodec: configuracao.imagem ? 'none' : 'h264' }) };
    if (args.includes('--print')) {
      const arquivo = args[args.indexOf('-o') + 1].replace('%(ext)s', 'mp4');
      await fs.writeFile(arquivo, Buffer.alloc(2048, 7));
      return { stdout: arquivo };
    }
    if (binario === 'ffprobe') return { stdout: JSON.stringify({ streams: configuracao.semAudio
      ? [{ codec_type: 'video',codec_name:'h264' }]
      : [{ codec_type: 'video',codec_name:'h264' }, { codec_type: 'audio',codec_name:'aac' }] }) };
    if (binario === 'ffmpeg') { await fs.writeFile(args.at(-1), 'audio'); return { stdout: '' }; }
    if (binario === 'python') {
      if (configuracao.falhaTranscricao && !configuracao.corrigido) throw new Error('Modelo indisponível.');
      return { stdout: JSON.stringify({ texto: configuracao.transcricao || 'Fala em português.', idioma: 'pt' }) };
    }
    throw new Error(`Comando inesperado: ${binario}`);
  };
  const processador = criarProcessadorVideos({ pastaDados: pasta, executar,
    binarios: { ytdlp: 'yt-dlp', ffprobe: 'ffprobe', ffmpeg: 'ffmpeg', python: 'python' },
    resolverDownloads:async()=>downloads,
    selecionarDiretorio:async()=>configuracao.pastaEscolhida || null,
    abrirDiretorio:async destino=>{configuracao.pastaAberta=destino;return {pasta:destino};},
    informar: mensagem => mensagens.push(mensagem) });
  return { pasta, downloads, chamadas, mensagens, processador, encerrar: async () => {
    if (path.dirname(pasta) === raiz) await fs.rm(pasta, { recursive: true, force: true });
  } };
}

test('aceita apenas URL pública HTTPS de post/reel/tv com identificador seguro', () => {
  assert.deepEqual(validarUrlInstagram('https://www.instagram.com/reel/ABC_123/?utm_source=x'),
    { url: LINK, id: 'ABC_123' });
  for (const url of ['x', 'http://www.instagram.com/reel/ABC_123/',
    'https://evilinstagram.com/reel/ABC_123/', 'https://www.instagram.com/accounts/login/',
    'https://www.instagram.com/reel/../../outro'])
    assert.throws(() => validarUrlInstagram(url));
});

test('download, validação, áudio e transcrição em português produzem arquivos separados', async () => {
  const teste = await ambiente();
  try {
    const resultado = await teste.processador.iniciar(LINK);
    assert.match(resultado.url, /Instagram_ABC_123\.mp4$/);
    assert.equal(resultado.caminho,path.join(teste.downloads,'Instagram_ABC_123.mp4'));
    assert.equal((await fs.stat(resultado.caminho)).size,2048);
    assert.equal(resultado.transcricao, 'Fala em português.');
    assert.equal(resultado.idioma, 'pt');
    const transcricoes=await fs.readdir(path.join(teste.pasta, 'transcricoes'));
    assert.equal(transcricoes.length,1);
    assert.equal(await fs.readFile(path.join(teste.pasta, 'transcricoes', transcricoes[0]), 'utf8'), resultado.transcricao);
    assert.ok(teste.chamadas.some(chamada => chamada.binario === 'ffmpeg'));
    assert.equal(teste.chamadas.some(chamada => chamada.args.includes('-movflags')),false,
      'MP4 H.264/AAC compatível não deve ser recodificado.');
    assert.ok(teste.mensagens.some(mensagem => mensagem.includes('Download concluído')));
  } finally { await teste.encerrar(); }
});

test('saída do Python permanece UTF-8 mesmo sob codificação legada do Windows', async () => {
  const raiz = path.join(__dirname, '..', 'work');
  await fs.mkdir(raiz, { recursive: true });
  const pasta = await fs.mkdtemp(path.join(raiz, 'gv-python-'));
  try {
    const modulo = 'class WhisperModel:\n    def __init__(self, *args, **kwargs):\n        pass\n    def transcribe(self, *args, **kwargs):\n        from types import SimpleNamespace\n        return [SimpleNamespace(text=' + JSON.stringify(FRASE_ACENTUADA) + ')], SimpleNamespace(language="pt")\n';
    await fs.writeFile(path.join(pasta, 'faster_whisper.py'), modulo, 'utf8');
    const processo = spawnSync(process.env.AUTOXS_PYTHON || 'python',
      [path.join(__dirname, '..', 'gerador-videos', 'transcrever.py'), 'audio-ficticio.wav', 'small'],
      { env: { ...process.env, PYTHONPATH: pasta, PYTHONIOENCODING: 'cp1252' }, encoding: null });
    assert.equal(processo.status, 0, processo.stderr.toString('utf8'));
    const saida = processo.stdout.toString('utf8');
    assert.equal(JSON.parse(saida).texto, FRASE_ACENTUADA);
    assert.ok(!saida.includes('\uFFFD'));
  } finally { await fs.rm(pasta, { recursive: true, force: true }); }
});

test('Node preserva caracteres UTF-8 divididos entre blocos de stdout e stderr', async () => {
  const bytes = Buffer.from(FRASE_ACENTUADA, 'utf8').toString('base64');
  const codigo = `const dados=Buffer.from('${bytes}','base64');process.stdout.write(dados.subarray(0,3));process.stderr.write(dados.subarray(0,3));setTimeout(()=>{process.stdout.write(dados.subarray(3));process.stderr.write(dados.subarray(3));},30);`;
  const resposta = await executarComando(process.execPath, ['-e', codigo]);
  assert.equal(resposta.stdout, FRASE_ACENTUADA);
  assert.equal(resposta.stderr, FRASE_ACENTUADA);
});

test('transcrição acentuada atravessa JSON e é gravada em TXT UTF-8', async () => {
  const teste = await ambiente({ transcricao: FRASE_ACENTUADA });
  try {
    const resultado = await teste.processador.iniciar(LINK);
    assert.equal(resultado.transcricao, FRASE_ACENTUADA);
    const transcricoes = await fs.readdir(path.join(teste.pasta, 'transcricoes'));
    const bytes = await fs.readFile(path.join(teste.pasta, 'transcricoes', transcricoes[0]));
    assert.deepEqual(bytes, Buffer.from(FRASE_ACENTUADA, 'utf8'));
  } finally { await teste.encerrar(); }
});

test('não baixa novamente link com vídeo válido já armazenado', async () => {
  const teste = await ambiente();
  try {
    await teste.processador.iniciar(LINK);
    await teste.processador.iniciar(LINK);
    assert.equal(teste.chamadas.filter(chamada => chamada.args.includes('--print')).length, 1);
    assert.deepEqual((await fs.readdir(teste.downloads)).sort(),
      ['Instagram_ABC_123 (2).mp4','Instagram_ABC_123.mp4']);
  } finally { await teste.encerrar(); }
});

test('pasta escolhida recebe vídeo e botão abre somente a pasta do arquivo salvo', async () => {
  const configuracao={};
  const teste=await ambiente(configuracao);
  try {
    configuracao.pastaEscolhida=path.join(teste.pasta,'Escolhida');
    await fs.mkdir(configuracao.pastaEscolhida);
    assert.deepEqual(await teste.processador.escolherPastaDestino(),
      {pasta:configuracao.pastaEscolhida,cancelado:false});
    const resultado=await teste.processador.iniciar(LINK);
    assert.equal(resultado.pasta,configuracao.pastaEscolhida);
    assert.equal((await fs.stat(resultado.caminho)).size,2048);
    await teste.processador.abrirPastaVideo();
    assert.equal(configuracao.pastaAberta,configuracao.pastaEscolhida);
    configuracao.pastaEscolhida=null;
    assert.deepEqual(await teste.processador.escolherPastaDestino(),
      {pasta:configuracao.pastaAberta,cancelado:true});
  } finally { await teste.encerrar(); }
});

test('vídeo WebM é convertido em MP4 reproduzível sem templates', async () => {
  const raiz=path.join(__dirname,'..');
  const python=path.join(raiz,'gerador-videos','.venv','Scripts','python.exe');
  const ffmpeg=spawnSync(python,['-c','import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'],{encoding:'utf8'}).stdout.trim();
  const pasta=await fs.mkdtemp(path.join(raiz,'work','gv-webm-'));
  try {
    const fonte=path.join(pasta,'fonte.webm');
    const criado=spawnSync(ffmpeg,['-nostdin','-v','error','-f','lavfi','-i','color=c=blue:s=320x180:r=15:d=1',
      '-c:v','libvpx','-b:v','200k','-y',fonte],{encoding:'utf8'});
    assert.equal(criado.status,0,criado.stderr);
    const downloads=path.join(pasta,'Downloads');await fs.mkdir(downloads);
    const executar=async(binario,argumentos,opcoes)=>{
      if(binario==='yt-dlp-simulado') {
        if(argumentos.includes('--dump-single-json')) return {stdout:JSON.stringify({vcodec:'vp8'})};
        const destino=argumentos[argumentos.indexOf('-o')+1].replace('%(ext)s','webm');
        await fs.copyFile(fonte,destino);
        return {stdout:destino};
      }
      return executarComando(binario,argumentos,opcoes);
    };
    const processador=criarProcessadorVideos({pastaDados:path.join(pasta,'dados'),executar,
      binarios:{ytdlp:'yt-dlp-simulado',ffmpeg,python},resolverDownloads:async()=>downloads});
    const resultado=await processador.iniciar(LINK);
    assert.equal(path.extname(resultado.caminho),'.mp4');
    const inspecao=spawnSync(python,[path.join(raiz,'gerador-videos','sondar-exportacao.py'),resultado.caminho],{encoding:'utf8'});
    assert.equal(inspecao.status,0,inspecao.stderr);
    const dados=JSON.parse(inspecao.stdout);
    assert.equal(dados.codec_video,'h264');
    assert.ok(dados.duracao>0.8);
  } finally {
    if (path.dirname(path.resolve(pasta)) === path.resolve(raiz,'work'))
      await fs.rm(pasta,{recursive:true,force:true});
  }
});

test('publicação inacessível ou sem vídeo falha antes de criar original', async () => {
  for (const tipo of ['inacessivel', 'imagem']) {
    const teste = await ambiente({ [tipo]: true });
    try {
      await assert.rejects(teste.processador.iniciar(LINK));
      assert.equal(teste.chamadas.some(chamada => chamada.args.includes('--print')), false);
    } finally { await teste.encerrar(); }
  }
});

test('vídeo sem áudio continua disponível sem inventar transcrição', async () => {
  const teste = await ambiente({ semAudio: true });
  try {
    const resultado = await teste.processador.iniciar(LINK);
    assert.equal(resultado.transcricao, '');
    assert.equal(teste.chamadas.some(chamada => chamada.binario === 'python'), false);
  } finally { await teste.encerrar(); }
});

test('falha na transcrição preserva vídeo e permite repetir sem download', async () => {
  const config = { falhaTranscricao: true, corrigido: false };
  const teste = await ambiente(config);
  try {
    const resultado = await teste.processador.iniciar(LINK);
    assert.match(resultado.erroTranscricao, /Modelo indisponível/);
    assert.ok((await fs.stat(fileURLToPath(resultado.url))).size > 0);
    config.corrigido = true;
    const repetido = await teste.processador.tentarTranscricao(LINK);
    assert.equal(repetido.transcricao, 'Fala em português.');
    assert.equal(teste.chamadas.filter(chamada => chamada.args.includes('--print')).length, 1);
  } finally { await teste.encerrar(); }
});

test('cancelamento interrompe trabalho e não inicia download posterior', async () => {
  const teste = await ambiente({ interromper: true });
  try {
    const pendente = teste.processador.iniciar(LINK);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(teste.processador.cancelar(), true);
    await assert.rejects(pendente, { name: 'AbortError' });
    assert.equal(teste.chamadas.some(chamada => chamada.args.includes('--print')), false);
  } finally { await teste.encerrar(); }
});

test('download interrompido não registra arquivo original como válido', async () => {
  const teste = await ambiente({ interromperDownload: true });
  try {
    const pendente = teste.processador.iniciar(LINK);
    for (let tentativa=0;tentativa<200 && !teste.chamadas.some(chamada => chamada.args.includes('--print'));tentativa++)
      await new Promise(resolve => setTimeout(resolve, 5));
    assert.ok(teste.chamadas.some(chamada => chamada.args.includes('--print')));
    assert.equal(teste.processador.cancelar(), true);
    await assert.rejects(pendente, { name: 'AbortError' });
    assert.deepEqual(await fs.readdir(path.join(teste.pasta, 'originais')), []);
    assert.deepEqual(await fs.readdir(path.join(teste.pasta, 'temporarios')), []);
  } finally { await teste.encerrar(); }
});

test('cancelamento encerra um subprocesso local em execução', async () => {
  const controlador=new AbortController();
  const inicio=Date.now();
  const pendente=executarComando(process.execPath,['-e','setTimeout(() => {}, 10000)'],
    {signal:controlador.signal});
  setTimeout(() => controlador.abort(),100);
  await assert.rejects(pendente,{name:'AbortError'});
  assert.ok(Date.now()-inicio<5000,'Subprocesso não encerrou prontamente');
});
