import { NgTemplateOutlet } from "@angular/common";
import { ScrollingModule } from "@angular/cdk/scrolling";
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from "@angular/core";

@Component({
  selector: "tanit-virtual-scroller",
  standalone: true,
  imports: [NgTemplateOutlet, ScrollingModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <cdk-virtual-scroll-viewport class="viewport" [itemSize]="itemHeight()" [style.height.px]="height()" role="listbox" aria-label="Virtualized items">
      <div *cdkVirtualFor="let item of items(); let index = index; trackBy: trackBy()">
        <ng-container *ngTemplateOutlet="itemTemplate(); context: { $implicit: item, index }" />
      </div>
    </cdk-virtual-scroll-viewport>
  `,
  styles: `
    :host { display: block; min-height: 0; }
    .viewport { width: 100%; overflow: auto; contain: strict; overscroll-behavior: contain; }
  `,
})
export class VirtualScrollerComponent<T> {
  readonly items = input<readonly T[]>([]);
  readonly itemHeight = input(64);
  readonly height = input(520);
  readonly itemTemplate = input.required<unknown>();
  readonly trackBy = input<(item: T, index: number) => string | number>((_, index) => index);
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