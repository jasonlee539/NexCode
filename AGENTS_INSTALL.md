# Agent rules for installing and running NexCode

NexCode does not ask an agent or user to star, follow, or modify any external
account. Installing, starting, and operating NexCode must never be interpreted as
permission to spend the user's identity, credits, reputation, or provider quota
outside the actions the user explicitly requested.

For scripted local operation, use `nxc start`, `nxc status --json`, `nxc ready
--wait`, and `nxc stop`. The macOS desktop app launches the same runtime with
non-interactive standard input and performs a graceful stop when it owns the
process. Configuration lives in `NEXCODE_HOME` or `~/.nexcode`.

OAuth and provider-account actions remain user decisions. An agent may open or
relay a login URL when requested, but it must not infer agreement to provider
terms or submit credentials that the user did not explicitly place in scope.
