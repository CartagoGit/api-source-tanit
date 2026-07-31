<?php
/**
 * postman-from-routes — alternativa PHP/Artisan.
 *
 * Para proyectos Laravel donde se prefiere no instalar Node/Bun:
 *   php runtime/php/postman-from-routes.php generate
 *   php runtime/php/postman-from-routes.php check
 *   php runtime/php/postman-from-routes.php list
 *
 * Implementa el mismo contrato agnóstico:
 *   - Lee `routes/*.php` y parsea prefijos + acciones.
 *   - Intenta resolver FormRequest tipado en el controlador.
 *   - Genera `build/<proyecto>.postman_collection.json`.
 *
 * No usa `composer` ni dependencias externas. Solo PHP 8.1+ (enums y readonly).
 */

declare(strict_types=1);

namespace PostmanFromRoutes;

final class RoutesParser
{
    public static function parseAll(array $filePrefixes): array
    {
        $cwd = getcwd() ?: '.';
        $routesDir = $cwd . '/routes';
        if (!is_dir($routesDir)) {
            fwrite(STDERR, "✘ No se encuentra $routesDir (ejecuta dentro de la raíz Laravel).\n");
            exit(1);
        }
        $out = [];
        foreach (glob($routesDir . '/*.php') ?: [] as $file) {
            $rel = 'routes/' . basename($file);
            $prefixes = $filePrefixes[$rel] ?? ['api'];
            $parsed = self::parseFile($rel, $prefixes);
            $out = array_merge($out, $parsed);
        }
        return $out;
    }

    private static function stripComments(string $src): string
    {
        $src = preg_replace('!/\*.*?\*/!s', '', $src);
        $src = preg_replace('/(^|[^:])\/\/.*$/m', '$1', $src ?? '');
        return $src ?? '';
    }

    private static function parseFile(string $rel, array $initialPrefix): array
    {
        $abs = (getcwd() ?: '.') . '/' . $rel;
        $text = self::stripComments((string) file_get_contents($abs));

        $imports = [];
        if (preg_match_all(
            '/use\s+([A-Za-z0-9_\\\\]+)\s*(?:as\s+([A-Za-z0-9_]+))?\s*;/',
            $text,
            $m,
            PREG_SET_ORDER,
        )) {
            foreach ($m as $im) {
                $fqcn = $im[1];
                $short = substr($fqcn, strrpos($fqcn, '\\') + 1);
                $alias = $im[2] ?? $short;
                $imports[$alias] = $fqcn;
                if (!isset($imports[$short])) $imports[$short] = $fqcn;
            }
        }

        $prefixStack = $initialPrefix;
        $out = [];
        $lines = explode("\n", $text);
        foreach ($lines as $i => $line) {
            if (preg_match("/Route::prefix\(\s*['\"]([^'\"]+)['\"]/", $line, $pm)) {
                $prefixStack[] = $pm[1];
            }
            if (preg_match('/\}\s*\)/', $line) && count($prefixStack) > count($initialPrefix)) {
                array_pop($prefixStack);
            }
            if (preg_match(
                "/Route::(get|post|put|delete|patch)\s*\(\s*['\"]([^'\"]*)['\"]/",
                $line,
                $rm,
            )) {
                $method = strtoupper($rm[1]);
                $rawUri = $rm[2];
                $segments = $rawUri ? array_merge($prefixStack, [$rawUri]) : $prefixStack;
                $full = implode('/', $segments);
                $full = preg_replace('#/+#', '/', $full) ?? $full;

                $window = $line . ' ' . ($lines[$i + 1] ?? '');
                $controller = null;
                $action = null;
                if (preg_match('/\[\s*([A-Za-z0-9_]+)::class\s*,\s*[\'"]([A-Za-z0-9_]+)[\'"]\s*\]/', $window, $am)) {
                    $alias = $am[1];
                    $action = $am[2];
                    $controller = $imports[$alias] ?? ("App\\Http\\Controllers\\{$alias}");
                }

                $entry = [
                    'method' => $method,
                    'uri' => $full,
                    'rawUri' => $rawUri,
                    'sourceFile' => $rel,
                    'line' => $i + 1,
                    'prefixChain' => $prefixStack,
                ];
                if ($controller) $entry['controllerClass'] = $controller;
                if ($action) $entry['actionName'] = $action;
                $out[] = $entry;
            }
        }
        return $out;
    }
}

