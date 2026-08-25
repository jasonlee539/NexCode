import AppKit
import Darwin
import Foundation
import WebKit

/// WKWebView consumes pointer events even when the window is configured as
/// movable by its background. Keep a small native titlebar strip above the web
/// content so the window retains normal macOS dragging behaviour.
private final class WindowDragRegionView: NSView {
    override var mouseDownCanMoveWindow: Bool {
        true
    }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool {
        true
    }

    override func mouseDown(with event: NSEvent) {
        guard let window else { return }
        if event.clickCount == 2 {
            window.zoom(nil)
            return
        }
        window.performDrag(with: event)
    }
}

private struct RuntimeRecord: Decodable {
    let pid: Int?
    let port: Int
    let hostname: String?
}

private final class RuntimeController {
    var onReady: ((URL) -> Void)?
    var onFailure: ((String) -> Void)?

    private let workQueue = DispatchQueue(label: "com.nexcode.desktop.runtime", qos: .userInitiated)
    private let lock = NSLock()
    private var process: Process?
    private var stopping = false
    private var logTail = ""

    var hasManagedProcess: Bool {
        lock.lock()
        defer { lock.unlock() }
        return process?.isRunning == true
    }

    func start() {
        lock.lock()
        stopping = false
        logTail = ""
        lock.unlock()

        workQueue.async { [weak self] in
            guard let self else { return }

            if let existing = self.waitForHealthyRuntime(timeout: 1.2) {
                self.deliverReady(existing)
                return
            }

            guard let resources = Bundle.main.resourceURL else {
                self.deliverFailure("应用资源目录不可用。")
                return
            }
            let runtimeRoot = resources.appendingPathComponent("runtime", isDirectory: true)
            let bunURL = runtimeRoot.appendingPathComponent("bin/bun")
            let cliURL = runtimeRoot.appendingPathComponent("src/cli/index.ts")
            guard FileManager.default.isExecutableFile(atPath: bunURL.path),
                  FileManager.default.fileExists(atPath: cliURL.path) else {
                self.deliverFailure("NexCode 运行时不完整，请重新构建应用。")
                return
            }

            let child = Process()
            child.executableURL = bunURL
            child.arguments = [cliURL.path, "start"]
            child.currentDirectoryURL = runtimeRoot
            child.standardInput = FileHandle.nullDevice

            var environment = self.desktopRuntimeEnvironment()
            environment["NEXCODE_DESKTOP_APP"] = "1"
            environment["NXC_BUN_RUNTIME_SOURCE"] = "bundled"
            environment["NXC_BUN_RUNTIME_PATH"] = bunURL.path
            environment["PATH"] = self.desktopPath(environment["PATH"])
            child.environment = environment

            let outputPipe = Pipe()
            let errorPipe = Pipe()
            child.standardOutput = outputPipe
            child.standardError = errorPipe
            self.capture(outputPipe.fileHandleForReading)
            self.capture(errorPipe.fileHandleForReading)

            child.terminationHandler = { [weak self, weak child] process in
                guard let self else { return }
                outputPipe.fileHandleForReading.readabilityHandler = nil
                errorPipe.fileHandleForReading.readabilityHandler = nil
                self.lock.lock()
                let wasStopping = self.stopping
                if self.process === child { self.process = nil }
                self.lock.unlock()
                guard !wasStopping else { return }

                self.workQueue.asyncAfter(deadline: .now() + 0.4) {
                    if let replacement = self.waitForHealthyRuntime(timeout: 5) {
                        self.deliverReady(replacement)
                        return
                    }
                    let detail = self.currentLogTail()
                    let suffix = detail.isEmpty ? "" : "\n\n最近的运行日志：\n\(detail)"
                    self.deliverFailure("NexCode 代理已退出（状态码 \(process.terminationStatus)）。\(suffix)")
                }
            }

            do {
                try child.run()
            } catch {
                outputPipe.fileHandleForReading.readabilityHandler = nil
                errorPipe.fileHandleForReading.readabilityHandler = nil
                self.deliverFailure("无法启动 NexCode 运行时：\(error.localizedDescription)")
                return
            }

            self.lock.lock()
            self.process = child
            self.lock.unlock()

            if let dashboard = self.waitForHealthyRuntime(timeout: 30) {
                self.deliverReady(dashboard)
                return
            }

            if child.isRunning { child.terminate() }
            let detail = self.currentLogTail()
            let suffix = detail.isEmpty ? "" : "\n\n最近的运行日志：\n\(detail)"
            self.deliverFailure("本地代理未能在 30 秒内就绪。\(suffix)")
        }
    }

