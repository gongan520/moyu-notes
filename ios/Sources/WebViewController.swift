import UIKit
import WebKit

final class WebViewController: UIViewController {

    private var webView: WKWebView!
    private var server: LocalHTTPServer?
    private var bridge: Bridge?
    private var backupBridge: BackupBridge?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.051, green: 0.051, blue: 0.059, alpha: 1)

        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        if #available(iOS 14.0, *) {
            config.defaultWebpagePreferences.allowsContentJavaScript = true
        }

        let controller = WKUserContentController()

        // 关键：在页面脚本执行之前把上次的原生快照注入进去，
        // 由 backup.js 判断本地库是否为空并自动回灌。
        if let script = BackupStore.shared.injectedScript() {
            controller.addUserScript(WKUserScript(source: script,
                                                  injectionTime: .atDocumentStart,
                                                  forMainFrameOnly: true))
        }

        let br = Bridge(host: self)
        controller.add(br, name: "moyuSave")
        controller.add(br, name: "moyuOpen")
        config.userContentController = controller
        self.bridge = br

        let bb = BackupBridge()
        controller.add(bb, name: "moyuBackup")
        self.backupBridge = bb

        webView = WKWebView(frame: view.bounds, configuration: config)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.bounces = false
        webView.scrollView.alwaysBounceVertical = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.allowsBackForwardNavigationGestures = false
        webView.allowsLinkPreview = false
        webView.navigationDelegate = self
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }
        view.addSubview(webView)

        loadApp()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        // 写笔记时不希望屏幕自动熄灭
        UIApplication.shared.isIdleTimerDisabled = true
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        UIApplication.shared.isIdleTimerDisabled = false
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }
    override var prefersStatusBarHidden: Bool { false }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .all }

    // MARK: - 载入

    private func loadApp() {
        guard let www = Bundle.main.url(forResource: "www", withExtension: nil) else {
            webView.loadHTMLString("<h1 style='color:#fff;font-family:-apple-system'>未找到 www 资源</h1>", baseURL: nil)
            return
        }

        let s = LocalHTTPServer(root: www)
        if let port = s.start() {
            server = s
            if let url = URL(string: "http://127.0.0.1:\(port)/index.html") {
                webView.load(URLRequest(url: url))
                return
            }
        }

        // 兜底：直接读文件（部分设备上存储能力会受限，但至少能用）
        let index = www.appendingPathComponent("index.html")
        webView.loadFileURL(index, allowingReadAccessTo: www)
    }
}

// MARK: - 导航策略

extension WebViewController: WKNavigationDelegate {

    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }
        // 只允许留在本地应用内
        if url.scheme == "http" || url.scheme == "https" {
            if url.host == "127.0.0.1" || url.host == "localhost" {
                decisionHandler(.allow)
                return
            }
            UIApplication.shared.open(url, options: [:], completionHandler: nil)
            decisionHandler(.cancel)
            return
        }
        if url.scheme == "file" || url.scheme == "about" {
            decisionHandler(.allow)
            return
        }
        UIApplication.shared.open(url, options: [:], completionHandler: nil)
        decisionHandler(.cancel)
    }
}

// MARK: - JS 桥：导出文件时调用系统分享

final class Bridge: NSObject, WKScriptMessageHandler {

    weak var host: UIViewController?

    init(host: UIViewController) {
        self.host = host
        super.init()
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        // 在系统浏览器里打开外部链接（笔记里的 <a href="https://...">）
        if message.name == "moyuOpen" {
            guard let dict = message.body as? [String: Any],
                  let s = dict["url"] as? String,
                  let url = URL(string: s) else { return }
            DispatchQueue.main.async {
                UIApplication.shared.open(url, options: [:], completionHandler: nil)
            }
            return
        }

        guard message.name == "moyuSave",
              let dict = message.body as? [String: Any],
              let name = dict["name"] as? String,
              let b64 = dict["data"] as? String,
              let data = Data(base64Encoded: b64, options: .ignoreUnknownCharacters) else {
            return
        }

        let safeName = name
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: ":", with: "_")
        let dir = FileManager.default.temporaryDirectory
        let fileURL = dir.appendingPathComponent(safeName.isEmpty ? "墨屿导出" : safeName)

        do {
            try data.write(to: fileURL, options: .atomic)
        } catch {
            return
        }

        DispatchQueue.main.async { [weak self] in
            guard let host = self?.host else { return }
            let av = UIActivityViewController(activityItems: [fileURL], applicationActivities: nil)
            if let pop = av.popoverPresentationController {
                pop.sourceView = host.view
                pop.sourceRect = CGRect(x: host.view.bounds.midX,
                                        y: host.view.bounds.maxY - 80,
                                        width: 1, height: 1)
                pop.permittedArrowDirections = []
            }
            host.present(av, animated: true)
        }
    }
}
