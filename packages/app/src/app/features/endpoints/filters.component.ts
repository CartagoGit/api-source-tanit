import { ChangeDetectionStrategy, Component, effect, input, output, signal } from "@angular/core";

import {
  ENDPOINT_CONFIDENCES,
  ENDPOINT_TRANSPORTS,
  EndpointConfidence,
  EndpointQuery,
} from "../../core/api/endpoints.client";
import { debounce, FILTER_DEBOUNCE_MS } from "../../core/api/debounce.helper";

/**
 * The filter bar of the endpoint explorer.
 *
 * Every filter here is answered by the **backend**. They used to be
 * applied in the client, over a list the app had invented — a filter
 * over invented data is decoration. Now the same filters narrow the
 * real project, and the count that comes back is the count of the
 * project, not of a page.
 *
 * The vocabularies are the core's: `ws` is a WebSocket, `high` is a
 * confidence level, `none` is the absence of a validation.
 *
 * ## Why typing does not ask the backend on every keystroke
 *
 * It used to. Typing "orders" sent four requests — "o", "or",
 * "ord", "orders" — and each answer threw away the last one. On a
 * project with thousands of endpoints that is four scans of the list
 * for one word.
 *
 * Now the **draft** is local: the letter appears in the field
 * immediately, because waiting for a round trip to show a letter is
 * how an app feels broken. The **request** waits a quarter of a
 * second, and only the last one goes.
 */
@Component({
  selector: "tanit-endpoint-filters",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./filters.component.html",
  styleUrls: ["./filters.component.scss"],
})
export class FiltersComponent {
  readonly value = input<EndpointQuery>({});
  readonly changed = output<EndpointQuery>();
  readonly transports = ENDPOINT_TRANSPORTS;
  readonly confidences = ENDPOINT_CONFIDENCES;

  /**
   * What the fields show right now.
   *
   * It is local on purpose: a letter typed in a field appears there
   * without waiting for the backend, and the backend is asked once
   * the word is finished.
   */
  readonly draft = signal<EndpointQuery>({});

  /**
   * The delayed request.
   *
   * It is created once: a debounce that was rebuilt on every change
   * would never fire, because each new one would clear the previous
   * one's timer.
   */
  private readonly ask = debounce((query: EndpointQuery) => {
    this.changed.emit(query);
  }, FILTER_DEBOUNCE_MS);

  constructor() {
    // When the parent sets a new query — from the URL, or after
    // clearing — the draft follows it.
    effect(() => {
      const query = this.value();
      this.draft.set(query);
    });
  }

  /**
   * A field the user typed in.
   *
   * The draft changes at once; the request waits.
   */
  type(partial: EndpointQuery): void {
    this.draft.set({ ...this.draft(), ...partial });
    this.ask(this.draft());
  }

  /**
   * A field the user picked.
   *
   * A selection is a decision, not a word being typed: it goes
   * straight out.
   */
  choose(partial: EndpointQuery): void {
    this.draft.set({ ...this.draft(), ...partial });
    this.ask.cancel();
    this.changed.emit(this.draft());
  }

  /** Empties every field. */
  clear(): void {
    this.ask.cancel();
    this.draft.set({});
    this.changed.emit({});
  }

  inputValue(event: Event): string { return (event.target as HTMLInputElement).value; }
  transportValue(event: Event): EndpointQuery["transport"] { const value = this.inputValue(event); return ENDPOINT_TRANSPORTS.includes(value as typeof ENDPOINT_TRANSPORTS[number]) ? value as EndpointQuery["transport"] : undefined; }
  confidenceValue(event: Event): EndpointConfidence | undefined { const value = this.inputValue(event); return ENDPOINT_CONFIDENCES.includes(value as EndpointConfidence) ? value as EndpointConfidence : undefined; }
}
