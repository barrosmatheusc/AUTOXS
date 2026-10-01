require('dotenv').config();

const OpenAI = require('openai');

async function testar() {
  const chave = process.env.OPENAI_API_KEY;

  if (!chave) {
    console.log('❌ OPENAI_API_KEY não encontrada no .env');
    return;
  }

  console.log('✅ Chave encontrada.');
  console.log('🤖 Fazendo uma chamada mínima à OpenAI...');
  console.log('');

  const openai = new OpenAI({
    apiKey: chave
  });

  try {
    const resposta = await openai.responses.create({
      model: 'gpt-5.6-luna',
      reasoning: {
        effort: 'none'
      },
      input:
        'Responda somente com a palavra OK.'
    });

    console.log('✅ API FUNCIONOU!');
    console.log('');
    console.log('Resposta da IA:');
    console.log(resposta.output_text);

    if (resposta.usage) {
      console.log('');
      console.log('Uso desta chamada:');

      console.log(
        'Tokens de entrada:',
        resposta.usage.input_tokens
      );

      console.log(
        'Tokens de saída:',
        resposta.usage.output_tokens
      );

      console.log(
        'Tokens totais:',
        resposta.usage.total_tokens
      );
    }

  } catch (erro) {
    console.log('❌ A chamada não funcionou.');
    console.log('');

    console.log(
      'Status:',
      erro.status || 'não informado'
    );

    console.log(
      'Código:',
      erro.code || 'não informado'
    );

    console.log('');
    console.log('Mensagem:');
    console.log(erro.message);

    console.log('');

    if (erro.status === 401) {
      console.log(
        '➡️ A chave não foi aceita pela API.'
      );
    }

    if (
      erro.status === 429 ||
      erro.code === 'insufficient_quota'
    ) {
      console.log(
        '➡️ A chave parece estar funcionando, mas sua conta provavelmente está sem saldo/quota de API.'
      );
    }
  }
}

testar();