final class FormRequestParser
{
    /** @return array{rules: array<string, array<int, string>>, className: string} */
    public static function parse(string $absPath): array
    {
        $text = (string) file_get_contents($absPath);
        if (!preg_match('/class\s+(\w+)\s+extends\s+\w*FormRequest/', $text, $cls)) {
            return ['rules' => [], 'className' => basename($absPath, '.php')];
        }
        if (!preg_match('/public\s+function\s+rules\s*\([^)]*\)\s*:\s*array\s*\{/', $text, $m, PREG_OFFSET_CAPTURE)) {
            return ['rules' => [], 'className' => $cls[1]];
        }
        $start = $m[0][1];
        $tail = substr($text, $start);
        if (!preg_match('/return\s*\[/', $tail, $rm, PREG_OFFSET_CAPTURE)) {
            return ['rules' => [], 'className' => $cls[1]];
        }
        $open = $rm[0][1] + strlen($rm[0][0]) - 1;
        $depth = 0;
        $len = strlen($tail);
        for ($i = $open; $i < $len; $i++) {
            $c = $tail[$i];
            if ($c === '[') $depth++;
            elseif ($c === ']') {
                $depth--;
                if ($depth === 0) {
                    $block = substr($tail, $rm[0][1], $i - $rm[0][1] + 1);
                    return [
                        'rules' => self::parseRulesArray($block),
                        'className' => $cls[1],
                    ];
                }
            }
        }
        return ['rules' => [], 'className' => $cls[1]];
    }

    /** @return array<string, array<int, string>> */
    private static function parseRulesArray(string $block): array
    {
        $rules = [];
        if (!preg_match_all(
            '/[\'\"]([^\'\"]+)[\'\"]\s*=>\s*\[([^\]]*)\]/',
            $block,
            $m,
            PREG_SET_ORDER,
        )) {
            return $rules;
        }
        foreach ($m as $pair) {
            $field = $pair[1];
            $inner = $pair[2];
            preg_match_all('/[\'"]([^\'\"]+)[\'\"]/', $inner, $rs);
            $rules[$field] = $rs[1] ?? [];
        }
        return $rules;
    }
}

final class ParamInferrer
{
    private const PATH_HINTS = [
        '/(^|_)id($|_)/i' => '1',
        '/(^|_)codigo($|_)/i' => 'COD001',
        '/(^|_)matricula($|_)/i' => '1234ABC',
        '/^email$/i' => 'usuario@ejemplo.com',
        '/uuid/i' => '00000000-0000-0000-0000-000000000001',
    ];

    public static function exampleForPathParam(string $name): string
    {
        foreach (self::PATH_HINTS as $re => $v) {
            if (preg_match($re, $name)) return $v;
        }
        return '1';
    }

    /** @return array<int, array<string, string>> */
    public static function inferQuery(string $method, string $uri): array
    {
        if (strtoupper($method) !== 'GET') return [];
        if (preg_match('/\{\{[^}]+\}\}/', $uri)) {
            return [['key' => 'include', 'value' => 'all', 'description' => 'Relaciones a incluir']];
        }
        $last = strtolower(basename($uri));
        if (preg_match('/alive|auth-test|historial|blacklist|codigos|pdf|csv|excel|log/', $last)) {
            return [['key' => 'q', 'value' => 'ejemplo', 'description' => 'Búsqueda libre']];
        }
        return [
            ['key' => 'pagina', 'value' => '1', 'description' => 'Número de página'],
            ['key' => 'items_por_pagina', 'value' => '20', 'description' => 'Tamaño de página'],
            ['key' => 'q', 'value' => 'ejemplo', 'description' => 'Búsqueda libre'],
        ];
    }

