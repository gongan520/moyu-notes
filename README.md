# 墨屿 · 手写笔记

一个专为 **iPad + Apple Pencil** 做的笔记应用：把 AI 生成的 `.html` 文件导进来，它能像一张纸一样铺开，**原样式完整保留**，然后你直接在页面上手写批注。

- 纯前端，无账号、无服务器、数据只存在你自己的设备上
- 既能当网页用（Safari 添加到主屏幕），也能打包成真正的 `.ipa` 装进 iPad

---

## 一、它有什么

**手写**
- 压感变宽钢笔（Apple Pencil 压力实时生效）、均匀圆珠笔、铅笔、荧光笔
- 像素橡皮（擦局部）/ 整笔删除（点到即消失）
- 12 色快速调色板 + 自定义取色
- 1–44 px 笔尖，实时预览
- 矢量存储：放大 600% 依然锐利
- 撤销 / 重做（160 步）

**HTML 笔记**
- 导入 `.html` / `.htm`，自动补全文档骨架、charset、viewport
- 内容多高，纸就多长；超过一页自动分页，可以一页页手写
- 原页面的 CSS、字体、渐变、Flex/Grid 布局、外链图片全部按原样渲染
- 「底稿」开关：一键隐藏网页只看笔迹；「浏览」模式：网页里的链接和交互可点
- 外链自动拦截，防止把笔记页导航走

**编辑**
- 套索选择 → 移动 / 复制 / 改色 / 置顶 / 删除
- 形状：矩形、椭圆、直线、箭头
- 文字框、插入图片
- 页面管理：新增 / 复制 / 删除 / 缩略图跳转
- 纸张模板：空白、横线、方格、点阵、康奈尔、五线谱；5 种纸色
- 双指缩放平移，单手拖动，适应宽度 / 适应整页
- 导出 PDF、导出 PNG、整库 JSON 备份与恢复

---

## 二、用 Safari 直接用（最快）

1. 把整个仓库发布成静态站点（GitHub Pages / Vercel / Cloudflare Pages 都行）
2. iPad 用 Safari 打开那个网址
3. 点「分享 → 添加到主屏幕」，之后从桌面图标进入，全屏无地址栏

> 注意：iOS 上 Safari 的 IndexedDB 在**普通标签页**里也能存，但退到后台久了可能被系统清理。添加到主屏幕后（standalone 模式）存储更稳定。重要笔记请定期「备份全部」。

---

## 三、打包成 .ipa（GitHub 云端 macOS 编译）

仓库里已经准备好了 iOS 原生外壳（`ios/`）和 GitHub Actions 工作流（`.github/workflows/build-ipa.yml`）。

外壳做的事很简单：内置一个只监听 `127.0.0.1` 的迷你 HTTP 服务器，把 `www/` 里的前端以 `http://127.0.0.1:47823` 的 origin 打开。这样 IndexedDB 才能像在 Safari 里一样正常工作并持久保存（直接用 `file://` 加载，WebKit 会禁掉本地存储）。

### 步骤

```bash
git init
git add .
git commit -m "墨屿 初版"
git branch -M main
git remote add origin https://github.com/<你的账号>/<仓库名>.git
git push -u origin main
```

推送后 GitHub 会自动跑 `Build unsigned IPA`：

1. 打开仓库 → **Actions** → 左侧 `Build unsigned IPA`
2. 等 5–10 分钟（首次要 `brew install xcodegen`）
3. 进入这次运行 → 页面底部 **Artifacts** → 下载 `MoYu-unsigned-ipa`

解压得到 `MoYu-unsigned.ipa`。

> 也可以手动触发：Actions → Build unsigned IPA → **Run workflow**。
> 打 tag（`git tag v1.0.0 && git push --tags`）会自动把 ipa 附到 Release 上，方便直接下载。

### 装到 iPad 上

ipa 是**未签名**的，需要你自己用 Apple ID 签一次名：

| 工具 | 平台 | 说明 |
|---|---|---|
| **Sideloadly** | Windows / macOS | 最省事，连数据线，输入 Apple ID，拖入 ipa 即可 |
| **AltStore / SideStore** | Windows / macOS | 装一次 AltServer，之后可在 iPad 上续签 |
| **TrollStore** | 仅特定 iOS 版本 | 永久安装，不用续签（需你的系统版本在支持范围内） |
| **ESign / 轻松签** | iOS | 用证书自签，需要自备证书 |

免费 Apple ID 签名 **7 天过期**，到期要重签一次（数据不会丢，因为数据在 App 沙盒里，重签同一个 Bundle ID 会保留）。

装完后如果提示「未受信任的开发者」，去 **设置 → 通用 → VPN与设备管理** 里信任一下；iOS 16+ 还要在 **设置 → 隐私与安全性 → 开发者模式** 打开开关。

Bundle ID 固定为 `com.moyu.notes`，想换就改 `ios/project.yml` 里的 `PRODUCT_BUNDLE_IDENTIFIER`。

---

## 四、目录结构

```
index.html              应用入口
css/app.css             视觉系统
js/util.js              工具、Toast、底部面板
js/idb.js               IndexedDB 封装（书 / 页 / 资源）
js/ink.js               墨迹渲染内核（压感变宽、平滑、命中检测）
js/htmlpage.js          HTML 导入、基线注入、高度同步、分页偏移
js/pdf.js               零依赖 PDF 生成器
js/library.js           书架
js/studio.js            编辑器（手势、工具、套索、撤销、导出）
js/boot.js              启动
manifest.webmanifest    PWA 清单
sw.js                   离线缓存
assets/                 图标
ios/                    iOS 原生外壳（XcodeGen 工程描述 + Swift 源码）
.github/workflows/      GitHub Actions：云端 macOS 打包 ipa
```

本地调试：

```bash
python -m http.server 8000
# 浏览器打开 http://localhost:8000
```

（必须用 http 打开，`file://` 下 IndexedDB 不可用。）

---

## 五、试用

`examples/示例-深度学习笔记.html` 是一个 AI 生成的网页笔记，导入后可以直接在上面圈画批注，用来验证「网页 + 手写」的效果。

---

## 六、已知边界（说清楚，不糊弄）

1. **网页底稿无法画进 PDF**。浏览器的安全模型不允许把 iframe 的渲染结果绘制到 canvas，所以导出 PDF 得到的是「纸张 + 手写笔迹」。要连网页一起保存，请在「浏览」模式下用系统的「分享 → 打印」。
2. **HTML 里引用的相对路径资源**（`./img/a.png`）导入后会失效，因为文件已经不在一起了。外链（https）和 base64 内联图片都正常。建议让 AI 生成 HTML 时用内联或绝对 URL。
3. 依赖 `window.innerHeight` 的 JS、`position: fixed` 的元素在分页模式下位置可能不对——这是分页本身带来的。
4. PDF 导出用 JPEG 内嵌，文字笔迹是位图，不是矢量文字。
5. 首版只做了单机存储，没有云同步。

---

MIT License
