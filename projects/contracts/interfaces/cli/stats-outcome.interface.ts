/**
 * Lo que devuelven las estadísticas de una colección.
 *
 * Vive aquí y no dentro de `stats.script.ts` por lo mismo que
 * `IScanOutcome`: lo consumen el comando que lo produce y el tool MCP
 * que lo expone, y ninguno de los dos debería tener que importar al otro
 * para conocer la forma del dato.
 *
 * Los desgloses tienen un invariante que el tipo no puede expresar y los
 * tests sí comprueban: `total` es la suma de `byMethod` y también la de
 * `zones`, y el `total` de cada zona es la suma de su `byFolder`. Un
 * desglose que no suma su propio total es la clase de dato con el que se
 * decide mal sin enterarse.
 */

/** Cuántas requests hay de un método HTTP. */
export interface IMethodCount {
  readonly method: string;
  readonly count: number;
}

/** Cuántas requests cuelgan de una carpeta de primer nivel. */
export interface IFolderCount {
  readonly folder: string;
  readonly count: number;
}

/** El desglose de una zona. Solo aparecen las que tienen algo dentro. */
export interface IZoneStats {
  readonly zone: string;
  readonly total: number;
  readonly byFolder: ReadonlyArray<IFolderCount>;
}

/** El resultado completo de contar una colección. */
export interface IStatsOutcome {
  readonly code: number;
  readonly total: number;
  /** De mayor a menor, igual que se imprime. */
  readonly byMethod: ReadonlyArray<IMethodCount>;
  /** En el orden de presentación que dicta la configuración de zonas. */
  readonly zones: ReadonlyArray<IZoneStats>;
}
