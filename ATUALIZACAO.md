# Atualizar o AutoXS

## Computador principal

Edite e teste o AutoXS aqui. Quando uma versao estiver aprovada, confira os arquivos antes de fazer commit e enviar ao GitHub. Essa publicacao ainda nao foi configurada.

Nunca envie `.env`, `sessao.json`, perfis do navegador, cookies, logs ou a pasta `node_modules`.

## Outros computadores

Depois que o projeto estiver conectado ao GitHub e cada computador tiver uma copia Git configurada, feche o AutoXS e de dois cliques em `ATUALIZAR AUTOXS.bat`. O programa consulta a versao publicada, baixa apenas as mudancas e atualiza as dependencias se `package.json` ou `package-lock.json` tiverem mudado. Na instalacao das dependencias, scripts automaticos de pacotes ficam desativados. Ele nao inicia o AutoXS.

E preciso ter Git e Node.js/npm instalados. Na primeira instalacao, as dependencias precisam ser instaladas e os dados locais precisam ser configurados separadamente.

## O que permanece em cada computador

O arquivo `.env` guarda acesso ao site e eventuais chaves de API. Use `.env.example` apenas como lista dos nomes das configuracoes e preencha um `.env` proprio em cada computador. `sessao.json`, perfis do navegador, cookies, logs, experimentos, arquivos temporarios e `node_modules` tambem permanecem locais.

Se aparecer **alteracoes locais detectadas**, o atualizador para sem substituir os arquivos. Peça ajuda para revisar essas alteracoes antes de tentar novamente. Ele nao apaga arquivos nem descarta modificacoes.

Esta etapa prepara o projeto local. Ainda falta criar/conectar o repositorio privado no GitHub, publicar a primeira versao aprovada e configurar a copia Git dos outros computadores.