    func restart() {
        stop { [weak self] in self?.start() }
    }

    func stop(completion: @escaping () -> Void) {
        lock.lock()
        stopping = true
        let child = process
        lock.unlock()

        guard let child, child.isRunning else {
            DispatchQueue.main.async(execute: completion)
            return
        }

        child.terminate()
        workQueue.async {
            let deadline = Date().addingTimeInterval(12)
            while child.isRunning && Date() < deadline {
                Thread.sleep(forTimeInterval: 0.1)
            }
            if child.isRunning { kill(child.processIdentifier, SIGKILL) }
            DispatchQueue.main.async(execute: completion)
        }
    }

    private func capture(_ handle: FileHandle) {
        handle.readabilityHandler = { [weak self] source in
            let data = source.availableData
            guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }
            self?.appendLog(text)
        }
    }

    private func appendLog(_ text: String) {
        lock.lock()
        logTail.append(text)
        if logTail.count > 6_000 { logTail = String(logTail.suffix(6_000)) }
        lock.unlock()
    }

    private func currentLogTail() -> String {
        lock.lock()
        defer { lock.unlock() }
        return logTail.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func desktopPath(_ inherited: String?) -> String {
        let user = FileManager.default.homeDirectoryForCurrentUser.path
        let preferred = [
            "\(user)/.bun/bin",
            "\(user)/.local/bin",
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
            "/usr/sbin",
            "/sbin",
        ]
        let inheritedParts = (inherited ?? "").split(separator: ":").map(String.init)
        return Array(NSOrderedSet(array: preferred + inheritedParts))
            .compactMap { $0 as? String }
            .joined(separator: ":")
    }

    /// Finder-launched apps do not inherit variables configured by the user's login
    /// shell. NexCode's account quota requests use the same proxy settings as Codex,
    /// so import only the small proxy allow-list instead of copying the whole shell
    /// environment (which may contain secrets unrelated to this app).
    private func desktopRuntimeEnvironment() -> [String: String] {
        var environment = ProcessInfo.processInfo.environment
        for (key, value) in loginShellProxyEnvironment() where environment[key] == nil {
            environment[key] = value
        }
        appendLoopbackBypass(to: &environment, key: "NO_PROXY")
        appendLoopbackBypass(to: &environment, key: "no_proxy")
        return environment
    }

    private func loginShellProxyEnvironment() -> [String: String] {
        let shell = loginShellPath()
        guard FileManager.default.isExecutableFile(atPath: shell) else { return [:] }

        let task = Process()
        task.executableURL = URL(fileURLWithPath: shell)
        task.arguments = ["-l", "-i", "-c", "/usr/bin/env -0"]
        task.environment = ProcessInfo.processInfo.environment
        task.standardInput = FileHandle.nullDevice
        task.standardError = FileHandle.nullDevice
        let output = Pipe()
        task.standardOutput = output

        do {
            try task.run()
        } catch {
            return [:]
        }

        let deadline = Date().addingTimeInterval(3)
        while task.isRunning && Date() < deadline {
            Thread.sleep(forTimeInterval: 0.03)
        }
        if task.isRunning {
            task.terminate()
            let terminationDeadline = Date().addingTimeInterval(0.35)
            while task.isRunning && Date() < terminationDeadline {
                Thread.sleep(forTimeInterval: 0.02)
            }
            if task.isRunning { kill(task.processIdentifier, SIGKILL) }
            return [:]
        }
        guard task.terminationStatus == 0 else { return [:] }

        let data = output.fileHandleForReading.readDataToEndOfFile()
        guard data.count <= 256 * 1_024,
              let raw = String(data: data, encoding: .utf8) else { return [:] }
        let allowed = Set([
            "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
            "http_proxy", "https_proxy", "all_proxy", "no_proxy",
        ])
        var result: [String: String] = [:]
        for entry in raw.split(separator: "\0", omittingEmptySubsequences: true) {
            guard let separator = entry.firstIndex(of: "=") else { continue }
            var key = String(entry[..<separator])
            // A noisy interactive shell can print a line before env's first NUL-delimited
            // entry. Retain only the text after that line when it is a permitted key.
            if let newline = key.lastIndex(of: "\n") {
                key = String(key[key.index(after: newline)...])
            }
            guard allowed.contains(key) else { continue }
            let value = String(entry[entry.index(after: separator)...])
            if validProxyEnvironmentValue(value, for: key) { result[key] = value }
        }
        return result
    }

    private func loginShellPath() -> String {
        if let inherited = ProcessInfo.processInfo.environment["SHELL"],
           FileManager.default.isExecutableFile(atPath: inherited) {
            return inherited
        }
        if let record = getpwuid(getuid()), let shell = record.pointee.pw_shell {
            let value = String(cString: shell)
            if FileManager.default.isExecutableFile(atPath: value) { return value }
        }
        return "/bin/zsh"
    }

    private func validProxyEnvironmentValue(_ value: String, for key: String) -> Bool {
        guard !value.isEmpty,
              !value.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else {
            return false
        }
        if key.lowercased() == "no_proxy" { return value.utf8.count <= 4_096 }
        guard value.utf8.count <= 2_048,
              let components = URLComponents(string: value),
              let scheme = components.scheme?.lowercased(),
              ["http", "https", "socks", "socks5", "socks5h"].contains(scheme),
              components.host != nil else { return false }
        return true
    }

    private func appendLoopbackBypass(to environment: inout [String: String], key: String) {
        let required = ["localhost", "127.0.0.1", "::1"]
        let existing = (environment[key] ?? "")
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        var values = existing
        for value in required where !values.contains(where: { $0.caseInsensitiveCompare(value) == .orderedSame }) {
            values.append(value)
        }
        environment[key] = values.joined(separator: ",")
    }

    private var configDirectory: URL {
        if let raw = ProcessInfo.processInfo.environment["NEXCODE_HOME"]?.trimmingCharacters(in: .whitespacesAndNewlines),
           !raw.isEmpty {
            return URL(fileURLWithPath: NSString(string: raw).expandingTildeInPath, isDirectory: true)
        }
        return FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".nexcode", isDirectory: true)
    }

    private func waitForHealthyRuntime(timeout: TimeInterval) -> URL? {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            for candidate in runtimeCandidates() {
                if healthCheck(candidate.url) { return candidate.url }
            }
            Thread.sleep(forTimeInterval: 0.18)
        } while Date() < deadline
        return nil
    }

    private func runtimeCandidates() -> [(url: URL, pid: Int?)] {
        var candidates: [(URL, Int?)] = []
        let recordURL = configDirectory.appendingPathComponent("runtime-port.json")
        if let data = try? Data(contentsOf: recordURL),
           let record = try? JSONDecoder().decode(RuntimeRecord.self, from: data),
           (1...65_535).contains(record.port) {
            let host = loopbackHost(record.hostname)
            if let url = URL(string: "http://\(host):\(record.port)/") {
                candidates.append((url, record.pid))
            }
        }

        let configURL = configDirectory.appendingPathComponent("config.json")
        var configuredPort = 10_100
        var configuredHost: String?
        if let data = try? Data(contentsOf: configURL),
           let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            if let port = object["port"] as? Int, (1...65_535).contains(port) { configuredPort = port }
            configuredHost = object["hostname"] as? String
        }
        let configuredURL = URL(string: "http://\(loopbackHost(configuredHost)):\(configuredPort)/")!
        if !candidates.contains(where: { $0.0.port == configuredURL.port }) {
            candidates.append((configuredURL, nil))
        }
        return candidates
    }

    private func loopbackHost(_ hostname: String?) -> String {
        let value = (hostname ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if value.isEmpty || value == "0.0.0.0" || value == "::" || value == "[::]" { return "127.0.0.1" }
        if value.contains(":") && !value.hasPrefix("[") { return "[\(value)]" }
        return value
    }

    private func healthCheck(_ dashboardURL: URL) -> Bool {
        guard let healthURL = URL(string: "healthz", relativeTo: dashboardURL)?.absoluteURL else { return false }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 0.75
        configuration.timeoutIntervalForResource = 0.9
        let session = URLSession(configuration: configuration)
        let semaphore = DispatchSemaphore(value: 0)
        var healthy = false
        let task = session.dataTask(with: healthURL) { data, response, _ in
            defer { semaphore.signal() }
            guard let http = response as? HTTPURLResponse,
                  http.statusCode == 200,
                  let data,
                  let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
            healthy = (object["service"] as? String)?.lowercased() == "nexcode"
                && (object["status"] as? String) == "ok"
        }
        task.resume()
        if semaphore.wait(timeout: .now() + 1) == .timedOut { task.cancel() }
        session.invalidateAndCancel()
        return healthy
    }

    private func deliverReady(_ url: URL) {
        DispatchQueue.main.async { [weak self] in self?.onReady?(url) }
    }

    private func deliverFailure(_ message: String) {
        DispatchQueue.main.async { [weak self] in self?.onFailure?(message) }
    }
}

