import { NgTemplateOutlet } from "@angular/common";
import { CdkFixedSizeVirtualScroll, CdkVirtualForOf, CdkVirtualScrollViewport } from "@angular/cdk/scrolling";
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from "@angular/core";

/**
 * A list that only draws what is on screen.
 *
 * ## What was broken
 *
 * The component had an `onScroll` that **nothing called**. The
 * viewport scrolled, the range was never recomputed, and the
 * `rangeChange` output — the thing a parent would use to know which
 * page to load — never fired.
 *
 * It is wired now: the viewport listens to its own scroll, and the
 * range follows.
 *
 * ## The role
 *
 * The viewport is a `role="list"` and the rows are `role="listitem"`.
 * It used to say `listbox` while the rows said nothing at all: a
 * listbox whose options are not options is a listbox that promises
 * a keyboard interaction it does not have.
 */
@Component({
  selector: "tanit-virtual-scroller",
  standalone: true,
  imports: [NgTemplateOutlet, CdkFixedSizeVirtualScroll, CdkVirtualForOf, CdkVirtualScrollViewport],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./virtual-scroller.component.html",
  styleUrls: ["./virtual-scroller.component.scss"],
})
export class VirtualScrollerComponent<T> {
  readonly items = input<readonly T[]>([]);
  readonly itemHeight = input(64);
  readonly height = input(520);
  readonly itemTemplate = input.required<unknown>();
  readonly trackBy = input<(item: T, index: number) => string | number>((_, index) => index);
  /** What the list is about, for whoever hears it. */
  readonly label = input("Items");
  readonly rangeChange = output<{ start: number; end: number }>();
  readonly scrollTop = signal(0);

  readonly start = computed(() => Math.floor(this.scrollTop() / this.itemHeight()));
  readonly end = computed(() => Math.min(this.items().length, this.start() + Math.ceil(this.height() / this.itemHeight())));

  onScroll(event: Event): void {
    const target = event.target as HTMLElement;
    this.scrollTop.set(target.scrollTop);
    this.rangeChange.emit({ start: this.start(), end: this.end() });
  }
}
