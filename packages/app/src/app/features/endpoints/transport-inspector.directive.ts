import { Directive, ElementRef, HostListener, inject, input, output } from "@angular/core";

@Directive({ selector: "[tanitTransportInspector]", standalone: true })
export class TransportInspectorDirective {
  readonly diagnostic = input<string>();
  readonly filter = output<string>();
  private readonly element = inject(ElementRef<HTMLElement>);

  @HostListener("click") onClick(): void { if (this.diagnostic()) this.filter.emit(this.diagnostic()!); }
  @HostListener("keydown.enter") onEnter(): void { this.onClick(); }
  constructor() { this.element.nativeElement.setAttribute("tabindex", "0"); }
}