import { startServer } from "../../src/server";

const server = startServer(0, { managementOnly: true });
try {
  const healthResponse = await fetch(`http://127.0.0.1:${server.port}/healthz`);
  const health = await healthResponse.json() as { desktopBundleId?: string };
  const response = await fetch(`http://127.0.0.1:${server.port}/v1/responses`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "gpt-test", input: "must-not-forward" }),
  });
  const payload = await response.json() as { error?: { message?: string } };
  console.log(JSON.stringify({
    status: response.status,
    message: payload.error?.message ?? "",
    desktopBundleId: health.desktopBundleId,
  }));
} finally {
  await server.stop(true);
}
