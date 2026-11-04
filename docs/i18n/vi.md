# REA Pro Max

**Thấu hiểu cơ chế. Tái tạo hành vi. Kiểm chứng kết quả.**

Bộ công cụ reverse engineering độc lập với MCP cục bộ, skill cho agent và CLI trực tiếp, dành cho Claude Code, Codex và client MCP tương thích. Biến một app, extension hay tính năng web chưa quen thuộc thành cơ chế có thể giải thích, mã triển khai có thể chạy và tập hành vi có thể kiểm chứng.

[English](../../README.md) · [Tiếng Việt](vi.md) · [한국어](ko.md) · [日本語](ja.md) · [Español](es.md) · [Português](pt-BR.md) · [简体中文](zh-CN.md) · [ไทย](th.md) · [Français](fr.md)

[Khám phá bản lab đã ghi lại](https://hieunguyenak92.github.io/rea-pro-max/#explorer) · [Cài skill](../INSTALL.md) · [Hồ sơ kiểm chứng](../VALIDATION.md) · [Bản phát hành](https://github.com/hieunguyenak92/rea-pro-max/releases)

![REA Pro Max — Understand the mechanism](../media/hero.png)

![Workbench REA Pro Max thực tế từ lab tổng hợp do dự án sở hữu](../media/workbench.png)

*Ảnh report thật từ mô hình JavaScript có Chrome API mô phỏng; đây không phải bằng chứng vòng đời Chromium thật.*

## Giao diện thuyết phục mới chỉ là điểm khởi đầu

Phần khó nằm sau cú nhấp: context nào nhận thông điệp, trạng thái tồn tại ở đâu, thao tác hủy thực sự dừng điều gì, lỗi nào trả về cho bên gọi và vì sao tính năng vừa dựng lại thất bại ở lần sử dụng thứ hai.

REA Pro Max đưa những câu hỏi đó vào quá trình triển khai. Phân tích JavaScript đã đóng gói. Đặt các giả thuyết cạnh tranh. Chọn phép thử phân biệt chúng. Dựng hành vi được yêu cầu ngay trong dự án của bạn. So sánh đầu ra, thay đổi trạng thái và sự kiện thực tế. Thu gọn lỗi thành chuỗi thao tác vẫn tái hiện đúng sai khác ban đầu.

**Thành phẩm là tính năng chạy được mà bạn yêu cầu, kèm bằng chứng.** Agent trong môi trường của bạn thực hiện việc lập trình và thao tác runtime; bộ công cụ đi kèm cung cấp phân tích, xếp hạng phép thử, đối chiếu hành vi và thu gọn lỗi bằng mã thực thi.

## Gắn skill vào công việc bạn đang làm

Sau khi [cài đặt](../INSTALL.md), giao việc bằng ngôn ngữ tự nhiên trong Claude Code:

```text
/rea-pro-max Phân tích cơ chế lưu và khôi phục của extension này rồi triển khai trong dự án của tôi. Lần theo popup, content script, worker và storage. Kiểm tra tính bền vững của dữ liệu sau khi xác nhận worker thực sự khởi động lại, giữ đúng hành vi lỗi và bàn giao mã chạy được, các ca đã kiểm tra cùng phần chưa xác minh.
```

Với Codex, chọn skill hoặc thêm `$rea-pro-max` trước yêu cầu tương tự. Bạn cung cấp mục tiêu và dự án nhận mã; agent chuẩn bị các tệp case nội bộ. Quan sát trình duyệt, app hoặc thiết bị thật cần công cụ tương ứng trong môi trường chạy agent.

Các công việc phù hợp:

- **Tái tạo một tính năng cụ thể** với thứ tự sự kiện, lỗi, hủy và ranh giới lưu trữ đúng yêu cầu.
- **Hiểu extension MV3** qua popup, content, page và worker trước khi sửa đổi.
- **Khôi phục ranh giới Electron** từ mã main, preload và renderer đã giải nén.
- **Tìm nguyên nhân hồi quy giữa hai bản build** bằng đầu vào và hiệu ứng có thể đối chiếu.
- **Thu gọn lỗi tái hiện được** mà vẫn giữ nguyên loại sai khác cần điều tra.

## Một bộ công cụ. Ba cách bắt đầu.

**v0.2 bổ sung MCP cục bộ với 12 công cụ** để agent gọi trực tiếp cơ chế phân tích và kiểm chứng. Skill cung cấp quy trình giao việc; CLI cho phép chạy và xem kết quả độc lập. Runtime đóng gói sẵn parser và SDK MCP chính thức, không cần cài npm khi sử dụng.

### Kết nối MCP với Claude Code hoặc Codex

Thay các đường dẫn tuyệt đối bằng đường dẫn thật trên máy. Workspace phải là thư mục đã tồn tại, chứa mục tiêu và nơi lưu kết quả bạn định dùng. Lệnh dưới đây là hướng dẫn để bạn chạy; sản phẩm không tự sửa cấu hình ứng dụng khác.

**Đường dẫn trong các lệnh bên dưới dùng cấu trúc Git checkout.** Với tệp ZIP skill đóng gói ở Releases, thư mục `rea-pro-max/` giải nén chính là gốc skill: chạy `node scripts/rea-pro-max.mjs demo --out ./rpm-lab`, dùng `/absolute/path/to/rea-pro-max/scripts/mcp-server.mjs` cho MCP và sao chép cả thư mục khi cài. [Phân biệt cấu trúc và lệnh ZIP — tiếng Anh](../INSTALL.md#choose-your-package-layout). Tệp Source code tự tạo của GitHub giữ cấu trúc checkout.

```sh
claude mcp add --transport stdio --scope local rea-pro-max -- node "/absolute/path/to/rea-pro-max/skills/rea-pro-max/scripts/mcp-server.mjs" --workspace "/absolute/path/to/your-workspace"
```

```sh
codex mcp add rea-pro-max -- node "/absolute/path/to/rea-pro-max/skills/rea-pro-max/scripts/mcp-server.mjs" --workspace "/absolute/path/to/your-workspace"
```

Kết nối lại host, kiểm tra danh sách công cụ rồi yêu cầu gọi `get_capabilities`. Nếu môi trường desktop có PATH khác, dùng đường dẫn tuyệt đối tới Node. [Hướng dẫn MCP tiếng Anh](../MCP.md) có cấu hình JSON, đối số, giới hạn và xử lý lỗi.

Server dùng stdio cục bộ. Nếu chạy trực tiếp, nó đợi thông điệp MCP thay vì in một giao diện tương tác:

```sh
node /absolute/path/to/rea-pro-max/skills/rea-pro-max/scripts/mcp-server.mjs --workspace /absolute/path/to/your-workspace
```

### Cài skill để giao việc tự nhiên

Sao chép **toàn bộ** thư mục `skills/rea-pro-max` vào `.claude/skills/rea-pro-max` của dự án Claude Code, hoặc `.agents/skills/rea-pro-max` của dự án Codex. Các thư mục `lib`, `scripts`, `references`, `assets` là một phần của sản phẩm; chỉ sao chép `SKILL.md` sẽ làm mất cơ chế thực thi.

Sau đó dùng `/rea-pro-max` trong Claude Code hoặc chọn/nhắc `$rea-pro-max` trong Codex. [INSTALL.md tiếng Anh](../INSTALL.md) có lệnh sao chép không ghi đè, vị trí cài cá nhân và hướng dẫn Windows.

### Chạy CLI và giữ kết quả của riêng bạn

Lệnh demo ngay bên dưới chạy độc lập với MCP. Bạn có thể dùng skill, MCP hoặc CLI theo môi trường hiện có; server REA gốc không phải điều kiện bắt buộc.

## Danh mục MCP: từ artifact đến kết quả có thể bàn giao

| Công cụ | Nhiệm vụ |
| --- | --- |
| `get_capabilities` | Xem phiên bản, workspace, phạm vi, giới hạn và chính sách thực thi. |
| `inspect_artifact` | Phân tích tĩnh mục tiêu trong phạm vi, lưu kết quả đầy đủ sau một handle. |
| `read_artifact` | Đọc từng phần hoặc từng trang thay vì lặp lại toàn bộ đồ thị. |
| `create_case` | Tạo case từ danh tính mục tiêu thực tế trong inspection. |
| `revise_case` | Kiểm tra patch và revision trước khi cập nhật mô hình. |
| `record_observation` | Lưu quan sát, nguồn, authority và bindings đã khai báo. |
| `rank_probes` | Xếp hạng phép thử hợp lệ; không tự chạy phép thử. |
| `verify_behavior` | So sánh tệp receipt theo hợp đồng hành vi hữu hạn. |
| `export_artifact` | Xuất JSON hoặc HTML độc lập vào tệp workspace mới. |
| `run_owned_lab` | Chạy mô hình kiểm soát với worker đi kèm do dự án sở hữu. |
| `list_task_prompts` | Xem 36 template theo nhóm và phân trang. |
| `import_case` | Tiếp tục từ case JSON đã xuất và được xác thực định dạng. |

Handle là định danh mờ trong bộ nhớ của tiến trình. Cache có giới hạn; khi khởi động lại hoặc bị loại khỏi cache, hãy import case đã lưu hoặc phân tích lại. `read_artifact` đọc phần cần thiết; schema công cụ mà client khám phá là hợp đồng đối số chính xác.

MCP giới hạn đường dẫn đầu vào/đầu ra do client chọn bên trong workspace, từ chối symlink và không ghi đè tệp đã có. Đây là chính sách của công cụ, không phải sandbox hệ điều hành cho Node hoặc công cụ khác của host. Không có lệnh shell, launcher app, điều khiển trình duyệt hay thực thi oracle tùy ý trong MCP. `run_owned_lab` chỉ chạy mã lab cố định được đóng gói.

## Chạy thử cơ chế trước khi tin vào lời hứa

Cần **Node.js 22+**. Bộ công cụ chạy trực tiếp, không cần API key, `npm install` hay server REA gốc.

```sh
git clone https://github.com/hieunguyenak92/rea-pro-max.git rea-pro-max
cd rea-pro-max
node skills/rea-pro-max/scripts/rea-pro-max.mjs demo --out ./rpm-lab
```

Mở `rpm-lab/report.html` bằng trình duyệt. Lab tổng hợp do dự án sở hữu chạy worker tham chiếu và worker lỗi trong **mô hình JavaScript được kiểm soát, dùng API Chrome mô phỏng**. Các kết quả phân tích, xếp hạng phép thử, phát hiện sai khác và thu gọn thao tác được kernel tính thật. Lab này **không** chứng minh worker Chromium thực sự bị tạm dừng. Các quan sát runtime riêng được ghi trong [hồ sơ kiểm chứng](../VALIDATION.md).

Tự phân tích artifact đi kèm:

```sh
node skills/rea-pro-max/scripts/rea-pro-max.mjs inspect ./rpm-lab/fixtures/mv3/reference --out inspection.json
node skills/rea-pro-max/scripts/rea-pro-max.mjs report inspection.json --out inspection.html
node skills/rea-pro-max/scripts/rea-pro-max.mjs prompts --target mv3
```

Chọn đường dẫn đầu ra mới: công cụ không âm thầm ghi đè kết quả có sẵn. Xem [cài đặt và CLI](../INSTALL.md), tài liệu tiếng Anh, để thiết lập môi trường và dùng thêm lệnh.

## Chất xám thể hiện bằng cơ chế có thể kiểm tra

| Năng lực | Giá trị trong thực tế |
| --- | --- |
| Phân tích ranh giới artifact | Parser AST Acorn, context riêng biệt, cạnh giao tiếp ứng viên, vị trí mã chính xác và digest. `inspect` không thực thi mã mục tiêu. |
| Giả thuyết cạnh tranh | Nêu rõ dự đoán và quy trình reset của phép thử, tránh chốt lời giải thích đầu tiên chỉ vì nghe hợp lý. |
| Xếp hạng phép thử thận trọng | Tối ưu số giả thuyết có thể loại trong trường hợp xấu nhất trên chi phí khai báo; lọc theo năng lực, hiệu ứng cho phép và ngân sách. Dự đoán thiếu vẫn là chưa biết. |
| Ràng buộc bằng chứng | Danh tính target, kịch bản, reset và toolchain ngăn quan sát không tương thích làm sai suy luận hiện tại. Hash xác định nội dung, không bảo chứng sự thật runtime. |
| Đối chiếu hành vi hữu hạn | Kết luận `pass`, `fail`, `unknown` trên output, state, effects và trace; giữ sự kiện lặp cùng thứ tự có ý nghĩa. |
| Thu gọn chuỗi lỗi | Loại bớt thao tác trong ngân sách, kiểm tra oracle lặp lại và giữ fingerprint lỗi. Không hứa chuỗi ngắn nhất toàn cục. |
| Workbench cục bộ | HTML độc lập, tìm kiếm, lọc context, chọn bằng chứng và xuất toàn bộ JSON; không cần backend hay CDN. |
| 36 prompt theo nhiệm vụ | Trải rộng web, extension, desktop và mobile, ghi rõ điều kiện cần. Có prompt không đồng nghĩa có provider đã kiểm chứng. |

Planner chọn câu hỏi tiếp theo, không tự chạy phép thử. Verifier so sánh quan sát được cung cấp, không tự xác nhận runtime đã chạy. Skill hướng agent thực hiện phần việc đó và giữ bằng chứng.

## Phạm vi rõ ràng để kết quả có giá trị

**Phân tích tích hợp ở v0.2:** tệp JavaScript và mã web, Manifest V3, Electron đã giải nén. Biểu thức động, cú pháp chưa hỗ trợ, import thiếu và giới hạn tài nguyên được nêu rõ.

**Kernel độc lập provider:** quản lý case, xếp hạng phép thử, đối chiếu hữu hạn, thu gọn chuỗi và báo cáo cục bộ. `shrink` thực thi module oracle `.mjs` do bạn cung cấp; hãy dùng mã do bạn sở hữu và kiểm soát.

**Quy trình nâng cao qua công cụ của host:** thư viện prompt có native, managed, Android, Apple, React Native, Flutter, Tauri và WebAssembly. Phân tích sâu cần công cụ phù hợp thực sự có sẵn. Phiên bản này không tích hợp decompiler đa năng, mobile runtime, bộ giải nén mọi định dạng hay engine khôi phục ngữ nghĩa. Nhận diện định dạng hoặc có prompt không phải bằng chứng tích hợp hoạt động.

CLI không gửi dữ liệu qua mạng hay telemetry. AI host và công cụ ngoài tuân theo chính sách riêng. Report có thể chứa đường dẫn, mã và giá trị nhạy cảm; đọc [quyền riêng tư và ranh giới thực thi](../PRIVACY.md), tài liệu tiếng Anh, trước khi chia sẻ.

## Bạn nhận được gì

Một yêu cầu tái tạo cần bàn giao source chạy được, cách khởi chạy, hợp đồng hành vi đã chọn, thao tác thực sự đã thử, tệp bằng chứng và giới hạn còn lại. Kết quả `pass` chỉ áp dụng cho các ca được kiểm tra, không xác nhận tương đương toàn bộ ứng dụng.

Lab xuất `inspection.json`, `case.json`, `planner.json`, `reference.json`, `candidate.json`, `verification.json`, `reduction.json`, `lab.json` và `report.html` độc lập. Bạn có thể xem riêng từng bản ghi, lưu cùng dự án và xuất toàn bộ payload JSON từ workbench.

## Ví dụ thật và bằng chứng có thể xem lại

**Tìm kiếm Unicode:** [implementation nhận mã](../../examples/recovered-search/CONTRACT.md) tái tạo hành vi tìm kiếm đã chọn của web fixture: NFKC, chuyển chữ thường theo locale, khớp chuỗi con, giữ thứ tự bản ghi và ID dạng chuỗi. Target và app nhận mã được mở riêng. Các ca hữu hạn và giới hạn được ghi trong [VALIDATION.md](../VALIDATION.md). Đây là ví dụ có quyền xem source do cùng agent xây và kiểm tra, chưa phải nghiên cứu mù hay benchmark tác động của skill.

![App tìm kiếm được khởi chạy riêng](../media/recovered-search.png)

**Electron export:** fixture do dự án sở hữu đã chạy qua renderer → preload → `ipcRenderer.invoke` → main, sau đó tệp JSON cục bộ được đọc lại. Phân tích tĩnh giữ mức candidate; quan sát runtime là bằng chứng cho thao tác thực sự đã thử.

![Kết quả export từ Electron thật](../media/electron-runtime.png)

## Những quyết định chuyên sâu bên trong

Điểm xếp hạng phép thử là số giả thuyết có thể loại trong trường hợp xấu nhất chia cho chi phí khai báo. Phép thử phải qua bộ lọc năng lực, hiệu ứng được phép và ngân sách. Nếu mọi giả thuyết đều mâu thuẫn với quan sát hợp lệ, planner trả về `model_incomplete`; không có phép thử phân biệt phù hợp có thể trả về `no_discriminating_probe`. Các trạng thái này giữ nguyên sự chưa biết thay vì biến nó thành phần trăm tự tin giả.

Verifier chỉ cho phép chuẩn hóa ở đường dẫn metadata đã chỉ định, không xóa khác biệt output/state/effects/trace. Hợp đồng thứ tự toàn phần hoặc theo channel giữ sự kiện lặp và thứ tự có ý nghĩa. Reducer chạy kiểm tra oracle lặp lại, hỗ trợ reset trước từng lần và giữ fingerprint lỗi; kết luận tối thiểu chỉ áp dụng cho phép loại thao tác đã thử.

## Câu hỏi thường gặp và xử lý vướng mắc

**Có bắt buộc cài cả MCP và skill không?** Không. MCP cung cấp công cụ có cấu trúc; skill cung cấp hướng dẫn thực hiện nhiệm vụ. CLI vẫn chạy trực tiếp.

**Skill có viết tính năng không?** Skill chỉ đạo agent triển khai và chạy tính năng trong dự án của bạn. Một report đơn lẻ chưa hoàn tất yêu cầu tái tạo.

**Case có còn sau khi tắt MCP không?** Hãy xuất case JSON trước khi tắt và dùng `import_case` trong phiên mới. Handle không tồn tại qua nhiều tiến trình.

**Vì sao kết quả là `unknown`?** Kiểm tra receipt thiếu, input không tương đương và bindings của scenario/reset/toolchain/verifier. `unknown` không được tự đổi thành `pass`.

| Vướng mắc | Cách xử lý |
| --- | --- |
| MCP không khởi động | Kiểm tra Node22+, đường dẫn tuyệt đối và workspace đã tồn tại. |
| Không thấy tool | Kết nối lại host, xem trạng thái server và quyền MCP của môi trường. |
| Handle không hợp lệ | Import case đã xuất hoặc phân tích lại sau khi server khởi động lại/cache loại mục. |
| Xung đột revision | Đọc bản case mới nhất rồi dùng revision thực tế. |
| Vượt giới hạn hoặc ngoài workspace | Chọn phạm vi artifact hẹp hơn hoặc khởi động server với workspace đúng. |
| Tệp kết quả đã có | Chọn tên mới để giữ bằng chứng cũ. |

Hướng phát triển tiếp theo: cải thiện phân giải tĩnh với độ bất định rõ ràng, thêm ví dụ phục hồi tính năng có thể tái lập và tích hợp provider theo phiên bản khi thực sự kiểm tra được. Đây là định hướng, không phải tính năng đã phát hành.

Tài liệu kỹ thuật tiếng Anh: [Skill](../../skills/rea-pro-max/SKILL.md) · [Phạm vi mục tiêu](../../skills/rea-pro-max/references/target-analysis.md) · [Định dạng case](../../skills/rea-pro-max/references/case-format.md) · [Hợp đồng kiểm chứng](../../skills/rea-pro-max/references/verification.md) · [Thư viện prompt](../../skills/rea-pro-max/references/prompt-library.md).

REA Pro Max được phát triển độc lập. Nguồn cảm hứng và thông báo thư viện ở [credits](../../THIRD_PARTY_NOTICES.md); REA gốc không phải dependency bắt buộc. [Giấy phép MIT](../../LICENSE).

**Mang đến một tính năng đáng để thấu hiểu. Nhận lại kết quả bạn có thể kiểm tra.**
