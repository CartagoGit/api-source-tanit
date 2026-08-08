# `.docker/` — el taller

Las herramientas que este proyecto necesita y tu máquina puede no tener.

**No es para el día a día.** El ciclo normal sigue siendo `bun run` en tu
terminal, que tarda segundos. Esto es para lo que la máquina no puede
hacer, y para comprobar que lo que funciona aquí funciona también en un
sitio limpio.

## Por qué existe

`f00001` S4 —los instaladores de escritorio— quedó bloqueado por un
motivo concreto: Tauri necesita Rust y la máquina de desarrollo no tenía
toolchain. La alternativa era commitear un scaffold sin compilarlo una
sola vez, y esta ronda ya había demostrado lo que eso cuesta: tres
comandos del CLI —`list`, `init` y `enrich`— estaban rotos precisamente
porque nadie los había ejecutado nunca. `list` no listaba nada en los 21
frameworks.

Un contenedor con las herramientas dentro convierte «no puedo
verificarlo» en «lo verifico aquí».

## Qué hay

| Atajo | Qué hace |
| --- | --- |
| `bun run docker:validate` | El gate en un entorno limpio |
| `bun run docker:binaries` | Los cuatro binarios autocontenidos |
| `bun run docker:installers` | `.deb` y `.AppImage` con Tauri |
| `bun run docker:smoke` | El binario en una imagen **sin Bun ni Node** |
| `bun run docker:shell` | Una shell dentro, para cuando algo falla |

## Lo que encontró la primera vez que se ejecutó

Esto es lo que un contenedor paga por sí solo: **cuatro fallos que en la
máquina de desarrollo no se podían ver**, porque la máquina tenía cosas
que un sitio limpio no tiene.

- **`bash -lc` tiraba el `PATH`.** Una shell de login relee
  `/etc/profile` y reconstruye el `PATH` desde cero, así que `bun` no
  existía dentro aunque estuviera instalado.
- **Dos tests dependían del nombre de la carpeta del checkout.**
  Exigían que el directorio se llamara `export-to-postman`; el
  contenedor monta en `/work`. Cualquiera que clone en otra carpeta
  tenía el mismo fallo.
- **El test de permisos pasaba siempre como root.** `chmod 0555` no
  impide escribir a quien puede saltarse los permisos, así que el
  escenario que probaba no existía. Ahora se salta declarando el motivo:
  un test que no puede fallar es peor que no tenerlo, porque además
  cuenta como cobertura.
- **`lint:bootstrap-drift` pasaba por suerte.** El bootstrap citaba una
  ruta del checkout hermano de `mcp-vertex`, que existe en la máquina de
  desarrollo y en ningún otro sitio.

## La limitación que queda, y de quién es

`docker:validate` **no corre la sección `plugin`**, y no es un descuido.

El plugin declara
`"@mcp-vertex/core": "file:../../../../mcp-vertex/packages/core"`: un
`file:` que apunta **fuera** del repositorio. En un sitio limpio ese
enlace no resuelve, el install del workspace se queda a medias y todo lo
que dependa de él falla.

Se intentó montar el checkout hermano dentro y no basta —bun no
materializa el enlace—, pero sobre todo **no debería hacer falta**: el
bootstrap prohíbe expresamente que este repositorio exija un checkout al
lado.

O sea que el contenedor no ha causado nada: le ha puesto número a
[`p00007`](../docs/mcp-vertex/proposals/blocked/p00007-consumir-mcp-vertex-core-publicado.md).
Lo que esa propuesta describe como «cambiar una línea cuando se
publique» es, en realidad, **el repositorio no siendo autocontenido** —
y solo se nota cuando intentas construirlo en un sitio limpio.

El día que `@mcp-vertex/core` esté en npm, `docker:validate` pasa a ser
`bun run validate` a secas y esta sección se borra.

## El aviso de `glib`, y por qué sigue ahí

El `.deb` arrastra `glib 0.18.5`, sobre el que hay un aviso de
*unsoundness* en `VariantStrIter`. **No se puede subir**: lo fija toda la
pila `gtk 0.18` de Tauri —`atk`, `muda`, `tao`—, y `cargo update -p glib`
no mueve nada. La ruta de subida depende de que `gtk-rs` pase a 0.20.

Está anotado como riesgo tolerado, no descartado: CVSS 0, es un problema
de corrección de un iterador y no un fallo explotable. Se revisa al subir
Tauri.

La diferencia con las 67 alertas de la ronda anterior importa: aquellas
salían de manifiestos de mentira que nadie instala. Esta viaja dentro
del paquete que se distribuye.

## Las versiones van fijadas

Bun, Rust y el CLI de Tauri llevan versión concreta en el `Dockerfile`.
Un `latest` haría que el contenedor dejara de reproducir el entorno del
día que se construyó, que es la mitad del motivo de tener un contenedor.
