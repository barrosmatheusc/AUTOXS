require('dotenv').config();

const chave = process.env.OPENAI_API_KEY;

if (!chave) {
  console.log('❌ OPENAI_API_KEY não encontrada no .env');
  process.exit();
}

console.log('✅ OPENAI_API_KEY encontrada no .env');

console.log(
  'Início da chave:',
  chave.slice(0, 7) + '...'
);

console.log(
  'Quantidade de caracteres:',
  chave.length
);

console.log('');
console.log('Nenhuma chamada à API foi feita.');
console.log('Nenhum crédito foi consumido.');