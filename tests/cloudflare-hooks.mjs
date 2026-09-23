// vinext's server bundle statically imports "cloudflare:workers" (a runtime
// module only available inside Cloudflare Workers). These tests import the
// bundle in plain Node, so map that specifier to an empty stub.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") {
    return { url: "data:text/javascript,export default {}", shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
