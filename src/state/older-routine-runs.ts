import { useEffect } from "react";

import { api, useStore } from "./store";

/** Loads the runs scheduled from `start` up to where the app's window begins, once a view shows dates before it. */
export function useRoutineRunsFrom(start: number): void {
  const { state, dispatch } = useStore();
  const since = state.routineRunsSince;
  useEffect(() => {
    if (since === null || start >= since) return;
    let live = true;
    api(`/api/routines?from=${start}&to=${since}`)
      .then(({ runs }) => { if (live && Array.isArray(runs)) dispatch({ type: "routineRunsLoaded", runs, from: start, to: since }); })
      .catch(() => {});
    return () => { live = false; };
  }, [start, since, dispatch]);
}
