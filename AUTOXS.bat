@echo off
setlocal
title AutoXS
pushd "%~dp0"
if errorlevel 1 goto pastaIndisponivel

where.exe node.exe >nul 2>&1
if errorlevel 1 goto faltaNode
if not exist "autoxs.js" goto faltaArquivo
if not exist "node_modules\playwright\package.json" goto faltamDependencias
if not exist "node_modules\dotenv\package.json" goto faltamDependencias

echo Abrindo o AutoXS...
echo Mantenha esta janela aberta enquanto usa a automacao.
echo O painel abrira no navegador.
echo.
node.exe "autoxs.js"
set "autoxsResultado=%errorlevel%"
if not "%autoxsResultado%"=="0" (
  echo.
  echo O AutoXS foi encerrado com um erro. Confira a mensagem acima.
  pause
)
popd
exit /b %autoxsResultado%

:faltaNode
echo O Node.js nao foi encontrado neste computador.
echo Instale o Node.js e abra este arquivo novamente.
goto falha

:faltaArquivo
echo O arquivo autoxs.js nao foi encontrado.
echo Mantenha este iniciador na mesma pasta do autoxs.js.
goto falha

:faltamDependencias
echo Os componentes do AutoXS nao foram encontrados na pasta node_modules.
echo Conclua a instalacao do projeto antes de iniciar.
goto falha

:falha
pause
popd
exit /b 1

:pastaIndisponivel
echo Nao foi possivel abrir a pasta do AutoXS.
pause
exit /b 1
