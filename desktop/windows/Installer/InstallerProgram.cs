using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;

namespace NexCode.Installer
{
    internal static class InstallerProgram
    {
        private const string ProductVersion = "1.0.0";
        private const string PayloadResource = "NexCodePayload.zip";
        private const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\NexCode";
        private const string ProtocolKey = @"Software\Classes\nexcode";
        private const uint MoveFileDelayUntilReboot = 0x4;

        [STAThread]
        private static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            if (args.Any(value => string.Equals(value, "/uninstall", StringComparison.OrdinalIgnoreCase)))
            {
                BeginDetachedUninstall();
                return;
            }

            int copyIndex = Array.FindIndex(args, value => string.Equals(value, "/uninstall-copy", StringComparison.OrdinalIgnoreCase));
            if (copyIndex >= 0)
            {
                RunUninstallCopy(copyIndex + 1 < args.Length ? args[copyIndex + 1] : null);
                return;
            }

            bool silent = args.Any(value => string.Equals(value, "/silent", StringComparison.OrdinalIgnoreCase));
            if (silent)
            {
                try { Install(null); }
                catch (Exception error)
                {
                    MessageBox.Show(error.Message, "NexCode 安装失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    Environment.ExitCode = 1;
                }
                return;
            }

            Application.Run(new InstallerForm());
        }

        internal static string InstallDirectory
        {
            get
            {
                return Path.GetFullPath(Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "Programs",
                    "NexCode"));
            }
        }

        internal static void Install(Action<string> report)
        {
            string target = InstallDirectory;
            string parent = Path.GetDirectoryName(target);
            Directory.CreateDirectory(parent);
            string stage = Path.Combine(parent, ".NexCode.install." + Guid.NewGuid().ToString("N"));
            string backup = Path.Combine(parent, ".NexCode.previous." + Guid.NewGuid().ToString("N"));

            try
            {
                if (report != null) report("正在解压 NexCode…");
                Directory.CreateDirectory(stage);
                ExtractPayload(stage);
                ValidatePayload(stage);

                if (Directory.Exists(target))
                {
                    if (report != null) report("正在安全关闭现有版本…");
                    RequestShutdown(target);
                    Directory.Move(target, backup);
                }

                Directory.Move(stage, target);
                try
                {
                    string installedInstaller = Path.Combine(target, "NexCodeInstaller.exe");
                    string currentInstaller = Path.GetFullPath(Application.ExecutablePath);
                    if (!string.Equals(currentInstaller, installedInstaller, StringComparison.OrdinalIgnoreCase))
                    {
                        File.Copy(currentInstaller, installedInstaller, true);
                    }

                    if (report != null) report("正在注册快捷方式与 OAuth 回调…");
                    RegisterProduct(target);
                }
                catch
                {
                    if (Directory.Exists(target)) Directory.Delete(target, true);
                    if (Directory.Exists(backup)) Directory.Move(backup, target);
                    throw;
                }

                if (Directory.Exists(backup)) Directory.Delete(backup, true);
                if (report != null) report("安装完成，正在启动 NexCode…");
                Process.Start(new ProcessStartInfo(Path.Combine(target, "NexCode.exe"))
                {
                    WorkingDirectory = target,
                    UseShellExecute = true
                });
            }
            finally
            {
                if (Directory.Exists(stage)) Directory.Delete(stage, true);
            }
        }

        private static void ExtractPayload(string destination)
        {
            Stream payload = Assembly.GetExecutingAssembly().GetManifestResourceStream(PayloadResource);
            if (payload == null) throw new InvalidDataException("安装包缺少 NexCode 运行时载荷。");
            using (payload)
            using (ZipArchive archive = new ZipArchive(payload, ZipArchiveMode.Read, false))
            {
                string root = Path.GetFullPath(destination) + Path.DirectorySeparatorChar;
                foreach (ZipArchiveEntry entry in archive.Entries)
                {
                    string normalized = entry.FullName.Replace('/', Path.DirectorySeparatorChar);
                    string output = Path.GetFullPath(Path.Combine(destination, normalized));
                    if (!output.StartsWith(root, StringComparison.OrdinalIgnoreCase))
                    {
                        throw new InvalidDataException("安装包包含无效路径。");
                    }
                    if (string.IsNullOrEmpty(entry.Name))
                    {
                        Directory.CreateDirectory(output);
                        continue;
                    }
                    Directory.CreateDirectory(Path.GetDirectoryName(output));
                    entry.ExtractToFile(output, true);
                }
            }
        }

