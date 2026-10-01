require('dotenv').config();

async function testar() {

  const chave = process.env.GEMINI_API_KEY;

  if (!chave) {
    console.log('❌ GEMINI_API_KEY não encontrada no .env');
    return;
  }

  console.log('✅ Chave do Gemini encontrada.');
  console.log('🤖 Fazendo uma chamada mínima...');
  console.log('');

  try {

    const { GoogleGenAI } =
      await import('@google/genai');

    const ai = new GoogleGenAI({
      apiKey: chave
    });

    const resposta =
      await ai.interactions.create({
        model: 'gemini-3.7-flash',
        input: 'Responda somente com a palavra OK.'
      });

    console.log('✅ GEMINI FUNCIONOU!');
    console.log('');
    console.log('Resposta:');
    console.log(resposta.output_text);

  } catch (erro) {

    console.log('❌ Gemini não funcionou.');
    console.log('');

    console.log(
      'Mensagem:',
      erro.message
    );

    if (erro.status) {
      console.log(
        'Status:',
        erro.status
      );
    }
  }
}

testar();