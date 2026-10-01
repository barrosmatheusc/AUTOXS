const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extrairTermoBusca } = require('../termo-busca');

test('extrai nomes compostos de pessoas sem incluir cargos ou verbos', () => {
  for (const [titulo, esperado] of [
    ['Bernie Ecclestone é detido em Portugal por porte de espingarda', 'Bernie Ecclestone'],
    ['Jão tieta Elton John no Rock in Rio', 'Elton John'],
    ['O ministro Alexandre de Moraes anuncia decisão', 'Alexandre de Moraes'],
    ['Em sabatina, Douglas Ruas busca se desvencilhar de Castro', 'Douglas Ruas'],
    ['Luiz Inácio Lula da Silva faz pronunciamento', 'Luiz Inácio Lula da Silva']
  ]) assert.equal(extrairTermoBusca(titulo), esperado);
});

test('aceita nomes isolados, siglas e palavras do assunto', () => {
  for (const [titulo, esperado] of [
    ['Lula mantém liderança em pesquisa', 'Lula'],
    ['Fachin se reúne com ministro da Justiça e Messias no STF', 'Fachin'],
    ['Análise: Banco do BRICS abre caminho para novas ações', 'BRICS'],
    ['Países que adotaram criptomoedas e recuaram em sua utilização', 'criptomoedas'],
    ['Chuvas fortes causam alagamentos', 'Chuvas'],
    ['Veja: chuvas fortes causam alagamentos', 'chuvas']
  ]) assert.equal(extrairTermoBusca(titulo), esperado);
});

test('não inventa termo quando o título está vazio ou só contém palavras genéricas', () => {
  for (const titulo of ['', undefined, '  ', '12345', 'Veja como foi']) assert.equal(extrairTermoBusca(titulo), '');
});
test('preserva siglas compostas como OAB-SP antes de palavras genéricas', () => {
  assert.equal(extrairTermoBusca('OAB-SP e entidades reivindicam transparência no STF e reforma do Judiciário'), 'OAB-SP');
});