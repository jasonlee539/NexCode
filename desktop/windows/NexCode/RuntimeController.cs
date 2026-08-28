using System;
using System.Collections.Generic;
using System.Collections.Specialized;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace NexCode.Desktop
{
    internal sealed class RuntimeController : IDisposable
    {
        private readonly object gate = new object();
        private readonly StringBuilder logTail = new StringBuilder();
        private Process process;
        private int generation;
        private int failedGeneration = -1;
        private bool stopping;
        private bool disposed;

        internal event Action<Uri> Ready;
        internal event Action<string> Failed;

        internal void Start()
        {
            int currentGeneration;
            lock (gate)
            {
                if (disposed) return;
                generation++;
                currentGeneration = generation;
                failedGeneration = -1;
                stopping = false;
                logTail.Clear();
            }
            Task.Run(delegate { StartCore(currentGeneration); });
        }

        internal async Task RestartAsync()
        {
            await StopAsync().ConfigureAwait(false);
            Start();
        }

        internal Task StopAsync()
        {
            int currentGeneration;
            Process child;
            lock (gate)
            {
                if (disposed) return Task.FromResult(0);
                generation++;
                currentGeneration = generation;
                stopping = true;
                child = process;
            }
            return Task.Run(delegate { StopCore(currentGeneration, child); });
        }

        private void StartCore(int currentGeneration)
        {
            Uri existing = WaitForHealthyRuntime(TimeSpan.FromSeconds(1.2), currentGeneration);
            if (existing != null)
            {
                DeliverReady(currentGeneration, existing);
                return;
            }

            string runtimeRoot;
            string bunPath;
            string cliPath;
            if (!TryResolveBundledRuntime(out runtimeRoot, out bunPath, out cliPath))
            {
                DeliverFailure(currentGeneration, "NexCode 运行时不完整，请重新安装或重新构建应用。");
                return;
            }

            Process child = new Process();
            child.StartInfo = CreateRuntimeStartInfo(runtimeRoot, bunPath, cliPath, "start");
            child.EnableRaisingEvents = true;
            child.OutputDataReceived += CaptureOutput;
            child.ErrorDataReceived += CaptureOutput;
            child.Exited += delegate
            {
                int exitCode = -1;
                try { exitCode = child.ExitCode; } catch { }
                HandleUnexpectedExit(currentGeneration, child, exitCode);
            };

            try
            {
                if (!child.Start()) throw new InvalidOperationException("The runtime process did not start.");
                child.BeginOutputReadLine();
                child.BeginErrorReadLine();
            }
            catch (Exception error)
            {
                child.Dispose();
                DeliverFailure(currentGeneration, "无法启动 NexCode 运行时：" + error.Message);
                return;
            }

            lock (gate)
            {
                if (!IsCurrentLocked(currentGeneration))
                {
                    TryTerminate(child);
                    child.Dispose();
                    return;
                }
                process = child;
            }

            Uri dashboard = WaitForHealthyRuntime(TimeSpan.FromSeconds(30), currentGeneration);
            if (dashboard != null)
            {
                DeliverReady(currentGeneration, dashboard);
                return;
            }

            bool shouldFail;
            lock (gate) shouldFail = IsCurrentLocked(currentGeneration);
            if (!shouldFail) return;
            TryTerminate(child);
            string detail = CurrentLogTail();
            string suffix = string.IsNullOrWhiteSpace(detail) ? "" : "\r\n\r\n最近的运行日志：\r\n" + detail;
            DeliverFailure(currentGeneration, "本地代理未能在 30 秒内就绪。" + suffix);
        }

        private void StopCore(int currentGeneration, Process child)
        {
            string runtimeRoot;
            string bunPath;
            string cliPath;
            if (TryResolveBundledRuntime(out runtimeRoot, out bunPath, out cliPath))
            {
                using (Process stopper = new Process())
                {
                    stopper.StartInfo = CreateRuntimeStartInfo(runtimeRoot, bunPath, cliPath, "stop");
                    stopper.StartInfo.RedirectStandardOutput = false;
                    stopper.StartInfo.RedirectStandardError = false;
                    try
                    {
                        if (stopper.Start() && !stopper.WaitForExit(25000)) stopper.Kill();
                    }
                    catch { }
                }
            }

            if (child != null)
            {
                try
                {
                    if (!child.HasExited)
                    {
                        child.CloseMainWindow();
                        if (!child.WaitForExit(12000)) child.Kill();
                    }
                }
                catch { }
            }

            lock (gate)
            {
                if (process == child) process = null;
                if (generation == currentGeneration) stopping = true;
            }
            if (child != null) child.Dispose();
        }

        private void HandleUnexpectedExit(int currentGeneration, Process child, int exitCode)
        {
            bool shouldInspect;
            lock (gate)
            {
                if (process == child) process = null;
                shouldInspect = IsCurrentLocked(currentGeneration);
            }
            if (!shouldInspect) return;

            Task.Run(delegate
            {
                Uri replacement = WaitForHealthyRuntime(TimeSpan.FromSeconds(5), currentGeneration);
                if (replacement != null)
                {
                    DeliverReady(currentGeneration, replacement);
                    return;
                }
                string detail = CurrentLogTail();
                string suffix = string.IsNullOrWhiteSpace(detail) ? "" : "\r\n\r\n最近的运行日志：\r\n" + detail;
                DeliverFailure(currentGeneration, "NexCode 代理已退出（状态码 " + exitCode + "）。" + suffix);
            });
        }

        private ProcessStartInfo CreateRuntimeStartInfo(
            string runtimeRoot,
            string bunPath,
            string cliPath,
            string command)
        {
            ProcessStartInfo startInfo = new ProcessStartInfo();
            startInfo.FileName = bunPath;
            startInfo.Arguments = QuoteArgument(cliPath) + " " + command;
            startInfo.WorkingDirectory = runtimeRoot;
            startInfo.UseShellExecute = false;
            startInfo.CreateNoWindow = true;
            startInfo.WindowStyle = ProcessWindowStyle.Hidden;
            startInfo.RedirectStandardInput = false;
            startInfo.RedirectStandardOutput = true;
            startInfo.RedirectStandardError = true;
            startInfo.EnvironmentVariables["NEXCODE_DESKTOP_APP"] = "1";
            startInfo.EnvironmentVariables["NXC_BUN_RUNTIME_SOURCE"] = "bundled";
            startInfo.EnvironmentVariables["NXC_BUN_RUNTIME_PATH"] = bunPath;
            startInfo.EnvironmentVariables["PATH"] = BuildDesktopPath(
                startInfo.EnvironmentVariables["PATH"],
                Path.GetDirectoryName(bunPath));
            AppendLoopbackBypass(startInfo.EnvironmentVariables, "NO_PROXY");
            AppendLoopbackBypass(startInfo.EnvironmentVariables, "no_proxy");
            return startInfo;
        }

        private static string QuoteArgument(string value)
        {
            return "\"" + value.Replace("\"", "\\\"") + "\"";
        }

        private static string BuildDesktopPath(string inherited, string bunDirectory)
        {
            List<string> paths = new List<string>();
            AddUniquePath(paths, bunDirectory);
            AddUniquePath(paths, Environment.GetFolderPath(Environment.SpecialFolder.System));
            AddUniquePath(paths, Environment.GetEnvironmentVariable("SystemRoot"));
            foreach (string path in (inherited ?? "").Split(Path.PathSeparator)) AddUniquePath(paths, path);
            return string.Join(Path.PathSeparator.ToString(), paths.ToArray());
        }

        private static void AddUniquePath(List<string> paths, string value)
        {
            if (string.IsNullOrWhiteSpace(value)) return;
            string trimmed = value.Trim();
            if (!paths.Exists(item => string.Equals(item, trimmed, StringComparison.OrdinalIgnoreCase)))
            {
                paths.Add(trimmed);
            }
        }

        private static void AppendLoopbackBypass(StringDictionary environment, string key)
        {
            List<string> values = new List<string>();
            string current = environment[key] ?? "";
            foreach (string part in current.Split(','))
            {
                string value = part.Trim();
                if (!string.IsNullOrEmpty(value)) values.Add(value);
            }
            foreach (string required in new[] { "localhost", "127.0.0.1", "::1" })
            {
                if (!values.Exists(item => string.Equals(item, required, StringComparison.OrdinalIgnoreCase)))
                {
                    values.Add(required);
                }
            }
            environment[key] = string.Join(",", values.ToArray());
        }

        private bool TryResolveBundledRuntime(out string root, out string bun, out string cli)
        {
            root = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "runtime");
            bun = Path.Combine(root, "bin", "bun.exe");
            cli = Path.Combine(root, "src", "cli", "index.ts");
            return File.Exists(bun) && File.Exists(cli);
        }

        private Uri WaitForHealthyRuntime(TimeSpan timeout, int currentGeneration)
        {
            DateTime deadline = DateTime.UtcNow.Add(timeout);
            do
            {
                lock (gate)
                {
                    if (!IsCurrentLocked(currentGeneration)) return null;
                }
                foreach (Uri candidate in RuntimeCandidates())
                {
                    if (HealthCheck(candidate)) return candidate;
                }
                Thread.Sleep(180);
            } while (DateTime.UtcNow < deadline);
            return null;
        }

        private IEnumerable<Uri> RuntimeCandidates()
        {
            List<Uri> candidates = new List<Uri>();
            string configDirectory = ConfigDirectory();
            JavaScriptSerializer json = new JavaScriptSerializer();
            try
            {
                string recordPath = Path.Combine(configDirectory, "runtime-port.json");
                if (File.Exists(recordPath))
                {
                    Dictionary<string, object> record = json.Deserialize<Dictionary<string, object>>(File.ReadAllText(recordPath));
                    int port = JsonPort(record, "port", 0);
                    if (port > 0) candidates.Add(DashboardUri(JsonString(record, "hostname"), port));
                }
            }
            catch { }

            int configuredPort = 10100;
            string configuredHost = null;
            try
            {
                string configPath = Path.Combine(configDirectory, "config.json");
                if (File.Exists(configPath))
                {
                    Dictionary<string, object> config = json.Deserialize<Dictionary<string, object>>(File.ReadAllText(configPath));
                    configuredPort = JsonPort(config, "port", configuredPort);
                    configuredHost = JsonString(config, "hostname");
                }
            }
            catch { }

            Uri configured = DashboardUri(configuredHost, configuredPort);
            if (!candidates.Exists(item => item.Port == configured.Port)) candidates.Add(configured);
            return candidates;
        }

        private static int JsonPort(Dictionary<string, object> value, string key, int fallback)
        {
            object raw;
            if (!value.TryGetValue(key, out raw) || raw == null) return fallback;
            int port;
            return int.TryParse(Convert.ToString(raw), out port) && port >= 1 && port <= 65535 ? port : fallback;
        }

        private static string JsonString(Dictionary<string, object> value, string key)
        {
            object raw;
            return value.TryGetValue(key, out raw) && raw != null ? Convert.ToString(raw) : null;
        }

        private static Uri DashboardUri(string hostname, int port)
        {
            string host = (hostname ?? "").Trim();
            if (host.Length == 0 || host == "0.0.0.0" || host == "::" || host == "[::]") host = "127.0.0.1";
            if (host.IndexOf(':') >= 0 && !host.StartsWith("[", StringComparison.Ordinal)) host = "[" + host + "]";
            return new Uri("http://" + host + ":" + port + "/", UriKind.Absolute);
        }

        private static string ConfigDirectory()
        {
            string configured = Environment.GetEnvironmentVariable("NEXCODE_HOME");
            if (!string.IsNullOrWhiteSpace(configured))
            {
                string expanded = Environment.ExpandEnvironmentVariables(configured.Trim());
                if (expanded == "~") return Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
                if (expanded.StartsWith("~\\", StringComparison.Ordinal) || expanded.StartsWith("~/", StringComparison.Ordinal))
                {
                    return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), expanded.Substring(2));
                }
                return Path.GetFullPath(expanded);
            }
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".nexcode");
        }

        private static bool HealthCheck(Uri dashboard)
        {
            try
            {
                Uri health = new Uri(dashboard, "healthz");
                HttpWebRequest request = (HttpWebRequest)WebRequest.Create(health);
                request.Method = "GET";
                request.Proxy = null;
                request.Timeout = 900;
                request.ReadWriteTimeout = 900;
                request.UserAgent = "NexCode/1.0 Windows";
                using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                using (StreamReader reader = new StreamReader(response.GetResponseStream()))
                {
                    if (response.StatusCode != HttpStatusCode.OK) return false;
                    JavaScriptSerializer json = new JavaScriptSerializer();
                    Dictionary<string, object> body = json.Deserialize<Dictionary<string, object>>(reader.ReadToEnd());
                    return string.Equals(JsonString(body, "service"), "nexcode", StringComparison.OrdinalIgnoreCase)
                        && string.Equals(JsonString(body, "status"), "ok", StringComparison.Ordinal);
                }
            }
            catch { return false; }
        }

        private void CaptureOutput(object sender, DataReceivedEventArgs args)
        {
            if (string.IsNullOrEmpty(args.Data)) return;
            lock (gate)
            {
                logTail.AppendLine(args.Data);
                if (logTail.Length > 6000) logTail.Remove(0, logTail.Length - 6000);
            }
        }

        private string CurrentLogTail()
        {
            lock (gate) return logTail.ToString().Trim();
        }

        private bool IsCurrentLocked(int currentGeneration)
        {
            return !disposed && !stopping && generation == currentGeneration;
        }

        private void DeliverReady(int currentGeneration, Uri value)
        {
            Action<Uri> handler;
            lock (gate)
            {
                if (!IsCurrentLocked(currentGeneration)) return;
                handler = Ready;
            }
            if (handler != null) handler(value);
        }

        private void DeliverFailure(int currentGeneration, string message)
        {
            Action<string> handler;
            lock (gate)
            {
                if (!IsCurrentLocked(currentGeneration) || failedGeneration == currentGeneration) return;
                failedGeneration = currentGeneration;
                handler = Failed;
            }
            if (handler != null) handler(message);
        }

        private static void TryTerminate(Process child)
        {
            try
            {
                if (!child.HasExited)
                {
                    child.CloseMainWindow();
                    if (!child.WaitForExit(1200)) child.Kill();
                }
            }
            catch { }
        }

        public void Dispose()
        {
            Process child;
            lock (gate)
            {
                if (disposed) return;
                disposed = true;
                generation++;
                stopping = true;
                child = process;
                process = null;
            }
            TryTerminate(child);
            if (child != null) child.Dispose();
        }
    }
}
