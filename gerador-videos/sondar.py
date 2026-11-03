"""Inspeciona um arquivo local usando PyAV/FFmpeg, sem acessar a rede."""
import json
import sys

import av


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Uso: sondar.py VIDEO")
    with av.open(sys.argv[1]) as arquivo:
        videos = [fluxo for fluxo in arquivo.streams if fluxo.type == "video"]
        if not videos:
            raise RuntimeError("Arquivo sem vídeo.")
        if next(arquivo.decode(videos[0]), None) is None:
            raise RuntimeError("Não foi possível decodificar o vídeo.")
        print(json.dumps({"streams": [{"codec_type": fluxo.type,
                                       "codec_name": fluxo.codec_context.name}
                                      for fluxo in arquivo.streams]}))


if __name__ == "__main__":
    main()