    /** @return array<string, mixed> */
    public static function inferBody(string $method, string $uri): ?array
    {
        $method = strtoupper($method);
        if (!in_array($method, ['POST', 'PUT', 'PATCH'], true)) return null;
        $segs = array_values(array_filter(explode('/', $uri), fn($s) => $s !== ''));
        $last = strtolower(end($segs) ?: '');
        if (preg_match('/(cancel|reindex|reactivate|restore|approve|reject|resend|refresh|sincronizar|importar|exportar|ejecutar|force|publish)/i', $last)) {
            return ['force' => true];
        }
        if (in_array($last, ['despersonar', 'logout', 'desactivar'], true)) {
            return [];
        }
        return ['force' => false];
    }

    /** @return array<int, array<string, string>> */
    public static function inferVariables(array $specs): array
    {
        $seen = ['baseUrl', 'token'];
        foreach ($specs as $s) {
            if (preg_match_all('/\{\{([^}]+)\}\}/', $s['uri'], $m)) {
                foreach ($m[1] as $p) {
                    $seen[$p] = self::exampleForPathParam($p);
                }
            }
        }
        $out = [];
        foreach ($seen as $k => $v) {
            $out[] = ['key' => $k, 'value' => (string) $v, 'type' => 'string'];
        }
        return $out;
    }
}

final class CollectionBuilder
{
    /** @param array<int, array<string, mixed>> $specs */
    public static function build(array $specs, string $name, string $description, array $variables): array
    {
        $groups = [];
        foreach ($specs as $spec) {
            $key = $spec['folder'] ?? self::topGroup($spec['uri']);
            $groups[$key][] = self::item($spec);
        }
        $items = [];
        foreach ($groups as $key => $children) {
            $items[] = ['name' => self::pretty($key), 'item' => $children];
        }
        return [
            'info' => [
                'name' => $name,
                'description' => $description,
                'schema' => 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
                '_postman_id' => '00000000-0000-0000-0000-000000000001',
            ],
            'auth' => [
                'type' => 'bearer',
                'bearer' => [['key' => 'token', 'value' => '{{token}}', 'type' => 'string']],
            ],
            'variable' => $variables,
            'item' => $items,
        ];
    }

    private static function topGroup(string $uri): string
    {
        $u = preg_replace('#^/?(api/)?#', '', $uri) ?? $uri;
        return explode('/', $u)[0] ?? '(raíz)';
    }

    private static function pretty(string $key): string
    {
        return implode(' ', array_map(fn($w) => ucfirst($w), preg_split('/[-_]/', $key) ?: [$key]));
    }

    private static function item(array $spec): array
    {
        $req = [
            'method' => $spec['method'],
            'header' => [
                ['key' => 'Accept', 'value' => 'application/json', 'type' => 'text'],
                ['key' => 'Authorization', 'value' => 'Bearer {{token}}', 'type' => 'text'],
            ],
            'url' => [
                'raw' => '{{baseUrl}}' . $spec['uri'],
                'host' => ['{{baseUrl}}'],
                'path' => array_values(array_filter(explode('/', $spec['uri']), fn($s) => $s !== '')),
            ],
        ];
        if (!empty($spec['query'])) {
            $req['url']['query'] = array_map(
                fn($q) => ['key' => $q['key'], 'value' => $q['value'], 'description' => $q['description'] ?? '', 'disabled' => false],
                $spec['query'],
            );
        }
        if (!empty($spec['body'])) {
            $req['body'] = [
                'mode' => 'raw',
                'raw' => json_encode($spec['body'], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE),
                'options' => ['raw' => ['language' => 'json']],
            ];
            $req['header'][] = ['key' => 'Content-Type', 'value' => 'application/json', 'type' => 'text'];
        }
        $out = ['name' => $spec['name'], 'request' => $req];
        if (!empty($spec['description'])) $out['description'] = $spec['description'];
        return $out;
    }
}

