import type { ScreenAction } from "../domain/actions";
import type { SampleTask } from "../domain/task";
import type {
  Fixture,
  LegacyInput,
  LegacyState,
  Screen,
} from "../legacy/types";

/** HARBOURMASTER as the browser runs it for "take the keyboard". */
export type HandKit = {
  boot: (fixture: Fixture, now: number) => LegacyState;
  step: (state: LegacyState, input: LegacyInput, now: number) => LegacyState;
  render: (state: LegacyState, now: number) => Screen;
  screenHtml: (screen: Screen) => string;
  terminalCss: string;
  inputsOf: (action: ScreenAction) => LegacyInput[];
  sampleTask: (id: string) => SampleTask | undefined;
};

let loading: Promise<HandKit> | null = null;

/**
 * Loads the legacy machine, its renderer and the sample Tasks, once. Only
 * hand mode needs them, so they stay out of the page's first download; call
 * it on hover or focus to have them ready by the click.
 */
export function loadHandKit(): Promise<HandKit> {
  loading ??= Promise.all([
    import("../legacy/machine"),
    import("../legacy/terminal"),
    import("../legacy/input"),
    import("../domain/tasks"),
  ]).then(
    ([machine, terminal, input, tasks]): HandKit => ({
      boot: machine.boot,
      step: machine.step,
      render: machine.render,
      screenHtml: terminal.screenHtml,
      terminalCss: terminal.TERMINAL_CSS,
      inputsOf: input.inputsOf,
      sampleTask: tasks.sampleTask,
    }),
    (error: unknown) => {
      loading = null;
      throw error;
    },
  );
  return loading;
}