        private static void ValidatePayload(string stage)
        {
            string[] required =
            {
                Path.Combine(stage, "NexCode.exe"),
                Path.Combine(stage, "Microsoft.Web.WebView2.Core.dll"),
                Path.Combine(stage, "Microsoft.Web.WebView2.WinForms.dll"),
                Path.Combine(stage, "runtime", "bin", "bun.exe"),
                Path.Combine(stage, "runtime", "src", "cli", "index.ts"),
                Path.Combine(stage, "runtime", "gui", "dist", "index.html")
            };
            if (required.Any(path => !File.Exists(path)))
            {
                throw new InvalidDataException("安装包运行时不完整，请重新下载。");
            }
        }

        private static void RegisterProduct(string target)
        {
            string executable = Path.Combine(target, "NexCode.exe");
            string installer = Path.Combine(target, "NexCodeInstaller.exe");
            string icon = executable + ",0";

            using (RegistryKey protocol = Registry.CurrentUser.CreateSubKey(ProtocolKey))
            {
                protocol.SetValue(null, "URL:NexCode OAuth callback");
                protocol.SetValue("URL Protocol", "");
                using (RegistryKey defaultIcon = protocol.CreateSubKey("DefaultIcon"))
                {
                    defaultIcon.SetValue(null, icon);
                }
                using (RegistryKey command = protocol.CreateSubKey(@"shell\open\command"))
                {
                    command.SetValue(null, Quote(executable) + " \"%1\"");
                }
            }

            string startMenu = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.StartMenu),
                "Programs",
                "NexCode.lnk");
            string desktop = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
                "NexCode.lnk");
            CreateShortcut(startMenu, executable, target, icon);
            CreateShortcut(desktop, executable, target, icon);

            using (RegistryKey uninstall = Registry.CurrentUser.CreateSubKey(UninstallKey))
            {
                uninstall.SetValue("DisplayName", "NexCode");
                uninstall.SetValue("DisplayVersion", ProductVersion);
                uninstall.SetValue("Publisher", "NexCode contributors");
                uninstall.SetValue("DisplayIcon", icon);
                uninstall.SetValue("InstallLocation", target);
                uninstall.SetValue("UninstallString", Quote(installer) + " /uninstall");
                uninstall.SetValue("QuietUninstallString", Quote(installer) + " /uninstall");
                uninstall.SetValue("NoModify", 1, RegistryValueKind.DWord);
                uninstall.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            }
        }

        private static void CreateShortcut(string shortcutPath, string executable, string workingDirectory, string icon)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(shortcutPath));
            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType == null) throw new InvalidOperationException("Windows 快捷方式组件不可用。");
            object shell = Activator.CreateInstance(shellType);
            try
            {
                object shortcut = shellType.InvokeMember(
                    "CreateShortcut",
                    BindingFlags.InvokeMethod,
                    null,
                    shell,
                    new object[] { shortcutPath });
                try
                {
                    Type type = shortcut.GetType();
                    type.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] { executable });
                    type.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, shortcut, new object[] { workingDirectory });
                    type.InvokeMember("IconLocation", BindingFlags.SetProperty, null, shortcut, new object[] { icon });
                    type.InvokeMember("Description", BindingFlags.SetProperty, null, shortcut, new object[] { "NexCode local AI routing workspace" });
                    type.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, null);
                }
                finally
                {
                    if (shortcut != null && Marshal.IsComObject(shortcut)) Marshal.FinalReleaseComObject(shortcut);
                }
            }
            finally
            {
                if (shell != null && Marshal.IsComObject(shell)) Marshal.FinalReleaseComObject(shell);
            }
        }

        private static void RequestShutdown(string target)
        {
            string executable = Path.Combine(target, "NexCode.exe");
            if (File.Exists(executable))
            {
                try
                {
                    using (Process request = Process.Start(new ProcessStartInfo(executable, "--shutdown")
                    {
                        WorkingDirectory = target,
                        UseShellExecute = false,
                        CreateNoWindow = true
                    }))
                    {
                        if (request != null) request.WaitForExit(3000);
                    }
                }
                catch { }
            }

            string bun = Path.Combine(target, "runtime", "bin", "bun.exe");
            string cli = Path.Combine(target, "runtime", "src", "cli", "index.ts");
            if (File.Exists(bun) && File.Exists(cli))
            {
                try
                {
                    using (Process stopper = Process.Start(new ProcessStartInfo(bun, Quote(cli) + " stop")
                    {
                        WorkingDirectory = Path.Combine(target, "runtime"),
                        UseShellExecute = false,
                        CreateNoWindow = true,
                        WindowStyle = ProcessWindowStyle.Hidden
                    }))
                    {
                        if (stopper != null && !stopper.WaitForExit(25000)) stopper.Kill();
                    }
                }
                catch { }
            }

            DateTime deadline = DateTime.UtcNow.AddSeconds(8);
            do
            {
                Process[] remaining = ProcessesFromDirectory(target).ToArray();
                if (remaining.Length == 0) return;
                foreach (Process item in remaining) item.Dispose();
                Thread.Sleep(200);
            } while (DateTime.UtcNow < deadline);

            foreach (Process item in ProcessesFromDirectory(target))
            {
                try { item.Kill(); item.WaitForExit(3000); } catch { }
                item.Dispose();
            }
        }

        private static System.Collections.Generic.IEnumerable<Process> ProcessesFromDirectory(string target)
        {
            string root = Path.GetFullPath(target).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            foreach (Process process in Process.GetProcessesByName("NexCode"))
            {
                string path = null;
                try { path = process.MainModule.FileName; } catch { }
                if (path != null && Path.GetFullPath(path).StartsWith(root, StringComparison.OrdinalIgnoreCase)) yield return process;
                else process.Dispose();
            }
        }

        private static void BeginDetachedUninstall()
        {
            string temp = Path.Combine(Path.GetTempPath(), "NexCode-uninstall-" + Guid.NewGuid().ToString("N") + ".exe");
            File.Copy(Application.ExecutablePath, temp, true);
            Process.Start(new ProcessStartInfo(temp, "/uninstall-copy " + Quote(InstallDirectory))
            {
                UseShellExecute = true,
                WorkingDirectory = Path.GetTempPath()
            });
        }

        private static void RunUninstallCopy(string requestedTarget)
        {
            string target;
            try { target = Path.GetFullPath(requestedTarget ?? ""); }
            catch
            {
                MessageBox.Show("卸载目标无效。", "NexCode", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }
            if (!string.Equals(target, InstallDirectory, StringComparison.OrdinalIgnoreCase))
            {
                MessageBox.Show("卸载目标不属于 NexCode。", "NexCode", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }
            if (MessageBox.Show("确定要卸载 NexCode？账户和路由配置将保留。", "卸载 NexCode", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes)
            {
                return;
            }

            try
            {
                RequestShutdown(target);
                RemoveRegistration(target);
                if (Directory.Exists(target)) Directory.Delete(target, true);
                MessageBox.Show("NexCode 已卸载。用户配置仍保留在 .nexcode 目录中。", "NexCode", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            catch (Exception error)
            {
                MessageBox.Show("卸载失败：" + error.Message, "NexCode", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            finally
            {
                MoveFileEx(Application.ExecutablePath, null, MoveFileDelayUntilReboot);
            }
        }

        private static void RemoveRegistration(string target)
        {
            using (RegistryKey protocol = Registry.CurrentUser.OpenSubKey(ProtocolKey))
            {
                string expected = Quote(Path.Combine(target, "NexCode.exe")) + " \"%1\"";
                string command = null;
                using (RegistryKey commandKey = Registry.CurrentUser.OpenSubKey(ProtocolKey + @"\shell\open\command"))
                {
                    if (commandKey != null) command = commandKey.GetValue(null) as string;
                }
                if (protocol != null && string.Equals(command, expected, StringComparison.OrdinalIgnoreCase))
                {
                    Registry.CurrentUser.DeleteSubKeyTree(ProtocolKey, false);
                }
            }

            using (RegistryKey uninstall = Registry.CurrentUser.OpenSubKey(UninstallKey))
            {
                string installLocation = uninstall == null ? null : uninstall.GetValue("InstallLocation") as string;
                if (string.Equals(installLocation, target, StringComparison.OrdinalIgnoreCase))
                {
                    Registry.CurrentUser.DeleteSubKeyTree(UninstallKey, false);
                }
            }

            DeleteShortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs", "NexCode.lnk"));
            DeleteShortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "NexCode.lnk"));
        }

        private static void DeleteShortcut(string path)
        {
            if (File.Exists(path)) File.Delete(path);
        }

        private static string Quote(string value)
        {
            return "\"" + value.Replace("\"", "\\\"") + "\"";
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool MoveFileEx(string existingFile, string newFile, uint flags);

        private sealed class InstallerForm : Form
        {
            private readonly Label status = new Label();
            private readonly ProgressBar progress = new ProgressBar();
            private readonly Button install = new Button();

            internal InstallerForm()
            {
                Text = "安装 NexCode";
                StartPosition = FormStartPosition.CenterScreen;
                ClientSize = new Size(520, 318);
                MinimumSize = SizeFromClientSize(ClientSize);
                MaximumSize = MinimumSize;
                MaximizeBox = false;
                try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

                PictureBox logo = new PictureBox();
                logo.Size = new Size(84, 84);
                logo.Location = new Point(218, 30);
                logo.SizeMode = PictureBoxSizeMode.Zoom;
                try { logo.Image = Icon == null ? null : Icon.ToBitmap(); } catch { }

                Label title = new Label();
                title.Text = "NexCode for Windows";
                title.Font = new Font(SystemFonts.MessageBoxFont.FontFamily, 17f, FontStyle.Bold);
                title.TextAlign = ContentAlignment.MiddleCenter;
                title.SetBounds(35, 122, 450, 40);

                Label location = new Label();
                location.Text = "将安装到：" + InstallDirectory;
                location.ForeColor = SystemColors.GrayText;
                location.TextAlign = ContentAlignment.MiddleCenter;
                location.AutoEllipsis = true;
                location.SetBounds(35, 165, 450, 28);

                status.Text = "包含与 macOS 版一致的主题、前端和本地代理功能。";
                status.TextAlign = ContentAlignment.MiddleCenter;
                status.SetBounds(35, 195, 450, 28);

                progress.Style = ProgressBarStyle.Marquee;
                progress.MarqueeAnimationSpeed = 24;
                progress.SetBounds(80, 232, 360, 6);
                progress.Visible = false;

                install.Text = Directory.Exists(InstallDirectory) ? "更新 NexCode" : "安装 NexCode";
                install.AutoSize = true;
                install.Padding = new Padding(22, 6, 22, 6);
                install.Location = new Point(190, 255);
                install.Click += InstallClicked;

                Controls.Add(logo);
                Controls.Add(title);
                Controls.Add(location);
                Controls.Add(status);
                Controls.Add(progress);
                Controls.Add(install);
            }

            private async void InstallClicked(object sender, EventArgs args)
            {
                install.Enabled = false;
                progress.Visible = true;
                try
                {
                    await Task.Run(delegate
                    {
                        Install(delegate(string message)
                        {
                            if (!IsDisposed) BeginInvoke(new Action(delegate { status.Text = message; }));
                        });
                    });
                    DialogResult = DialogResult.OK;
                    Close();
                }
                catch (Exception error)
                {
                    progress.Visible = false;
                    install.Enabled = true;
                    status.Text = "安装失败";
                    MessageBox.Show(this, error.Message, "NexCode 安装失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
            }
        }
    }
}
