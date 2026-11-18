#!/usr/bin/env python3
"""Lanzador de apisrc para proyectos Python.

Para ponerlo en un Makefile, en taskipy o en un hook de pre-commit sin
tener que saber si hay bun instalado.

Cero lógica de dominio: resuelve el lanzador y le pasa los argumentos.
Si este fichero empieza a parsear rutas, está mal — el motor es el
binario, y hay uno solo a propósito (ver p00021).

    python bin/wrappers/apisrc.py generate --project-root .
"""
import os
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
LAUNCHER = REPO_ROOT / "bin" / ("apisrc.ps1" if os.name == "nt" else "apisrc")


def main() -> int:
    if os.name == "nt":
        command = ["powershell", "-ExecutionPolicy", "Bypass", "-File", str(LAUNCHER)]
    else:
        command = [str(LAUNCHER)]
    return subprocess.call([*command, *sys.argv[1:]])


if __name__ == "__main__":
    raise SystemExit(main())
