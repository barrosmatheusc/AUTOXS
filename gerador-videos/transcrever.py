"""Transcrição local invocada pelo Gerador de Vídeos do AutoXS."""
import json
import sys


def main():
    if len(sys.argv) != 3:
        raise SystemExit("Uso: transcrever.py AUDIO MODELO")

    from faster_whisper import WhisperModel

    audio, modelo = sys.argv[1:]
    reconhecedor = WhisperModel(modelo, device="cpu", compute_type="int8")
    segmentos, info = reconhecedor.transcribe(audio, beam_size=5, vad_filter=True)
    texto = " ".join(segmento.text.strip() for segmento in segmentos if segmento.text.strip()).strip()
    resultado = json.dumps({"texto": texto, "idioma": info.language}, ensure_ascii=False)
    sys.stdout.buffer.write((resultado + "\n").encode("utf-8"))


if __name__ == "__main__":
    main()
