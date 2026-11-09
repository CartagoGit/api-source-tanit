/**
 * The Angular testing environment, for the app's tests.
 *
 * ## Why it exists
 *
 * The app's clients take their connector through `inject()`, which is
 * the only way Angular can build them — and also the only way they
 * can be built **outside** an injection context, which is a
 * contradiction unless the test environment is initialized.
 *
 * It was not, so the app's tests could not construct a client at all:
 * they tested the pieces that did not need one. The clients that
 * talk to the backend — the ones where the fiction used to live —
 * were the ones with no test.
 *
 * So this file initializes the environment once, and the app's tests
 * can build the real thing with a fake connector inside it.
 */
import "zone.js";
import "zone.js/testing";

import { getTestBed } from "@angular/core/testing";
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";

getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting(), {
  teardown: { destroyAfterEach: true },
});
