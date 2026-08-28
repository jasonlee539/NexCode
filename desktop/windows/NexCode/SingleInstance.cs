using System;
using System.IO;
using System.IO.Pipes;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Threading;

namespace NexCode.Desktop
{
    internal sealed class SingleInstance : IDisposable
    {
        private readonly Mutex mutex;
        private readonly string pipeName;
        private readonly CancellationTokenSource cancellation = new CancellationTokenSource();
        private Thread listener;

        internal SingleInstance()
        {
            string identity = WindowsIdentity.GetCurrent().User == null
                ? Environment.UserName
                : WindowsIdentity.GetCurrent().User.Value;
            string suffix = Hash(identity).Substring(0, 16);
            bool created;
            mutex = new Mutex(true, "Local\\NexCode.Desktop." + suffix, out created);
            IsPrimary = created;
            pipeName = "NexCode.Desktop." + suffix;
        }

        internal bool IsPrimary { get; private set; }
        internal event Action<string> MessageReceived;

        internal void StartListening()
        {
            if (!IsPrimary || listener != null) return;
            listener = new Thread(ListenLoop);
            listener.IsBackground = true;
            listener.Name = "NexCode activation listener";
            listener.Start();
        }

        internal void Send(string message)
        {
            if (IsPrimary) return;
            try
            {
                using (NamedPipeClientStream client = new NamedPipeClientStream(
                    ".", pipeName, PipeDirection.Out, PipeOptions.None))
                {
                    client.Connect(2500);
                    using (StreamWriter writer = new StreamWriter(client, new UTF8Encoding(false)))
                    {
                        writer.AutoFlush = true;
                        writer.WriteLine(message ?? "show");
                    }
                }
            }
            catch (IOException) { }
            catch (TimeoutException) { }
            catch (UnauthorizedAccessException) { }
        }

        private void ListenLoop()
        {
            while (!cancellation.IsCancellationRequested)
            {
                try
                {
                    using (NamedPipeServerStream server = new NamedPipeServerStream(
                        pipeName,
                        PipeDirection.In,
                        1,
                        PipeTransmissionMode.Byte,
                        PipeOptions.None))
                    {
                        server.WaitForConnection();
                        using (StreamReader reader = new StreamReader(server, Encoding.UTF8, false, 1024, true))
                        {
                            string message = reader.ReadLine();
                            if (!string.IsNullOrWhiteSpace(message))
                            {
                                Action<string> handler = MessageReceived;
                                if (handler != null) handler(message);
                            }
                        }
                    }
                }
                catch (IOException)
                {
                    if (!cancellation.IsCancellationRequested) Thread.Sleep(120);
                }
                catch (UnauthorizedAccessException)
                {
                    if (!cancellation.IsCancellationRequested) Thread.Sleep(500);
                }
            }
        }

        private static string Hash(string value)
        {
            using (SHA256 sha = SHA256.Create())
            {
                byte[] bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(value ?? "nexcode"));
                StringBuilder builder = new StringBuilder(bytes.Length * 2);
                foreach (byte item in bytes) builder.Append(item.ToString("x2"));
                return builder.ToString();
            }
        }

        public void Dispose()
        {
            cancellation.Cancel();
            if (IsPrimary)
            {
                try
                {
                    using (NamedPipeClientStream wake = new NamedPipeClientStream(
                        ".", pipeName, PipeDirection.Out, PipeOptions.None))
                    {
                        wake.Connect(150);
                    }
                }
                catch { }
                try { mutex.ReleaseMutex(); } catch (ApplicationException) { }
            }
            mutex.Dispose();
            cancellation.Dispose();
        }
    }
}
