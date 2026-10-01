@echo off
setlocal
title AutoXS - Atualizador
pushd "%~dp0"
if errorlevel 1 goto erroPasta

echo ========================================
echo           AUTOXS - ATUALIZADOR
echo ========================================
echo.
echo Verificando Git...
where.exe git.exe >nul 2>&1
if errorlevel 1 goto erroGit
git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 goto erroRepositorio
rem O BAT deve ficar na raiz da propria instalacao Git.
for /f "delims=" %%L in ('git rev-parse --show-prefix 2^>nul') do goto erroRepositorio

rem Qualquer arquivo local nao ignorado impede a atualizacao segura.
git status --porcelain --untracked-files=normal >nul 2>&1
if errorlevel 1 goto erroRepositorio
for /f "delims=" %%L in ('git status --porcelain --untracked-files=normal 2^>nul') do goto erroAlteracoes

git remote get-url origin >nul 2>&1
if errorlevel 1 goto erroRemoto
git symbolic-ref --quiet --short HEAD | findstr /x /c:"main" >nul
if errorlevel 1 goto erroBranch

echo OK
echo.
echo Verificando atualizacoes...
git fetch origin main
if errorlevel 1 goto erroBusca
git show-ref --verify --quiet refs/remotes/origin/main
if errorlevel 1 goto erroUpstream
git merge-base --is-ancestor HEAD origin/main
if errorlevel 1 goto erroHistorico
git diff --quiet HEAD origin/main
if not errorlevel 1 goto atualizado

git diff --quiet HEAD origin/main -- package.json package-lock.json
if errorlevel 1 (set "AUTOXS_DEPENDENCIAS=1") else (set "AUTOXS_DEPENDENCIAS=0")
echo Atualizacao encontrada. Baixando...
git merge --ff-only origin/main
if errorlevel 1 goto erroMerge
echo Arquivos atualizados com sucesso.
if "%AUTOXS_DEPENDENCIAS%"=="1" (
  echo Atualizando dependencias...
  where.exe npm.cmd >nul 2>&1
  if errorlevel 1 goto erroNpm
  call npm.cmd ci --ignore-scripts
  if errorlevel 1 goto erroDependencias
)
echo.
echo AUTOXS ATUALIZADO!
goto fim

:atualizado
echo AUTOXS JA ESTA ATUALIZADO.
goto fim

:erroPasta
echo ERRO AO ATUALIZAR: nao foi possivel abrir a pasta do AutoXS.
goto fimErro
:erroGit
echo ERRO AO ATUALIZAR: instale o Git neste computador.
goto fimErro
:erroRepositorio
echo ERRO AO ATUALIZAR: o BAT deve estar na raiz de uma instalacao Git valida.
goto fimErro
:erroAlteracoes
echo ERRO AO ATUALIZAR: alteracoes locais detectadas.
echo Seus arquivos foram preservados. Peca ajuda antes de atualizar.
goto fimErro
:erroRemoto
echo ERRO AO ATUALIZAR: o GitHub ainda nao foi conectado como origin.
goto fimErro
:erroBranch
echo ERRO AO ATUALIZAR: esta instalacao precisa estar na branch main.
goto fimErro
:erroUpstream
echo ERRO AO ATUALIZAR: origin/main ainda nao esta disponivel neste PC.
goto fimErro
:erroBusca
echo ERRO AO ATUALIZAR: nao foi possivel consultar o GitHub.
goto fimErro
:erroHistorico
echo ERRO AO ATUALIZAR: historico diferente da versao publicada.
echo Nenhum arquivo local foi substituido.
goto fimErro
:erroMerge
echo ERRO AO ATUALIZAR: nao foi possivel aplicar a atualizacao com seguranca.
goto fimErro
:erroNpm
echo ERRO AO ATUALIZAR: arquivos atualizados, mas o npm nao foi encontrado.
echo Instale o Node.js/npm e conclua a instalacao das dependencias.
goto fimErro
:erroDependencias
echo ERRO AO ATUALIZAR: arquivos atualizados, mas as dependencias falharam.
echo Peca ajuda antes de iniciar o AutoXS.
goto fimErro

:fim
echo.
echo Pressione qualquer tecla para fechar.
pause >nul
popd
exit /b 0
:fimErro
echo.
echo Pressione qualquer tecla para fechar.
pause >nul
popd
exit /b 1
