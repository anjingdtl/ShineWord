/**
 * Development sink for the startup trace (convergence plan W0).
 *
 * Every recorded event is printed as one JSON line via console.log (React
 * Native routes this to logcat with the ReactNativeJS tag).
 *
 * Deliberately NOT gated on `__DEV__`: this project's distributable debug
 * APKs are built with `shinewordStandaloneDebug=true`, which empties
 * `debuggableVariants` and compiles the JS bundle with dev=false — `__DEV__`
 * is false even on QA devices. The trace payload is privacy-safe by
 * construction (enumerated event names; scalar fields only — counts,
 * durations, enum tokens; never keys, novel text, or player input), so
 * logging it in every build is safe. The ring buffer itself stays
 * in-process-only and is never persisted.
 *
 * Reading the trace on a device:
 *   adb logcat -s ReactNativeJS | grep '\[startup-trace\]'
 */
import { setStartupTraceSink } from '../../src/application/observability/startupTrace';

let installed = false;

export function installStartupTraceSink(): void {
  if (installed) return;
  installed = true;
  setStartupTraceSink(entry => {
    console.log(`[startup-trace] ${JSON.stringify(entry)}`);
  });
}
