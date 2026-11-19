# Issues scaffoldeadas

Aquí escribe el plugin `issues` de delendai cuando se le pide preparar
una incidencia para GitHub.

## Por qué no está dentro de `proposals/`

Porque estaba, y era un error con consecuencia. `scaffoldDir` apuntaba a
`docs/delendai/proposals/retired/issues`, o sea **dentro del árbol de
propuestas**, donde `lint:proposals` exige que todo fichero se llame
`<kind><NNNNN>-<slug>.md`. La primera issue que el plugin hubiera escrito
ahí habría roto el gate del repositorio sin que nadie entendiera por qué.

Y conceptualmente tampoco encaja: una issue scaffoldeada no es una
propuesta retirada. Son dos cosas distintas con dos ciclos de vida
distintos.

`tests/cli/mcp-config.spec.ts` comprueba ahora que **todos** los
directorios que declara la configuración existan, no solo los `roots`.
Ese era el hueco por el que este pasó.
