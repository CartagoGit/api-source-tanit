/**
 * Los modos de tema y las variables que cada uno define.
 *
 * Ni un color escrito a pelo en las reglas: **todo** apunta a una
 * variable, y cambiar de tema es cambiar los valores de esas variables.
 * Es lo que hace que añadir un tema sea escribir doce líneas en vez de
 * duplicar la hoja de estilos entera — y lo que impide que un tema nuevo
 * se olvide de la mitad de los elementos.
 *
 * ## Por qué variables CSS y no clases
 *
 * Con clases (`.oscuro .boton { … }`) cada elemento necesita su regla
 * repetida por tema, así que un elemento nuevo se ve bien en el tema en
 * el que se escribió y roto en los otros. Con variables, un elemento
 * nuevo hereda el tema sin que nadie se acuerde de él.
 *
 * ## Los tres modos, y por qué «sistema» es el de por defecto
 *
 * Quien tiene el sistema en oscuro lo tiene por un motivo —de noche, o
 * porque le molesta la luz— y abrir una aplicación en blanco brillante
 * es exactamente lo que esa persona configuró para que no pasara.
 * `prefers-color-scheme` ya lo dice; ignorarlo sería preguntar algo que
 * ya está contestado.
 */

/** Los modos que se pueden elegir en ajustes. */
export const THEME_MODES = ["system", "light", "dark"] as const;

/** Un modo de tema válido. */
export type ThemeMode = (typeof THEME_MODES)[number];

/** El de por defecto: el que ya haya elegido la persona en su sistema. */
export const DEFAULT_THEME: ThemeMode = "system";

/**
 * Los nombres de las variables, en un solo sitio.
 *
 * Se declaran aquí y no solo en el CSS para que un test pueda
 * comprobar que **los dos temas definen las mismas**. Un tema al que le
 * falte una variable no falla: hereda la del otro y se ve mal en un
 * sitio concreto, que es de los fallos más difíciles de encontrar
 * mirando código.
 */
export const THEME_VARIABLES = [
  "--fondo",
  "--fondo-elevado",
  "--borde",
  "--texto",
  "--texto-suave",
  "--acento",
  "--acento-texto",
  "--exito",
  "--aviso",
  "--error",
  "--sombra",
  "--foco",
] as const;
