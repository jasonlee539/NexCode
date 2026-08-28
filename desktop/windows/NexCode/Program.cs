using System;
using System.Linq;
using System.Windows.Forms;

namespace NexCode.Desktop
{
    internal static class Program
    {
        [STAThread]
        private static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            string launchMessage = ParseLaunchMessage(args);
            using (SingleInstance instance = new SingleInstance())
            {
                if (!instance.IsPrimary)
                {
                    instance.Send(launchMessage ?? "show");
                    return;
                }

                if (string.Equals(launchMessage, "shutdown", StringComparison.Ordinal))
                {
                    return;
                }

                using (MainForm form = new MainForm())
                {
                    instance.MessageReceived += delegate(string message)
                    {
                        if (!form.IsDisposed)
                        {
                            form.BeginInvoke(new Action(delegate { form.HandleInstanceMessage(message); }));
                        }
                    };
                    instance.StartListening();
                    if (!string.IsNullOrEmpty(launchMessage))
                    {
                        form.QueueInitialMessage(launchMessage);
                    }
                    Application.Run(form);
                }
            }
        }

        private static string ParseLaunchMessage(string[] args)
        {
            if (args.Any(argument => string.Equals(argument, "--shutdown", StringComparison.OrdinalIgnoreCase)))
            {
                return "shutdown";
            }

            string uri = args.FirstOrDefault(argument =>
                argument.StartsWith("nexcode://", StringComparison.OrdinalIgnoreCase));
            return uri == null ? null : "oauth:" + uri;
        }
    }
}
