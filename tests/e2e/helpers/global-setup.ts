// Zeroes the sign-in budget before a run, so the number teardown prints belongs
// to this run and not to every run since the file was created.

import { resetBudget } from "./signin-budget";

export default function globalSetup(): void {
  resetBudget();
}