final class OpenPostman
{
    public static function launch(string $collectionPath): int
    {
        if (!file_exists($collectionPath)) {
            fwrite(STDERR, "✘ No se encuentra $collectionPath\n");
            return 1;
        }
        $os = PHP_OS_FAMILY;
        $abs = realpath($collectionPath) ?: $collectionPath;
        $url = 'https://app.postman.com/import';
        echo "→ Abriendo Postman con: $abs\n→ OS: $os\n";
        switch ($os) {
            case 'Darwin':
                @exec('open -a Postman ' . escapeshellarg($abs) . ' 2>/dev/null');
                if (self::processRunning('Postman')) return 0;
                @exec('open ' . escapeshellarg($abs));
                return 0;
            case 'Windows':
                @pclose(@popen('start "" ' . escapeshellarg($abs), 'r'));
                return 0;
            case 'Linux':
                @exec('xdg-open ' . escapeshellarg($abs) . ' 2>/dev/null', $o, $c);
                if ($c === 0) return 0;
                @exec('gio open ' . escapeshellarg($abs) . ' 2>/dev/null', $o, $c);
                if ($c === 0) return 0;
                break;
        }
        echo "→ No se detectó app de escritorio; abriendo web: $url\n";
        echo "  Arrastra el archivo al importador: $abs\n";
        @exec('xdg-open ' . escapeshellarg($url));
        return 0;
    }

    private static function processRunning(string $name): bool
    {
        @exec('pgrep -lf ' . escapeshellarg($name), $out);
        return !empty($out);
    }
}

// --- Entry point ----------------------------------------------------------

$cmd = $argv[1] ?? null;
$root = getcwd() ?: '.';
$buildDir = $root . '/build';
@mkdir($buildDir, 0777, true);

function loadConfig(string $root): array
{
    $configPath = getenv('POSTMAN_CONFIG') ?: null;
    if (!$configPath) {
        $examples = glob($root . '/examples/*/config.constant.*');
        if (!$examples) {
            // Buscar JSON/PHP en la raíz Laravel.
            $examples = array_merge(
                glob($root . '/examples/*/config.*'),
                glob($root . '/config/postman.*'),
            );
        }
        if ($examples) $configPath = $examples[0];
    }
    if (!$configPath || !file_exists($configPath)) {
        // Mínimo viable: nombre del directorio + baseUrl.
        return [
            'name' => basename($root),
            'collectionName' => basename($root) . ' (Postman)',
            'collectionDescription' => 'Colección generada por postman-from-routes.',
            'baseUrl' => 'http://localhost/api',
            'variables' => [
                ['key' => 'baseUrl', 'value' => 'http://localhost/api', 'type' => 'string'],
                ['key' => 'token', 'value' => '', 'type' => 'string'],
            ],
            'filePrefixes' => [],
            'loginEndpointName' => 'Login',
            'uriGroupOverrides' => [],
        ];
    }
    $ext = pathinfo($configPath, PATHINFO_EXTENSION);
    if ($ext === 'ts' || $ext === 'js') {
        fwrite(STDERR, "✘ Para leer config TS/JS usa el CLI Node/Bun. Esta build PHP solo soporta config PHP/JSON.\n");
        exit(1);
    }
    if ($ext === 'php') {
        $config = require $configPath;
    } else {
        $config = json_decode((string) file_get_contents($configPath), true);
    }
    return $config;
}

function toPostmanUri(string $laravel): string
{
    $u = preg_replace('#^/?(api/)?#', '', $laravel) ?? $laravel;
    $u = preg_replace('/\{([^}:]+)(?::[^}]+)?\}/', '{{$1}}', $u) ?? $u;
    if (!str_starts_with($u, '/')) $u = '/' . $u;
    return $u;
}

