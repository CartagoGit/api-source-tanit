---
id: f00021
title: "Completar huecos puntuales con IA remota anónima opcional y trazable"
kind: feat
status: ready
type: proposal
track: enrichment
date: 2026-11-10
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
- **Files**: `docs/AI-ENRICHMENT.md`, `tests/enrichment/provider-contract.spec.ts`
- **Gate**: e2e
- acceptance:
  - "Verificar endpoint anónimo con petición sintética, condiciones para apps distribuidas, privacidad y destinatarios; no enviar código privado durante la investigación."
  - "Registrar fecha/límites/resultado real: llmfaucet es candidato, no certificado, con DNS fallido en este entorno; los términos actuales de LLM7 requieren token."
  - "Sin proveedor elegible, registrar no disponible; no prometer una API anónima de ChatGPT/Gemini ni introducir infraestructura sustitutiva."

### S2 — Huecos, consentimiento, caché y UI comunes
- **Status**: pending
- **DependsOn**: [S1]
- **Files**: `packages/core/enrichment`, `packages/contracts/interfaces/core/enrichment.interface.ts`, `packages/ui`, `packages/cli`, `tests/enrichment/enrichment-flow.spec.ts`
- **Gate**: e2e
- acceptance:
  - "Cero peticiones desactivado por defecto; habilitación UI explícita explica fragmentos y destino; configuración común gobierna consumidores."
  - "Mostrar análisis primero; agrupar huecos por endpoint, contexto mínimo sin secretos, caché por hash/versión, presupuesto finito y sin consultas continuas."
  - "Timeout/offline/429/respuesta inválida/proveedor ausente conservan análisis estático sin diálogos ni reintentos agresivos."
  - "Salida validada estructuralmente, procedencia AI generated con proveedor/modelo disponible/evidencia/hash/fecha; hechos verificados y conflictos permanecen intactos."

## acceptance

- Verificar endpoint anónimo con petición sintética, condiciones para apps distribuidas, privacidad y destinatarios; no enviar código privado durante la investigación.
- Registrar fecha/límites/resultado real: llmfaucet es candidato, no certificado, con DNS fallido en este entorno; los términos actuales de LLM7 requieren token.
- Sin proveedor elegible, registrar no disponible; no prometer una API anónima de ChatGPT/Gemini ni introducir infraestructura sustitutiva.
- Cero peticiones desactivado por defecto; habilitación UI explícita explica fragmentos y destino; configuración común gobierna consumidores.
- Mostrar análisis primero; agrupar huecos por endpoint, contexto mínimo sin secretos, caché por hash/versión, presupuesto finito y sin consultas continuas.
- Timeout/offline/429/respuesta inválida/proveedor ausente conservan análisis estático sin diálogos ni reintentos agresivos.
- Salida validada estructuralmente, procedencia AI generated con proveedor/modelo disponible/evidencia/hash/fecha; hechos verificados y conflictos permanecen intactos.
