// The image pull and build commands for each container runtime.
import type { Runtime } from "./container-computer.ts";

/**
 * Docker 29's legacy builder, which it still uses when it can't find the buildx plugin or `DOCKER_BUILDKIT=0` is set,
 * keeps a step's stopped container when the build fails or the client goes away during the commit. Only `--force-rm`
 * removes it. BuildKit accepts the flag and leaves no containers. Apple's `container build` has no such flag and
 * builds with BuildKit.
 */
export function imageBuildArgs(runtime: Runtime, tag: string, context: string): string[] {
  return runtime === "container" ? ["build", "-t", tag, context] : ["build", "--force-rm", "-t", tag, context];
}

export function imagePullArgs(runtime: Runtime, image: string): string[] {
  return runtime === "container" ? ["image", "pull", image] : ["pull", image];
}
