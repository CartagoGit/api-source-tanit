import { ChangeDetectionStrategy, Component } from "@angular/core";

@Component({
  selector: "tanit-empty-state",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./empty-state.component.html",
  styleUrls: ["./empty-state.component.scss"],
})
export class EmptyStateComponent {}
