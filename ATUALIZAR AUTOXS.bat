@echo off
setlocal EnableExtensions DisableDelayedExpansion
title AutoXS - Atualizador
set "AUTOXS_ENTROU=0"
pushd "%~dp0"
if errorlevel 1 goto erroPasta
set "AUTOXS_ENTROU=1"

echo ========================================
echo           AUTOXS - ATUALIZADOR
echo ========================================
echo.
echo [1/6] Verificando instalacao...
where.exe git.exe >nul 2>&1
if errorlevel 1 goto erroGit
set "AUTOXS_WORKTREE="
for /f "delims=" %%R in ('git rev-parse --is-inside-work-tree') do set "AUTOXS_WORKTREE=%%R"
if not "%AUTOXS_WORKTREE%"=="true" goto erroRepositorio
rem O BAT precisa estar na raiz Git da propria instalacao.
for /f "delims=" %%R in ('git rev-parse --show-prefix') do goto erroRepositorio
set "AUTOXS_BRANCH="
for /f "delims=" %%B in ('git symbolic-ref --quiet --short HEAD') do set "AUTOXS_BRANCH=%%B"
if not "%AUTOXS_BRANCH%"=="main" goto erroBranch
git remote get-url origin >nul
if errorlevel 1 goto erroRemoto
echo [OK] Repositorio, branch main e origin encontrados.
echo.

echo [2/6] Verificando arquivos locais...
git status --porcelain=v1 --untracked-files=normal >nul
if errorlevel 1 goto erroStatus
for /f "delims=" %%S in ('git status --porcelain=v1 --untracked-files=normal') do goto erroAlteracoes
set "AUTOXS_ANTES="
for /f "delims=" %%H in ('git rev-parse HEAD') do set "AUTOXS_ANTES=%%H"
if not defined AUTOXS_ANTES goto erroStatus
echo [OK] Nenhuma alteracao local.
echo.

echo [3/6] Procurando atualizacoes...
git fetch origin
if errorlevel 1 goto erroBusca
git show-ref --verify --quiet refs/remotes/origin/main
if errorlevel 1 goto erroUpstream
set "AUTOXS_AHEAD="
set "AUTOXS_BEHIND="
for /f "tokens=1,2" %%A in ('git rev-list --left-right --count HEAD...origin/main') do (
  set "AUTOXS_AHEAD=%%A"
  set "AUTOXS_BEHIND=%%B"
)
if not defined AUTOXS_AHEAD goto erroComparacao
if not defined AUTOXS_BEHIND goto erroComparacao
if not "%AUTOXS_AHEAD%"=="0" goto historicoLocal
if "%AUTOXS_BEHIND%"=="0" goto atualizado
echo [OK] Nova versao encontrada: %AUTOXS_BEHIND% commit(s).
echo.

echo [4/6] Atualizando AutoXS...
git merge --ff-only origin/main
if errorlevel 1 goto erroMerge
echo [OK] Arquivos atualizados.
echo.

echo [5/6] Verificando dependencias...
git diff --quiet --exit-code "%AUTOXS_ANTES%" HEAD -- package.json package-lock.json
if errorlevel 2 goto erroComparacaoDependencias
if errorlevel 1 goto instalarDependencias
echo [OK] Dependencias nao mudaram. npm nao foi executado.
goto finalizar

:instalarDependencias
echo package.json ou package-lock.json mudou. Instalando dependencias sem scripts...
where.exe npm.cmd >nul 2>&1
if errorlevel 1 goto erroNpm
call npm.cmd ci --ignore-scripts
if errorlevel 1 goto erroDependencias
echo [OK] Dependencias atualizadas.
goto finalizar

:atualizado
echo [OK] Nenhum commit novo em origin/main.
echo.
echo [4/6] Nenhuma atualizacao necessaria.
echo [5/6] Dependencias nao mudaram. npm nao foi executado.
echo [6/6] Finalizando...
echo.
echo ========================================
echo  AutoXS ja esta atualizado
echo ========================================
goto fimSucesso

:historicoLocal
if not "%AUTOXS_BEHIND%"=="0" goto erroDivergencia
goto erroAdiantado

:finalizar
echo.
echo [6/6] Finalizando...
echo ========================================
echo  AutoXS atualizado com sucesso!
echo ========================================
goto fimSucesso

:erroPasta
echo [ERRO] Atualizacao cancelada.
echo Motivo: nao foi possivel abrir a pasta deste BAT.
goto fimErro
:erroGit
echo [ERRO] Atualizacao cancelada.
echo Motivo: Git nao encontrado. Instale o Git neste computador.
goto fimErro
:erroRepositorio
echo [ERRO] Atualizacao cancelada.
echo Motivo: este BAT deve estar na raiz de uma instalacao Git valida.
goto fimErro
:erroBranch
echo [ERRO] Atualizacao cancelada.
echo Motivo: esta instalacao precisa estar na branch main.
goto fimErro
:erroRemoto
echo [ERRO] Atualizacao cancelada.
echo Motivo: o remote origin nao esta configurado.
goto fimErro
:erroStatus
echo [ERRO] Atualizacao cancelada.
echo Motivo: Git nao conseguiu verificar os arquivos locais.
goto fimErro
:erroAlteracoes
echo [ERRO] Atualizacao cancelada.
echo Motivo: existem alteracoes locais em arquivos nao ignorados.
echo Seus arquivos foram preservados. Peca ajuda antes de atualizar.
goto fimErro
:erroBusca
echo [ERRO] Atualizacao cancelada.
echo Motivo: nao foi possivel consultar origin. Veja o erro do Git acima.
goto fimErro
:erroUpstream
echo [ERRO] Atualizacao cancelada.
echo Motivo: origin/main nao existe nesta instalacao apos a busca.
goto fimErro
:erroComparacao
echo [ERRO] Atualizacao cancelada.
echo Motivo: Git nao conseguiu comparar main com origin/main.
goto fimErro
:erroAdiantado
echo [ERRO] Atualizacao cancelada.
echo Motivo: esta main tem %AUTOXS_AHEAD% commit(s) que nao estao em origin/main.
echo Nenhum arquivo foi substituido. Peca ajuda antes de atualizar.
goto fimErro
:erroDivergencia
echo [ERRO] Atualizacao cancelada.
echo Motivo: os historicos divergiram: %AUTOXS_AHEAD% commit(s) locais e %AUTOXS_BEHIND% remoto(s).
echo Nenhum arquivo foi substituido. Peca ajuda antes de atualizar.
goto fimErro
:erroMerge
echo [ERRO] Atualizacao cancelada.
echo Motivo: Git nao conseguiu aplicar o fast-forward. Veja o erro acima.
goto fimErro
:erroComparacaoDependencias
echo [ERRO] O codigo foi atualizado, mas nao foi possivel comparar as dependencias.
echo Peca ajuda antes de iniciar o AutoXS.
goto fimErro
:erroNpm
echo [ERRO] O codigo foi atualizado, mas npm nao foi encontrado.
echo Instale Node.js/npm e conclua a instalacao das dependencias.
goto fimErro
:erroDependencias
echo [ERRO] O codigo foi atualizado, mas a instalacao das dependencias falhou.
echo Veja o erro do npm acima e peca ajuda antes de iniciar o AutoXS.
goto fimErro

:fimSucesso
echo.
echo Pressione qualquer tecla para fechar.
pause >nul
if "%AUTOXS_ENTROU%"=="1" popd
exit /b 0
:fimErro
echo.
echo Pressione qualquer tecla para fechar.
pause >nul
if "%AUTOXS_ENTROU%"=="1" popd
exit /b 1