function humanize(string $method): string
{
    static $labels = [
        'index' => 'Listar', 'show' => 'Ver', 'store' => 'Crear', 'create' => 'Crear',
        'update' => 'Actualizar', 'destroy' => 'Eliminar', 'delete' => 'Eliminar',
        'login' => 'Login', 'logout' => 'Cerrar sesión', 'alive' => 'Alive',
    ];
    return $labels[$method] ?? ucfirst($method);
}

function endpointName(array $route, string $pmUri): string
{
    $action = $route['actionName'] ?? $route['method'];
    $segs = array_values(array_filter(explode('/', $pmUri), fn($s) => $s !== '' && !str_starts_with($s, '{{')));
    $resource = end($segs) ?: '';
    $resourceTitle = ucwords(str_replace(['-', '_'], ' ', $resource));
    $verb = humanize($action);
    return trim("$verb $resourceTitle") ?: $verb;
}

function resolveFormRequest(string $controller, string $action, string $root): ?array
{
    $map = parseControllerFormRequests($controller, $root);
    $fqcn = $map[$action] ?? null;
    if (!$fqcn) {
        // Convención: <ControllerName><Action>Request.php en subcarpeta homónima
        $controllerShort = substr($controller, strrpos($controller, '\\') + 1);
        $resource = preg_replace('/Controller$/', '', $controllerShort) ?? $controllerShort;
        $actionMap = [
            'index' => ['Index', 'Listar'], 'show' => ['Show', 'Ver'],
            'store' => ['Store', 'Crear', 'Create'], 'update' => ['Update', 'Actualizar', 'Edit'],
            'destroy' => ['Destroy', 'Eliminar', 'Delete'],
        ];
        $pfxs = $actionMap[$action] ?? [ucfirst($action)];
        $reqs = glob($root . '/app/Http/Requests/*/*Request.php') ?: [];
        foreach ($reqs as $f) {
            $cls = basename($f, '.php');
            foreach ($pfxs as $pfx) {
                foreach ([$pfx . $resource . 'Request', $pfx . 'Request'] as $cand) {
                    if ($cls === $cand) return ['absPath' => $f, 'className' => $cls];
                }
            }
        }
        return null;
    }
    if (!str_starts_with($fqcn, 'App\\Http\\Requests\\')) return null;
    $rel = str_replace('App\\', 'app/', $fqcn) . '.php';
    $abs = $root . '/' . str_replace('\\', '/', $rel);
    if (!file_exists($abs)) return null;
    return ['absPath' => $abs, 'className' => basename($abs, '.php')];
}

function parseControllerFormRequests(string $controller, string $root): array
{
    $rel = str_replace('App\\', 'app/', $controller) . '.php';
    $abs = $root . '/' . str_replace('\\', '/', $rel);
    if (!file_exists($abs)) return [];
    $text = (string) file_get_contents($abs);
    $text = preg_replace('!/\*.*?\*/!s', '', $text);
    $imports = [];
    if (preg_match_all('/use\s+([A-Za-z0-9_\\\\]+)\s*(?:as\s+([A-Za-z0-9_]+))?\s*;/', $text, $m, PREG_SET_ORDER)) {
        foreach ($m as $im) {
            $fqcn = $im[1];
            $short = substr($fqcn, strrpos($fqcn, '\\') + 1);
            $alias = $im[2] ?? $short;
            if (str_ends_with($alias, 'Request')) $imports[$alias] = $fqcn;
        }
    }
    if (preg_match_all('/(?:public|protected)\s+function\s+(\w+)\s*\(([^)]*)\)/s', $text, $m, PREG_SET_ORDER)) {
        $out = [];
        foreach ($m as $mm) {
            $name = $mm[1];
            $params = $mm[2];
            if (preg_match('/(?:\\\\?([A-Za-z0-9_\\\\]*Request))\s+\$/', $params, $tm)) {
                $typeName = $tm[1];
                $short = substr($typeName, strrpos($typeName, '\\') + 1);
                $fqcn = $imports[$short] ?? ($typeName !== 'Request' ? $typeName : null);
                if ($fqcn) $out[$name] = $fqcn;
            }
        }
        return $out;
    }
    return [];
}

