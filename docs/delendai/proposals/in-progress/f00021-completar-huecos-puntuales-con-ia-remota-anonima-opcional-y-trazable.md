---
id: f00021
title: "Completar huecos puntuales con IA remota anónima opcional y trazable"
kind: feat
status: in-progress
type: proposal
track: enrichment
date: 2026-11-10
last-transition-id: 8cdf2a4f-4aa7-4101-a87d-cfc3791e950e
last-correlation-id: 8cdf2a4f-4aa7-4101-a87d-cfc3791e950e
last-transition-from: ready
last-transition-at: 2026-11-11T00:43:23.527Z
---

# f00021 — Completar huecos puntuales con IA remota anónima opcional y trazable

## goal

Tras mostrar resultados estáticos, completar únicamente información incompleta con servicio remoto gratuito sin cuenta, claves, modelo local ni infraestructura del usuario.

## why

Opción UI apagada por defecto; consultas mínimas por endpoint y evidencia faltante, sin error bloqueante y marca AI generated. No sustituir por relay propio o proveedor de pago.

## non-goals

- Automatizar chats web o evadir autenticación.
- Enviar repositorios completos, alterar código o reemplazar hechos verificados.
- Exigir cuenta, clave, modelo local o servidor del usuario.

## slices

- global_gate: none

### S1 — Verificar proveedor y disponibilidad real
- **Status**: pending
- **Files**: `docs/AI-ENRICHMENT.md`, `docs/BETA.md`, `docs/delendai/AGENT-BOOTSTRAP.md`
- **Gate**: documentation review; `bun run lint:docs` and `bun run lint:proposals`
- acceptance:
  - "Registrar fuentes primarias actuales, fecha, autenticación, precio, límites, proveedor downstream, retención/entrenamiento y condiciones de distribución para cada opción comprobada."
  - "Registrar los resultados observados de llmfaucet y las comprobaciones de catálogo y solicitud sintética de Kilo; distinguir el fallo de un ID obsoleto de la respuesta del modelo vigente."
  - "Explicar que los términos NVIDIA publicados dicen que el uso confirma el acuerdo, sin afirmar que el usuario aceptó legalmente; registrar que la solicitud sintética precedió la lectura de esos términos."
  - "No enviar datos de proyecto ni credenciales, no configurar el producto y no inferir una API anónima de un chat web. Si no hay proveedor elegible, mantener S2 pendiente."

### S2 — Huecos, consentimiento, caché y UI comunes
- **Status**: pending
- **DependsOn**: [S1]
- **Blocked**: S1 no verificó proveedor que permita distribución del producto bajo condiciones de privacidad y uso aceptables; requiere nueva evidencia de proveedor elegible antes de implementar.
- **Files**: `packages/core/enrichment`, `packages/contracts/interfaces/core/enrichment.interface.ts`, `packages/ui`, `packages/cli`, `tests/enrichment/enrichment-flow.spec.ts`
- **Gate**: e2e
- acceptance:
  - "Cero peticiones desactivado por defecto; habilitación UI explícita explica fragmentos y destino; configuración común gobierna consumidores."
  - "Mostrar análisis primero; agrupar huecos por endpoint, contexto mínimo sin secretos, caché por hash/versión, presupuesto finito y sin consultas continuas."
  - "Timeout/offline/429/respuesta inválida/proveedor ausente conservan análisis estático sin diálogos ni reintentos agresivos."
  - "Salida validada estructuralmente, procedencia AI generated con proveedor/modelo disponible/evidencia/hash/fecha; hechos verificados y conflictos permanecen intactos."

## acceptance

- S1 documenta fuentes actuales y resultados reproducibles en [AI-ENRICHMENT.md](../../../../AI-ENRICHMENT.md); por ahora no hay proveedor elegible verificado y no se habilita enriquecimiento.
- S2 solo puede comenzar después de documentar una opción anónima gratuita con permiso para distribución, destinatarios y manejo de datos aceptables; acceso gratuito de prueba no basta.
- Cero peticiones desactivado por defecto; habilitación UI explícita explica fragmentos y destino; configuración común gobierna consumidores.
- Mostrar análisis primero; agrupar huecos por endpoint, contexto mínimo sin secretos, caché por hash/versión, presupuesto finito y sin consultas continuas.
- Timeout/offline/429/respuesta inválida/proveedor ausente conservan análisis estático sin diálogos ni reintentos agresivos.
- Salida validada estructuralmente, procedencia AI generated con proveedor/modelo disponible/evidencia/hash/fecha; hechos verificados y conflictos permanecen intactos.
