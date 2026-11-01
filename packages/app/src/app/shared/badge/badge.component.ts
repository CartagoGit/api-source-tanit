import { ChangeDetectionStrategy, Component } from "@angular/core";

@Component({
  selector: "tanit-badge",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./badge.component.html",
  styleUrls: ["./badge.component.scss"],
})
export class BadgeComponent {}