function buildSpecs(array $routes, string $root): array
{
    $specs = [];
    foreach ($routes as $r) {
        if (!in_array($r['method'], ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'], true)) continue;
        $pmUri = toPostmanUri($r['uri']);
        $spec = [
            'name' => endpointName($r, $pmUri),
            'method' => $r['method'],
            'uri' => $pmUri,
        ];
        $fr = ($r['controllerClass'] ?? null) && ($r['actionName'] ?? null)
            ? resolveFormRequest($r['controllerClass'], $r['actionName'], $root)
            : null;
        if ($fr) {
            $spec['formRequest'] = str_replace($root . '/', '', $fr['absPath']);
            $parsed = FormRequestParser::parse($fr['absPath']);
            $spec['description'] = 'Auto · ' . $parsed['className'];
        }
        // Inferencia agnóstica para todo (incluye sin FR).
        $spec['query'] = ParamInferrer::inferQuery($r['method'], $pmUri);
        $body = ParamInferrer::inferBody($r['method'], $pmUri);
        if ($body !== null) $spec['body'] = $body;
        $specs[] = $spec;
    }
    return $specs;
}

switch ($cmd) {
    case 'generate': {
        $config = loadConfig($root);
        $routes = RoutesParser::parseAll($config['filePrefixes'] ?? []);
        $specs = buildSpecs($routes, $root);
        $variables = $config['variables'] ?? ParamInferrer::inferVariables($specs);
        $collection = CollectionBuilder::build(
            $specs,
            $config['collectionName'] ?? ($config['name'] ?? 'collection'),
            $config['collectionDescription'] ?? '',
            $variables,
        );
        $basename = getenv('POSTMAN_OUTPUT_BASENAME') ?: (($config['name'] ?? basename($root)) . '.postman_collection');
        $out = $buildDir . '/' . $basename . '.json';
        file_put_contents($out, json_encode($collection, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        echo "✔ Colección escrita en $out\n";
        echo "  · " . count($specs) . " specs\n";
        if (in_array('--open', $argv, true)) {
            OpenPostman::launch($out);
        }
        break;
    }
    case 'check': {
        $config = loadConfig($root);
        $routes = RoutesParser::parseAll($config['filePrefixes'] ?? []);
        $specs = buildSpecs($routes, $root);
        $basename = getenv('POSTMAN_OUTPUT_BASENAME') ?: (($config['name'] ?? basename($root)) . '.postman_collection');
        $path = $buildDir . '/' . $basename . '.json';
        if (!file_exists($path)) {
            fwrite(STDERR, "✘ Falta $path (ejecuta 'generate' antes)\n");
            exit(1);
        }
        $collection = json_decode((string) file_get_contents($path), true);
        if (!is_array($collection) || empty($collection['info']['schema'])) {
            fwrite(STDERR, "✘ JSON inválido\n");
            exit(1);
        }
        echo "✔ Colección válida\n";
        echo "  · " . count($collection['item'] ?? []) . " carpetas top\n";
        break;
    }
    case 'list': {
        $config = loadConfig($root);
        $routes = RoutesParser::parseAll($config['filePrefixes'] ?? []);
        foreach ($routes as $r) {
            echo "  " . str_pad($r['method'], 6) . ' /' . toPostmanUri($r['uri']) . "\n";
        }
        break;
    }
    case 'open': {
        $config = loadConfig($root);
        $basename = getenv('POSTMAN_OUTPUT_BASENAME') ?: (($config['name'] ?? basename($root)) . '.postman_collection');
        OpenPostman::launch($buildDir . '/' . $basename . '.json');
        break;
    }
    default:
        echo "postman-from-routes (PHP)\n";
        echo "Uso: php postman-from-routes.php <generate|check|list|open> [--open]\n";
        exit($cmd === null ? 0 : 1);
}
