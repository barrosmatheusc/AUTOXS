const { test } = require('node:test');
const assert = require('node:assert/strict');
const { identificarMateria } = require('../identificar-materia');
const { validarCampos } = require('../preencher-materia');

test('chapéu fica em maiúsculas na identificação e nos dados enviados ao formulário', () => {
  const { campos } = identificarMateria('Título: Matéria de exemplo\nChapéu: *finanças públicas*\nTexto: Conteúdo da matéria.');
  assert.equal(campos.chapeu, 'FINANÇAS PÚBLICAS');
  // Simula o usuário escrevendo novamente em minúsculas na revisão.
  const paraSite = validarCampos({ ...campos, chapeu: '  educação e ação social  ' });
  assert.equal(paraSite.chapeu, 'EDUCAÇÃO E AÇÃO SOCIAL');
  assert.equal(paraSite.titulo, campos.titulo);
  assert.equal(validarCampos({ ...campos, chapeu: '' }).chapeu, '');
});
