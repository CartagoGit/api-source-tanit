/**
 * A call that waits before it runs.
 *
 * ## Why it exists
 *
 * The endpoint filters sent a request **per keystroke**. Typing
 * "orders" in the search box asked the backend four times — once
 * for "o", once for "or", once for "ord" and once for "orders" — and
 * every answer replaced the last one. On a big project that is four
 * scans of the endpoint list for one word.
 *
 * The wait is a quarter of a second: long enough that a word is
 * typed, short enough that the list feels alive.
 *
 * The **last** call wins, and the pending one is forgotten when the
 * debounced function is told to cancel. A timer that fires after the
 * user left the screen is a request nobody is waiting for.
 *
 * How long to wait is the caller's decision: this helper only knows
 * how to delay.
 */

/**
 * Wraps a call so it only runs once the calls stop coming.
 *
 * @param call The call to delay.
 * @param waitMs How long to wait after the last call.
 * @returns The delayed call, with a `cancel` to forget the pending one.
 */
export function debounce<T extends unknown[]>(
  call: (...args: T) => void,
  waitMs: number,
): ((...args: T) => void) & { cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const delayed = (...args: T): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      call(...args);
    }, waitMs);
  };

  delayed.cancel = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  return delayed;
}