private final class AppWindowController: NSWindowController, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    var onRetry: (() -> Void)?

    private let webView: WKWebView
    private let loadingView = NSVisualEffectView()
    private let statusLabel = NSTextField(labelWithString: "正在启动 NexCode")
    private let detailLabel = NSTextField(wrappingLabelWithString: "正在准备本地 AI 路由工作区…")
    private let progress = NSProgressIndicator()
    private let retryButton = NSButton(title: "重新启动", target: nil, action: nil)
    private var dashboardURL: URL?

    init() {
        let preferences = WKWebpagePreferences()
        preferences.allowsContentJavaScript = true
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences = preferences
        configuration.websiteDataStore = .default()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = true
        configuration.applicationNameForUserAgent = "NexCode/1.0"
        webView = WKWebView(frame: .zero, configuration: configuration)

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 940, height: 630),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        super.init(window: window)
        configureWindow(window)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func showLoading(stopping: Bool = false) {
        statusLabel.stringValue = stopping ? "正在安全退出 NexCode" : "正在启动 NexCode"
        detailLabel.stringValue = stopping ? "正在恢复客户端配置并关闭本地代理…" : "正在准备本地 AI 路由工作区…"
        retryButton.isHidden = true
        progress.isHidden = false
        progress.startAnimation(nil)
        loadingView.isHidden = false
        webView.isHidden = true
    }

    func showDashboard(_ url: URL) {
        dashboardURL = url
        loadingView.isHidden = false
        progress.isHidden = false
        retryButton.isHidden = true
        statusLabel.stringValue = "正在载入 NexCode"
        detailLabel.stringValue = "正在打开桌面工作区…"
        webView.isHidden = false
        webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20))
    }

    func showError(_ message: String) {
        progress.stopAnimation(nil)
        progress.isHidden = true
        statusLabel.stringValue = "NexCode 未能启动"
        detailLabel.stringValue = message
        retryButton.isHidden = false
        loadingView.isHidden = false
        webView.isHidden = true
    }

    func reloadDashboard() {
        if webView.url != nil { webView.reload() }
        else if let dashboardURL { showDashboard(dashboardURL) }
    }

    func notifyOAuthComplete() {
        showWindow(nil)
        window?.makeKeyAndOrderFront(nil)
        webView.evaluateJavaScript("window.dispatchEvent(new Event('nexcode:oauth-complete'))")
    }

    private func configureWindow(_ window: NSWindow) {
        window.title = "NexCode"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.isMovableByWindowBackground = true
        window.minSize = NSSize(width: 820, height: 560)
        window.center()
        // v6 adopts the balanced 1.5:1 workspace used by the focused dashboard,
        // then keeps the user's resized desktop window on later launches.
        window.setFrameAutosaveName("NexCode.MainWindow.v6")

        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.isHidden = true

        let root = NSView()
        root.wantsLayer = true
        root.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor
        window.contentView = root
        root.addSubview(webView)

        loadingView.material = .sidebar
        loadingView.blendingMode = .behindWindow
        loadingView.state = .active
        loadingView.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(loadingView)

        let iconView = NSImageView()
        iconView.imageScaling = .scaleProportionallyUpOrDown
        iconView.translatesAutoresizingMaskIntoConstraints = false
        if let iconURL = Bundle.main.url(forResource: "NexCode", withExtension: "icns") {
            iconView.image = NSImage(contentsOf: iconURL)
        }

        statusLabel.font = .systemFont(ofSize: 23, weight: .semibold)
        statusLabel.alignment = .center
        detailLabel.font = .systemFont(ofSize: 13)
        detailLabel.textColor = .secondaryLabelColor
        detailLabel.alignment = .center
        detailLabel.maximumNumberOfLines = 10
        detailLabel.preferredMaxLayoutWidth = 620

        progress.style = .spinning
        progress.controlSize = .regular
        progress.startAnimation(nil)
        retryButton.bezelStyle = .rounded
        retryButton.target = self
        retryButton.action = #selector(retryPressed)
        retryButton.isHidden = true

        let stack = NSStackView(views: [iconView, statusLabel, detailLabel, progress, retryButton])
        stack.orientation = .vertical
        stack.alignment = .centerX
        stack.spacing = 14
        stack.setCustomSpacing(22, after: iconView)
        stack.translatesAutoresizingMaskIntoConstraints = false
        loadingView.addSubview(stack)

        // Keep this view last (front-most). The first 76 points remain free for
        // the native traffic-light controls; the rest is a dedicated drag strip.
        let dragRegion = WindowDragRegionView()
        dragRegion.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(dragRegion)

        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            webView.topAnchor.constraint(equalTo: root.topAnchor),
            webView.bottomAnchor.constraint(equalTo: root.bottomAnchor),
            loadingView.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            loadingView.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            loadingView.topAnchor.constraint(equalTo: root.topAnchor),
            loadingView.bottomAnchor.constraint(equalTo: root.bottomAnchor),
            stack.centerXAnchor.constraint(equalTo: loadingView.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: loadingView.centerYAnchor, constant: -12),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: loadingView.leadingAnchor, constant: 40),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: loadingView.trailingAnchor, constant: -40),
            iconView.widthAnchor.constraint(equalToConstant: 92),
            iconView.heightAnchor.constraint(equalToConstant: 92),
            dragRegion.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: 76),
            dragRegion.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            dragRegion.topAnchor.constraint(equalTo: root.topAnchor),
            dragRegion.heightAnchor.constraint(equalToConstant: 30),
        ])
    }

    @objc private func retryPressed() {
        showLoading()
        onRetry?()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loadingView.isHidden = true
        webView.isHidden = false
        window?.title = "NexCode"
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        showError("界面载入失败：\(error.localizedDescription)")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showError("无法连接本地 NexCode：\(error.localizedDescription)")
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        if shouldOpenExternally(url) {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        if navigationAction.targetFrame == nil {
            webView.load(navigationAction.request)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationResponse: WKNavigationResponse,
        decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
    ) {
        let disposition = (navigationResponse.response as? HTTPURLResponse)?
            .value(forHTTPHeaderField: "Content-Disposition")?.lowercased() ?? ""
        if disposition.contains("attachment") || !navigationResponse.canShowMIMEType {
            decisionHandler(.download)
        } else {
            decisionHandler(.allow)
        }
    }

    private func shouldOpenExternally(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased() else { return false }
        if scheme == "blob" || scheme == "data" || scheme == "about" { return false }
        if scheme != "http" && scheme != "https" { return true }
        guard let host = url.host?.lowercased() else { return true }
        return host != "localhost" && host != "127.0.0.1" && host != "::1"
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        guard let url = navigationAction.request.url else { return nil }
        if shouldOpenExternally(url) { NSWorkspace.shared.open(url) }
        else { webView.load(navigationAction.request) }
        return nil
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping () -> Void
    ) {
        let alert = NSAlert()
        alert.messageText = "NexCode"
        alert.informativeText = message
        alert.addButton(withTitle: "确定")
        present(alert) { _ in completionHandler() }
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (Bool) -> Void
    ) {
        let alert = NSAlert()
        alert.messageText = "NexCode"
        alert.informativeText = message
        alert.addButton(withTitle: "确定")
        alert.addButton(withTitle: "取消")
        present(alert) { response in completionHandler(response == .alertFirstButtonReturn) }
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptTextInputPanelWithPrompt prompt: String,
        defaultText: String?,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (String?) -> Void
    ) {
        let input = NSTextField(string: defaultText ?? "")
        input.frame = NSRect(x: 0, y: 0, width: 420, height: 24)
        let alert = NSAlert()
        alert.messageText = "NexCode"
        alert.informativeText = prompt
        alert.accessoryView = input
        alert.addButton(withTitle: "确定")
        alert.addButton(withTitle: "取消")
        present(alert) { response in
            completionHandler(response == .alertFirstButtonReturn ? input.stringValue : nil)
        }
    }

    func webView(
        _ webView: WKWebView,
        runOpenPanelWith parameters: WKOpenPanelParameters,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping ([URL]?) -> Void
    ) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.canChooseFiles = true
        guard let window else {
            completionHandler(nil)
            return
        }
        panel.beginSheetModal(for: window) { response in
            completionHandler(response == .OK ? panel.urls : nil)
        }
    }

    private func present(_ alert: NSAlert, completion: @escaping (NSApplication.ModalResponse) -> Void) {
        if let window { alert.beginSheetModal(for: window, completionHandler: completion) }
        else { completion(alert.runModal()) }
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func download(
        _ download: WKDownload,
        decideDestinationUsing response: URLResponse,
        suggestedFilename: String,
        completionHandler: @escaping (URL?) -> Void
    ) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedFilename
        guard let window else {
            completionHandler(nil)
            return
        }
        panel.beginSheetModal(for: window) { result in
            completionHandler(result == .OK ? panel.url : nil)
        }
    }

    func downloadDidFinish(_ download: WKDownload) {}

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        let alert = NSAlert()
        alert.messageText = "下载失败"
        alert.informativeText = error.localizedDescription
        alert.addButton(withTitle: "确定")
        present(alert) { _ in }
    }
}

