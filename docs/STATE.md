# Estado durable

La persistencia durable de Tanit se mantiene detrás de contratos runtime-neutral. SQLite es infraestructura: `bun:sqlite` sólo se importa en `packages/core/state/sqlite/sqlite-connection.adapter.ts`; contratos y dominio no dependen de él.

## Base de datos

La base usa `PRAGMA user_version` y migraciones forward-only reproducibles. La versión actual es `2`. Las migraciones se ejecutan dentro del límite transaccional del adapter y rechazan versiones futuras desconocidas. Un esquema corrupto no se repara silenciosamente.

El esquema separa `projects`, `snapshots`, `services`, `operations`, `servers`, `auth_profiles`, `schemas`, `diagnostics`, `provenance` y `source_files`. Los campos variables se almacenan como JSON únicamente en columnas `*_json`; secretos no forman parte del modelo de conexión.

## Ubicación y conexión

Por defecto, la base global del usuario vive en `~/.tanit/state.sqlite`. `TANIT_STATE_DB` permite sustituir la ruta para tests, CI, Docker y modo portable. Cada conexión activa foreign keys, WAL y `busy_timeout` de 5 segundos.

La creación de la carpeta padre es responsabilidad de la infraestructura. Los consumidores futuros deben cerrar la conexión y mantener las escrituras dentro de transacciones explícitas.