# Download e Transcrição — dependências locais

A ferramenta usa a própria instalação do AutoXS. O JARVIS não precisa estar aberto.

1. Instale Python e crie um ambiente isolado dentro do Gerador:

   ```powershell
   python -m venv gerador-videos\.venv
   gerador-videos\.venv\Scripts\python.exe -m pip install -r gerador-videos\requirements.txt
   ```

2. `imageio-ffmpeg` fornece o executável FFmpeg dentro desse ambiente isolado. A leitura das faixas usa PyAV, incluído pelo Faster-Whisper. Não é necessário instalar FFmpeg no sistema.

3. Confira no terminal usado para iniciar o AutoXS:

   ```powershell
   gerador-videos\.venv\Scripts\python.exe -m yt_dlp --version
   gerador-videos\.venv\Scripts\python.exe -c "import faster_whisper; print('Faster-Whisper disponível')"
   gerador-videos\.venv\Scripts\python.exe -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"
   ```

O primeiro uso de Faster-Whisper pode baixar o modelo `small` para o cache local do usuário. É possível usar um modelo já instalado ou outro tamanho definindo `AUTOXS_WHISPER_MODEL`. O processamento usa CPU e `int8` por padrão. Para instalações em caminhos diferentes, cada computador precisa dessas dependências.

O AutoXS usa automaticamente o Python de `gerador-videos\.venv`. `AUTOXS_PYTHON`, `AUTOXS_YTDLP`, `AUTOXS_FFMPEG` e `AUTOXS_FFPROBE` permitem informar instalações alternativas. Por padrão, yt-dlp é chamado por `python -m yt_dlp`, FFmpeg vem de `imageio-ffmpeg` e a inspeção do vídeo usa PyAV.

Os arquivos de trabalho ficam em `dados/originais`, transcrições em `dados/transcricoes` e arquivos temporários em `dados/temporarios`. O vídeo para o usuário é salvo na pasta Downloads do Windows ou na pasta escolhida na interface, com nome `Instagram_ID.mp4`. A pasta `dados` não é versionada. O AutoXS não lê cookies nem senhas do Instagram; apenas publicações públicas acessíveis podem funcionar.

Se a transcrição falhar, o vídeo validado permanece salvo e o botão **Tentar transcrição novamente** não repete o download. Fechar a janela durante o processamento cancela a operação. A edição com templates foi desativada; ela será feita no Canva.