private final class AppDelegate: NSObject, NSApplicationDelegate {
    private let runtime = RuntimeController()
    private let appWindow = AppWindowController()
    private var waitingForTermination = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        configureMenu()
        NSApp.activate(ignoringOtherApps: true)
        appWindow.showWindow(nil)
        appWindow.showLoading()
        appWindow.onRetry = { [weak self] in self?.runtime.restart() }
        runtime.onReady = { [weak self] url in self?.appWindow.showDashboard(url) }
        runtime.onFailure = { [weak self] message in self?.appWindow.showError(message) }
        runtime.start()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        appWindow.showWindow(nil)
        appWindow.window?.makeKeyAndOrderFront(nil)
        return true
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        guard urls.contains(where: {
            $0.scheme?.lowercased() == "nexcode" && $0.host?.lowercased() == "oauth-complete"
        }) else { return }
        application.activate(ignoringOtherApps: true)
        appWindow.notifyOAuthComplete()
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard runtime.hasManagedProcess else { return .terminateNow }
        if waitingForTermination { return .terminateLater }
        waitingForTermination = true
        appWindow.showLoading(stopping: true)
        runtime.stop { NSApp.reply(toApplicationShouldTerminate: true) }
        return .terminateLater
    }

    @objc private func reloadDashboard() { appWindow.reloadDashboard() }

    @objc private func showAbout() {
        NSApp.orderFrontStandardAboutPanel(options: [
            .applicationName: "NexCode",
            .applicationVersion: "1.0.0",
            .version: "Local AI Router",
            .credits: NSAttributedString(string: "Independent desktop AI routing software.\nOpenCodex-derived portions are available under the MIT License."),
        ])
    }

    private func configureMenu() {
        let menu = NSMenu()

        let appItem = NSMenuItem()
        menu.addItem(appItem)
        let appMenu = NSMenu(title: "NexCode")
        appItem.submenu = appMenu
        let about = NSMenuItem(title: "关于 NexCode", action: #selector(showAbout), keyEquivalent: "")
        about.target = self
        appMenu.addItem(about)
        appMenu.addItem(.separator())
        appMenu.addItem(NSMenuItem(title: "隐藏 NexCode", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h"))
        let hideOthers = NSMenuItem(title: "隐藏其他应用", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(hideOthers)
        appMenu.addItem(NSMenuItem(title: "显示全部", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: ""))
        appMenu.addItem(.separator())
        appMenu.addItem(NSMenuItem(title: "退出 NexCode", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))

        let editItem = NSMenuItem()
        menu.addItem(editItem)
        let editMenu = NSMenu(title: "编辑")
        editItem.submenu = editMenu
        editMenu.addItem(NSMenuItem(title: "撤销", action: Selector(("undo:")), keyEquivalent: "z"))
        editMenu.addItem(NSMenuItem(title: "重做", action: Selector(("redo:")), keyEquivalent: "Z"))
        editMenu.addItem(.separator())
        editMenu.addItem(NSMenuItem(title: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x"))
        editMenu.addItem(NSMenuItem(title: "复制", action: #selector(NSText.copy(_:)), keyEquivalent: "c"))
        editMenu.addItem(NSMenuItem(title: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v"))
        editMenu.addItem(NSMenuItem(title: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a"))

        let viewItem = NSMenuItem()
        menu.addItem(viewItem)
        let viewMenu = NSMenu(title: "显示")
        viewItem.submenu = viewMenu
        let reload = NSMenuItem(title: "重新载入", action: #selector(reloadDashboard), keyEquivalent: "r")
        reload.target = self
        viewMenu.addItem(reload)
        viewMenu.addItem(.separator())
        viewMenu.addItem(NSMenuItem(title: "进入全屏幕", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f"))
        viewMenu.items.last?.keyEquivalentModifierMask = [.command, .control]

        let windowItem = NSMenuItem()
        menu.addItem(windowItem)
        let windowMenu = NSMenu(title: "窗口")
        windowItem.submenu = windowMenu
        windowMenu.addItem(NSMenuItem(title: "最小化", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m"))
        windowMenu.addItem(NSMenuItem(title: "缩放", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: ""))
        NSApp.windowsMenu = windowMenu

        NSApp.mainMenu = menu
    }
}

let nexCodeApp = NSApplication.shared
nexCodeApp.setActivationPolicy(.regular)
private let nexCodeDelegate = AppDelegate()
nexCodeApp.delegate = nexCodeDelegate
nexCodeApp.run()
