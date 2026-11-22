<?php
/**
 * Lanzador de apisrc para proyectos PHP.
 *
 * Pensado para `composer.json > scripts`:
 *
 *   "scripts": {
 *     "tanit": "php bin/wrappers/apisrc.php generate --project-root ."
 *   }
 *
 * Cero lógica de dominio: resuelve el lanzador y le pasa los
 * argumentos. El motor es el binario y hay uno solo (ver p00021).
 */
$repoRoot = dirname(__DIR__, 2);
$isWindows = DIRECTORY_SEPARATOR === '\\';
$launcher = $repoRoot . '/bin/' . ($isWindows ? 'apisrc.ps1' : 'apisrc');

$args = array_slice($argv, 1);
$parts = $isWindows
    ? ['powershell', '-ExecutionPolicy', 'Bypass', '-File', $launcher]
    : [$launcher];

$command = implode(' ', array_map('escapeshellarg', array_merge($parts, $args)));
passthru($command, $exitCode);
exit($exitCode);
