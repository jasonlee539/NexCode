using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace NexCode.Desktop
{
    internal sealed class MainForm : Form
    {
        private const string WebView2DownloadUrl = "https://developer.microsoft.com/microsoft-edge/webview2/";
        private const int MinimumClientWidth = 900;
        private const int MinimumClientHeight = 600;
        private const int PreferredClientWidth = 1600;
        private const int PreferredClientHeight = 900;
        private readonly RuntimeController runtime = new RuntimeController();
        private readonly UpdateService updates = new UpdateService();
        private readonly JavaScriptSerializer webMessageJson = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
        private readonly WebView2 webView = new WebView2();
        private readonly Panel overlay = new Panel();
        private readonly Label statusLabel = new Label();
        private readonly Label detailLabel = new Label();
        private readonly ProgressBar progress = new ProgressBar();
        private readonly Button retryButton = new Button();
        private readonly LinkLabel runtimeLink = new LinkLabel();
        private readonly NotifyIcon trayIcon = new NotifyIcon();
        private Uri pendingDashboard;
        private string initialMessage;
        private bool webViewReady;
        private bool webViewInitializing;
        private bool oauthNotificationPending;
        private bool automaticUpdateCheckStarted;
        private bool updateCheckRunning;
        private bool allowClose;
        private bool exiting;
        private bool closeHintShown;
        private bool fullScreen;
        private Rectangle restoredBounds;
        private FormBorderStyle restoredBorderStyle;
        private FormWindowState restoredWindowState;

        internal MainForm()
        {
            Text = "NexCode";
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(1280, 720);
            MinimumSize = SizeFromClientSize(new Size(MinimumClientWidth, MinimumClientHeight));
            MaximumSize = Size.Empty;
            MaximizeBox = true;
            KeyPreview = true;
            AutoScaleMode = AutoScaleMode.Dpi;
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

            ConfigureWebView();
            ConfigureOverlay();
            ConfigureTray();

            runtime.Ready += delegate(Uri dashboard) { OnUi(delegate { ShowDashboard(dashboard); }); };
            runtime.Failed += delegate(string message) { OnUi(delegate { ShowError(message, false); }); };

            Load += OnInitialLoad;
            Shown += OnFirstShown;
            FormClosing += OnFormClosing;
            KeyDown += OnWindowKeyDown;
        }

        private void OnInitialLoad(object sender, EventArgs args)
        {
            // Size in device pixels after WinForms has applied PerMonitorV2 DPI.
            // This keeps roughly the same useful CSS workspace on 1080p, 2K and
            // 4K monitors while still fitting smaller working areas and leaving
            // the window freely resizable/maximizable.
            Rectangle workingArea = Screen.FromControl(this).WorkingArea;
            double scale = Math.Max(1.0, DeviceDpi / 96.0);
            int frameWidth = Math.Max(0, Width - ClientSize.Width);
            int frameHeight = Math.Max(0, Height - ClientSize.Height);
            int margin = (int)Math.Round(48 * scale);
            int availableWidth = Math.Max(1, workingArea.Width - frameWidth - margin);
            int availableHeight = Math.Max(1, workingArea.Height - frameHeight - margin);
            int minimumWidth = Math.Min((int)Math.Round(MinimumClientWidth * scale), availableWidth);
            int minimumHeight = Math.Min((int)Math.Round(MinimumClientHeight * scale), availableHeight);
            int targetWidth = Math.Max(minimumWidth, Math.Min((int)Math.Round(PreferredClientWidth * scale), availableWidth));
            int targetHeight = Math.Max(minimumHeight, Math.Min((int)Math.Round(PreferredClientHeight * scale), availableHeight));

            MinimumSize = SizeFromClientSize(new Size(minimumWidth, minimumHeight));
            MaximumSize = Size.Empty;
            ClientSize = new Size(targetWidth, targetHeight);
            StartPosition = FormStartPosition.Manual;
            Location = new Point(
                workingArea.Left + Math.Max(0, (workingArea.Width - Width) / 2),
                workingArea.Top + Math.Max(0, (workingArea.Height - Height) / 2));
        }

        internal void QueueInitialMessage(string message)
        {
            initialMessage = message;
        }

        internal void HandleInstanceMessage(string message)
        {
            if (string.Equals(message, "shutdown", StringComparison.Ordinal))
            {
                ExitApplication();
                return;
            }

            ShowAndActivate();
            if (message != null && message.StartsWith("oauth:", StringComparison.Ordinal))
            {
                string rawUri = message.Substring("oauth:".Length);
                Uri uri;
                if (Uri.TryCreate(rawUri, UriKind.Absolute, out uri)
                    && string.Equals(uri.Scheme, "nexcode", StringComparison.OrdinalIgnoreCase)
                    && string.Equals(uri.Host, "oauth-complete", StringComparison.OrdinalIgnoreCase))
                {
                    NotifyOAuthComplete();
                }
            }
        }

        private async void OnFirstShown(object sender, EventArgs args)
        {
            ShowLoading(false);
            Task webViewTask = InitializeWebViewAsync();
            runtime.Start();
            if (!string.IsNullOrEmpty(initialMessage))
            {
                string queued = initialMessage;
                initialMessage = null;
                HandleInstanceMessage(queued);
            }
            await webViewTask;
        }

        private void ConfigureWebView()
        {
            webView.Dock = DockStyle.Fill;
            webView.Visible = false;
            webView.DefaultBackgroundColor = SystemColors.Window;
            Controls.Add(webView);
        }

        private void ConfigureOverlay()
        {
            overlay.Dock = DockStyle.Fill;
            overlay.BackColor = SystemColors.Window;

            TableLayoutPanel layout = new TableLayoutPanel();
            layout.Dock = DockStyle.Fill;
            layout.ColumnCount = 3;
            layout.RowCount = 7;
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 660));
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
            layout.RowStyles.Add(new RowStyle(SizeType.Percent, 50));
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 104));
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 48));
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 82));
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 30));
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 46));
            layout.RowStyles.Add(new RowStyle(SizeType.Percent, 50));

            PictureBox logo = new PictureBox();
            logo.Size = new Size(92, 92);
            logo.SizeMode = PictureBoxSizeMode.Zoom;
            logo.Anchor = AnchorStyles.None;
            try { logo.Image = Icon == null ? null : Icon.ToBitmap(); } catch { }

            statusLabel.Text = "正在启动 NexCode";
            statusLabel.Font = new Font(SystemFonts.MessageBoxFont.FontFamily, 18f, FontStyle.Bold);
            statusLabel.TextAlign = ContentAlignment.MiddleCenter;
            statusLabel.Dock = DockStyle.Fill;

            detailLabel.Text = "正在准备本地 AI 路由工作区…";
            detailLabel.Font = new Font(SystemFonts.MessageBoxFont.FontFamily, 10f, FontStyle.Regular);
            detailLabel.ForeColor = SystemColors.GrayText;
            detailLabel.TextAlign = ContentAlignment.TopCenter;
            detailLabel.Dock = DockStyle.Fill;
            detailLabel.AutoEllipsis = true;

            progress.Style = ProgressBarStyle.Marquee;
            progress.MarqueeAnimationSpeed = 28;
            progress.Size = new Size(180, 6);
            progress.Anchor = AnchorStyles.None;

            FlowLayoutPanel actions = new FlowLayoutPanel();
            actions.FlowDirection = FlowDirection.TopDown;
            actions.WrapContents = false;
            actions.AutoSize = true;
            actions.Anchor = AnchorStyles.None;

            retryButton.Text = "重新启动";
            retryButton.AutoSize = true;
            retryButton.Padding = new Padding(16, 4, 16, 4);
            retryButton.Click += async delegate
            {
                ShowLoading(false);
                if (!webViewReady) await InitializeWebViewAsync();
                await runtime.RestartAsync();
            };
            retryButton.Visible = false;

            runtimeLink.Text = "安装 Microsoft Edge WebView2 Runtime";
            runtimeLink.AutoSize = true;
            runtimeLink.TextAlign = ContentAlignment.MiddleCenter;
            runtimeLink.Visible = false;
            runtimeLink.LinkClicked += delegate { OpenExternal(WebView2DownloadUrl); };
            actions.Controls.Add(retryButton);
            actions.Controls.Add(runtimeLink);

            layout.Controls.Add(logo, 1, 1);
            layout.Controls.Add(statusLabel, 1, 2);
            layout.Controls.Add(detailLabel, 1, 3);
            layout.Controls.Add(progress, 1, 4);
            layout.Controls.Add(actions, 1, 5);
            overlay.Controls.Add(layout);
            Controls.Add(overlay);
            overlay.BringToFront();
        }

        private void ConfigureTray()
        {
            trayIcon.Text = "NexCode";
            trayIcon.Icon = Icon ?? SystemIcons.Application;
            trayIcon.Visible = true;
            trayIcon.DoubleClick += delegate { ShowAndActivate(); };

            ContextMenuStrip menu = new ContextMenuStrip();
            menu.Items.Add("显示 NexCode", null, delegate { ShowAndActivate(); });
            menu.Items.Add("重新载入", null, delegate { ReloadDashboard(); });
            menu.Items.Add("检查更新", null, delegate { BeginUpdateCheck(true); });
            menu.Items.Add("重启管理服务", null, async delegate
            {
                ShowAndActivate();
                ShowLoading(false);
                await runtime.RestartAsync();
            });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("完全退出 NexCode", null, delegate { ExitApplication(); });
            trayIcon.ContextMenuStrip = menu;
        }

        private async Task InitializeWebViewAsync()
        {
            if (webViewReady || webViewInitializing) return;
            webViewInitializing = true;
            try
            {
                string userData = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "NexCode",
                    "WebView2");
                Directory.CreateDirectory(userData);
                CoreWebView2Environment environment = await CoreWebView2Environment.CreateAsync(null, userData);
                await webView.EnsureCoreWebView2Async(environment);

                CoreWebView2Settings settings = webView.CoreWebView2.Settings;
                settings.IsScriptEnabled = true;
                settings.IsWebMessageEnabled = true;
                settings.AreDefaultScriptDialogsEnabled = true;
                settings.IsStatusBarEnabled = false;
                // WebView2 persists zoom per origin in its user-data directory. A
                // stray Ctrl+wheel therefore used to resize and reflow every card on
                // later launches. NexCode is a fixed-size native surface, so always
                // render its dashboard at the CSS size it was designed for.
                settings.IsZoomControlEnabled = false;
                webView.ZoomFactor = 1.0;
                settings.AreDevToolsEnabled = false;
                settings.UserAgent = settings.UserAgent + " NexCode/1.0";

                webView.CoreWebView2.NavigationStarting += OnNavigationStarting;
                webView.CoreWebView2.NavigationCompleted += OnNavigationCompleted;
                webView.CoreWebView2.NewWindowRequested += OnNewWindowRequested;
                webView.CoreWebView2.DownloadStarting += OnDownloadStarting;
                webView.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
                webViewReady = true;
                runtimeLink.Visible = false;

                if (pendingDashboard != null)
                {
                    Uri dashboard = pendingDashboard;
                    pendingDashboard = null;
                    ShowDashboard(dashboard);
                }
            }
            catch (Exception error)
            {
                string detail = error is WebView2RuntimeNotFoundException
                    ? "未检测到 Microsoft Edge WebView2 Runtime。安装后即可使用与 macOS 版一致的桌面界面。"
                    : "Windows WebView2 初始化失败：" + error.Message;
                ShowError(detail, true);
            }
            finally
            {
                webViewInitializing = false;
            }
        }

        private void ShowLoading(bool stopping)
        {
            statusLabel.Text = stopping ? "正在安全退出 NexCode" : "正在启动 NexCode";
            detailLabel.Text = stopping ? "正在关闭 NexCode 管理服务…" : "正在准备 NexCode 管理工作区…";
            retryButton.Visible = false;
            runtimeLink.Visible = false;
            progress.Visible = true;
            progress.Style = ProgressBarStyle.Marquee;
            overlay.Visible = true;
            overlay.BringToFront();
            webView.Visible = false;
        }

        private void ShowDashboard(Uri dashboard)
        {
            if (!webViewReady)
            {
                pendingDashboard = dashboard;
                return;
            }
            statusLabel.Text = "正在载入 NexCode";
            detailLabel.Text = "正在打开桌面工作区…";
            retryButton.Visible = false;
            runtimeLink.Visible = false;
            progress.Visible = true;
            overlay.Visible = true;
            overlay.BringToFront();
            webView.Visible = true;
            webView.ZoomFactor = 1.0;
            webView.CoreWebView2.Navigate(dashboard.AbsoluteUri);
        }

        private void ShowError(string message, bool showRuntimeLink)
        {
            progress.Visible = false;
            statusLabel.Text = "NexCode 未能启动";
            detailLabel.Text = message;
            retryButton.Visible = true;
            runtimeLink.Visible = showRuntimeLink;
            overlay.Visible = true;
            overlay.BringToFront();
            webView.Visible = false;
        }

        private void OnNavigationStarting(object sender, CoreWebView2NavigationStartingEventArgs args)
        {
            Uri uri;
            if (!Uri.TryCreate(args.Uri, UriKind.Absolute, out uri)) return;
            if (string.Equals(uri.Scheme, "nexcode", StringComparison.OrdinalIgnoreCase))
            {
                args.Cancel = true;
                HandleInstanceMessage("oauth:" + uri.AbsoluteUri);
                return;
            }
            if (ShouldOpenExternally(uri))
            {
                args.Cancel = true;
                OpenExternal(uri.AbsoluteUri);
            }
        }

        private void OnNavigationCompleted(object sender, CoreWebView2NavigationCompletedEventArgs args)
        {
            if (!args.IsSuccess)
            {
                ShowError("无法连接本地 NexCode（" + args.WebErrorStatus + "）。", false);
                return;
            }
            overlay.Visible = false;
            webView.ZoomFactor = 1.0;
            webView.Visible = true;
            Text = "NexCode";
            if (oauthNotificationPending) NotifyOAuthComplete();
            if (!automaticUpdateCheckStarted && updates.IsInstalled)
            {
                automaticUpdateCheckStarted = true;
                BeginUpdateCheck(false);
            }
        }

        private void OnNewWindowRequested(object sender, CoreWebView2NewWindowRequestedEventArgs args)
        {
            args.Handled = true;
            Uri uri;
            if (!Uri.TryCreate(args.Uri, UriKind.Absolute, out uri)) return;
            if (ShouldOpenExternally(uri)) OpenExternal(uri.AbsoluteUri);
            else webView.CoreWebView2.Navigate(uri.AbsoluteUri);
        }

        private void OnDownloadStarting(object sender, CoreWebView2DownloadStartingEventArgs args)
        {
            CoreWebView2Deferral deferral = args.GetDeferral();
            try
            {
                using (SaveFileDialog dialog = new SaveFileDialog())
                {
                    dialog.FileName = Path.GetFileName(args.ResultFilePath);
                    dialog.OverwritePrompt = true;
                    if (dialog.ShowDialog(this) == DialogResult.OK)
                    {
                        args.ResultFilePath = dialog.FileName;
                    }
                    else
                    {
                        args.Cancel = true;
                    }
                }
            }
            finally
            {
                deferral.Complete();
            }
        }

        private void OnWebMessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs args)
        {
            Dictionary<string, object> message;
            try
            {
                message = webMessageJson.DeserializeObject(args.WebMessageAsJson) as Dictionary<string, object>;
            }
            catch
            {
                return;
            }
            if (!string.Equals(JsonString(message, "type"), "nexcode:save-markdown", StringComparison.Ordinal)) return;

            string requestId = JsonString(message, "requestId");
            string markdown = JsonString(message, "content");
            if (string.IsNullOrWhiteSpace(requestId) || requestId.Length > 128 || markdown == null)
            {
                PostSaveResult(requestId, "error");
                return;
            }

            string fileName = SafeMarkdownFileName(JsonString(message, "fileName"));
            try
            {
                using (SaveFileDialog dialog = new SaveFileDialog())
                {
                    dialog.Title = "导出线程 Markdown";
                    dialog.FileName = fileName;
                    dialog.DefaultExt = "md";
                    dialog.AddExtension = true;
                    dialog.Filter = "Markdown 文件 (*.md)|*.md|所有文件 (*.*)|*.*";
                    dialog.OverwritePrompt = true;
                    dialog.CheckPathExists = true;
                    dialog.RestoreDirectory = true;
                    if (dialog.ShowDialog(this) != DialogResult.OK)
                    {
                        PostSaveResult(requestId, "cancelled");
                        return;
                    }

                    using (FileStream output = new FileStream(dialog.FileName, FileMode.Create, FileAccess.Write, FileShare.None))
                    using (StreamWriter writer = new StreamWriter(output, new UTF8Encoding(false)))
                    {
                        writer.Write(markdown);
                    }
                    PostSaveResult(requestId, "saved");
                }
            }
            catch (Exception)
            {
                PostSaveResult(requestId, "error");
            }
        }

        private void PostSaveResult(string requestId, string status)
        {
            if (!webViewReady || webView.CoreWebView2 == null || string.IsNullOrWhiteSpace(requestId)) return;
            string payload = webMessageJson.Serialize(new Dictionary<string, string>
            {
                { "type", "nexcode:save-markdown-result" },
                { "requestId", requestId },
                { "status", status }
            });
            webView.CoreWebView2.PostWebMessageAsJson(payload);
        }

        private static string SafeMarkdownFileName(string value)
        {
            string candidate;
            try { candidate = Path.GetFileName((value ?? "thread.md").Trim()); }
            catch { candidate = "thread.md"; }
            if (string.IsNullOrWhiteSpace(candidate)) candidate = "thread.md";
            foreach (char invalid in Path.GetInvalidFileNameChars()) candidate = candidate.Replace(invalid, '-');
            if (!candidate.EndsWith(".md", StringComparison.OrdinalIgnoreCase)) candidate += ".md";
            return candidate;
        }

        private static string JsonString(Dictionary<string, object> value, string key)
        {
            if (value == null) return null;
            object result;
            return value.TryGetValue(key, out result) ? result as string : null;
        }

        private async void BeginUpdateCheck(bool interactive)
        {
            if (updateCheckRunning) return;
            updateCheckRunning = true;
            try
            {
                UpdateRelease release = await updates.CheckForUpdateAsync();
                if (release == null)
                {
                    if (interactive)
                    {
                        MessageBox.Show(this, "当前已是最新版本（" + updates.CurrentVersion + "）。", "NexCode 更新", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    }
                    return;
                }

                DialogResult choice = MessageBox.Show(
                    this,
                    "发现 NexCode " + release.Version + "。是否立即下载更新并自动重启？",
                    "NexCode 更新",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Information);
                if (choice != DialogResult.Yes) return;

                trayIcon.ShowBalloonTip(2500, "NexCode 更新", "正在下载并校验 Windows-Ota-Updata…", ToolTipIcon.Info);
                string installer = await updates.DownloadInstallerAsync(release);
                Process.Start(new ProcessStartInfo(installer, "/silent /ota")
                {
                    WorkingDirectory = Path.GetDirectoryName(installer),
                    UseShellExecute = true
                });
            }
            catch (Exception error)
            {
                if (interactive)
                {
                    MessageBox.Show(this, "检查或安装更新失败：" + error.Message, "NexCode 更新", MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
            }
            finally
            {
                updateCheckRunning = false;
            }
        }

        private static bool ShouldOpenExternally(Uri uri)
        {
            string scheme = uri.Scheme.ToLowerInvariant();
            if (scheme == "blob" || scheme == "data" || scheme == "about") return false;
            if (scheme != Uri.UriSchemeHttp && scheme != Uri.UriSchemeHttps) return true;
            string host = uri.Host;
            return !string.Equals(host, "localhost", StringComparison.OrdinalIgnoreCase)
                && !string.Equals(host, "127.0.0.1", StringComparison.OrdinalIgnoreCase)
                && !string.Equals(host, "::1", StringComparison.OrdinalIgnoreCase);
        }

        private void NotifyOAuthComplete()
        {
            ShowAndActivate();
            if (!webViewReady || webView.CoreWebView2 == null || overlay.Visible)
            {
                oauthNotificationPending = true;
                return;
            }
            oauthNotificationPending = false;
            webView.CoreWebView2.ExecuteScriptAsync(
                "window.dispatchEvent(new Event('nexcode:oauth-complete'))");
        }

        private void ReloadDashboard()
        {
            if (webViewReady && webView.CoreWebView2 != null) webView.Reload();
            else if (pendingDashboard != null) ShowDashboard(pendingDashboard);
        }

        private void ShowAndActivate()
        {
            if (!Visible) Show();
            if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
            ShowInTaskbar = true;
            Activate();
            BringToFront();
        }

        private void OnFormClosing(object sender, FormClosingEventArgs args)
        {
            if (allowClose || args.CloseReason == CloseReason.WindowsShutDown) return;
            args.Cancel = true;
            Hide();
            ShowInTaskbar = false;
            if (!closeHintShown)
            {
                closeHintShown = true;
                trayIcon.ShowBalloonTip(2500, "NexCode 仍在运行", "双击托盘图标可重新打开；选择“完全退出”会安全关闭管理服务。", ToolTipIcon.Info);
            }
        }

        private void OnWindowKeyDown(object sender, KeyEventArgs args)
        {
            if (args.Control && args.KeyCode == Keys.R)
            {
                args.SuppressKeyPress = true;
                ReloadDashboard();
            }
            else if (args.Control && args.KeyCode == Keys.Q)
            {
                args.SuppressKeyPress = true;
                ExitApplication();
            }
            else if (args.KeyCode == Keys.F11)
            {
                args.SuppressKeyPress = true;
                ToggleFullScreen();
            }
        }

        private void ToggleFullScreen()
        {
            if (!fullScreen)
            {
                restoredWindowState = WindowState;
                restoredBounds = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
                restoredBorderStyle = FormBorderStyle;
                WindowState = FormWindowState.Normal;
                MaximumSize = Size.Empty;
                MinimumSize = Size.Empty;
                FormBorderStyle = FormBorderStyle.None;
                Bounds = Screen.FromControl(this).Bounds;
                fullScreen = true;
            }
            else
            {
                FormBorderStyle = restoredBorderStyle;
                Bounds = restoredBounds;
                double scale = Math.Max(1.0, DeviceDpi / 96.0);
                MinimumSize = SizeFromClientSize(new Size(
                    (int)Math.Round(MinimumClientWidth * scale),
                    (int)Math.Round(MinimumClientHeight * scale)));
                MaximumSize = Size.Empty;
                WindowState = restoredWindowState;
                fullScreen = false;
            }
        }

        private async void ExitApplication()
        {
            if (exiting) return;
            exiting = true;
            ShowAndActivate();
            ShowLoading(true);
            await runtime.StopAsync();
            allowClose = true;
            trayIcon.Visible = false;
            Close();
        }

        private static void OpenExternal(string target)
        {
            try
            {
                Process.Start(new ProcessStartInfo(target) { UseShellExecute = true });
            }
            catch (Win32Exception) { }
        }

        private void OnUi(Action action)
        {
            if (IsDisposed) return;
            if (InvokeRequired) BeginInvoke(action);
            else action();
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                trayIcon.Visible = false;
                trayIcon.Dispose();
                runtime.Dispose();
                webView.Dispose();
            }
            base.Dispose(disposing);
        }
    }
}
