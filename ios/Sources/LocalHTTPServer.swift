import Foundation

/// 极简本地 HTTP 服务器。
/// 存在的唯一目的：让 WKWebView 以 http://127.0.0.1 的 origin 打开应用，
/// 这样 IndexedDB / localStorage 才能像 Safari 里一样正常工作并持久保存。
/// 只监听 127.0.0.1，不对外网暴露。
final class LocalHTTPServer {

    enum ServerError: Error {
        case socketFailed
        case bindFailed
        case listenFailed
    }

    private let root: URL
    private var listenFD: Int32 = -1
    private var running = false
    private let acceptQueue = DispatchQueue(label: "com.moyu.http.accept")
    private let workQueue = DispatchQueue(label: "com.moyu.http.work", attributes: .concurrent)

    private(set) var port: UInt16 = 0

    init(root: URL) {
        self.root = root
    }

    deinit {
        stop()
    }

    /// 优先使用固定端口，保证 origin 稳定（否则本地数据会因 origin 变化而读不到）
    @discardableResult
    func start(preferred: UInt16 = 47823) -> UInt16? {
        let candidates: [UInt16] = [preferred, preferred &+ 1, preferred &+ 2, preferred &+ 3, 0]
        for p in candidates {
            if let actual = try? open(port: p) {
                port = actual
                running = true
                acceptQueue.async { [weak self] in self?.acceptLoop() }
                return actual
            }
        }
        return nil
    }

    func stop() {
        guard running else { return }
        running = false
        if listenFD >= 0 {
            Darwin.shutdown(listenFD, Int32(SHUT_RDWR))
            Darwin.close(listenFD)
            listenFD = -1
        }
    }

    // MARK: - Socket

    private func open(port p: UInt16) throws -> UInt16 {
        let fd = Darwin.socket(AF_INET, Int32(SOCK_STREAM.rawValue), 0)
        guard fd >= 0 else { throw ServerError.socketFailed }

        var yes: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &yes, socklen_t(MemoryLayout<Int32>.size))
        setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &yes, socklen_t(MemoryLayout<Int32>.size))

        var addr = sockaddr_in()
        addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = p.bigEndian
        addr.sin_addr.s_addr = inet_addr("127.0.0.1")

        let bound = withUnsafePointer(to: &addr) { ptr -> Int32 in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sa in
                Darwin.bind(fd, sa, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard bound == 0 else {
            Darwin.close(fd)
            throw ServerError.bindFailed
        }

        guard Darwin.listen(fd, 32) == 0 else {
            Darwin.close(fd)
            throw ServerError.listenFailed
        }

        var actual = sockaddr_in()
        var len = socklen_t(MemoryLayout<sockaddr_in>.size)
        _ = withUnsafeMutablePointer(to: &actual) { ptr -> Int32 in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sa in
                getsockname(fd, sa, &len)
            }
        }

        listenFD = fd
        return UInt16(bigEndian: actual.sin_port)
    }

    private func acceptLoop() {
        while running {
            var caddr = sockaddr_in()
            var clen = socklen_t(MemoryLayout<sockaddr_in>.size)
            let client = withUnsafeMutablePointer(to: &caddr) { ptr -> Int32 in
                ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sa in
                    Darwin.accept(listenFD, sa, &clen)
                }
            }
            if client < 0 {
                if !running { break }
                continue
            }
            workQueue.async { [weak self] in
                self?.handle(client)
            }
        }
    }

    // MARK: - 请求处理

    private func handle(_ fd: Int32) {
        defer { Darwin.close(fd) }

        var tv = timeval(tv_sec: 6, tv_usec: 0)
        setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))

        var buffer = [UInt8](repeating: 0, count: 8192)
        let n = Darwin.recv(fd, &buffer, buffer.count, 0)
        guard n > 0 else { return }

        let request = String(decoding: buffer[0..<n], as: UTF8.self)
        guard let head = request.components(separatedBy: "\r\n").first else { return }
        let parts = head.split(separator: " ")
        guard parts.count >= 2 else { return }

        let method = String(parts[0])
        var path = String(parts[1])

        guard method == "GET" || method == "HEAD" else {
            sendText(fd, status: "405 Method Not Allowed", body: "Method Not Allowed")
            return
        }
        if let q = path.firstIndex(of: "?") { path = String(path[..<q]) }
        path = path.removingPercentEncoding ?? path
        if path.isEmpty || path == "/" { path = "/index.html" }

        let safeParts = path.split(separator: "/").filter { $0 != ".." && $0 != "." }
        let fileURL = root.appendingPathComponent(safeParts.joined(separator: "/"))

        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: fileURL.path, isDirectory: &isDir),
              !isDir.boolValue,
              let data = try? Data(contentsOf: fileURL) else {
            sendText(fd, status: "404 Not Found", body: "Not Found")
            return
        }

        let mime = LocalHTTPServer.mimeType(for: fileURL.pathExtension)
        var header = "HTTP/1.1 200 OK\r\n"
        header += "Content-Type: \(mime)\r\n"
        header += "Content-Length: \(data.count)\r\n"
        header += "Cache-Control: no-cache\r\n"
        header += "Connection: close\r\n"
        header += "\r\n"

        writeAll(fd, Array(header.utf8))
        if method == "GET" {
            writeAll(fd, [UInt8](data))
        }
    }

    private func sendText(_ fd: Int32, status: String, body: String) {
        let bytes = Array(body.utf8)
        var header = "HTTP/1.1 \(status)\r\n"
        header += "Content-Type: text/plain; charset=utf-8\r\n"
        header += "Content-Length: \(bytes.count)\r\n"
        header += "Connection: close\r\n\r\n"
        writeAll(fd, Array(header.utf8))
        writeAll(fd, bytes)
    }

    private func writeAll(_ fd: Int32, _ bytes: [UInt8]) {
        var offset = 0
        let total = bytes.count
        while offset < total {
            let sent = bytes.withUnsafeBytes { raw -> Int in
                guard let base = raw.baseAddress else { return -1 }
                return Darwin.send(fd, base.advanced(by: offset), total - offset, 0)
            }
            if sent <= 0 { break }
            offset += sent
        }
    }

    // MARK: - MIME

    static func mimeType(for ext: String) -> String {
        switch ext.lowercased() {
        case "html", "htm": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json", "webmanifest": return "application/json; charset=utf-8"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "webp": return "image/webp"
        case "gif": return "image/gif"
        case "ico": return "image/x-icon"
        case "woff": return "font/woff"
        case "woff2": return "font/woff2"
        case "ttf": return "font/ttf"
        case "otf": return "font/otf"
        case "mp4": return "video/mp4"
        case "pdf": return "application/pdf"
        case "txt", "md": return "text/plain; charset=utf-8"
        default: return "application/octet-stream"
        }
    }
}
