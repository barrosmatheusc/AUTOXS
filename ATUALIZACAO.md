# Atualizar o AutoXS

## Computador principal

Edite e teste o AutoXS neste computador. Quando uma versao estiver aprovada, confira os arquivos antes de fazer commit e enviar a branch `main` ao GitHub.

Nunca envie `.env`, `sessao.json`, perfis do navegador, cookies, logs ou a pasta `node_modules`.

## Outros computadores

Cada instalacao pode ficar em uma pasta diferente. O BAT usa a pasta onde ele proprio esta, inclusive quando o caminho contem espacos. Cada pasta deve ser uma copia Git do mesmo projeto, na branch `main`, com `origin` apontando para o repositorio do AutoXS. O atualizador busca o mesmo codigo publicado em `origin/main` para todas elas.

Feche o AutoXS e de dois cliques em `ATUALIZAR AUTOXS.bat` dentro da instalacao que deseja atualizar. O BAT entra na propria pasta (`%~dp0`), mesmo se o caminho tiver espacos. Ele verifica Git, a raiz do repositorio, a branch `main`, o remote `origin` e se ha alteracoes locais nao ignoradas. Depois consulta `origin/main`.

Se as versoes forem iguais, o BAT informa que o AutoXS ja esta atualizado. Se a instalacao estiver atras, ele mostra quantos commits faltam e aplica somente uma atualizacao por fast-forward. Se houver commits locais a frente ou historicos divergentes, ele para e pede ajuda, sem descartar arquivos. Os erros do Git e do npm aparecem no CMD junto com uma explicacao simples da etapa que falhou.

O BAT compara o commit anterior com o novo somente para `package.json` e `package-lock.json`. Se nenhum deles mudou, nao executa npm. Se algum mudou, executa `npm ci --ignore-scripts`; scripts automaticos de pacotes ficam desativados. Ele nao inicia o AutoXS.

E preciso ter Git e Node.js/npm instalados. Uma pasta copiada sem o historico `.git` precisa ser preparada como copia Git antes de usar o BAT. Na primeira instalacao, as dependencias precisam ser instaladas e os dados locais precisam ser configurados separadamente.

## O que permanece em cada computador

O arquivo `.env` guarda acesso ao site e eventuais chaves de API. Use `.env.example` apenas como lista dos nomes das configuracoes e preencha um `.env` proprio em cada computador. `sessao.json`, perfis do navegador, cookies, logs, experimentos, arquivos temporarios e `node_modules` tambem permanecem locais.

Se aparecer **alteracoes locais detectadas**, o atualizador para sem substituir os arquivos. Isso inclui uma copia editada do proprio BAT dentro de um repositorio Git: para testar uma nova versao pelo fluxo normal, ela precisa primeiro fazer parte da versao publicada e limpa da instalacao. Peca ajuda para revisar as alteracoes antes de tentar novamente. O BAT nao usa `reset --hard` nem `git clean`, nao apaga arquivos ignorados e nao descarta modificacoes.

O repositorio privado ja existe e a primeira versao foi publicada. Cada outro computador ainda precisa ter sua instalacao conectada ao repositorio antes de usar o atualizador.
