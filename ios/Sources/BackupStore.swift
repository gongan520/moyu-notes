import Foundation
import WebKit

/// 笔记库的本地快照。
/// 存在的理由：WebKit 在存储紧张时可能清掉 IndexedDB，
/// 或者本地服务器换了端口导致 origin 变化、读不到旧数据。
/// 把整库 JSON 落到 App 沙盒的 Documents 里，重装前都不会丢。
final class BackupStore {

    static let shared = BackupStore()

    private let fm = FileManager.default

    var dir: URL {
        let d = fm.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("MoYu", isDirectory: true)
        if !fm.fileExists(atPath: d.path) {
            try? fm.createDirectory(at: d, withIntermediateDirectories: true)
        }
        return d
    }

    var fileURL: URL { dir.appendingPathComponent("library.json") }

    /// 读取快照文本（用于注入到页面里做恢复）
    func readText() -> String? {
        guard let d = try? Data(contentsOf: fileURL), d.count > 8 else { return nil }
        return String(data: d, encoding: .utf8)
    }

    @discardableResult
    func save(json: String) -> Bool {
        guard let d = json.data(using: .utf8) else { return false }
        do {
            try d.write(to: fileURL, options: .atomic)
            return true
        } catch {
            print("[backup] 写入失败 \(error)")
            return false
        }
    }

    /// 把快照包成可安全注入的 JS 字面量
    func injectedScript(limit: Int = 24 * 1024 * 1024) -> String? {
        guard let text = readText() else { return nil }
        guard text.utf8.count < limit else {
            print("[backup] 快照过大，跳过注入")
            return nil
        }
        guard let arr = try? JSONSerialization.data(withJSONObject: [text], options: []),
              var literal = String(data: arr, encoding: .utf8) else { return nil }
        // JSONSerialization 给出 ["..."]，去掉方括号就是合法的 JS 字符串字面量
        literal.removeFirst()
        literal.removeLast()
        return "window.__MOYU_BACKUP__ = \(literal);"
    }
}

/// JS -> 原生：保存快照
final class BackupBridge: NSObject, WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard message.name == "moyuBackup",
              let dict = message.body as? [String: Any],
              let action = dict["action"] as? String else { return }

        if action == "save", let json = dict["json"] as? String {
            DispatchQueue.global(qos: .utility).async {
                BackupStore.shared.save(json: json)
            }
        }
    }
}
